import { Injectable } from '@nestjs/common';
import { DashboardService } from '../../dashboard/dashboard.service.js';
import { BaseTool, type ToolDefinition } from './base-tool.js';
import { AuditedTool } from './tool-audit.js';
import { flightFilters, schema } from './tool-schema.js';
import { extractFilters } from './param-extractor.js';
import { describeCodes } from './entity-dictionary.js';
import { buildFlightDto } from './query-dto.js';
import {
  toolSuccess,
  type BubbleChartPayload,
  type BubbleNode,
  type ToolContext,
  type ToolResult,
} from './tool.types.js';

export interface DashboardBubbleParams {
  metric?: string;
  carriers?: string[];
  airports?: string[];
  years?: number[];
  months?: number[];
  dateFrom?: number;
  dateTo?: number;
  ranges?: Record<string, { min?: number; max?: number }>;
  /** 1 = airlines only, 2 = airlines + their airports (default). */
  maxLevel?: number;
  topN?: number;
}

/**
 * Hierarchical bubble data.
 *
 * `DashboardService.bubble` already returns carrier × airport aggregates; this
 * tool only shapes them into the nested node tree the existing D3 renderer
 * expects (level 1 = airline, level 2 = airport), keeping the zoom/drill-down
 * structure intact.
 */
@Injectable()
export class DashboardBubbleTool extends BaseTool<DashboardBubbleParams, BubbleChartPayload> {
  readonly definition: ToolDefinition = {
    name: 'dashboard.bubble',
    description: '航司层级气泡图：航司→机场两层结构，支持缩放下钻',
    intent: 'STATISTICS_ANALYSIS',
    resultType: 'chart',
    keywords: ['气泡图', '气泡', '层级', '下钻', 'bubble', '分布图'],
    strongKeywords: ['气泡图', '气泡', '下钻'],
    permission: 'dashboard:read',
    parameters: schema({
      metric: {
        type: 'string',
        enum: ['arr_flights', 'arr_del15', 'arr_cancelled', 'arr_diverted', 'arr_delay'],
        description: '气泡大小所依据的指标。',
      },
      maxLevel: { type: 'integer', minimum: 1, maximum: 2, description: '展开层级，1 航司、2 含机场。' },
      topN: {
        type: 'integer',
        minimum: 1,
        description: '只返回数值最大的前 N 个航司节点；用户没有提排名数量时不要填，留空返回全部航司。',
      },
      ...flightFilters(),
    }),
  };

  constructor(private readonly dashboard: DashboardService) {
    super();
  }

  extractParams(query: string): Partial<DashboardBubbleParams> | null {
    if (!/气泡|层级|下钻|bubble/i.test(query)) return null;
    return extractFilters(query);
  }

  @AuditedTool()
  async execute(
    params: DashboardBubbleParams,
    _ctx: ToolContext,
  ): Promise<ToolResult<BubbleChartPayload>> {
    const dto = buildFlightDto(params);
    const { data } = await this.dashboard.bubble(dto);

    const metric = params.metric && isMetric(params.metric) ? params.metric : 'arr_flights';
    const maxLevel = params.maxLevel === 1 ? 1 : 2;
    // 0 / undefined = every carrier. `Math.max(1, …)` used to force a single
    // bubble even when the user asked for the whole airline hierarchy.
    const requestedTopN = Math.trunc(params.topN ?? 0);
    const topN = requestedTopN > 0 ? Math.min(60, requestedTopN) : 0;

    const grouped = new Map<string, { name: string; children: BubbleNode[]; total: number }>();

    for (const row of data) {
      const value = Number((row as unknown as Record<string, number>)[metric] ?? 0);
      const carrierCode = String(row.carrier_code);
      const entry =
        grouped.get(carrierCode) ??
        { name: String(row.carrier_name ?? carrierCode), children: [], total: 0 };
      entry.total += value;

      if (maxLevel >= 2) {
        entry.children.push({
          id: `L2:${carrierCode}:${row.airport_code}`,
          name: String(row.airport_name ?? row.airport_code),
          level: 2,
          value,
          metrics: {
            arr_flights: Number(row.arr_flights),
            arr_del15: Number(row.arr_del15),
            arr_cancelled: Number(row.arr_cancelled),
            arr_diverted: Number(row.arr_diverted),
            arr_delay: Number(row.arr_delay),
          },
        });
      }

      grouped.set(carrierCode, entry);
    }

    let nodes: BubbleNode[] = [...grouped.entries()].map(([code, entry]) => ({
      id: `L1:${code}`,
      name: entry.name,
      level: 1,
      value: entry.total,
      children: entry.children.sort((a, b) => b.value - a.value),
    }));

    nodes.sort((a, b) => b.value - a.value);
    if (topN > 0) nodes = nodes.slice(0, topN);

    const metricLabel = this.dashboard.metricLabel(metric);
    const filters: Record<string, unknown> = {};
    if (params.carriers?.length) filters.carriers = params.carriers;
    if (params.airports?.length) filters.airports = params.airports;
    if (params.years?.length) filters.years = params.years;
    if (params.months?.length) filters.months = params.months;
    if (params.dateFrom) filters.dateFrom = params.dateFrom;
    if (params.dateTo) filters.dateTo = params.dateTo;
    if (params.ranges && Object.keys(params.ranges).length) filters.ranges = params.ranges;

    const carrierLabel = params.carriers?.length ? `${describeCodes('carriers', params.carriers)} ` : '';

    return toolSuccess(this.definition.name, 'chart', { chartType: 'bubble', metric, metricLabel, nodes }, {
      message: `气泡图已生成：${carrierLabel}${nodes.length} 家航司${maxLevel >= 2 ? '，可下钻查看机场层级' : ''}（指标：${metricLabel}）`,
      meta: {
        maxLevel,
        topN: topN || null,
        airportNodes: nodes.reduce((sum, node) => sum + (node.children?.length ?? 0), 0),
        filters,
      },
    });
  }
}

function isMetric(value: string): boolean {
  return ['arr_flights', 'arr_del15', 'arr_cancelled', 'arr_diverted', 'arr_delay'].includes(value);
}
