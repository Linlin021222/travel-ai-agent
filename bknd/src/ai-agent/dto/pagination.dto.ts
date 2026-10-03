import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const MAX_PAGE_SIZE = 200;

/** Shared paging + sorting contract for every AI list endpoint. */
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: '每页条数', default: 20, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = 20;

  @ApiPropertyOptional({ description: '排序方向', enum: SORT_DIRECTIONS, default: 'desc' })
  @IsOptional()
  @IsIn(SORT_DIRECTIONS as unknown as string[])
  sortDir?: SortDirection = 'desc';
}

export class KeywordQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '模糊搜索关键字' })
  @IsOptional()
  @IsString()
  keyword?: string;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function resolvePage(dto: PaginationQueryDto): { page: number; pageSize: number; skip: number } {
  const page = dto.page && dto.page > 0 ? dto.page : 1;
  const pageSize = dto.pageSize && dto.pageSize > 0 ? Math.min(dto.pageSize, MAX_PAGE_SIZE) : 20;
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function toPageResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PageResult<T> {
  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
