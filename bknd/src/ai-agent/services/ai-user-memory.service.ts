import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AI_DATA_SOURCE } from '../ai-orm.constants.js';
import type {
  CreateMemoryBodyDto,
  QueryMemoryDto,
  UpdateMemoryBodyDto,
} from '../dto/ai-user-memory.dto.js';
import { resolvePage, toPageResult, type PageResult } from '../dto/pagination.dto.js';
import {
  AiUserMemoryEntity,
  type MemoryCategory,
  type MemoryScope,
} from '../entities/ai-user-memory.entity.js';
import { AiOperationAuditService } from './ai-operation-audit.service.js';

function ownerWhere(user: AuthUser): FindOptionsWhere<AiUserMemoryEntity> {
  return { userId: user.userId, tenantId: user.tenantId };
}

@Injectable()
export class AiUserMemoryService {
  constructor(
    @InjectRepository(AiUserMemoryEntity, AI_DATA_SOURCE)
    private readonly memories: Repository<AiUserMemoryEntity>,
    private readonly audit: AiOperationAuditService,
  ) {}

  async list(user: AuthUser, query: QueryMemoryDto): Promise<PageResult<ReturnType<AiUserMemoryEntity['toJSON']>>> {
    const { page, pageSize, skip } = resolvePage(query);
    const where: FindOptionsWhere<AiUserMemoryEntity> = { ...ownerWhere(user) };
    if (query.category) where.category = query.category as MemoryCategory;
    if (query.scope) where.scope = query.scope as MemoryScope;
    if (query.memoryKey) where.memoryKey = query.memoryKey;
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.keyword) where.memoryKey = ILike(`%${query.keyword}%`);

    const [items, total] = await this.memories.findAndCount({
      where,
      order: { [query.sortBy ?? 'updatedAt']: query.sortDir ?? 'desc' },
      skip,
      take: pageSize,
    });
    return toPageResult(items.map((item) => item.toJSON()), total, page, pageSize);
  }

  async findOne(user: AuthUser, id: string): Promise<AiUserMemoryEntity> {
    const found = await this.memories.findOne({ where: { id, ...ownerWhere(user) } });
    if (!found) throw new NotFoundException('记忆不存在或无权访问');
    return found;
  }

  /** Upsert semantics: the same key+scope for the same user is overwritten. */
  async create(user: AuthUser, dto: CreateMemoryBodyDto) {
    const scope = dto.scope ?? 'user';
    const existing = await this.memories.findOne({
      where: { userId: user.userId, memoryKey: dto.memoryKey, scope },
    });

    const entity = existing ?? this.memories.create();
    entity.userId = user.userId;
    entity.tenantId = user.tenantId;
    entity.memoryKey = dto.memoryKey;
    entity.memoryValue = dto.memoryValue as never;
    entity.category = dto.category ?? 'fact';
    entity.scope = scope;
    entity.sessionId = dto.sessionId ?? null;
    entity.importance = dto.importance ?? 0;
    entity.source = dto.source ?? null;
    entity.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    entity.metadata = dto.metadata ?? null;

    const saved = await this.memories.save(entity);
    await this.audit.record(user, {
      action: 'memory.create',
      resourceType: 'memory',
      resourceId: saved.id,
      operation: 'create',
      requestPayload: { memoryKey: saved.memoryKey, scope: saved.scope },
    });
    return saved.toJSON();
  }

  async update(user: AuthUser, id: string, dto: UpdateMemoryBodyDto) {
    const memory = await this.findOne(user, id);
    if (dto.memoryValue !== undefined) memory.memoryValue = dto.memoryValue as never;
    if (dto.category !== undefined) memory.category = dto.category;
    if (dto.importance !== undefined) memory.importance = dto.importance;
    if (dto.expiresAt !== undefined) {
      memory.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    if (dto.metadata !== undefined) memory.metadata = dto.metadata;

    const saved = await this.memories.save(memory);
    await this.audit.record(user, {
      action: 'memory.update',
      resourceType: 'memory',
      resourceId: id,
      operation: 'update',
    });
    return saved.toJSON();
  }

  async remove(user: AuthUser, id: string) {
    await this.findOne(user, id);
    await this.memories.delete({ id, ...ownerWhere(user) });
    await this.audit.record(user, {
      action: 'memory.delete',
      resourceType: 'memory',
      resourceId: id,
      operation: 'delete',
    });
    return { id, deleted: true };
  }
}
