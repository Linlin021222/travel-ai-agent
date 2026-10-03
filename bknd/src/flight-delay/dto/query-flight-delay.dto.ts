import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { PAGE_SIZE_OPTIONS } from '../flight-delay.fields.js';

function toNumberArray() {
  return Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value : String(value).split(',');
    const numbers = raw
      .map((item) => Number(String(item).trim()))
      .filter((item) => Number.isFinite(item));
    return numbers.length > 0 ? numbers : undefined;
  });
}

function toStringArray() {
  return Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const raw = Array.isArray(value) ? value : String(value).split(',');
    const values = raw
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
    return values.length > 0 ? values : undefined;
  });
}

function toNumber() {
  return Transform(({ value }: { value: unknown }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  });
}

const minMax = (label: string, example: number) => ({
  min: {
    type: Number,
    description: `${label} 最小值（含）`,
    example,
  },
  max: {
    type: Number,
    description: `${label} 最大值（含）`,
    example: example * 10,
  },
} as const);

/** Query contract shared by the data endpoint and the filter option endpoint. */
export class QueryFlightDelayDto {
  @ApiPropertyOptional({ description: '页码，从 1 开始', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @toNumber()
  page?: number;

  @ApiPropertyOptional({ description: '每页条数', enum: PAGE_SIZE_OPTIONS, example: 20 })
  @IsOptional()
  @IsInt()
  @IsIn(PAGE_SIZE_OPTIONS as unknown as number[])
  @toNumber()
  pageSize?: number;

  @ApiPropertyOptional({
    description: '排序字段',
    example: 'year',
  })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ description: '排序方向', enum: ['asc', 'desc'], example: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional({
    description: '年份筛选，逗号分隔，支持多选',
    example: '2017,2018',
  })
  @IsOptional()
  @IsInt({ each: true })
  @toNumberArray()
  years?: number[];

  @ApiPropertyOptional({ description: '月份筛选，逗号分隔，1-12', example: '1,2,12' })
  @IsOptional()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  @toNumberArray()
  months?: number[];

  @ApiPropertyOptional({ description: '航司代码筛选，逗号分隔，支持多选', example: 'AA,UA' })
  @IsOptional()
  @IsString({ each: true })
  @toStringArray()
  carriers?: string[];

  @ApiPropertyOptional({ description: '机场代码筛选，逗号分隔，支持多选', example: 'ATL,ORD' })
  @IsOptional()
  @IsString({ each: true })
  @toStringArray()
  airports?: string[];

  // ---- 数值范围筛选：到达航班总数 ----
  @ApiPropertyOptional(minMax('到达航班总数', 10).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_flights_min?: number;

  @ApiPropertyOptional(minMax('到达航班总数', 10).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_flights_max?: number;

  // ---- 延误 15 分钟以上航班数 ----
  @ApiPropertyOptional(minMax('延误 15 分钟以上航班数', 5).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_del15_min?: number;

  @ApiPropertyOptional(minMax('延误 15 分钟以上航班数', 5).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_del15_max?: number;

  // ---- 航司原因延误航班数 ----
  @ApiPropertyOptional(minMax('航司原因延误航班数', 1).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  carrier_ct_min?: number;

  @ApiPropertyOptional(minMax('航司原因延误航班数', 1).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  carrier_ct_max?: number;

  // ---- 天气原因延误航班数 ----
  @ApiPropertyOptional(minMax('天气原因延误航班数', 1).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  weather_ct_min?: number;

  @ApiPropertyOptional(minMax('天气原因延误航班数', 1).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  weather_ct_max?: number;

  // ---- 空管原因延误航班数 ----
  @ApiPropertyOptional(minMax('空管原因延误航班数', 1).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  nas_ct_min?: number;

  @ApiPropertyOptional(minMax('空管原因延误航班数', 1).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  nas_ct_max?: number;

  // ---- 安检原因延误航班数 ----
  @ApiPropertyOptional(minMax('安检原因延误航班数', 1).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  security_ct_min?: number;

  @ApiPropertyOptional(minMax('安检原因延误航班数', 1).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  security_ct_max?: number;

  // ---- 晚到航班原因延误航班数 ----
  @ApiPropertyOptional(minMax('晚到航班原因延误航班数', 1).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  late_aircraft_ct_min?: number;

  @ApiPropertyOptional(minMax('晚到航班原因延误航班数', 1).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  late_aircraft_ct_max?: number;

  // ---- 取消航班数 ----
  @ApiPropertyOptional(minMax('取消航班数', 1).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_cancelled_min?: number;

  @ApiPropertyOptional(minMax('取消航班数', 1).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_cancelled_max?: number;

  // ---- 备降航班数 ----
  @ApiPropertyOptional(minMax('备降航班数', 1).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_diverted_min?: number;

  @ApiPropertyOptional(minMax('备降航班数', 1).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_diverted_max?: number;

  // ---- 总延误时长 ----
  @ApiPropertyOptional(minMax('总延误时长（分钟）', 100).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_delay_min?: number;

  @ApiPropertyOptional(minMax('总延误时长（分钟）', 100).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  arr_delay_max?: number;

  // ---- 航司原因延误时长 ----
  @ApiPropertyOptional(minMax('航司原因延误时长（分钟）', 50).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  carrier_delay_min?: number;

  @ApiPropertyOptional(minMax('航司原因延误时长（分钟）', 50).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  carrier_delay_max?: number;

  // ---- 天气原因延误时长 ----
  @ApiPropertyOptional(minMax('天气原因延误时长（分钟）', 50).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  weather_delay_min?: number;

  @ApiPropertyOptional(minMax('天气原因延误时长（分钟）', 50).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  weather_delay_max?: number;

  // ---- 空管原因延误时长 ----
  @ApiPropertyOptional(minMax('空管原因延误时长（分钟）', 50).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  nas_delay_min?: number;

  @ApiPropertyOptional(minMax('空管原因延误时长（分钟）', 50).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  nas_delay_max?: number;

  // ---- 安检原因延误时长 ----
  @ApiPropertyOptional(minMax('安检原因延误时长（分钟）', 50).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  security_delay_min?: number;

  @ApiPropertyOptional(minMax('安检原因延误时长（分钟）', 50).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  security_delay_max?: number;

  // ---- 晚到航班原因延误时长 ----
  @ApiPropertyOptional(minMax('晚到航班原因延误时长（分钟）', 50).min)
  @IsOptional()
  @IsNumber()
  @toNumber()
  late_aircraft_delay_min?: number;

  @ApiPropertyOptional(minMax('晚到航班原因延误时长（分钟）', 50).max)
  @IsOptional()
  @IsNumber()
  @toNumber()
  late_aircraft_delay_max?: number;

  // ---- 图表专用：聚合维度 ----
  @ApiPropertyOptional({
    description: '聚合维度（条形图 X 轴）：date=年月，carrier=航空公司，airport=机场',
    enum: ['date', 'carrier', 'airport'],
    example: 'carrier',
  })
  @IsOptional()
  @IsIn(['date', 'carrier', 'airport'])
  dimension?: 'date' | 'carrier' | 'airport';

  // ---- 图表专用：聚合指标 ----
  @ApiPropertyOptional({
    description: '聚合指标（条形图 Y 轴）',
    enum: [
      'arr_flights',
      'arr_del15',
      'arr_cancelled',
      'arr_diverted',
      'arr_delay',
    ],
    example: 'arr_flights',
  })
  @IsOptional()
  @IsIn([
    'arr_flights',
    'arr_del15',
    'arr_cancelled',
    'arr_diverted',
    'arr_delay',
  ])
  metric?: 'arr_flights' | 'arr_del15' | 'arr_cancelled' | 'arr_diverted' | 'arr_delay';

  // ---- 图表专用：日期区间（含端点，格式 YYYYMM）----
  @ApiPropertyOptional({
    description: '日期区间起点（含），格式 YYYYMM，例如 201801 表示 2018 年 1 月',
    example: 201801,
  })
  @IsOptional()
  @IsInt()
  @toNumber()
  date_from?: number;

  @ApiPropertyOptional({
    description: '日期区间终点（含），格式 YYYYMM，例如 201812 表示 2018 年 12 月',
    example: 201812,
  })
  @IsOptional()
  @IsInt()
  @toNumber()
  date_to?: number;
}
