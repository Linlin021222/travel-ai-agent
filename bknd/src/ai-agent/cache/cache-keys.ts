import { createHash } from 'node:crypto';

/**
 * The key prefixes the AI module may use. Every Redis call must go through
 * `AiCacheService` (or `WriteGuardService` for confirmation tokens) so keys,
 * TTLs and namespacing stay consistent.
 */
export const AI_CACHE_PREFIX = {
  session: 'ai:session:',
  chatCache: 'ai:chat_cache:',
  llmCache: 'ai:llm_cache:',
  taskState: 'ai:task_state:',
  writeConfirm: 'ai:write_confirm:',
} as const;

export type AiCacheNamespace = keyof typeof AI_CACHE_PREFIX;

/** Default TTLs in seconds. */
export const AI_CACHE_DEFAULT_TTL = {
  /** Short term conversation memory. */
  session: 2 * 60 * 60,
  /** Repeated identical questions. */
  chatCache: 10 * 60,
  /** Reserved for model response caching (placeholder, unused for now). */
  llmCache: 30 * 60,
  /** LangGraph task state. */
  taskState: 60 * 60,
  /** Write confirmation tokens — deliberately short, single use. */
  writeConfirm: 5 * 60,
} as const;

/** How many conversation turns the short term memory keeps (5 user + 5 AI). */
export const SESSION_CONTEXT_MAX_TURNS = 10;

export function aiSessionKey(tenantId: string, sessionId: string): string {
  return `${AI_CACHE_PREFIX.session}${tenantId}:${sessionId}`;
}

export function aiChatCacheKey(
  tenantId: string,
  userId: string,
  dimension: string,
  hash: string,
): string {
  return `${AI_CACHE_PREFIX.chatCache}${tenantId}:${userId}:${dimension}:${hash}`;
}

export function aiLlmCacheKey(provider: string, model: string, hash: string): string {
  return `${AI_CACHE_PREFIX.llmCache}${provider}:${model}:${hash}`;
}

export function aiTaskStateKey(tenantId: string, threadId: string): string {
  return `${AI_CACHE_PREFIX.taskState}${tenantId}:${threadId}`;
}

/** Single-use token issued by the write interception layer. */
export function aiWriteConfirmKey(token: string): string {
  return `${AI_CACHE_PREFIX.writeConfirm}${token}`;
}

/** Stable, short fingerprint used inside cache keys. */
export function hashQuery(parts: Array<string | number | boolean | null | undefined>): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 32);
}
