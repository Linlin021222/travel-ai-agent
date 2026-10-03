import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.module.js';
import type { QueryFlightDelayDto } from './dto/query-flight-delay.dto.js';
import {
  CHART_DIMENSIONS,
  CHART_METRICS,
  DEFAULT_PAGE_SIZE,
  FLIGHT_DELAY_COLUMNS,
  NUMERIC_FIELDS,
  NUMERIC_FIELD_SET,
  PAGE_SIZE_OPTIONS,
  SORTABLE_FIELDS,
  type AggregatePoint,
  type AggregateResult,
  type AirportOption,
  type BubblePoint,
  type BubbleResult,
  type CarrierOption,
  type ChartDimension,
  type ChartMetric,
  type FlightDelayFilterOptions,
  type FlightDelayRow,
  type NumericField,
  type RangeFilters,
} from './flight-delay.fields.js';

type Dimension = 'years' | 'months' | 'carriers' | 'airports';

export interface FlightDelayOverview {
  carrierCount: number;
  airportCount: number;
  arrFlights: number;
  arrCancelled: number;
  arrDel15: number;
  arrDiverted: number;
  arrDelay: number;
  dateFrom: number | null;
  dateTo: number | null;
}

interface NormalizedFilters {
  years?: number[];
  months?: number[];
  carriers?: string[];
  airports?: string[];
  dateFrom?: number;
  dateTo?: number;
  ranges: RangeFilters;
}

export interface PagedFlightDelay {
  data: FlightDelayRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
}

@Injectable()
export class FlightDelayService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findAll(dto: QueryFlightDelayDto): Promise<PagedFlightDelay> {
    const filters = normalizeFilters(dto);
    const page = Math.max(1, Math.trunc(dto.page ?? 1));
    const pageSize = resolvePageSize(dto.pageSize);
    const orderBy = resolveOrderBy(dto);

    const where = this.buildWhere(filters, new Set());
    const totalResult = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count FROM flight_delay${where.sql}`,
      where.params,
    );
    const total = Number(totalResult.rows[0]?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;

    const rows = total
      ? await this.pool.query<FlightDelayRow>(
          `SELECT ${FLIGHT_DELAY_COLUMNS.join(', ')}
           FROM flight_delay${where.sql}
           ORDER BY ${orderBy}, id ASC
           LIMIT $${where.params.length + 1} OFFSET $${where.params.length + 2}`,
          [...where.params, pageSize, offset],
        )
      : { rows: [] as FlightDelayRow[] };

    const rangeStart = total === 0 ? 0 : offset + 1;
    const rangeEnd = Math.min(offset + pageSize, total);

    return {
      data: rows.rows.map((row) => normalizeRow(row)),
      total,
      page: safePage,
      pageSize,
      totalPages,
      rangeStart,
      rangeEnd,
    };
  }

  /**
   * Group-by aggregate for the dynamic bar chart. Returns one summed value per
   * dimension bucket (a year-month, a carrier, or an airport) for a single
   * metric. The metric range is applied as a HAVING filter on the aggregated
   * sum (not on raw rows) so it filters whole bars, not individual records.
   */
  async aggregate(dto: QueryFlightDelayDto): Promise<AggregateResult> {
    const dimension: ChartDimension = CHART_DIMENSIONS.includes(dto.dimension as ChartDimension)
      ? (dto.dimension as ChartDimension)
      : 'date';
    const metric: ChartMetric = CHART_METRICS.includes(dto.metric as ChartMetric)
      ? (dto.metric as ChartMetric)
      : 'arr_flights';

    const filters = normalizeFilters(dto);
    // Metric range filters the aggregated value, so keep it out of the raw WHERE.
    const metricRange = filters.ranges[metric];
    delete filters.ranges[metric];

    const where = this.buildWhere(filters, new Set());
    const { sql: havingSql, params: havingParams } = this.metricHaving(metric, metricRange, where.params.length);

    let select: string;
    let groupBy: string;
    let orderBy: string;

    if (dimension === 'date') {
      select = `year, month, (year * 100 + month) AS ym, SUM(${metric})::bigint AS value`;
      groupBy = 'year, month, ym';
      orderBy = 'ym ASC';
    } else if (dimension === 'carrier') {
      select = `carrier_code AS code, MIN(carrier_name) AS label, SUM(${metric})::bigint AS value`;
      groupBy = 'carrier_code';
      orderBy = 'value DESC, carrier_code ASC';
    } else {
      select = `airport_code AS code, MIN(airport_name) AS label, SUM(${metric})::bigint AS value`;
      groupBy = 'airport_code';
      orderBy = 'value DESC, airport_code ASC';
    }

    const rows = await this.pool.query(
      `SELECT ${select} FROM flight_delay${where.sql} GROUP BY ${groupBy}${havingSql} ORDER BY ${orderBy}`,
      [...where.params, ...havingParams],
    );

    const data: AggregatePoint[] = rows.rows.map((row: Record<string, unknown>) => {
      if (dimension === 'date') {
        const year = Number(row.year);
        const month = Number(row.month);
        const key = `${year}-${String(month).padStart(2, '0')}`;
        return { key, label: key, value: Number(row.value), year, month };
      }
      return { key: String(row.code), label: String(row.label), value: Number(row.value) };
    });

    return { dimension, metric, data };
  }

  /**
   * Carrier × airport aggregates for the bubble chart. Each row is one
   * airline-airport pair with the five core metrics summed, so the front end
   * can roll up to level 1 (airline) or drill into level 2 (airport). The
   * selected metric range (if any) is applied as a HAVING filter.
   */
  async bubble(dto: QueryFlightDelayDto): Promise<BubbleResult> {
    const filters = normalizeFilters(dto);
    const metric: ChartMetric = CHART_METRICS.includes(dto.metric as ChartMetric)
      ? (dto.metric as ChartMetric)
      : 'arr_flights';
    const metricRange = filters.ranges[metric];
    delete filters.ranges[metric];

    const where = this.buildWhere(filters, new Set());
    const { sql: havingSql, params: havingParams } = this.metricHaving(metric, metricRange, where.params.length);

    const rows = await this.pool.query<BubblePoint>(
      `SELECT carrier_code,
              MIN(carrier_name) AS carrier_name,
              airport_code,
              MIN(airport_name) AS airport_name,
              SUM(arr_flights)::bigint    AS arr_flights,
              SUM(arr_del15)::bigint      AS arr_del15,
              SUM(arr_cancelled)::bigint  AS arr_cancelled,
              SUM(arr_diverted)::bigint   AS arr_diverted,
              SUM(arr_delay)::bigint      AS arr_delay
       FROM flight_delay${where.sql}
       GROUP BY carrier_code, airport_code${havingSql}
       ORDER BY carrier_code ASC, arr_flights DESC`,
      [...where.params, ...havingParams],
    );

    const data = rows.rows.map((row) => ({
      carrier_code: row.carrier_code,
      carrier_name: row.carrier_name,
      airport_code: row.airport_code,
      airport_name: row.airport_name,
      arr_flights: Number(row.arr_flights),
      arr_del15: Number(row.arr_del15),
      arr_cancelled: Number(row.arr_cancelled),
      arr_diverted: Number(row.arr_diverted),
      arr_delay: Number(row.arr_delay),
    }));

    return { data };
  }

  /**
   * Dashboard headline numbers for the current filter.
   *
   * Deliberately reuses the *same* WHERE builder as the table / bar / bubble
   * endpoints so the KPI cards can never disagree with the charts.
   */
  async overview(dto: QueryFlightDelayDto): Promise<FlightDelayOverview> {
    const filters = normalizeFilters(dto);
    const where = this.buildWhere(filters, new Set());

    const result = await this.pool.query<Record<string, string | number>>(
      `SELECT COUNT(DISTINCT carrier_code)::bigint AS carrier_count,
              COUNT(DISTINCT airport_code)::bigint AS airport_count,
              COALESCE(SUM(arr_flights), 0)::bigint   AS arr_flights,
              COALESCE(SUM(arr_cancelled), 0)::bigint AS arr_cancelled,
              COALESCE(SUM(arr_del15), 0)::bigint     AS arr_del15,
              COALESCE(SUM(arr_diverted), 0)::bigint  AS arr_diverted,
              COALESCE(SUM(arr_delay), 0)::bigint     AS arr_delay
       FROM flight_delay${where.sql}`,
      where.params,
    );

    const row = result.rows[0] ?? {};
    return {
      carrierCount: Number(row.carrier_count ?? 0),
      airportCount: Number(row.airport_count ?? 0),
      arrFlights: Number(row.arr_flights ?? 0),
      arrCancelled: Number(row.arr_cancelled ?? 0),
      arrDel15: Number(row.arr_del15 ?? 0),
      arrDiverted: Number(row.arr_diverted ?? 0),
      arrDelay: Number(row.arr_delay ?? 0),
      dateFrom: filters.dateFrom ?? null,
      dateTo: filters.dateTo ?? null,
    };
  }

  /**
   * Build a HAVING clause that filters the aggregated SUM(metric) by the
   * optional range. `offset` is the number of existing query parameters so the
   * placeholders stay numbered correctly.
   */
  private metricHaving(
    metric: ChartMetric,
    range: { min?: number; max?: number } | undefined,
    offset: number,
  ): { sql: string; params: unknown[] } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (range?.min !== undefined && Number.isFinite(range.min)) {
      params.push(range.min);
      clauses.push(`SUM(${metric}) >= $${offset + params.length}::double precision`);
    }
    if (range?.max !== undefined && Number.isFinite(range.max)) {
      params.push(range.max);
      clauses.push(`SUM(${metric}) <= $${offset + params.length}::double precision`);
    }
    return {
      sql: clauses.length ? ` HAVING ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  /**
   * Options for every filter dimension.
   * Each dimension is computed with the *other* dimensions applied so that the
   * dropdowns cascade (e.g. months only contain months that have data for the
   * selected years, airports only contain airports served by the selected
   * carriers).
   */
  async getFilterOptions(dto: QueryFlightDelayDto): Promise<FlightDelayFilterOptions> {
    const filters = normalizeFilters(dto);
    const [years, months, carriers, airports, numericBounds] = await Promise.all([
      this.distinctNumbers('year', filters, 'years', 'year'),
      this.distinctNumbers('month', filters, 'months', 'month'),
      this.distinctCarriers(filters),
      this.distinctAirports(filters),
      this.getNumericBounds(),
    ]);

    return { years, months, carriers, airports, numericBounds };
  }

  private async distinctNumbers(
    column: 'year' | 'month',
    filters: NormalizedFilters,
    dimension: Dimension,
    orderBy: string,
  ): Promise<number[]> {
    const where = this.buildWhere(filters, new Set([dimension]));
    const result = await this.pool.query<{ value: number }>(
      `SELECT DISTINCT ${column} AS value FROM flight_delay${where.sql} ORDER BY ${orderBy} ASC`,
      where.params,
    );
    return result.rows.map((row) => Number(row.value));
  }

  private async distinctCarriers(filters: NormalizedFilters): Promise<CarrierOption[]> {
    const where = this.buildWhere(filters, new Set<Dimension>(['carriers']));
    const result = await this.pool.query<CarrierOption>(
      `SELECT carrier_code AS code, MIN(carrier_name) AS name
       FROM flight_delay${where.sql}
       GROUP BY carrier_code
       ORDER BY carrier_code ASC`,
      where.params,
    );
    return result.rows;
  }

  private async distinctAirports(filters: NormalizedFilters): Promise<AirportOption[]> {
    const where = this.buildWhere(filters, new Set<Dimension>(['airports']));
    const result = await this.pool.query<AirportOption>(
      `SELECT airport_code AS code, MIN(airport_name) AS name
       FROM flight_delay${where.sql}
       GROUP BY airport_code
       ORDER BY airport_code ASC`,
      where.params,
    );
    return result.rows;
  }

  private async getNumericBounds() {
    const bounds: Record<string, { min: number; max: number }> = {};

    // Chart metrics need **aggregated** bounds because bar charts SUM by dimension
    // (carrier / date / airport).  Raw-row MIN/MAX would be far too small (e.g.
    // max arr_flights per row ≈ 33k but a carrier@ATL total is ≈ 3.9M).
    const chartMetricSet = new Set(CHART_METRICS as readonly string[]);
    const chartMetrics = [...chartMetricSet];

    if (chartMetrics.length) {
      // Each UNION ALL branch returns ALL metrics so column lists match.
      // Three branches = three grouping dimensions; outer query takes MAX across them.
      const sumExprs = chartMetrics.map((m) => `SUM(${m}) AS ${m}`).join(', ');
      const maxSelects = chartMetrics.map((m) => `MAX(${m}) AS ${m}_max`).join(', ');
      const result = await this.pool.query<Record<string, number>>(
        `WITH agg AS (
          SELECT ${sumExprs} FROM flight_delay GROUP BY carrier_code
          UNION ALL
          SELECT ${sumExprs} FROM flight_delay GROUP BY year * 100 + month
          UNION ALL
          SELECT ${sumExprs} FROM flight_delay GROUP BY airport_code
        ) SELECT ${maxSelects} FROM agg`,
      );
      const row = result.rows[0] ?? {};
      for (const m of chartMetrics) {
        bounds[m] = { min: 0, max: Number(row[`${m}_max`] ?? 0) };
      }
    }

    // Non-chart numeric fields keep raw-row MIN/MAX (used only in Flight info table).
    const otherFields = NUMERIC_FIELDS.filter((f) => !chartMetricSet.has(f));
    if (otherFields.length) {
      const expressions = otherFields
        .map((f) => `MIN(${f}) AS ${f}_min, MAX(${f}) AS ${f}_max`)
        .join(', ');
      const result = await this.pool.query<Record<string, number>>(
        `SELECT ${expressions} FROM flight_delay`,
      );
      const row = result.rows[0] ?? {};
      for (const f of otherFields) {
        bounds[f] = {
          min: Number(row[`${f}_min`] ?? 0),
          max: Number(row[`${f}_max`] ?? 0),
        };
      }
    }

    return bounds;
  }

  private buildWhere(filters: NormalizedFilters, exclude: Set<Dimension>) {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (!exclude.has('years') && filters.years?.length) {
      params.push(filters.years);
      clauses.push(`year = ANY($${params.length}::int[])`);
    }
    if (!exclude.has('months') && filters.months?.length) {
      params.push(filters.months);
      clauses.push(`month = ANY($${params.length}::int[])`);
    }
    if (filters.dateFrom !== undefined && Number.isFinite(filters.dateFrom)) {
      params.push(filters.dateFrom);
      clauses.push(`(year * 100 + month) >= $${params.length}::int`);
    }
    if (filters.dateTo !== undefined && Number.isFinite(filters.dateTo)) {
      params.push(filters.dateTo);
      clauses.push(`(year * 100 + month) <= $${params.length}::int`);
    }
    if (!exclude.has('carriers') && filters.carriers?.length) {
      params.push(filters.carriers);
      clauses.push(`carrier_code = ANY($${params.length}::text[])`);
    }
    if (!exclude.has('airports') && filters.airports?.length) {
      params.push(filters.airports);
      clauses.push(`airport_code = ANY($${params.length}::text[])`);
    }

    for (const field of NUMERIC_FIELDS) {
      const range = filters.ranges[field];
      if (!range) continue;
      if (typeof range.min === 'number' && Number.isFinite(range.min)) {
        params.push(range.min);
        clauses.push(`${field} >= $${params.length}::double precision`);
      }
      if (typeof range.max === 'number' && Number.isFinite(range.max)) {
        params.push(range.max);
        clauses.push(`${field} <= $${params.length}::double precision`);
      }
    }

    return {
      sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }
}

function normalizeFilters(dto: QueryFlightDelayDto): NormalizedFilters {
  const ranges: RangeFilters = {};
  const source = dto as unknown as Record<string, unknown>;
  for (const field of NUMERIC_FIELDS) {
    const min = toOptionalNumber(source[`${field}_min`]);
    const max = toOptionalNumber(source[`${field}_max`]);
    if (min !== undefined || max !== undefined) {
      ranges[field] = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    }
  }

  return {
    years: dto.years?.length ? dto.years : undefined,
    months: dto.months?.length ? dto.months : undefined,
    carriers: dto.carriers?.length ? dto.carriers : undefined,
    airports: dto.airports?.length ? dto.airports : undefined,
    dateFrom: toOptionalNumber(dto.date_from),
    dateTo: toOptionalNumber(dto.date_to),
    ranges,
  };
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolvePageSize(value: unknown): number {
  const parsed = Number(value);
  const fallback = Number(DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(parsed)) return fallback;
  const candidate = Math.trunc(parsed);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(candidate) ? candidate : fallback;
}

function resolveOrderBy(dto: QueryFlightDelayDto): string {
  const column = dto.sortBy && SORTABLE_FIELDS.has(dto.sortBy) ? dto.sortBy : null;
  if (!column) {
    return 'year DESC, month DESC, carrier_code ASC, airport_code ASC';
  }
  return `${column} ${dto.sortDir === 'asc' ? 'ASC' : 'DESC'}`;
}

function normalizeRow(row: FlightDelayRow): FlightDelayRow {
  const output = {} as Record<string, unknown>;
  for (const column of FLIGHT_DELAY_COLUMNS) {
    const value = row[column as keyof FlightDelayRow];
    output[column] = typeof value === 'string' && NUMERIC_FIELD_SET.has(column) ? Number(value) : value;
  }
  return output as unknown as FlightDelayRow;
}

export type { NumericField };
