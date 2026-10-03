import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { InvalidateCacheDto, TaskStateUpsertDto } from '../dto/ai-cache.dto.js';
import { AiCacheService } from '../cache/ai-cache.service.js';
import { AiTaskStateCheckpointer } from '../cache/langgraph-checkpointer.js';
import { AiOperationAuditService } from '../services/ai-operation-audit.service.js';

@ApiTags('ai-agent · cache')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-agent/cache')
export class AiCacheController {
  constructor(
    private readonly cache: AiCacheService,
    private readonly audit: AiOperationAuditService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Redis 连通性' })
  health() {
    return this.cache.isHealthy();
  }

  @Get('stats')
  @ApiOperation({ summary: '四类缓存前缀的 key 数量统计' })
  stats() {
    return this.cache.stats();
  }

  /** Called when business data changes so stale answers disappear. */
  @Post('invalidate')
  @ApiOperation({ summary: '主动失效聊天结果缓存（按业务维度 / 跨租户需管理员）' })
  async invalidate(@CurrentUser() user: AuthUser, @Body() dto: InvalidateCacheDto) {
    const removed =
      dto.allTenants && user.isAdmin && dto.dimension
        ? await this.cache.invalidateBusinessDimension(dto.dimension)
        : await this.cache.invalidateChatCache({
            tenantId: user.tenantId,
            userId: user.userId,
            dimension: dto.dimension,
          });

    await this.audit.record(user, {
      action: 'cache.invalidate',
      resourceType: 'cache',
      operation: 'delete',
      requestPayload: dto as Record<string, unknown>,
      responseSummary: { removed },
    });
    return { removed, dimension: dto.dimension ?? null };
  }

  @Get('task-state')
  @ApiOperation({ summary: '读取任务临时状态（ai:task_state:）' })
  getTaskState(@CurrentUser() user: AuthUser, @Query('threadId') threadId: string) {
    return this.cache.getTaskState(user.tenantId, threadId);
  }

  @Post('task-state')
  @ApiOperation({ summary: '写入任务临时状态' })
  setTaskState(@CurrentUser() user: AuthUser, @Body() dto: TaskStateUpsertDto) {
    const threadId = dto.threadId ?? randomUUID();
    return this.cache
      .setTaskState(user.tenantId, threadId, dto.state ?? {}, dto.ttlSeconds)
      .then(() => ({ threadId, stored: true }));
  }

  @Delete('task-state/:threadId')
  @ApiOperation({ summary: '清理任务临时状态' })
  deleteTaskState(@CurrentUser() user: AuthUser, @Param('threadId') threadId: string) {
    return this.cache
      .deleteTaskState(user.tenantId, threadId)
      .then(() => ({ threadId, deleted: true }));
  }

  @Post('task-state/sweep')
  @ApiOperation({ summary: '清理已过期的任务状态（TTL 之外的兜底扫描）' })
  sweepTaskState() {
    return this.cache.clearExpiredTaskStates();
  }

  /**
   * LangGraph-shaped view of a thread: uses the same `getTuple`/`put`/`list`
   * contract a graph will use once orchestration lands.
   */
  @Get('checkpoints/:threadId')
  @ApiOperation({ summary: '按 LangGraph Checkpointer 契约读取一个线程的检查点' })
  async checkpoints(@CurrentUser() user: AuthUser, @Param('threadId') threadId: string) {
    const checkpointer = new AiTaskStateCheckpointer(this.cache, user.tenantId);
    const config = { configurable: { thread_id: threadId } };
    const tuples = [];
    for await (const tuple of checkpointer.list(config, { limit: 20 })) {
      tuples.push(tuple);
    }
    return { threadId, count: tuples.length, checkpoints: tuples };
  }
}
