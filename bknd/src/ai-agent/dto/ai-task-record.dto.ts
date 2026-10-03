import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TASK_STATUSES } from '../entities/ai-task-record.entity.js';
import { KeywordQueryDto } from './pagination.dto.js';

const TASK_SORT_FIELDS = ['createdAt', 'updatedAt', 'startedAt', 'progress', 'status'] as const;

export class QueryTaskDto extends KeywordQueryDto {
  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({ description: '任务类型，例如 flight_delay_query' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taskType?: string;

  @ApiPropertyOptional({ description: '按会话筛选' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ enum: TASK_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(TASK_SORT_FIELDS as unknown as string[])
  sortBy?: (typeof TASK_SORT_FIELDS)[number] = 'createdAt';
}

export class CreateTaskBodyDto {
  @ApiProperty({ description: '任务类型' })
  @IsString()
  @MaxLength(64)
  taskType!: string;

  @ApiPropertyOptional({ description: '任务标题' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: '关联会话' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'LangGraph thread id，用于关联 Redis 任务状态' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  threadId?: string;

  @ApiPropertyOptional({ description: '任务入参' })
  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateTaskBodyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: TASK_STATUSES })
  @IsOptional()
  @IsIn(TASK_STATUSES as unknown as string[])
  status?: (typeof TASK_STATUSES)[number];

  @ApiPropertyOptional({ description: '进度 0-100' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @ApiPropertyOptional({ description: '任务输出' })
  @IsOptional()
  @IsObject()
  output?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '失败原因' })
  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  errorMessage?: string;

  @ApiPropertyOptional({ description: 'LangGraph run id' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  runId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class TaskIdParamDto {
  @ApiProperty({ description: '任务 ID' })
  @IsUUID()
  id!: string;
}
