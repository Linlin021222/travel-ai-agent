import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, ILike, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AI_DATA_SOURCE } from '../ai-orm.constants.js';
import {
  AiOperationAuditEntity,
  type AuditOperation,
} from '../entities/ai-operation-audit.entity.js';
import type { CreateAuditBodyDto, QueryAuditDto } from '../dto/ai-operation-audit.dto.js';
import { resolvePage, toPageResult, type PageResult } from '../dto/pagination.dto.js';

export interface AuditEntry {
  action: string;
  resourceType?: string;
  resourceId?: string | null;
  operation?: AuditOperation;
  sessionId?: string | null;
  taskId?: string | null;
  requestPayload?: Record<string, unknown> | null;
  responseSummary?: Record<string, unknown> | null;
  statusCode?: number | null;
  success?: boolean;
  durationMs?: number | null;
}

/**
 * Append-only operation log.
 * Regular users are pinned to their own rows; `scope=all` only widens the
 * result set when {@link AuthUser.isAdmin} is true.
 */
@Injectable()
export class AiOperationAuditService {
  constructor(
    @InjectRepository(AiOperationAuditEntity, AI_DATA_SOURCE)
    private readonly audits: Repository<AiOperationAuditEntity>,
  ) {}

  async record(user: AuthUser, entry: AuditEntry, context?: { ipAddress?: string; userAgent?: string }) {
    const entity = this.audits.create({
      userId: user.userId,
      tenantId: user.tenantId,
      sessionId: entry.sessionId ?? null,
      taskId: entry.taskId ?? null,
      action: entry.action,
      resourceType: entry.resourceType ?? '',
      resourceId: entry.resourceId ?? null,
      operation: entry.operation ?? 'read',
      requestPayload: entry.requestPayload ?? null,
      responseSummary: entry.responseSummary ?? null,
      statusCode: entry.statusCode ?? null,
      success: entry.success ?? true,
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
      // Defaulted to 0 rather than NULL: a missing duration would break the
      // per-tool latency percentiles the week-3 perf check relies on.
      durationMs: typeof entry.durationMs === 'number' && entry.durationMs >= 0
        ? entry.durationMs
        : 0,
    });
    return this.audits.save(entity);
  }

  async list(
    user: AuthUser,
    query: QueryAuditDto,
  ): Promise<PageResult<ReturnType<AiOperationAuditEntity['toJSON']>>> {
    const { page, pageSize, skip } = resolvePage(query);

    const crossTenant = query.scope === 'all' && user.isAdmin;
    const where: FindOptionsWhere<AiOperationAuditEntity> = crossTenant
      ? {}
      : { userId: user.userId, tenantId: user.tenantId };

    if (query.action) where.action = query.action;
    if (query.operation) where.operation = query.operation as AuditOperation;
    if (query.resourceType) where.resourceType = query.resourceType;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.success !== undefined) where.success = query.success;
    if (query.keyword) where.action = ILike(`%${query.keyword}%`);

    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (from && to) where.createdAt = Between(from, to);
    else if (from) where.createdAt = MoreThanOrEqual(from);
    else if (to) where.createdAt = LessThanOrEqual(to);

    const [items, total] = await this.audits.findAndCount({
      where,
      order: { [query.sortBy ?? 'createdAt']: query.sortDir ?? 'desc' },
      skip,
      take: pageSize,
    });

    return toPageResult(
      items.map((item) => item.toJSON()),
      total,
      page,
      pageSize,
    );
  }

  async findOne(user: AuthUser, id: string) {
    const where: FindOptionsWhere<AiOperationAuditEntity> = user.isAdmin
      ? { id }
      : { id, userId: user.userId, tenantId: user.tenantId };
    const found = await this.audits.findOne({ where });
    if (!found) throw new NotFoundException('审计记录不存在或无权访问');
    return found.toJSON();
  }

  /** Explicit write endpoint so other services can log through HTTP too. */
  async create(user: AuthUser, dto: CreateAuditBodyDto, context?: { ipAddress?: string; userAgent?: string }) {
    const saved = await this.record(
      user,
      {
        action: dto.action,
        resourceType: dto.resourceType,
        resourceId: dto.resourceId,
        operation: dto.operation,
        sessionId: dto.sessionId ?? null,
        taskId: dto.taskId ?? null,
        requestPayload: dto.requestPayload,
        responseSummary: dto.responseSummary,
        statusCode: dto.statusCode,
        success: dto.success,
        durationMs: dto.durationMs,
      },
      context,
    );
    return saved.toJSON();
  }
}
