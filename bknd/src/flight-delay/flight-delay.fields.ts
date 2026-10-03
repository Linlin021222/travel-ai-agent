/**
 * The 21 business fields of the airline delay archive.
 * The layout mirrors the BTS "Airline Delay Causes" dataset so the Flight info
 * table can render the full archive without dropping a column.
 */

export const FLIGHT_DELAY_COLUMNS = [
  'year',
  'month',
  'carrier_code',
  'carrier_name',
  'airport_code',
  'airport_name',
  'arr_flights',
  'arr_del15',
  'carrier_ct',
  'weather_ct',
  'nas_ct',
  'security_ct',
  'late_aircraft_ct',
  'arr_cancelled',
  'arr_diverted',
  'arr_delay',
  'carrier_delay',
  'weather_delay',
  'nas_delay',
  'security_delay',
  'late_aircraft_delay',
] as const;

export type FlightDelayColumn = (typeof FLIGHT_DELAY_COLUMNS)[number];

/** Columns that accept a min/max range filter. */
export const NUMERIC_FIELDS = [
  'arr_flights',
  'arr_del15',
  'carrier_ct',
  'weather_ct',
  'nas_ct',
  'security_ct',
  'late_aircraft_ct',
  'arr_cancelled',
  'arr_diverted',
  'arr_delay',
  'carrier_delay',
  'weather_delay',
  'nas_delay',
  'security_delay',
  'late_aircraft_delay',
] as const;

export type NumericField = (typeof NUMERIC_FIELDS)[number];

export const NUMERIC_FIELD_SET: ReadonlySet<string> = new Set(NUMERIC_FIELDS);

/** Columns the UI is allowed to sort on. */
export const SORTABLE_FIELDS: ReadonlySet<string> = new Set([
  ...FLIGHT_DELAY_COLUMNS,
  'id',
]);

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

export interface NumericRange {
  min?: number;
  max?: number;
}

export type RangeFilters = Partial<Record<NumericField, NumericRange>>;

export interface CarrierOption {
  code: string;
  name: string;
}

export interface AirportOption {
  code: string;
  name: string;
}

export interface FlightDelayFilterOptions {
  years: number[];
  months: number[];
  carriers: CarrierOption[];
  airports: AirportOption[];
  numericBounds: Record<string, { min: number; max: number }>;
}

export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

/** Dimensions the dynamic bar chart can group by (its X axis). */
export const CHART_DIMENSIONS = ['date', 'carrier', 'airport'] as const;
export type ChartDimension = (typeof CHART_DIMENSIONS)[number];

/** Metrics the charts can plot on the Y axis. */
export const CHART_METRICS = [
  'arr_flights',
  'arr_del15',
  'arr_cancelled',
  'arr_diverted',
  'arr_delay',
] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];

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

/** A carrier × airport aggregate row used by the bubble chart. */
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
