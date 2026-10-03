import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { FindOptionsWhere, ILike, Not, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AiCacheService, type SessionTurn } from '../cache/ai-cache.service.js';
import type {
  CreateSessionBodyDto,
  QuerySessionDto,
  UpdateSessionBodyDto,
} from '../dto/ai-chat-session.dto.js';
import { resolvePage, toPageResult, type PageResult } from '../dto/pagination.dto.js';
import { AI_DATA_SOURCE } from '../ai-orm.constants.js';
import {
  AiChatMessageEntity,
  type ChatMessageType,
  type ChatRole,
} from '../entities/ai-chat-message.entity.js';
import {
  AiChatSessionEntity,
  type SessionStatus,
} from '../entities/ai-chat-session.entity.js';
import { AiOperationAuditService } from './ai-operation-audit.service.js';

/** Every AI query is filtered through this — user + tenant, always. */
function ownerWhere(user: AuthUser): FindOptionsWhere<AiChatSessionEntity> {
  return { userId: user.userId, tenantId: user.tenantId };
}

@Injectable()
export class AiChatSessionService {
  private readonly logger = new Logger(AiChatSessionService.name);

  constructor(
    @InjectRepository(AiChatSessionEntity, AI_DATA_SOURCE)
    private readonly sessions: Repository<AiChatSessionEntity>,
    @InjectRepository(AiChatMessageEntity, AI_DATA_SOURCE)
    private readonly messages: Repository<AiChatMessageEntity>,
    private readonly cache: AiCacheService,
    private readonly audit: AiOperationAuditService,
  ) {}

  // -------------------------------------------------------------------- queries

  async list(user: AuthUser, query: QuerySessionDto): Promise<PageResult<ReturnType<AiChatSessionEntity['toJSON']>>> {
    const { page, pageSize, skip } = resolvePage(query);
    const where: FindOptionsWhere<AiChatSessionEntity> = { ...ownerWhere(user) };
    if (query.status) where.status = query.status as SessionStatus;
    if (query.provider) where.provider = query.provider;
    if (query.keyword) where.title = ILike(`%${query.keyword}%`);

    const [items, total] = await this.sessions.findAndCount({
      where,
      order: { [query.sortBy ?? 'updatedAt']: query.sortDir ?? 'desc' },
      skip,
      take: pageSize,
    });

    return toPageResult(items.map((item) => item.toJSON()), total, page, pageSize);
  }

  /** Owner-scoped read: another user's id simply resolves to 404. */
  async findOne(user: AuthUser, id: string): Promise<AiChatSessionEntity> {
    const found = await this.sessions.findOne({ where: { id, ...ownerWhere(user) } });
    if (!found) throw new NotFoundException('会话不存在或无权访问');
    return found;
  }

  async findOneWithMessages(user: AuthUser, id: string) {
    const session = await this.findOne(user, id);
    const rows = await this.messages.find({
      where: { sessionId: id, userId: user.userId },
      order: { createdAt: 'ASC' },
      take: 500,
    });
    await this.audit.record(user, {
      action: 'session.read',
      resourceType: 'session',
      resourceId: id,
      operation: 'read',
      sessionId: id,
    });
    return {
      ...session.toJSON(),
      messages: rows.map((row) => row.toJSON()),
    };
  }

  // ------------------------------------------------------------------- commands

  async create(user: AuthUser, dto: CreateSessionBodyDto) {
    const entity = this.sessions.create({
      userId: user.userId,
      tenantId: user.tenantId,
      title: dto.title?.trim() || '新对话',
      provider: dto.provider ?? 'deepseek',
      model: dto.model ?? '',
      status: 'active',
      messageCount: 0,
      metadata: dto.metadata ?? null,
    });
    const saved = await this.sessions.save(entity);
    await this.audit.record(user, {
      action: 'session.create',
      resourceType: 'session',
      resourceId: saved.id,
      operation: 'create',
      sessionId: saved.id,
    });
    return saved.toJSON();
  }

  async update(user: AuthUser, id: string, dto: UpdateSessionBodyDto) {
    const session = await this.findOne(user, id);
    if (dto.title !== undefined) session.title = dto.title;
    if (dto.status !== undefined) session.status = dto.status;
    if (dto.metadata !== undefined) session.metadata = dto.metadata;
    const saved = await this.sessions.save(session);

    // Closing a session drops its short term memory immediately.
    if (dto.status && dto.status !== 'active') {
      await this.cache.clearSessionContext(user.tenantId, id);
    }

    await this.audit.record(user, {
      action: 'session.update',
      resourceType: 'session',
      resourceId: id,
      operation: 'update',
      sessionId: id,
      requestPayload: dto as Record<string, unknown>,
    });
    return saved.toJSON();
  }

  async remove(user: AuthUser, id: string) {
    await this.findOne(user, id);
    await this.messages.delete({ sessionId: id, userId: user.userId });
    await this.sessions.delete({ id, ...ownerWhere(user) });
    await this.cache.clearSessionContext(user.tenantId, id);
    await this.audit.record(user, {
      action: 'session.delete',
      resourceType: 'session',
      resourceId: id,
      operation: 'delete',
      sessionId: id,
    });
    return { id, deleted: true };
  }

  // ------------------------------------------------------------------ messages

  async appendMessage(
    user: AuthUser,
    sessionId: string,
    input: {
      role: ChatRole;
      messageType: ChatMessageType;
      content: string;
      payload?: Record<string, unknown> | null;
      tokenCount?: number | null;
    },
  ): Promise<AiChatMessageEntity> {
    const entity = this.messages.create({
      sessionId,
      userId: user.userId,
      tenantId: user.tenantId,
      role: input.role,
      messageType: input.messageType,
      content: input.content,
      payload: input.payload ?? null,
      tokenCount: input.tokenCount ?? null,
    });
    const saved = await this.messages.save(entity);

    await this.sessions.increment({ id: sessionId }, 'messageCount', 1);
    await this.sessions.update({ id: sessionId }, { updatedAt: new Date() });

    // Keep the Redis short-term memory in step with PostgreSQL. The loader
    // rebuilds the window from history when the cache has expired.
    if (input.role !== 'system') {
      await this.cache.appendSessionTurn(
        user.tenantId,
        sessionId,
        user.userId,
        { role: input.role, content: input.content, at: new Date().toISOString() },
        // Runs only on a cache miss. The message was already inserted above, so
        // drop the trailing turn to avoid counting it twice.
        async () => (await this.loadRecentTurns(user, sessionId)).slice(0, -1),
      );
    }

    return saved;
  }

  /**
   * Rebuild short term memory from PostgreSQL after a cache miss.
   * Returns oldest -> newest, system prompts excluded.
   */
  async loadRecentTurns(user: AuthUser, sessionId: string, limit = 10): Promise<SessionTurn[]> {
    const rows = await this.messages.find({
      where: { sessionId, userId: user.userId, role: Not('system') },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return rows
      .reverse()
      .map((row) => ({ role: row.role, content: row.content, at: row.createdAt.toISOString() }));
  }

  async touch(sessionId: string) {
    await this.sessions.update({ id: sessionId }, { updatedAt: new Date() });
  }

  async resolveOrCreate(user: AuthUser, sessionId: string | undefined, fallbackTitle: string) {
    if (sessionId) {
      try {
        await this.findOne(user, sessionId);
        await this.touch(sessionId);
        return sessionId;
      } catch (error) {
        this.logger.warn(
          `session ${sessionId} unusable, creating a new one: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const created = await this.create(user, { title: fallbackTitle });
    return created.id;
  }
}

export function newId(): string {
  return randomUUID();
}
