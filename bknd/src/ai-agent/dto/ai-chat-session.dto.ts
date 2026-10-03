import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { SESSION_STATUSES } from '../entities/ai-chat-session.entity.js';
import { KeywordQueryDto, PaginationQueryDto } from './pagination.dto.js';

const SESSION_SORT_FIELDS = ['createdAt', 'updatedAt', 'title', 'messageCount'] as const;

export class QuerySessionDto extends KeywordQueryDto {
  @ApiPropertyOptional({ enum: SESSION_STATUSES })
  @IsOptional()
  @IsIn(SESSION_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({ description: '按模型提供商筛选' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;

  @ApiPropertyOptional({ enum: SESSION_SORT_FIELDS, default: 'updatedAt' })
  @IsOptional()
  @IsIn(SESSION_SORT_FIELDS as unknown as string[])
  sortBy?: (typeof SESSION_SORT_FIELDS)[number] = 'updatedAt';
}

export class CreateSessionBodyDto {
  @ApiPropertyOptional({ description: '会话标题；为空则由首条消息生成' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: '模型提供商' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  provider?: string;

  @ApiPropertyOptional({ description: '模型名称' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  model?: string;

  @ApiPropertyOptional({ description: '附加元数据' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateSessionBodyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ enum: SESSION_STATUSES })
  @IsOptional()
  @IsIn(SESSION_STATUSES as unknown as string[])
  status?: (typeof SESSION_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class SessionIdParamDto {
  @ApiProperty({ description: '会话 ID' })
  @IsUUID()
  id!: string;
}

export type { PaginationQueryDto };
