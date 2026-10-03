import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { AiCacheService } from '../cache/ai-cache.service.js';
import { AI_DATA_SOURCE } from '../ai-orm.constants.js';
import type {
  CreateTaskBodyDto,
  QueryTaskDto,
  UpdateTaskBodyDto,
} from '../dto/ai-task-record.dto.js';
import { resolvePage, toPageResult, type PageResult } from '../dto/pagination.dto.js';
import { AiTaskRecordEntity, TASK_STATUSES, type TaskStatus } from '../entities/ai-task-record.entity.js';
import { AiOperationAuditService } from './ai-operation-audit.service.js';

const TERMINAL_STATUSES: TaskStatus[] = ['success', 'failed', 'cancelled'];

function ownerWhere(user: AuthUser): FindOptionsWhere<AiTaskRecordEntity> {
  return { userId: user.userId, tenantId: user.tenantId };
}

@Injectable()
export class AiTaskRecordService {
  constructor(
    @InjectRepository(AiTaskRecordEntity, AI_DATA_SOURCE)
    private readonly tasks: Repository<AiTaskRecordEntity>,
    private readonly cache: AiCacheService,
    private readonly audit: AiOperationAuditService,
  ) {}

  async list(user: AuthUser, query: QueryTaskDto): Promise<PageResult<ReturnType<AiTaskRecordEntity['toJSON']>>> {
    const { page, pageSize, skip } = resolvePage(query);
    const where: FindOptionsWhere<AiTaskRecordEntity> = { ...ownerWhere(user) };
    if (query.status) where.status = query.status as TaskStatus;
    if (query.taskType) where.taskType = query.taskType;
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.keyword) where.title = ILike(`%${query.keyword}%`);

    const [items, total] = await this.tasks.findAndCount({
      where,
      order: { [query.sortBy ?? 'createdAt']: query.sortDir ?? 'desc' },
      skip,
      take: pageSize,
    });
    return toPageResult(items.map((item) => item.toJSON()), total, page, pageSize);
  }

  async findOne(user: AuthUser, id: string): Promise<AiTaskRecordEntity> {
    const found = await this.tasks.findOne({ where: { id, ...ownerWhere(user) } });
    if (!found) throw new NotFoundException('任务不存在或无权访问');
    return found;
  }

  async create(user: AuthUser, dto: CreateTaskBodyDto) {
    const threadId = dto.threadId ?? randomUUID();
    const entity = this.tasks.create({
      userId: user.userId,
      tenantId: user.tenantId,
      sessionId: dto.sessionId ?? null,
      taskType: dto.taskType,
      title: dto.title ?? '',
      status: 'pending',
      progress: 0,
      input: dto.input ?? null,
      threadId,
      metadata: dto.metadata ?? null,
      startedAt: new Date(),
    });
    const saved = await this.tasks.save(entity);

    // Seed the Redis task state so a LangGraph run can pick it up.
    await this.cache.setTaskState(user.tenantId, threadId, {
      taskId: saved.id,
      status: saved.status,
      progress: 0,
      updatedAt: new Date().toISOString(),
    });

    await this.audit.record(user, {
      action: 'task.create',
      resourceType: 'task',
      resourceId: saved.id,
      operation: 'create',
      taskId: saved.id,
      requestPayload: { taskType: saved.taskType, threadId },
    });
    return saved.toJSON();
  }

  async update(user: AuthUser, id: string, dto: UpdateTaskBodyDto) {
    const task = await this.findOne(user, id);
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.status !== undefined) {
      if (!TASK_STATUSES.includes(dto.status)) {
        throw new NotFoundException(`非法的任务状态: ${dto.status}`);
      }
      task.status = dto.status;
    }
    if (dto.progress !== undefined) task.progress = dto.progress;
    if (dto.output !== undefined) task.output = dto.output;
    if (dto.errorMessage !== undefined) task.errorMessage = dto.errorMessage;
    if (dto.runId !== undefined) task.runId = dto.runId;
    if (dto.metadata !== undefined) task.metadata = dto.metadata;

    if (task.status === 'running' && !task.startedAt) task.startedAt = new Date();
    if (TERMINAL_STATUSES.includes(task.status) && !task.finishedAt) {
      task.finishedAt = new Date();
      task.durationMs = task.startedAt
        ? task.finishedAt.getTime() - task.startedAt.getTime()
        : null;
    }

    const saved = await this.tasks.save(task);

    if (saved.threadId) {
      await this.cache.setTaskState(user.tenantId, saved.threadId, {
        taskId: saved.id,
        status: saved.status,
        progress: saved.progress,
        updatedAt: new Date().toISOString(),
      });
      // A finished task needs no live state any more.
      if (TERMINAL_STATUSES.includes(saved.status)) {
        await this.cache.deleteTaskState(user.tenantId, saved.threadId);
      }
    }

    await this.audit.record(user, {
      action: 'task.update',
      resourceType: 'task',
      resourceId: id,
      operation: 'update',
      taskId: id,
      requestPayload: dto as Record<string, unknown>,
    });
    return saved.toJSON();
  }

  async remove(user: AuthUser, id: string) {
    const task = await this.findOne(user, id);
    await this.tasks.delete({ id, ...ownerWhere(user) });
    if (task.threadId) await this.cache.deleteTaskState(user.tenantId, task.threadId);
    await this.audit.record(user, {
      action: 'task.delete',
      resourceType: 'task',
      resourceId: id,
      operation: 'delete',
      taskId: id,
    });
    return { id, deleted: true };
  }

  /** Live state for a task, read straight from the task-state cache. */
  async readState(user: AuthUser, id: string) {
    const task = await this.findOne(user, id);
    if (!task.threadId) return { taskId: id, threadId: null, state: null };
    const state = await this.cache.getTaskState(user.tenantId, task.threadId);
    return { taskId: id, threadId: task.threadId, state };
  }
}
