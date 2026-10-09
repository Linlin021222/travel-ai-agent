import { Injectable } from '@nestjs/common';
import { DeleteUserDto } from '../../../users/dto/user-write.dto.js';
import { UsersService } from '../../../users/users.service.js';
import { AuditedTool } from '../tool-audit.js';
import { schema } from '../tool-schema.js';
import { maskEmail, toolSuccess, type ToolContext, type ToolResult } from '../tool.types.js';
import { BaseWriteTool, type RollbackRecord, type WritePreviewInput, type WriteToolDefinition } from './base-write-tool.js';

export interface UserDeleteParams {
  id: string;
}

export interface UserDeleteResult {
  id: string;
  email: string;
  fullName: string;
}

/** Deletes one user. Irreversible — the preview says so explicitly. */
@Injectable()
export class UserDeleteTool extends BaseWriteTool<UserDeleteParams, UserDeleteResult> {
  readonly dto = DeleteUserDto;

  readonly definition: WriteToolDefinition = {
    name: 'user.delete',
    description:
      '删除单个用户（需管理员，不可恢复）。执行前返回被删对象的预览，确认后写入。',
    intent: 'WRITE_DATA',
    write: true,
    action: 'delete',
    entityKeywords: ['用户', '成员', '账号', '人员'],
    adminOnly: true,
    permission: 'user:manage',
    resultType: 'preview',
    destructive: true,
    keywords: ['删除用户', '移除用户', '注销用户', '删掉用户'],
    strongKeywords: ['删除用户', '移除用户', '注销用户'],
    autoExecute: false,
    parameters: schema({
      id: { type: 'string', description: '要删除的用户 ID。' },
    }, ['id']),
  };

  constructor(private readonly users: UsersService) {
    super();
  }

  extractParams(query: string): Partial<UserDeleteParams> | null {
    if (!/删除用户|移除用户|注销用户|删掉用户/.test(query)) return null;
    return {};
  }

  async validate(params: UserDeleteParams, ctx: ToolContext): Promise<string | null> {
    if (!params?.id) return '缺少要删除的用户 ID';

    const current = await this.users.findById(params.id);
    if (!current) return '用户不存在，无法删除';
    if (ctx.user.userId === params.id) return '不能删除当前登录的账号';
    if (current.role === 'admin' && (await this.users.isLastAdmin(params.id))) {
      return '系统必须保留至少一位启用状态的管理员';
    }
    return null;
  }

  async getPreview(params: UserDeleteParams, _ctx: ToolContext): Promise<WritePreviewInput> {
    const current = await this.users.findById(params.id);
    return {
      targetLabel: `用户 ${current?.email ?? params.id}`,
      affectedCount: 1,
      changes: [
        { field: 'email', label: '邮箱', from: current?.email ?? '-', to: null },
        { field: 'fullName', label: '姓名', from: current?.full_name ?? '-', to: null },
        { field: 'role', label: '角色', from: current?.role ?? '-', to: null },
      ],
      warnings: ['删除后该用户的所有会话与记忆记录将不再可访问'],
    };
  }

  @AuditedTool()
  async execute(
    params: UserDeleteParams,
    ctx: ToolContext,
  ): Promise<ToolResult<UserDeleteResult>> {
    const removed = await this.users.removeManaged(params.id, ctx.user.userId);
    return toolSuccess(
      this.definition.name,
      'text',
      { id: removed.id, email: maskEmail(removed.email), fullName: removed.fullName },
      {
        message: `已删除用户 ${removed.email}`,
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
