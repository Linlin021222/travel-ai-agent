import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service.js';
import { BaseTool, type ToolDefinition } from './base-tool.js';
import { AuditedTool } from './tool-audit.js';
import { flightFilters, schema } from './tool-schema.js';
import { extractFilters } from './param-extractor.js';
import { buildFlightDto } from './query-dto.js';
import {
  toolSuccess,
  type BarChartPayload,
  type ToolContext,
  type ToolResult,
} from './tool.types.js';

export interface DashboardBarParams {
  /** date | carrier | airport */
  dimension?: string;
  metric?: string;
  years?: number[];
  months?: number[];
  carriers?: string[];
  airports?: string[];
  dateFrom?: number;
  dateTo?: number;
  ranges?: Record<string, { min?: number; max?: number }>;
  topN?: number;
}

/**
 * Multi-dimension bar chart data.
 *
 * Delegates to `DashboardService.bar`, i.e. the exact GROUP BY + HAVING logic
 * the Dashboard page uses, including the "metric range filters whole bars"
 * rule. `topN` only trims the response — it never changes the aggregation.
 */
@Injectable()
export class DashboardBarTool extends BaseTool<DashboardBarParams, BarChartPayload> {
  readonly definition: ToolDefinition = {
    name: 'dashboard.bar',
    description: '多维度条形图统计：按日期/航司/机场聚合抵达、延误、取消、备降、延误时长',
    intent: 'STATISTICS_ANALYSIS',
    resultType: 'chart',
    keywords: ['条形图', '柱状图', ' bar', '图表', '对比', '排名', '趋势', '按月', '按航司', '按机场'],
    strongKeywords: ['条形图', '柱状图', 'bar 图', '排行'],
    permission: 'dashboard:read',
    // 用于比较、排名、趋势类提问：模型据此选出维度与指标。
    parameters: schema({
      dimension: {
        type: 'string',
        enum: ['date', 'carrier', 'airport'],
        description: '聚合维度：date 按日期、carrier 按航司、airport 按机场。',
      },
      metric: {
        type: 'string',
        enum: ['arr_flights', 'arr_del15', 'arr_cancelled', 'arr_diverted', 'arr_delay'],
        description:
          '统计指标：arr_flights 抵达航班总数、arr_del15 延误15分钟以上航班数、' +
          'arr_cancelled 取消航班数、arr_diverted 备降航班数、arr_delay 总延误分钟数。',
      },
      topN: {
        type: 'integer',
        minimum: 1,
        description:
          '只返回数值最大的前 N 个维度值。仅当用户明确问"最多的那一个""第一名"时才填 1；' +
          '比较/排名类提问请填 10 或留空，以便展示对比。',
      },
      ...flightFilters(),
    }),
  };

  constructor(private readonly dashboard: DashboardService) {
    super();
  }

  extractParams(query: string): Partial<DashboardBarParams> | null {
    const looksLikeChart =
      /条形图|柱状图|图表|对比|排名|趋势|统计|分布|最多的|最高/.test(query);
    if (!looksLikeChart) return null;

    const filters = extractFilters(query);
    if (!filters.dimension) {
      // Default to the dimension the question implies; date when talking about
      // a trend over time, carrier when a specific airline is mentioned.
      filters.dimension = /趋势|按月|月份|逐年|历年/.test(query) ? 'date' : 'carrier';
    }
    return filters;
  }

  @AuditedTool()
  async execute(
    params: DashboardBarParams,
    _ctx: ToolContext,
  ): Promise<ToolResult<BarChartPayload>> {
    const dto = buildFlightDto(params);
    const aggregate = await this.dashboard.bar(dto);

    let points = aggregate.data;
    const topN = Math.min(100, Math.max(1, Math.trunc(params.topN ?? 0) || 0));
    if (topN > 0 && aggregate.dimension !== 'date') {
      points = [...points].sort((a, b) => b.value - a.value).slice(0, topN);
    }

    const dimensionLabel = this.dashboard.dimensionLabel(aggregate.dimension);
    const metricLabel = this.dashboard.metricLabel(aggregate.metric);

    return toolSuccess(
      this.definition.name,
      'chart',
      {
        chartType: 'bar',
        dimension: aggregate.dimension,
        dimensionLabel,
        metric: aggregate.metric,
        metricLabel,
        points: points.map((point) => ({
          key: point.key,
          label: point.label,
          value: point.value,
        })),
      } satisfies BarChartPayload,
      {
        message:
          topN > 0 && points.length
            ? `已按${dimensionLabel}统计${metricLabel}，取前 ${points.length} 名：${points[0].label} 以 ${points[0].value.toLocaleString('zh-CN')} 领先`
            : `已按${dimensionLabel}统计${metricLabel}，共 ${points.length} 个分组`,
        meta: { topN: topN || null, filtered: aggregate.data.length },
      },
    );
  }
}
