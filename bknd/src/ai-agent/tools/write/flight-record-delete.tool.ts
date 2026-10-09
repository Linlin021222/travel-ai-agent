import { Injectable } from '@nestjs/common';
import { DeleteFlightRecordDto } from '../../../flight-delay/dto/flight-record-write.dto.js';
import { FlightDelayService } from '../../../flight-delay/flight-delay.service.js';
import { AuditedTool } from '../tool-audit.js';
import { schema } from '../tool-schema.js';
import { toolSuccess, type ToolContext, type ToolResult } from '../tool.types.js';
import { BaseWriteTool, type RollbackRecord, type WritePreviewInput, type WriteToolDefinition } from './base-write-tool.js';

export interface FlightRecordDeleteParams {
  id: number;
}

export interface FlightRecordDeleteResult {
  id: number;
  year: number;
  month: number;
  carrierCode: string;
  airportCode: string;
}

/** Deletes one flight-delay record. Irreversible — flagged in the preview. */
@Injectable()
export class FlightRecordDeleteTool extends BaseWriteTool<
  FlightRecordDeleteParams,
  FlightRecordDeleteResult
> {
  readonly dto = DeleteFlightRecordDto;

  readonly definition: WriteToolDefinition = {
    name: 'flight-record.delete',
    description: '删除一条航班延误记录（需管理员，不可恢复）。执行前返回预览，确认后写入。',
    intent: 'WRITE_DATA',
    write: true,
    action: 'delete',
    entityKeywords: ['航班记录', '航班数据', '记录', '机场', '航司'],
    adminOnly: true,
    permission: 'flight:write',
    resultType: 'preview',
    destructive: true,
    keywords: ['删除航班记录', '移除航班记录', '删掉航班数据'],
    strongKeywords: ['删除航班记录', '移除航班记录'],
    autoExecute: false,
    parameters: schema({
      id: { type: 'integer', description: '要删除的记录 ID。' },
    }, ['id']),
  };

  constructor(private readonly flights: FlightDelayService) {
    super();
  }

  extractParams(query: string): Partial<FlightRecordDeleteParams> | null {
    if (!/删除航班记录|移除航班记录|删掉航班数据/.test(query)) return null;
    const id = /(?:记录|id)\s*[:：]?\s*(\d{1,10})/i.exec(query);
    return id ? { id: Number(id[1]) } : {};
  }

  async validate(params: FlightRecordDeleteParams, _ctx: ToolContext): Promise<string | null> {
    if (params?.id === undefined || params?.id === null) return '缺少记录 ID';
    const current = await this.flights.findRecordById(Number(params.id));
    if (!current) return '航班记录不存在，无法删除';
    return null;
  }

  async getPreview(
    params: FlightRecordDeleteParams,
    _ctx: ToolContext,
  ): Promise<WritePreviewInput> {
    const current = await this.flights.findRecordById(Number(params.id));
    return {
      targetLabel: current
        ? `${current.year}-${String(current.month).padStart(2, '0')} ${current.carrier_code} ${current.airport_code}`
        : `记录 ${params.id}`,
      affectedCount: current ? 1 : 0,
      changes: current
        ? [
            { field: 'carrier_code', label: '航司', from: current.carrier_code, to: null },
            { field: 'airport_code', label: '机场', from: current.airport_code, to: null },
            { field: 'arr_flights', label: '抵达航班数', from: current.arr_flights, to: null },
          ]
        : [],
      warnings: ['删除后该记录不再参与任何统计与图表'],
    };
  }

  @AuditedTool()
  async execute(
    params: FlightRecordDeleteParams,
    _ctx: ToolContext,
  ): Promise<ToolResult<FlightRecordDeleteResult>> {
    const removed = await this.flights.removeRecord(Number(params.id));
    return toolSuccess(
      this.definition.name,
      'text',
      {
        id: Number(params.id),
        year: removed.year,
        month: removed.month,
        carrierCode: removed.carrier_code,
        airportCode: removed.airport_code,
      } satisfies FlightRecordDeleteResult,
      {
        message: `已删除记录 ${params.id}（${removed.year}-${String(removed.month).padStart(2, '0')} ${removed.carrier_code} ${removed.airport_code}）`,
        meta: { action: 'delete', rollbackAvailable: false },
      },
    );
  }

  async rollback(_record: RollbackRecord, _ctx: ToolContext): Promise<ToolResult<unknown>> {
    return toolSuccess(this.definition.name, 'text', null, {
      message: '删除操作不可回滚（预留接口，第二周接入软删除后可恢复）',
    });
  }
}
