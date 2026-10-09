import { Injectable } from '@nestjs/common';
import { BatchDeleteUsersDto } from '../../../users/dto/user-write.dto.js';
import { MAX_BATCH_DELETE, UsersService } from '../../../users/users.service.js';
import { AuditedTool } from '../tool-audit.js';
import { schema } from '../tool-schema.js';
import { maskEmail, toolSuccess, type ToolContext, type ToolResult } from '../tool.types.js';
import { BaseWriteTool, type RollbackRecord, type WritePreviewInput, type WriteToolDefinition } from './base-write-tool.js';

export interface UserBatchDeleteParams {
  ids: string[];
}

export interface BatchDeleteResult {
  deleted: Array<{ id: string; email: string }>;
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Deletes several users at once.
 *
 * Batch size is capped ({@link MAX_BATCH_DELETE}) and every id is validated
 * individually, so one bad id is reported as "skipped" instead of silently
 * deleting the rest.
 */
@Injectable()
export class UserBatchDeleteTool extends BaseWriteTool<UserBatchDeleteParams, BatchDeleteResult> {
  readonly dto = BatchDeleteUsersDto;

  readonly definition: WriteToolDefinition = {
    name: 'user.batchDelete',
    description:
      `批量删除用户（需管理员，单次最多 ${MAX_BATCH_DELETE} 个，不可恢复）。` +
      '执行前列出将被删除与将被跳过的用户，确认后写入。',
    intent: 'WRITE_DATA',
    write: true,
    action: 'batchDelete',
    entityKeywords: ['用户', '成员', '账号', '人员'],
    adminOnly: true,
    permission: 'user:manage',
    resultType: 'preview',
    destructive: true,
    keywords: ['批量删除用户', '批量移除用户', '批量注销', '删除多个用户'],
    strongKeywords: ['批量删除用户', '批量移除用户', '批量注销'],
    autoExecute: false,
    parameters: schema({
      ids: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: MAX_BATCH_DELETE,
        description: '要删除的用户 ID 列表。',
      },
    }, ['ids']),
  };

  constructor(private readonly users: UsersService) {
    super();
  }

  extractParams(query: string): Partial<UserBatchDeleteParams> | null {
    if (!/批量删除用户|批量移除用户|批量注销|删除多个用户/.test(query)) return null;
    return {};
  }

  async validate(params: UserBatchDeleteParams, ctx: ToolContext): Promise<string | null> {
    const ids = (params?.ids ?? []).map((id) => String(id).trim()).filter(Boolean);
    if (!ids.length) return '请提供要删除的用户 ID 列表';
    if (ids.length > MAX_BATCH_DELETE) {
      return `单次最多删除 ${MAX_BATCH_DELETE} 个用户，当前 ${ids.length} 个`;
    }
    if (ids.includes(ctx.user.userId)) return '不能删除当前登录的账号';

    // Refuse the whole batch when it would empty the admin pool.
    let adminsAtRisk = 0;
    for (const id of ids) {
      const row = await this.users.findById(id);
      if (row?.role === 'admin' && (await this.users.isLastAdmin(id))) adminsAtRisk += 1;
    }
    if (adminsAtRisk > 0) {
      return '系统必须保留至少一位启用状态的管理员';
    }
    return null;
  }

  async getPreview(params: UserBatchDeleteParams, ctx: ToolContext): Promise<WritePreviewInput> {
    const ids = [...new Set(params.ids.map((id) => String(id).trim()).filter(Boolean))];
    const targets: Array<{ id: string; label: string }> = [];
    const skipped: string[] = [];

    for (const id of ids) {
      const row = await this.users.findById(id);
      if (!row) {
        skipped.push(`${id}（不存在）`);
        continue;
      }
      if (row.role === 'admin') {
        skipped.push(`${maskEmail(row.email)}（管理员，受保护）`);
        continue;
      }
      targets.push({ id, label: `${maskEmail(row.email)}${row.full_name ? ` / ${row.full_name}` : ''}` });
    }

    return {
      targetLabel: `${targets.length} 个用户`,
      affectedCount: targets.length,
      changes: targets.map((target) => ({
        field: target.id,
        label: target.label,
        from: 'active',
        to: null,
      })),
      warnings: skipped.length ? [`将被跳过：${skipped.join('、')}`] : [],
    };
  }

  @AuditedTool()
  async execute(
    params: UserBatchDeleteParams,
    ctx: ToolContext,
  ): Promise<ToolResult<BatchDeleteResult>> {
    const ids = [...new Set(params.ids.map((id) => String(id).trim()).filter(Boolean))];
    const result = await this.users.removeManyManaged(ids, ctx.user.userId);

    return toolSuccess(
      this.definition.name,
      'text',
      {
        deleted: result.deleted.map((row) => ({ id: row.id, email: maskEmail(row.email) })),
        skipped: result.skipped,
      } satisfies BatchDeleteResult,
      {
        message:
          `已删除 ${result.deleted.length} 个用户` +
          (result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''),
        meta: { action: 'batchDelete', rollbackAvailable: false },
      },
    );
  }

  async rollback(_record: RollbackRecord, _ctx: ToolContext): Promise<ToolResult<unknown>> {
    return toolSuccess(this.definition.name, 'text', null, {
      message: '批量删除不可回滚（预留接口）',
    });
  }
}
