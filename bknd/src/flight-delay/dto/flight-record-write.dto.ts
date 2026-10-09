import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { NUMERIC_FIELDS } from '../flight-delay.fields.js';

/**
 * Business DTOs for flight-delay record mutations.
 *
 * Kept next to the read DTO so the assistant and the REST API share one set of
 * validation rules. Numeric columns default to 0 and must never be negative.
 */

const METRIC_RULE = { each: false } as const;

export class CreateFlightRecordDto {
  @ApiProperty({ example: 2018, minimum: 1990, maximum: 2100 })
  @IsInt({ message: '年份必须是整数' })
  @Min(1990, { message: '年份不能早于 1990' })
  @Max(2100, { message: '年份不能晚于 2100' })
  year!: number;

  @ApiProperty({ example: 3, minimum: 1, maximum: 12 })
  @IsInt({ message: '月份必须是整数' })
  @Min(1, { message: '月份必须在 1-12 之间' })
  @Max(12, { message: '月份必须在 1-12 之间' })
  month!: number;

  @ApiProperty({ example: 'AA', description: '航司代码' })
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,10}$/, { message: '航司代码格式不正确（2-10 位字母或数字）' })
  carrierCode!: string;

  @ApiProperty({ example: 'American Airlines Inc.' })
  @IsString()
  @IsNotEmpty({ message: '航司名称不能为空' })
  carrierName!: string;

  @ApiProperty({ example: 'ATL', description: '机场三字码' })
  @IsString()
  @Matches(/^[A-Za-z0-9]{3}$/, { message: '机场代码必须是 3 位三字码' })
  airportCode!: string;

  @ApiProperty({ example: 'Atlanta, GA: Hartsfield-Jackson Atlanta International' })
  @IsString()
  @IsNotEmpty({ message: '机场名称不能为空' })
  airportName!: string;

  @ApiPropertyOptional({ description: '其余 15 个数值指标，缺省为 0' })
  @IsOptional()
  metrics?: Record<string, number>;
}

export class UpdateFlightRecordDto {
  @ApiProperty({ description: '记录 ID' })
  @IsInt({ message: '记录 ID 必须是整数' })
  id!: number;

  @ApiPropertyOptional({ example: 2018 })
  @IsOptional()
  @IsInt({ message: '年份必须是整数' })
  @Min(1990, { message: '年份不能早于 1990' })
  @Max(2100, { message: '年份不能晚于 2100' })
  year?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt({ message: '月份必须是整数' })
  @Min(1, { message: '月份必须在 1-12 之间' })
  @Max(12, { message: '月份必须在 1-12 之间' })
  month?: number;

  @ApiPropertyOptional({ example: 'AA' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,10}$/, { message: '航司代码格式不正确（2-10 位字母或数字）' })
  carrierCode?: string;

  @ApiPropertyOptional({ example: 'American Airlines Inc.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '航司名称不能为空' })
  carrierName?: string;

  @ApiPropertyOptional({ example: 'ATL' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{3}$/, { message: '机场代码必须是 3 位三字码' })
  airportCode?: string;

  @ApiPropertyOptional({ example: 'Atlanta, GA: Hartsfield-Jackson Atlanta International' })
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '机场名称不能为空' })
  airportName?: string;

  @ApiPropertyOptional({ description: `可更新指标：${NUMERIC_FIELDS.join(', ')}` })
  @IsOptional()
  metrics?: Record<string, number>;
}

export class DeleteFlightRecordDto {
  @ApiProperty({ description: '记录 ID' })
  @IsInt({ message: '记录 ID 必须是整数' })
  id!: number;
}

export { METRIC_RULE };
