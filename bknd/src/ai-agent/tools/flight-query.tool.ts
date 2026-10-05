import { Injectable } from '@nestjs/common';
import type { QueryFlightDelayDto } from '../../flight-delay/dto/query-flight-delay.dto.js';
import { FLIGHT_DELAY_COLUMNS } from '../../flight-delay/flight-delay.fields.js';
import { FlightDelayService } from '../../flight-delay/flight-delay.service.js';
import { BaseTool, type ToolDefinition } from './base-tool.js';
import { AuditedTool } from './tool-audit.js';
import { flightFilters, schema } from './tool-schema.js';
import { extractFilters, extractKeyword } from './param-extractor.js';
import {
  toolSuccess,
  type TablePayload,
  type ToolContext,
  type ToolResult,
} from './tool.types.js';

export interface FlightQueryParams {
  keyword?: string;
  years?: number[];
  months?: number[];
  carriers?: string[];
  airports?: string[];
  dateFrom?: number;
  dateTo?: number;
  /** `{ arr_flights: { min: 100, max: 500 } }` — one entry per numeric column. */
  ranges?: Record<string, { min?: number; max?: number }>;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

const COLUMN_LABELS: Record<string, string> = {
  year: '年份',
  month: '月份',
  carrier_code: '航司代码',
  carrier_name: '航司名称',
  airport_code: '机场代码',
  airport_name: '机场名称',
  arr_flights: '抵达航班数',
  arr_del15: '延误15分钟以上',
  carrier_ct: '航司原因(次)',
  weather_ct: '天气原因(次)',
  nas_ct: '空管原因(次)',
  security_ct: '安保原因(次)',
  late_aircraft_ct: '晚到飞机(次)',
  arr_cancelled: '取消航班数',
  arr_diverted: '备降航班数',
  arr_delay: '总延误分钟数',
  carrier_delay: '航司原因延误(分钟)',
  weather_delay: '天气原因延误(分钟)',
  nas_delay: '空管原因延误(分钟)',
  security_delay: '安保原因延误(分钟)',
  late_aircraft_delay: '晚到飞机延误(分钟)',
};

/**
 * Read-only flight table query.
 *
 * Everything is delegated to `FlightDelayService.findAll`, so paging, sorting
 * and every numeric filter behave exactly like the Flight info page. The only
 * extra is keyword resolution: a free-text word is matched against the
 * carrier/airport catalogue returned by `getFilterOptions` and translated into
 * the corresponding code filters — no new SQL is introduced here.
 */
@Injectable()
export class FlightQueryTool extends BaseTool<FlightQueryParams, TablePayload> {
  readonly definition: ToolDefinition = {
    name: 'flight.query',
    description: '按年份/月份/航司/机场/各项航班指标查询航班延误明细',
    intent: 'QUERY_DATA',
    resultType: 'table',
    keywords: ['航班', '明细', '查询航班', '取消', '备降', '延误', '机场', '航司', '机票'],
    strongKeywords: ['明细', '记录', '清单'],
    permission: 'flight:read',
    parameters: schema({
      keyword: { type: 'string', description: '航司代码或机场代码关键词。' },
      ...flightFilters(),
      page: { type: 'integer', minimum: 1, description: '页码，默认 1。' },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页条数，默认 20。' },
      sortBy: { type: 'string', description: '排序字段，如 year、arr_flights。' },
      sortDir: { type: 'string', enum: ['asc', 'desc'] },
    }),
  };

  constructor(private readonly flights: FlightDelayService) {
    super();
  }

  extractParams(query: string): Partial<FlightQueryParams> | null {
    if (!/航班|明细|航司|机场|取消|备降|延误/.test(query)) return null;

    const filters = extractFilters(query);
    const params: Partial<FlightQueryParams> = { ...filters };

    const keyword = extractKeyword(query);
    // A quoted keyword belongs to the flight search, not to year/month parsing.
    if (keyword) params.keyword = keyword;

    return params;
  }

  @AuditedTool()
  async execute(params: FlightQueryParams, ctx: ToolContext): Promise<ToolResult<TablePayload>> {
    const { carriers, airports } = await this.resolveKeyword(params);

    const dto: Record<string, unknown> = {
      page: Math.max(1, Math.trunc(params.page ?? 1) || 1),
      pageSize: [20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20,
      sortBy: params.sortBy ?? 'arr_flights',
      sortDir: params.sortDir ?? 'desc',
      years: params.years,
      months: params.months,
      carriers,
      airports,
      date_from: params.dateFrom,
      date_to: params.dateTo,
    };

    for (const [field, range] of Object.entries(params.ranges ?? {})) {
      if (typeof range?.min === 'number') dto[`${field}_min`] = range.min;
      if (typeof range?.max === 'number') dto[`${field}_max`] = range.max;
    }

    const result = await this.flights.findAll(dto as unknown as QueryFlightDelayDto);

    const columns = FLIGHT_DELAY_COLUMNS.map((key) => ({
      key,
      label: COLUMN_LABELS[key] ?? key,
    }));

    return toolSuccess(
      this.definition.name,
      'table',
      { columns, rows: result.data as unknown as Record<string, unknown>[] } satisfies TablePayload,
      {
        message:
          result.total > 0
            ? `共 ${result.total.toLocaleString('zh-CN')} 条航班记录，当前显示第 ${result.rangeStart}-${result.rangeEnd} 条`
            : '当前筛选条件下没有航班记录',
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
          rangeStart: result.rangeStart,
          rangeEnd: result.rangeEnd,
        },
        meta: {
          keyword: params.keyword ?? null,
          filters: {
            ...(params.years?.length ? { years: params.years } : {}),
            ...(params.months?.length ? { months: params.months } : {}),
            ...(carriers?.length ? { carriers } : {}),
            ...(airports?.length ? { airports } : {}),
            ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
            ...(params.dateTo ? { dateTo: params.dateTo } : {}),
            ...(params.ranges && Object.keys(params.ranges).length ? { ranges: params.ranges } : {}),
          },
        },
      },
    );
  }

  /**
   * Translates a free-text keyword into carrier / airport code filters using
   * the catalogue the business service already exposes.
   */
  private async resolveKeyword(
    params: FlightQueryParams,
  ): Promise<{ carriers?: string[]; airports?: string[] }> {
    const explicitCarriers = params.carriers?.length ? params.carriers : undefined;
    const explicitAirports = params.airports?.length ? params.airports : undefined;

    if (!params.keyword) return { carriers: explicitCarriers, airports: explicitAirports };

    const options = await this.flights.getFilterOptions({} as QueryFlightDelayDto);
    const needle = params.keyword.trim().toLowerCase();

    const matchedCarriers = options.carriers
      .filter(
        (item) =>
          item.code.toLowerCase().includes(needle) ||
          (item.name ?? '').toLowerCase().includes(needle),
      )
      .map((item) => item.code);

    const matchedAirports = options.airports
      .filter(
        (item) =>
          item.code.toLowerCase().includes(needle) ||
          (item.name ?? '').toLowerCase().includes(needle),
      )
      .map((item) => item.code);

    return {
      carriers: mergeCodes(explicitCarriers, matchedCarriers),
      airports: mergeCodes(explicitAirports, matchedAirports),
    };
  }
}

function mergeCodes(explicit: string[] | undefined, matched: string[]): string[] | undefined {
  const merged = new Set([...(explicit ?? []), ...matched]);
  return merged.size ? [...merged] : undefined;
}
