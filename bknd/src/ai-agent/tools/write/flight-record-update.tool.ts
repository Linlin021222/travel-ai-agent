import { Injectable } from '@nestjs/common';
import { UpdateFlightRecordDto } from '../../../flight-delay/dto/flight-record-write.dto.js';
import { NUMERIC_FIELDS } from '../../../flight-delay/flight-delay.fields.js';
import { FlightDelayService } from '../../../flight-delay/flight-delay.service.js';
import { AuditedTool } from '../tool-audit.js';
import { schema } from '../tool-schema.js';
import { toolSuccess, type ToolContext, type ToolResult } from '../tool.types.js';
import { BaseWriteTool, type RollbackRecord, type WritePreviewInput, type WriteToolDefinition } from './base-write-tool.js';

export interface FlightRecordUpdateParams {
  id: number;
  year?: number;
  month?: number;
  carrierCode?: string;
  carrierName?: string;
  airportCode?: string;
  airportName?: string;
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
 * Updates one flight-delay record.
 *
 * The preview is a real diff: current values are read through the service, so
 * the user confirms against what is actually in the table.
 */
@Injectable()
export class FlightRecordUpdateTool extends BaseWriteTool<
  FlightRecordUpdateParams,
  FlightRecordResult
> {
  readonly dto = UpdateFlightRecordDto;

  readonly definition: WriteToolDefinition = {
    name: 'flight-record.update',
    description:
      '修改一条航班延误记录（需管理员）。可按记录 ID 修改年月、航司、机场或 15 个数值指标。' +
      '执行前返回新旧值对比，确认后写入。',
    intent: 'WRITE_DATA',
    write: true,
    action: 'update',
    entityKeywords: ['航班记录', '航班数据', '记录', '机场', '航司'],
    adminOnly: true,
    permission: 'flight:write',
    resultType: 'preview',
    keywords: ['修改航班记录', '更新航班记录', '调整航班数据', '修改航班数据'],
    strongKeywords: ['修改航班记录', '更新航班记录', '调整航班数据'],
    autoExecute: false,
    parameters: schema({
      id: { type: 'integer', description: '记录 ID。' },
      year: { type: 'integer', minimum: 1990, maximum: 2100 },
      month: { type: 'integer', minimum: 1, maximum: 12 },
      carrierCode: { type: 'string' },
      carrierName: { type: 'string' },
      airportCode: { type: 'string' },
      airportName: { type: 'string' },
      metrics: {
        type: 'object',
        description: `15 个数值指标（${NUMERIC_FIELDS.join(', ')}）。`,
      },
    }, ['id']),
  };

  constructor(private readonly flights: FlightDelayService) {
    super();
  }

  extractParams(query: string): Partial<FlightRecordUpdateParams> | null {
    if (!/修改航班记录|更新航班记录|调整航班数据|修改航班数据/.test(query)) return null;
    const id = /(?:记录|id)\s*[:：]?\s*(\d{1,10})/i.exec(query);
    return id ? { id: Number(id[1]) } : {};
  }

  async validate(params: FlightRecordUpdateParams, _ctx: ToolContext): Promise<string | null> {
    if (params?.id === undefined || params?.id === null) return '缺少记录 ID';

    const current = await this.flights.findRecordById(Number(params.id));
    if (!current) return '航班记录不存在，无法修改';

    const nextYear = params.year ?? current.year;
    const nextMonth = params.month ?? current.month;
    const nextCarrier = (params.carrierCode ?? current.carrier_code).toUpperCase();
    const nextAirport = (params.airportCode ?? current.airport_code).toUpperCase();

    const keyChanged =
      nextYear !== current.year ||
      nextMonth !== current.month ||
      nextCarrier !== current.carrier_code ||
      nextAirport !== current.airport_code;

    if (keyChanged) {
      const clash = await this.flights.existsByGrain({
        year: Number(nextYear),
        month: Number(nextMonth),
        carrierCode: nextCarrier,
        airportCode: nextAirport,
        excludeId: Number(params.id),
      });
      if (clash) {
        return `已存在相同的年-月-航司-机场记录：${nextYear}-${String(nextMonth).padStart(2, '0')} ${nextCarrier} ${nextAirport}`;
      }
    }
    return null;
  }

  async getPreview(
    params: FlightRecordUpdateParams,
    _ctx: ToolContext,
  ): Promise<WritePreviewInput> {
    const current = await this.flights.findRecordById(Number(params.id));
    if (!current) {
      return {
        targetLabel: `记录 ${params.id}`,
        affectedCount: 0,
        changes: [],
        warnings: ['记录不存在'],
      };
    }

    const changes: WritePreviewInput['changes'] = [];
    const push = (field: string, label: string, from: unknown, to: unknown) => {
      if (to === undefined || to === from) return;
      changes.push({ field, label, from, to });
    };
    push('year', '年份', current.year, params.year);
    push('month', '月份', current.month, params.month);
    push('carrierCode', '航司代码', current.carrier_code, params.carrierCode);
    push('airportCode', '机场代码', current.airport_code, params.airportCode);

    for (const [field, value] of Object.entries(params.metrics ?? {})) {
      const before = (current as unknown as Record<string, number>)[field];
      if (before === undefined) continue;
      push(field, field, before, value);
    }

    return {
      targetLabel: `${current.year}-${String(current.month).padStart(2, '0')} ${current.carrier_code} ${current.airport_code}`,
      affectedCount: 1,
      changes,
      warnings: changes.length ? [] : ['没有检测到字段变化'],
    };
  }

  @AuditedTool()
  async execute(
    params: FlightRecordUpdateParams,
    _ctx: ToolContext,
  ): Promise<ToolResult<FlightRecordResult>> {
    const updated = await this.flights.updateRecord(Number(params.id), {
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
        id: (updated as { id?: number }).id ?? Number(params.id),
        year: updated.year,
        month: updated.month,
        carrierCode: updated.carrier_code,
        airportCode: updated.airport_code,
        arrFlights: updated.arr_flights,
      } satisfies FlightRecordResult,
      {
        message: `已更新记录 ${params.id}（${updated.year}-${String(updated.month).padStart(2, '0')} ${updated.carrier_code} ${updated.airport_code}）`,
        meta: { action: 'update', rollbackAvailable: true },
      },
    );
  }

  async rollback(record: RollbackRecord, _ctx: ToolContext): Promise<ToolResult<unknown>> {
    const id = record.snapshot.id as number | undefined;
    const before = record.snapshot.before as Record<string, unknown> | undefined;
    if (!id || !before) {
      return toolSuccess(this.definition.name, 'text', null, {
        message: '回滚快照不完整，无法撤销',
      });
    }
    await this.flights.updateRecord(id, before as never);
    return toolSuccess(this.definition.name, 'text', { id }, {
      message: `已撤销修改，记录 ${id} 已恢复原值`,
    });
  }
}
