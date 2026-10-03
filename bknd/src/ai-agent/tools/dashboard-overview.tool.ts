import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service.js';
import { BaseTool, type ToolDefinition } from './base-tool.js';
import { AuditedTool } from './tool-audit.js';
import { flightFilters, schema } from './tool-schema.js';
import { extractFilters } from './param-extractor.js';
import { buildFlightDto } from './query-dto.js';
import { formatCompact, ratio } from './number-format.js';
import {
  toolSuccess,
  type MetricCardItem,
  type MetricCardPayload,
  type MetricRatio,
  type ToolContext,
  type ToolResult,
} from './tool.types.js';

export interface DashboardOverviewParams {
  years?: number[];
  months?: number[];
  carriers?: string[];
  airports?: string[];
  dateFrom?: number;
  dateTo?: number;
  ranges?: Record<string, { min?: number; max?: number }>;
}

function buildRatio(label: string, numerator: number, denominator: number): MetricRatio | null {
  const value = ratio(numerator, denominator);
  if (value === null) return null;
  return { label, value, percent: Number((value * 100).toFixed(2)) };
}

/**
 * The four Dashboard headline cards, reusing the production aggregation.
 *
 * Big numbers are formatted with the shared K/M/B rule on the server so the
 * Dashboard cards and the AI cards can never disagree.
 */
@Injectable()
export class DashboardOverviewTool extends BaseTool<DashboardOverviewParams, MetricCardPayload> {
  readonly definition: ToolDefinition = {
    name: 'dashboard.overview',
    description: 'Dashboard 四大核心指标：航司总数、覆盖机场数、航班抵达总数、取消航班总数（含占比）',
    intent: 'STATISTICS_ANALYSIS',
    resultType: 'chart',
    keywords: ['指标', '概览', '总览', '核心指标', '多少家', '覆盖', '统计', '大盘'],
    strongKeywords: ['核心指标', '指标卡', '概览', '总览', '大盘'],
    permission: 'dashboard:read',
    // 用于回答"整体情况怎么样""大盘数据"这类不含关键词的概括性提问。
    parameters: schema(flightFilters()),
  };

  constructor(private readonly dashboard: DashboardService) {
    super();
  }

  extractParams(query: string): Partial<DashboardOverviewParams> | null {
    if (!/指标|概览|总览|大盘|多少家|覆盖|统计|核心/.test(query)) return null;
    return extractFilters(query);
  }

  @AuditedTool()
  async execute(
    params: DashboardOverviewParams,
    _ctx: ToolContext,
  ): Promise<ToolResult<MetricCardPayload>> {
    const dto = buildFlightDto(params);
    const overview = await this.dashboard.overview(dto);

    const cards: MetricCardItem[] = [
      card('carrierCount', '航司总数', overview.carrierCount, null),
      card('airportCount', '覆盖机场数', overview.airportCount, null),
      card('arrFlights', '航班抵达总数', overview.arrFlights, null),
      card(
        'arrCancelled',
        '取消航班总数',
        overview.arrCancelled,
        buildRatio('取消率', overview.arrCancelled, overview.arrFlights),
      ),
    ];

    const message = [
      `航司 ${cards[0].formatted} 家`,
      `覆盖机场 ${cards[1].formatted} 个`,
      `抵达航班 ${cards[2].formatted}`,
      `取消航班 ${cards[3].formatted}`,
    ].join('，');

    return toolSuccess(this.definition.name, 'chart', { chartType: 'metric', cards }, {
      message,
      meta: {
        range: { from: params.dateFrom ?? null, to: params.dateTo ?? null },
        // Extra context the UI may render as secondary text.
        extra: {
          arrDel15: overview.arrDel15,
          arrDiverted: overview.arrDiverted,
          arrDelay: overview.arrDelay,
          delayRate: buildRatio('延误率', overview.arrDel15, overview.arrFlights),
        },
      },
    });
  }
}

function card(
  key: string,
  label: string,
  value: number,
  ratioValue: MetricRatio | null,
): MetricCardItem {
  const compact = formatCompact(value);
  return {
    key,
    label,
    value,
    formatted: compact.formatted,
    unit: compact.unit,
    ratio: ratioValue,
  };
}

