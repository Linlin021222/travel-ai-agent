import { Injectable } from '@nestjs/common';
import { UpdateUserDto } from '../../../users/dto/user-write.dto.js';
import { UsersService } from '../../../users/users.service.js';
import { AuditedTool } from '../tool-audit.js';
import { schema } from '../tool-schema.js';
import { maskEmail, toolSuccess, type ToolContext, type ToolResult } from '../tool.types.js';
import { BaseWriteTool, type RollbackRecord, type WritePreviewInput, type WriteToolDefinition } from './base-write-tool.js';

export interface UserUpdateParams {
  id: string;
  email?: string;
  fullName?: string | null;
  title?: string | null;
  role?: string;
  status?: string;
}

export interface UserWriteResult {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: string;
}

/**
 * Updates an existing user.
 *
 * The "current value → new value" diff shown in the preview is read through
 * `UsersService`, so the user confirms against real data rather than against
 * whatever the model hallucinated.
 */
@Injectable()
export class UserUpdateTool extends BaseWriteTool<UserUpdateParams, UserWriteResult> {
  readonly dto = UpdateUserDto;

  readonly definition: WriteToolDefinition = {
    name: 'user.update',
    description:
      '修改已有用户的信息（需管理员）：邮箱、姓名、职位、角色、状态。' +
      '执行前返回新旧值对比预览，确认后写入。',
    intent: 'WRITE_DATA',
    write: true,
    action: 'update',
    entityKeywords: ['用户', '成员', '账号', '人员'],
    adminOnly: true,
    permission: 'user:manage',
    resultType: 'preview',
    keywords: ['修改用户', '更新用户', '改角色', '停用用户', '调整用户', '变更用户'],
    strongKeywords: ['修改用户', '更新用户', '停用用户', '变更用户'],
    autoExecute: false,
    parameters: schema({
      id: { type: 'string', description: '要修改的用户 ID。' },
      email: { type: 'string', description: '新邮箱，必须唯一。' },
      fullName: { type: 'string', description: '新姓名。' },
      title: { type: 'string', description: '新职位。' },
      role: { type: 'string', enum: ['user', 'admin'] },
      status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
    }, ['id']),
  };

  constructor(private readonly users: UsersService) {
    super();
  }

  extractParams(query: string): Partial<UserUpdateParams> | null {
    if (!/修改用户|更新用户|停用用户|变更用户|调整用户|改角色|改状态/.test(query)) return null;
    const params: Partial<UserUpdateParams> = {};
    if (/停用|禁用|离职|inactive/i.test(query)) params.status = 'inactive';
    if (/启用|恢复|激活|active/i.test(query)) params.status = 'active';
    if (/管理员|admin/i.test(query)) params.role = 'admin';
    const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(query);
    if (email) params.email = email[0];
    return params;
  }

  async validate(params: UserUpdateParams, ctx: ToolContext): Promise<string | null> {
    if (!params?.id) return '缺少要修改的用户 ID';

    const current = await this.users.findById(params.id);
    if (!current) return '用户不存在，无法修改';

    if (params.email) {
      const next = params.email.trim().toLowerCase();
      if (next !== current.email) {
        const clash = await this.users.findByEmail(next);
        if (clash) return `邮箱 ${maskEmail(next)} 已被其他用户使用`;
      }
    }

    // Self-protection mirrors the service rules so the preview fails early.
    if (ctx.user.userId === params.id) {
      if (params.role && params.role !== current.role) return '不能修改自己的角色';
      if (params.status && params.status !== 'active') return '不能停用当前登录的账号';
    }

    if (
      current.role === 'admin' &&
      ((params.role && params.role !== 'admin') ||
        (params.status && params.status !== 'active')) &&
      (await this.users.isLastAdmin(params.id))
    ) {
      return '系统必须保留至少一位启用状态的管理员';
    }

    return null;
  }

  async getPreview(params: UserUpdateParams, _ctx: ToolContext): Promise<WritePreviewInput> {
    const current = await this.users.findById(params.id);
    const before = {
      email: current?.email ?? null,
      fullName: current?.full_name ?? null,
      title: current?.title ?? null,
      role: current?.role ?? null,
      status: current?.status ?? null,
    };

    const changes: WritePreviewInput['changes'] = [];
    const push = (field: string, label: string, from: unknown, to: unknown) => {
      if (to === undefined || to === from) return;
      changes.push({ field, label, from, to });
    };
    push('email', '邮箱', before.email, params.email);
    push('fullName', '姓名', before.fullName, params.fullName ?? undefined);
    push('title', '职位', before.title, params.title ?? undefined);
    push('role', '角色', before.role, params.role);
    push('status', '状态', before.status, params.status);

    return {
      targetLabel: `用户 ${current?.email ?? params.id}`,
      affectedCount: 1,
      changes,
      warnings: changes.length ? [] : ['没有检测到字段变化'],
    };
  }

  @AuditedTool()
  async execute(
    params: UserUpdateParams,
    ctx: ToolContext,
  ): Promise<ToolResult<UserWriteResult>> {
    const updated = await this.users.updateManaged(
      params.id,
      {
        email: params.email,
        fullName: params.fullName ?? undefined,
        title: params.title ?? undefined,
        role: params.role,
        status: params.status,
      },
      ctx.user.userId,
    );

    return toolSuccess(
      this.definition.name,
      'text',
      {
        id: updated.id,
        email: updated.email,
        fullName: updated.fullName,
        role: updated.role,
        status: updated.status,
      } satisfies UserWriteResult,
      {
        message: `已更新用户 ${updated.email}`,
        meta: { action: 'update', rollbackAvailable: true },
      },
    );
  }

  async rollback(record: RollbackRecord, ctx: ToolContext): Promise<ToolResult<unknown>> {
    const before = record.snapshot.before as Record<string, unknown> | undefined;
    const id = record.snapshot.id as string | undefined;
    if (!id || !before) {
      return toolSuccess(this.definition.name, 'text', null, {
        message: '回滚快照不完整，无法撤销',
      });
    }
    await this.users.updateManaged(
      id,
      {
        email: before.email as string | undefined,
        fullName: (before.fullName as string | null) ?? undefined,
        title: (before.title as string | null) ?? undefined,
        role: before.role as string | undefined,
        status: before.status as string | undefined,
      },
      ctx.user.userId,
    );
    return toolSuccess(this.definition.name, 'text', { id }, {
      message: `已撤销修改，用户 ${id} 已恢复原值`,
    });
  }
}
