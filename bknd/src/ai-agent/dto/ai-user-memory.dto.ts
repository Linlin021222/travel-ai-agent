import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
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
import { MEMORY_CATEGORIES, MEMORY_SCOPES } from '../entities/ai-user-memory.entity.js';
import { KeywordQueryDto } from './pagination.dto.js';

const MEMORY_SORT_FIELDS = ['createdAt', 'updatedAt', 'importance', 'memoryKey'] as const;

export class QueryMemoryDto extends KeywordQueryDto {
  @ApiPropertyOptional({ enum: MEMORY_CATEGORIES })
  @IsOptional()
  @IsIn(MEMORY_CATEGORIES as unknown as string[])
  category?: string;

  @ApiPropertyOptional({ enum: MEMORY_SCOPES })
  @IsOptional()
  @IsIn(MEMORY_SCOPES as unknown as string[])
  scope?: string;

  @ApiPropertyOptional({ description: '按记忆键精确筛选' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  memoryKey?: string;

  @ApiPropertyOptional({ description: '按会话筛选（scope=session 时常用）' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ enum: MEMORY_SORT_FIELDS, default: 'updatedAt' })
  @IsOptional()
  @IsIn(MEMORY_SORT_FIELDS as unknown as string[])
  sortBy?: (typeof MEMORY_SORT_FIELDS)[number] = 'updatedAt';
}

export class CreateMemoryBodyDto {
  @ApiProperty({ description: '记忆键，同一用户 + scope 下唯一' })
  @IsString()
  @MaxLength(120)
  memoryKey!: string;

  /**
   * Free-form JSON. `IsDefined` is required (not just a type annotation)
   * because the global pipe runs with `whitelist: true`: a property without
   * validation metadata is stripped and then rejected as unknown.
   */
  @ApiProperty({ description: '记忆内容（任意 JSON）' })
  @IsDefined()
  memoryValue!: unknown;

  @ApiPropertyOptional({ enum: MEMORY_CATEGORIES, default: 'fact' })
  @IsOptional()
  @IsIn(MEMORY_CATEGORIES as unknown as string[])
  category?: (typeof MEMORY_CATEGORIES)[number];

  @ApiPropertyOptional({ enum: MEMORY_SCOPES, default: 'user' })
  @IsOptional()
  @IsIn(MEMORY_SCOPES as unknown as string[])
  scope?: (typeof MEMORY_SCOPES)[number];

  @ApiPropertyOptional({ description: '关联的会话（scope=session 时提供）' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ description: '重要度 0-100', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  importance?: number;

  @ApiPropertyOptional({ description: '来源，例如 user_input / agent_inferred' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @ApiPropertyOptional({ description: '过期时间 ISO 字符串；为空表示长期有效' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateMemoryBodyDto {
  @ApiPropertyOptional({ description: '记忆内容（任意 JSON）' })
  @IsOptional()
  memoryValue?: unknown;

  @ApiPropertyOptional({ enum: MEMORY_CATEGORIES })
  @IsOptional()
  @IsIn(MEMORY_CATEGORIES as unknown as string[])
  category?: (typeof MEMORY_CATEGORIES)[number];

  @ApiPropertyOptional({ description: '重要度 0-100' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  importance?: number;

  @ApiPropertyOptional({ description: '过期时间 ISO 字符串' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  expiresAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class MemoryIdParamDto {
  @ApiProperty({ description: '记忆 ID' })
  @IsUUID()
  id!: string;
}
