export interface FlightDelayRow {
  year: number;
  month: number;
  carrier_code: string;
  carrier_name: string;
  airport_code: string;
  airport_name: string;
  arr_flights: number;
  arr_del15: number;
  carrier_ct: number;
  weather_ct: number;
  nas_ct: number;
  security_ct: number;
  late_aircraft_ct: number;
  arr_cancelled: number;
  arr_diverted: number;
  arr_delay: number;
  carrier_delay: number;
  weather_delay: number;
  nas_delay: number;
  security_delay: number;
  late_aircraft_delay: number;
}

export type FlightDelayField = keyof FlightDelayRow;

export interface PagedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
}

export interface CodeOption {
  code: string;
  name: string;
}

export interface FilterOptions {
  years: number[];
  months: number[];
  carriers: CodeOption[];
  airports: CodeOption[];
  numericBounds: Record<string, { min: number; max: number }>;
}

export const PAGE_SIZE_OPTIONS = [20, 50, 100];

export interface ColumnDef {
  key: FlightDelayField;
  label: string;
  width: number;
  numeric?: boolean;
  /** Long free text: ellipsis + hover tooltip, or wrap. */
  longText?: boolean;
}

/** All 21 fields of the airline delay archive, in archive order. */
export const COLUMNS: ColumnDef[] = [
  { key: "year", label: "年份", width: 72, numeric: true },
  { key: "month", label: "月份", width: 72, numeric: true },
  { key: "carrier_code", label: "航司代码", width: 96 },
  { key: "carrier_name", label: "航司全称", width: 200, longText: true },
  { key: "airport_code", label: "机场代码", width: 96 },
  { key: "airport_name", label: "机场全称", width: 230, longText: true },
  { key: "arr_flights", label: "到达航班总数", width: 120, numeric: true },
  { key: "arr_del15", label: "延误15分钟以上航班数", width: 150, numeric: true },
  { key: "carrier_ct", label: "航司原因延误航班数", width: 150, numeric: true },
  { key: "weather_ct", label: "天气原因延误航班数", width: 150, numeric: true },
  { key: "nas_ct", label: "空管原因延误航班数", width: 150, numeric: true },
  { key: "security_ct", label: "安检原因延误航班数", width: 150, numeric: true },
  { key: "late_aircraft_ct", label: "晚到航班原因延误航班数", width: 165, numeric: true },
  { key: "arr_cancelled", label: "航班取消数", width: 120, numeric: true },
  { key: "arr_diverted", label: "航班备降数", width: 120, numeric: true },
  { key: "arr_delay", label: "总延误时长(分钟)", width: 140, numeric: true },
  { key: "carrier_delay", label: "航司原因延误时长(分钟)", width: 165, numeric: true },
  { key: "weather_delay", label: "天气原因延误时长(分钟)", width: 165, numeric: true },
  { key: "nas_delay", label: "空管原因延误时长(分钟)", width: 165, numeric: true },
  { key: "security_delay", label: "安检原因延误时长(分钟)", width: 165, numeric: true },
  { key: "late_aircraft_delay", label: "晚到航班原因延误时长(分钟)", width: 180, numeric: true },
];

/** Columns frozen on the left while scrolling horizontally. */
export const STICKY_LEFT_COUNT = 2;

export const COLUMN_MAP: Record<string, ColumnDef> = COLUMNS.reduce(
  (acc, column) => {
    acc[column.key] = column;
    return acc;
  },
  {} as Record<string, ColumnDef>,
);

/** Numeric fields that support min/max range filtering. */
export const RANGE_FIELDS: { key: FlightDelayField; label: string; core?: boolean }[] = [
  { key: "arr_flights", label: "到达航班总数", core: true },
  { key: "arr_del15", label: "延误15分钟以上航班数", core: true },
  { key: "arr_cancelled", label: "航班取消数", core: true },
  { key: "arr_diverted", label: "航班备降数", core: true },
  { key: "arr_delay", label: "总延误时长(分钟)", core: true },
  { key: "carrier_delay", label: "航司原因延误时长(分钟)" },
  { key: "weather_delay", label: "天气原因延误时长(分钟)" },
  { key: "nas_delay", label: "空管原因延误时长(分钟)" },
  { key: "security_delay", label: "安检原因延误时长(分钟)" },
  { key: "late_aircraft_delay", label: "晚到航班原因延误时长(分钟)" },
  { key: "carrier_ct", label: "航司原因延误航班数" },
  { key: "weather_ct", label: "天气原因延误航班数" },
  { key: "nas_ct", label: "空管原因延误航班数" },
  { key: "security_ct", label: "安检原因延误航班数" },
  { key: "late_aircraft_ct", label: "晚到航班原因延误航班数" },
];

export const RANGE_FIELD_MAP: Record<string, string> = RANGE_FIELDS.reduce(
  (acc, field) => {
    acc[field.key] = field.label;
    return acc;
  },
  {} as Record<string, string>,
);

export type RangeValue = { min?: string; max?: string };

/* ------------------------------------------------------------------ */
/* Chart-oriented types (Dashboard bar chart + bubble chart)          */
/* ------------------------------------------------------------------ */

export type ChartDimension = "date" | "carrier" | "airport";
export type ChartMetric =
  | "arr_flights"
  | "arr_del15"
  | "arr_cancelled"
  | "arr_diverted"
  | "arr_delay";

export const CHART_DIMENSIONS: ChartDimension[] = ["date", "carrier", "airport"];
export const CHART_DIMENSION_LABELS: Record<ChartDimension, string> = {
  date: "日期（年月）",
  carrier: "航空公司",
  airport: "机场",
};

export const CHART_METRICS: ChartMetric[] = [
  "arr_flights",
  "arr_del15",
  "arr_cancelled",
  "arr_diverted",
  "arr_delay",
];
export const CHART_METRIC_LABELS: Record<ChartMetric, string> = {
  arr_flights: "到达航班总数",
  arr_del15: "延误15分钟以上航班数",
  arr_cancelled: "航班取消数",
  arr_diverted: "航班备降数",
  arr_delay: "总延误分钟数",
};

export interface AggregatePoint {
  key: string;
  label: string;
  value: number;
  year?: number;
  month?: number;
}

export interface AggregateResult {
  dimension: ChartDimension;
  metric: ChartMetric;
  data: AggregatePoint[];
}

export interface BubblePoint {
  carrier_code: string;
  carrier_name: string;
  airport_code: string;
  airport_name: string;
  arr_flights: number;
  arr_del15: number;
  arr_cancelled: number;
  arr_diverted: number;
  arr_delay: number;
}

export interface BubbleResult {
  data: BubblePoint[];
}

/** A carrier-level roll-up for the bubble chart level 1. */
export interface BubbleCarrierSummary {
  carrier_code: string;
  carrier_name: string;
  arr_flights: number;
  arr_del15: number;
  arr_cancelled: number;
  arr_diverted: number;
  arr_delay: number;
  airports: BubblePoint[];
}

/** Shared filter state driving both the bar charts and the bubble chart. */
export interface DashboardFilters {
  /** Inclusive start of the date range, format YYYYMM (e.g. 201801). */
  dateFrom: number | null;
  /** Inclusive end of the date range, format YYYYMM. */
  dateTo: number | null;
  carriers: string[];
  airports: string[];
  /** Selected Y-axis metric shared by both bar charts. */
  metric: ChartMetric;
  /** Range filter applied to the selected metric. */
  metricRange: { min?: number; max?: number };
}

export const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  dateFrom: null,
  dateTo: null,
  carriers: [],
  airports: [],
  metric: "arr_flights",
  metricRange: {},
};

/** Query contract shared by the chart API helpers in lib/api. */
export interface ChartQuery {
  dimension?: string;
  metric?: string;
  years?: number[];
  months?: number[];
  carriers?: string[];
  airports?: string[];
  dateFrom?: number;
  dateTo?: number;
  metricRange?: { min?: number; max?: number };
}

/** Serialise the shared dashboard filters into the ChartQuery shape. */
export function toChartQuery(filters: DashboardFilters): ChartQuery {
  return {
    carriers: filters.carriers.length ? filters.carriers : undefined,
    airports: filters.airports.length ? filters.airports : undefined,
    dateFrom: filters.dateFrom ?? undefined,
    dateTo: filters.dateTo ?? undefined,
    metric: filters.metric,
    metricRange:
      filters.metricRange.min !== undefined || filters.metricRange.max !== undefined
        ? filters.metricRange
        : undefined,
  };
}


export interface Filters {
  years: number[];
  months: number[];
  carriers: string[];
  airports: string[];
  ranges: Record<string, RangeValue>;
}

export const EMPTY_FILTERS: Filters = {
  years: [],
  months: [],
  carriers: [],
  airports: [],
  ranges: {},
};

export function createDefaultRanges(): Record<string, RangeValue> {
  return RANGE_FIELDS.filter((field) => field.core).reduce<Record<string, RangeValue>>(
    (acc, field) => {
      acc[field.key] = {};
      return acc;
    },
    {},
  );
}

export function formatMetric(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return numeric.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

export function countActiveFilters(filters: Filters): number {
  let count =
    filters.years.length + filters.months.length + filters.carriers.length + filters.airports.length;
  for (const value of Object.values(filters.ranges)) {
    if (value?.min) count += 1;
    if (value?.max) count += 1;
  }
  return count;
}

/** Serialise filters into the query string the API expects. */
export function buildFilterParams(
  filters: Filters,
  page: number,
  pageSize: number,
  sort?: { sortBy?: string; sortDir?: "asc" | "desc" },
): Record<string, string> {
  const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
  if (filters.years.length) params.years = filters.years.join(",");
  if (filters.months.length) params.months = filters.months.join(",");
  if (filters.carriers.length) params.carriers = filters.carriers.join(",");
  if (filters.airports.length) params.airports = filters.airports.join(",");
  for (const [field, range] of Object.entries(filters.ranges)) {
    if (range?.min) params[`${field}_min`] = range.min;
    if (range?.max) params[`${field}_max`] = range.max;
  }
  if (sort?.sortBy && sort.sortDir) {
    params.sortBy = sort.sortBy;
    params.sortDir = sort.sortDir;
  }
  return params;
}

export function filterSignature(filters: Filters): string {
  return JSON.stringify([
    filters.years,
    filters.months,
    filters.carriers,
    filters.airports,
    Object.entries(filters.ranges)
      .filter(([, range]) => range?.min || range?.max)
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
}
