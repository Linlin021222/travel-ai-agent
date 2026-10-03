import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import {
  CreateTaskBodyDto,
  QueryTaskDto,
  UpdateTaskBodyDto,
} from '../dto/ai-task-record.dto.js';
import { AiTaskRecordService } from '../services/ai-task-record.service.js';

@ApiTags('ai-agent · tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ai-agent/tasks')
export class AiTaskRecordController {
  constructor(private readonly tasks: AiTaskRecordService) {}

  @Get()
  @ApiOperation({ summary: '分页查询当前用户的任务记录' })
  list(@CurrentUser() user: AuthUser, @Query() query: QueryTaskDto) {
    return this.tasks.list(user, query);
  }

  @Post()
  @ApiOperation({ summary: '创建任务记录并初始化 Redis 任务状态' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskBodyDto) {
    return this.tasks.create(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '按 ID 查询任务（仅本人）' })
  async getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return (await this.tasks.findOne(user, id)).toJSON();
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新任务状态 / 进度 / 输出' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateTaskBodyDto,
  ) {
    return this.tasks.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除任务记录及其状态缓存' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.remove(user, id);
  }

  @Get(':id/state')
  @ApiOperation({ summary: '读取任务的实时状态（来自 ai:task_state: 缓存）' })
  state(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tasks.readState(user, id);
  }
}
