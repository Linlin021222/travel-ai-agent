import { Injectable } from '@nestjs/common';
import {
  FlightDelayService,
  type FlightDelayOverview,
} from '../flight-delay/flight-delay.service.js';
import type { QueryFlightDelayDto } from '../flight-delay/dto/query-flight-delay.dto.js';
import type {
  AggregateResult,
  BubbleResult,
  ChartDimension,
  ChartMetric,
  FlightDelayFilterOptions,
} from '../flight-delay/flight-delay.fields.js';

/** Chinese labels shared by the Dashboard UI and the AI chart tools. */
export const DIMENSION_LABELS: Record<ChartDimension, string> = {
  date: '日期',
  carrier: '航司',
  airport: '机场',
};

export const METRIC_LABELS: Record<ChartMetric, string> = {
  arr_flights: '抵达航班总数',
  arr_del15: '延误15分钟以上航班数',
  arr_cancelled: '取消航班数',
  arr_diverted: '备降航班数',
  arr_delay: '总延误分钟数',
};

/**
 * Dashboard façade.
 *
 * The project had no `DashboardService`; rather than duplicating SQL in the
 * tool layer, this service delegates to the existing `FlightDelayService`,
 * whose `overview`/`aggregate`/`bubble` all share one WHERE builder. Every
 * Dashboard AI tool therefore inherits the exact production aggregation rules.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly flightDelay: FlightDelayService) {}

  overview(dto: QueryFlightDelayDto): Promise<FlightDelayOverview> {
    return this.flightDelay.overview(dto);
  }

  bar(dto: QueryFlightDelayDto): Promise<AggregateResult> {
    return this.flightDelay.aggregate(dto);
  }

  bubble(dto: QueryFlightDelayDto): Promise<BubbleResult> {
    return this.flightDelay.bubble(dto);
  }

  filterOptions(dto: QueryFlightDelayDto): Promise<FlightDelayFilterOptions> {
    return this.flightDelay.getFilterOptions(dto);
  }

  dimensionLabel(dimension: string): string {
    return DIMENSION_LABELS[dimension as ChartDimension] ?? dimension;
  }

  metricLabel(metric: string): string {
    return METRIC_LABELS[metric as ChartMetric] ?? metric;
  }
}
