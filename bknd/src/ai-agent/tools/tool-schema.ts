import type { ToolParameterSchema } from './base-tool.js';

/**
 * Shared JSON-Schema fragments for the tool parameter schemas.
 *
 * Every read tool accepts the same flight filters, so they are declared once
 * here and composed per tool. This keeps the model-facing contract and the
 * `QueryFlightDelayDto` filters in lockstep.
 */

/** Data set boundaries — stated in the schema so the model refuses out-of-range asks. */
export const DATA_BOUNDS = '数据仅覆盖 2009-01 至 2018-12 的美国境内航班。';

export const YEARS = {
  type: 'array',
  items: { type: 'integer' },
  description: `年份列表，例如 [2018]。${DATA_BOUNDS}`,
} as const;

export const MONTHS = {
  type: 'array',
  items: { type: 'integer', minimum: 1, maximum: 12 },
  description: '月份列表，1-12，例如 [3]。不填表示全年。',
} as const;

export const CARRIERS = {
  type: 'array',
  items: { type: 'string' },
  description: '航司代码数组，例如 ["AA","DL"]。不填表示全部航司。',
} as const;

export const AIRPORTS = {
  type: 'array',
  items: { type: 'string' },
  description: '到达机场三字码数组，例如 ["JFK","LAX"]。不填表示全部机场。',
} as const;

export const DATE_FROM = {
  type: 'integer',
  description: '起始月份，格式 yyyymm，例如 201501。',
} as const;

export const DATE_TO = {
  type: 'integer',
  description: '结束月份，格式 yyyymm，例如 201712。',
} as const;

export const RANGES = {
  type: 'object',
  description:
    '按指标数值区间过滤。键为指标名（arr_flights 抵达航班总数、arr_del15 延误15分钟以上航班数、' +
    'arr_cancelled 取消航班数、arr_diverted 备降航班数、arr_delay 总延误分钟数），值为 {min,max}。',
} as const;

/** Filters shared by every flight/dashboard read tool. */
export function flightFilters(): Record<string, unknown> {
  return {
    years: YEARS,
    months: MONTHS,
    carriers: CARRIERS,
    airports: AIRPORTS,
    dateFrom: DATE_FROM,
    dateTo: DATE_TO,
    ranges: RANGES,
  };
}

/** Builds an object schema from composed fragments. */
export function schema(
  properties: Record<string, unknown>,
  required: string[] = [],
): ToolParameterSchema {
  return { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false };
}
