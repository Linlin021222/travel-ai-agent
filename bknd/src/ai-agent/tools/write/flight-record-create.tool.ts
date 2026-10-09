import { Injectable } from '@nestjs/common';
import { CreateFlightRecordDto } from '../../../flight-delay/dto/flight-record-write.dto.js';
import { NUMERIC_FIELDS } from '../../../flight-delay/flight-delay.fields.js';
import { FlightDelayService } from '../../../flight-delay/flight-delay.service.js';
import { AuditedTool } from '../tool-audit.js';
import { schema } from '../tool-schema.js';
import { toolSuccess, type ToolContext, type ToolResult } from '../tool.types.js';
import { BaseWriteTool, type RollbackRecord, type WritePreviewInput, type WriteToolDefinition } from './base-write-tool.js';

export interface FlightRecordCreateParams {
  year: number;
  month: number;
  carrierCode: string;
  carrierName: string;
  airportCode: string;
  airportName: string;
  metrics?: Record<string, number>;
}

export interface FlightRecordResult {
  id: number | null;
  year: number;
  month: number;
  carrierCode: string;
  airportCode: string;
  arrFlights: number;
}

/**
 * Creates one flight-delay record.
 *
 * Injects `FlightDelayService`; the natural key (year, month, carrier, airport)
 * is checked through the service so a duplicate is reported with the same
 * message the REST API returns.
 */
@Injectable()
export class FlightRecordCreateTool extends BaseWriteTool<
  FlightRecordCreateParams,
  FlightRecordResult
> {
  readonly dto = CreateFlightRecordDto;

  readonly definition: WriteToolDefinition = {
    name: 'flight-record.create',
    description:
      '新增一条航班延误记录（需管理员）。需要先提供年月、航司代码/名称、机场三字码/名称。' +
      '执行前返回预览，确认后写入。',
    intent: 'WRITE_DATA',
    write: true,
    action: 'create',
    entityKeywords: ['航班记录', '航班数据', '记录', '机场', '航司'],
    adminOnly: true,
    permission: 'flight:write',
    resultType: 'preview',
    keywords: ['新增航班记录', '添加航班记录', '新建航班记录', '录入航班数据'],
    strongKeywords: ['新增航班记录', '添加航班记录', '录入航班数据'],
    autoExecute: false,
    parameters: schema({
      year: { type: 'integer', minimum: 1990, maximum: 2100, description: '年份。' },
      month: { type: 'integer', minimum: 1, maximum: 12, description: '月份 1-12。' },
      carrierCode: { type: 'string', description: '航司代码，如 AA。' },
      carrierName: { type: 'string', description: '航司全称。' },
      airportCode: { type: 'string', description: '机场三字码，如 ATL。' },
      airportName: { type: 'string', description: '机场全称。' },
      metrics: {
        type: 'object',
        description: `15 个数值指标（${NUMERIC_FIELDS.join(', ')}），缺省为 0。`,
      },
    }, ['year', 'month', 'carrierCode', 'carrierName', 'airportCode', 'airportName']),
  };

  constructor(private readonly flights: FlightDelayService) {
    super();
  }

  extractParams(query: string): Partial<FlightRecordCreateParams> | null {
    if (!/新增航班记录|添加航班记录|新建航班记录|录入航班数据/.test(query)) return null;
    const params: Partial<FlightRecordCreateParams> = {};
    const year = /(20\d{2})\s*年/.exec(query);
    if (year) params.year = Number(year[1]);
    const month = /(\d{1,2})\s*月/.exec(query);
    if (month) params.month = Number(month[1]);
    const code = /\b([A-Z]{2})\b/.exec(query);
    if (code) params.carrierCode = code[1];
    const airport = /\b([A-Z]{3})\b/.exec(query);
    if (airport) params.airportCode = airport[1];
    return params;
  }

  async validate(params: FlightRecordCreateParams, _ctx: ToolContext): Promise<string | null> {
    if (!params?.year || !params?.month) return '缺少年份或月份';
    if (!params?.carrierCode || !params?.airportCode) return '缺少航司代码或机场代码';
    if (!params?.carrierName || !params?.airportName) return '缺少航司名称或机场名称';

    const clash = await this.flights.existsByGrain({
      year: Number(params.year),
      month: Number(params.month),
      carrierCode: String(params.carrierCode).toUpperCase(),
      airportCode: String(params.airportCode).toUpperCase(),
    });
    if (clash) {
      return `该记录已存在：${params.year}-${String(params.month).padStart(2, '0')} ${params.carrierCode} ${params.airportCode}`;
    }
    return null;
  }

  async getPreview(
    params: FlightRecordCreateParams,
    _ctx: ToolContext,
  ): Promise<WritePreviewInput> {
    const metrics = params.metrics ?? {};
    return {
      targetLabel: `${params.year}-${String(params.month).padStart(2, '0')} ${params.carrierCode} ${params.airportCode}`,
      affectedCount: 1,
      changes: [
        { field: 'carrierName', label: '航司', from: null, to: params.carrierName },
        { field: 'airportName', label: '机场', from: null, to: params.airportName },
        { field: 'arr_flights', label: '抵达航班数', from: null, to: metrics.arr_flights ?? 0 },
        { field: 'arr_del15', label: '延误15分钟以上', from: null, to: metrics.arr_del15 ?? 0 },
      ],
      warnings: ['该表为聚合指标表，新增记录会影响所有统计与图表结果'],
    };
  }

  @AuditedTool()
  async execute(
    params: FlightRecordCreateParams,
    _ctx: ToolContext,
  ): Promise<ToolResult<FlightRecordResult>> {
    const created = await this.flights.createRecord({
      year: params.year,
      month: params.month,
      carrierCode: params.carrierCode,
      carrierName: params.carrierName,
      airportCode: params.airportCode,
      airportName: params.airportName,
      ...(params.metrics ?? {}),
    });

    return toolSuccess(
      this.definition.name,
      'text',
      {
        id: (created as { id?: number }).id ?? null,
        year: created.year,
        month: created.month,
        carrierCode: created.carrier_code,
        airportCode: created.airport_code,
        arrFlights: created.arr_flights,
      } satisfies FlightRecordResult,
      {
        message:
          `已新增记录 ${created.year}-${String(created.month).padStart(2, '0')} ` +
          `${created.carrier_code} ${created.airport_code}`,
        meta: { action: 'create', rollbackAvailable: true },
      },
    );
  }

  async rollback(record: RollbackRecord, _ctx: ToolContext): Promise<ToolResult<unknown>> {
    const id = record.snapshot.id as number | undefined;
    if (!id) {
      return toolSuccess(this.definition.name, 'text', null, {
        message: '回滚快照缺少记录 ID，无法撤销',
      });
    }
    await this.flights.removeRecord(id);
    return toolSuccess(this.definition.name, 'text', { id }, {
      message: `已撤销新增，记录 ${id} 已删除`,
    });
  }
}
