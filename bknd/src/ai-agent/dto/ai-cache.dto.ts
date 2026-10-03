import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Manual cache invalidation (used when business data changes). */
export class InvalidateCacheDto {
  @ApiPropertyOptional({
    description: '业务维度，例如 flight-delay；为空则失效该用户下全部聊天缓存',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  dimension?: string;

  @ApiPropertyOptional({ description: '跨租户失效（仅管理员）' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  allTenants?: boolean;
}

export class TaskStateUpsertDto {
  @ApiPropertyOptional({ description: 'LangGraph thread id；为空则自动生成' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  threadId?: string;

  @ApiPropertyOptional({ description: '状态内容（任意 JSON）' })
  @IsOptional()
  @IsObject()
  state?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '过期秒数；为空使用默认 TTL' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  ttlSeconds?: number;
}
