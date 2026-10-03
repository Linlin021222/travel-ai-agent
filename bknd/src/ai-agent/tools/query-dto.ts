import type { QueryFlightDelayDto } from '../../flight-delay/dto/query-flight-delay.dto.js';

export interface FlightFilterParams {
  years?: number[];
  months?: number[];
  carriers?: string[];
  airports?: string[];
  dateFrom?: number;
  dateTo?: number;
  ranges?: Record<string, { min?: number; max?: number }>;
  dimension?: string;
  metric?: string;
  topN?: number;
}

/**
 * Maps a tool's friendly parameter object onto the *existing* query contract.
 *
 * Tools never build SQL; they only translate their own parameters into the
 * DTO the business service already validates.
 */
export function buildFlightDto(params: FlightFilterParams): QueryFlightDelayDto {
  const dto: Record<string, unknown> = {
    years: params.years,
    months: params.months,
    carriers: params.carriers,
    airports: params.airports,
    date_from: params.dateFrom,
    date_to: params.dateTo,
  };

  if (params.dimension) dto.dimension = params.dimension;
  if (params.metric) dto.metric = params.metric;

  for (const [field, range] of Object.entries(params.ranges ?? {})) {
    if (typeof range?.min === 'number') dto[`${field}_min`] = range.min;
    if (typeof range?.max === 'number') dto[`${field}_max`] = range.max;
  }

  return dto as unknown as QueryFlightDelayDto;
}
