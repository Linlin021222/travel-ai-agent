import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { AI_REDIS } from './ai-redis.module.js';
import {
  AI_CACHE_DEFAULT_TTL,
  AI_CACHE_PREFIX,
  SESSION_CONTEXT_MAX_TURNS,
  aiChatCacheKey,
  aiLlmCacheKey,
  aiSessionKey,
  aiTaskStateKey,
  hashQuery,
} from './cache-keys.js';

export interface SessionTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
  at: string;
}

export interface SessionContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  turns: SessionTurn[];
  updatedAt: string;
}

export interface CacheProfile {
  enabled: boolean;
  ttlSeconds: number;
}

export interface ChatCacheLookup {
  tenantId: string;
  userId: string;
  question: string;
  /** Business dimension, e.g. `flight-delay`. Drives per-dimension TTL/switch. */
  dimension?: string;
  provider?: string;
  model?: string;
  filters?: unknown;
}

export interface ChatCacheEntry<T = unknown> {
  answer: T;
  cachedAt: string;
  dimension: string;
}

/**
 * Single entry point for every AI Redis operation.
 *
 * Namespaces: `ai:session:`, `ai:chat_cache:`, `ai:llm_cache:`, `ai:task_state:`.
 * Redis failures degrade to cache misses — they never break a request.
 */
@Injectable()
export class AiCacheService {
  private readonly logger = new Logger(AiCacheService.name);
  private failureCount = 0;

  constructor(
    @Inject(AI_REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  // ------------------------------------------------------------- infrastructure

  async isHealthy(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  /** Never let Redis outages surface as 500s. */
  private async safe<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.failureCount += 1;
      if (this.failureCount <= 3 || this.failureCount % 50 === 0) {
        this.logger.warn(
          `redis op failed (${this.failureCount}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return fallback;
    }
  }

  /** SCAN-based matcher (safe for production, unlike KEYS). */
  private async scanKeys(pattern: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  // ------------------------------------------------- 1. session short term memory

  async getSessionContext(tenantId: string, sessionId: string): Promise<SessionContext | null> {
    const raw = await this.safe(() => this.redis.get(aiSessionKey(tenantId, sessionId)), null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionContext;
    } catch {
      await this.clearSessionContext(tenantId, sessionId);
      return null;
    }
  }

  async setSessionContext(context: SessionContext): Promise<void> {
    const ttl = this.numberConfig('AI_SESSION_CACHE_TTL', AI_CACHE_DEFAULT_TTL.session);
    await this.safe(
      () =>
        this.redis.set(
          aiSessionKey(context.tenantId, context.sessionId),
          JSON.stringify(context),
          'EX',
          ttl,
        ),
      undefined,
    );
  }

  /**
   * Append a turn, keep only the newest {@link SESSION_CONTEXT_MAX_TURNS}.
   *
   * `loader` matters: on a cache miss we must rebuild from PostgreSQL instead
   * of starting an empty context, otherwise the fallback path never fires
   * (the append itself would re-warm an empty context first).
   */
  async appendSessionTurn(
    tenantId: string,
    sessionId: string,
    userId: string,
    turn: SessionTurn,
    loader?: () => Promise<SessionTurn[]>,
  ): Promise<SessionContext> {
    let context = await this.getSessionContext(tenantId, sessionId);
    if (!context) {
      const restored = loader ? await loader() : [];
      context = {
        sessionId,
        userId,
        tenantId,
        turns: restored.slice(-SESSION_CONTEXT_MAX_TURNS),
        updatedAt: new Date().toISOString(),
      };
    }
    context.turns = [...context.turns, turn].slice(-SESSION_CONTEXT_MAX_TURNS);
    context.updatedAt = new Date().toISOString();
    await this.setSessionContext(context);
    return context;
  }

  /** Called when a session is closed/archived/deleted. */
  async clearSessionContext(tenantId: string, sessionId: string): Promise<void> {
    await this.safe(() => this.redis.del(aiSessionKey(tenantId, sessionId)), undefined);
  }

  /**
   * Cache-first read. On a miss the `loader` pulls the conversation from
   * PostgreSQL and the result is re-warmed into Redis.
   */
  async getOrLoadSessionContext(
    tenantId: string,
    sessionId: string,
    userId: string,
    loader: () => Promise<SessionTurn[]>,
  ): Promise<{ context: SessionContext; source: 'cache' | 'database' }> {
    const cached = await this.getSessionContext(tenantId, sessionId);
    if (cached) return { context: cached, source: 'cache' };

    const turns = (await loader()).slice(-SESSION_CONTEXT_MAX_TURNS);
    const context: SessionContext = {
      sessionId,
      userId,
      tenantId,
      turns,
      updatedAt: new Date().toISOString(),
    };
    await this.setSessionContext(context);
    return { context, source: 'database' };
  }

  // ------------------------------------------------------- 2. chat result cache

  chatProfile(dimension = 'default'): CacheProfile {
    const defaults: CacheProfile = {
      enabled: this.config.get<string>('AI_CHAT_CACHE_ENABLED') !== 'false',
      ttlSeconds: this.numberConfig('AI_CHAT_CACHE_TTL', AI_CACHE_DEFAULT_TTL.chatCache),
    };
    const override = this.businessProfiles()[dimension] ?? {};
    return {
      enabled: override.enabled ?? defaults.enabled,
      ttlSeconds: override.ttlSeconds ?? defaults.ttlSeconds,
    };
  }

  private businessProfiles(): Record<string, Partial<CacheProfile>> {
    const raw = this.config.get<string>('AI_CACHE_BUSINESS_PROFILES');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, Partial<CacheProfile>>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      this.logger.warn('AI_CACHE_BUSINESS_PROFILES is not valid JSON; ignoring');
      return {};
    }
  }

  async getChatCache<T>(lookup: ChatCacheLookup): Promise<ChatCacheEntry<T> | null> {
    const dimension = lookup.dimension ?? 'default';
    if (!this.chatProfile(dimension).enabled) return null;

    const key = aiChatCacheKey(
      lookup.tenantId,
      lookup.userId,
      dimension,
      this.chatHash(lookup),
    );
    const raw = await this.safe(() => this.redis.get(key), null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as ChatCacheEntry<T>;
    } catch {
      await this.safe(() => this.redis.del(key), undefined);
      return null;
    }
  }

  async setChatCache<T>(lookup: ChatCacheLookup, answer: T): Promise<boolean> {
    const dimension = lookup.dimension ?? 'default';
    const profile = this.chatProfile(dimension);
    if (!profile.enabled) return false;

    const entry: ChatCacheEntry<T> = {
      answer,
      cachedAt: new Date().toISOString(),
      dimension,
    };
    const ok = await this.safe(
      () =>
        this.redis.set(
          aiChatCacheKey(lookup.tenantId, lookup.userId, dimension, this.chatHash(lookup)),
          JSON.stringify(entry),
          'EX',
          profile.ttlSeconds,
        ),
      null,
    );
    return ok === 'OK';
  }

  private chatHash(lookup: ChatCacheLookup): string {
    return hashQuery([
      lookup.question.trim().toLowerCase(),
      lookup.provider ?? '',
      lookup.model ?? '',
      lookup.filters ? JSON.stringify(lookup.filters) : '',
    ]);
  }

  /**
   * Drop cached answers when the underlying business data changes.
   * Any omitted field becomes a wildcard.
   */
  async invalidateChatCache(options: {
    tenantId: string;
    userId?: string;
    dimension?: string;
  }): Promise<number> {
    const pattern = `${AI_CACHE_PREFIX.chatCache}${options.tenantId}:${
      options.userId ?? '*'
    }:${options.dimension ?? '*'}:*`;
    const keys = await this.safe(() => this.scanKeys(pattern), []);
    if (!keys.length) return 0;
    await this.safe(() => this.redis.del(...keys), 0);
    return keys.length;
  }

  /** Admin operation: invalidate one business dimension across all tenants. */
  async invalidateBusinessDimension(dimension: string): Promise<number> {
    const pattern = `${AI_CACHE_PREFIX.chatCache}*:*:${dimension}:*`;
    const keys = await this.safe(() => this.scanKeys(pattern), []);
    if (!keys.length) return 0;
    await this.safe(() => this.redis.del(...keys), 0);
    return keys.length;
  }

  // --------------------------------------------- 3. model call cache (placeholder)

  /**
   * PLACEHOLDER — model response caching is intentionally not implemented yet.
   * The key namespace (`ai:llm_cache:`) and the call sites are already in place,
   * so enabling it later is a one-line switch (`AI_LLM_CACHE_ENABLED=true`).
   */
  llmCacheEnabled(): boolean {
    return this.config.get<string>('AI_LLM_CACHE_ENABLED') === 'true';
  }

  async getLlmCache<T>(provider: string, model: string, promptHash: string): Promise<T | null> {
    if (!this.llmCacheEnabled()) return null;
    const raw = await this.safe(() => this.redis.get(aiLlmCacheKey(provider, model, promptHash)), null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setLlmCache<T>(
    provider: string,
    model: string,
    promptHash: string,
    value: T,
  ): Promise<boolean> {
    if (!this.llmCacheEnabled()) return false;
    const ok = await this.safe(
      () =>
        this.redis.set(
          aiLlmCacheKey(provider, model, promptHash),
          JSON.stringify(value),
          'EX',
          this.numberConfig('AI_LLM_CACHE_TTL', AI_CACHE_DEFAULT_TTL.llmCache),
        ),
      null,
    );
    return ok === 'OK';
  }

  // ------------------------------------------------------- 4. task state cache

  async getTaskState<T>(tenantId: string, threadId: string): Promise<T | null> {
    const raw = await this.safe(() => this.redis.get(aiTaskStateKey(tenantId, threadId)), null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setTaskState<T>(
    tenantId: string,
    threadId: string,
    state: T,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.safe(
      () =>
        this.redis.set(
          aiTaskStateKey(tenantId, threadId),
          JSON.stringify(state),
          'EX',
          ttlSeconds ?? this.numberConfig('AI_TASK_STATE_TTL', AI_CACHE_DEFAULT_TTL.taskState),
        ),
      undefined,
    );
  }

  /** Merge a partial update into the stored state (keeps the remaining TTL). */
  async patchTaskState<T extends Record<string, unknown>>(
    tenantId: string,
    threadId: string,
    patch: Partial<T>,
  ): Promise<T | null> {
    const current = (await this.getTaskState<T>(tenantId, threadId)) ?? ({} as T);
    const next = { ...current, ...patch } as T;
    const ttl = await this.safe(() => this.redis.ttl(aiTaskStateKey(tenantId, threadId)), -1);
    await this.setTaskState(tenantId, threadId, next, ttl > 0 ? ttl : undefined);
    return next;
  }

  async deleteTaskState(tenantId: string, threadId: string): Promise<void> {
    await this.safe(() => this.redis.del(aiTaskStateKey(tenantId, threadId)), undefined);
  }

  async listTaskStateKeys(tenantId?: string): Promise<string[]> {
    return this.safe(
      () => this.scanKeys(`${AI_CACHE_PREFIX.taskState}${tenantId ?? '*'}:*`),
      [],
    );
  }

  /**
   * Redis TTLs already expire abandoned tasks. This sweeps entries that carry
   * an explicit `expiresAt` earlier than now (used by long-running workflows).
   */
  async clearExpiredTaskStates(): Promise<{ scanned: number; removed: number }> {
    const keys = await this.listTaskStateKeys();
    let removed = 0;
    const now = Date.now();
    for (const key of keys) {
      const raw = await this.safe(() => this.redis.get(key), null);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { expiresAt?: string };
        if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() < now) {
          await this.safe(() => this.redis.del(key), 0);
          removed += 1;
        }
      } catch {
        /* unparsable entry: leave it to TTL */
      }
    }
    return { scanned: keys.length, removed };
  }

  // ------------------------------------------------------------------- ops info

  async stats(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const [name, prefix] of Object.entries(AI_CACHE_PREFIX)) {
      result[name] = (await this.safe(() => this.scanKeys(`${prefix}*`), [])).length;
    }
    result.failedOperations = this.failureCount;
    return result;
  }

  private numberConfig(key: string, fallback: number): number {
    const raw = Number(this.config.get<string>(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }
}
