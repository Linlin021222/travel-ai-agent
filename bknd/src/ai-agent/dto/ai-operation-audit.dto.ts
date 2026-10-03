import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AUDIT_OPERATIONS } from '../entities/ai-operation-audit.entity.js';
import { KeywordQueryDto } from './pagination.dto.js';

const AUDIT_SORT_FIELDS = ['createdAt', 'action', 'statusCode'] as const;

export class QueryAuditDto extends KeywordQueryDto {
  @ApiPropertyOptional({ description: '操作动作，例如 chat.send' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @ApiPropertyOptional({ enum: AUDIT_OPERATIONS })
  @IsOptional()
  @IsIn(AUDIT_OPERATIONS as unknown as string[])
  operation?: string;

  @ApiPropertyOptional({ description: '资源类型，例如 session / memory / task' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceId?: string;

  @ApiPropertyOptional({ description: '是否成功' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  success?: boolean;

  @ApiPropertyOptional({ description: '起始时间 ISO 字符串' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @ApiPropertyOptional({ description: '结束时间 ISO 字符串' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;

  /**
   * `all` requests every tenant's rows; it is silently ignored for non-admins
   * so a regular user can never widen their own scope.
   */
  @ApiPropertyOptional({ description: 'all = 全租户（仅管理员生效）', enum: ['self', 'all'] })
  @IsOptional()
  @IsIn(['self', 'all'])
  scope?: 'self' | 'all' = 'self';

  @ApiPropertyOptional({ enum: AUDIT_SORT_FIELDS, default: 'createdAt' })
  @IsOptional()
  @IsIn(AUDIT_SORT_FIELDS as unknown as string[])
  sortBy?: (typeof AUDIT_SORT_FIELDS)[number] = 'createdAt';
}

export class CreateAuditBodyDto {
  @ApiProperty({ description: '动作，例如 chat.send' })
  @IsString()
  @MaxLength(64)
  action!: string;

  @ApiPropertyOptional({ description: '资源类型' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  resourceId?: string;

  @ApiPropertyOptional({ enum: AUDIT_OPERATIONS, default: 'read' })
  @IsOptional()
  @IsIn(AUDIT_OPERATIONS as unknown as string[])
  operation?: (typeof AUDIT_OPERATIONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  taskId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  requestPayload?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  responseSummary?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusCode?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  success?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  durationMs?: number;
}

export class AuditIdParamDto {
  @ApiProperty({ description: '审计记录 ID' })
  @IsUUID()
  id!: string;
}
