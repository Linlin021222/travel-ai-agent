import { Injectable } from '@nestjs/common';
import { CreateUserDto } from '../../../users/dto/user-write.dto.js';
import { UsersService } from '../../../users/users.service.js';
import { AuditedTool } from '../tool-audit.js';
import { schema } from '../tool-schema.js';
import { maskEmail, toolSuccess, type ToolContext, type ToolResult } from '../tool.types.js';
import { BaseWriteTool, type WriteToolDefinition } from './base-write-tool.js';
import type { RollbackRecord, WritePreviewInput } from './base-write-tool.js';

export interface UserCreateParams {
  email: string;
  password: string;
  fullName?: string;
  title?: string;
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
 * Creates a business user.
 *
 * Injects `UsersService` only — no Repository, no SQL. Registered as a write
 * tool with `autoExecute: false`, so a call without a confirmation token can
 * only ever produce a preview.
 */
@Injectable()
export class UserCreateTool extends BaseWriteTool<UserCreateParams, UserWriteResult> {
  readonly dto = CreateUserDto;

  readonly definition: WriteToolDefinition = {
    name: 'user.create',
    description:
      '创建新用户账号（需管理员）。当用户说"新建一个用户""添加成员""注册一个账号"时使用。' +
      '执行前会先返回变更预览，用户确认后才会真正写入。',
    intent: 'WRITE_DATA',
    write: true,
    action: 'create',
    entityKeywords: ['用户', '成员', '账号', '人员'],
    adminOnly: true,
    permission: 'user:manage',
    resultType: 'preview',
    keywords: ['新建用户', '创建用户', '添加用户', '新增成员', '注册账号', '开通账号'],
    strongKeywords: ['新建用户', '创建用户', '添加用户', '新增成员', '开通账号'],
    autoExecute: false,
    parameters: schema({
      email: { type: 'string', description: '用户邮箱，必须唯一。' },
      password: { type: 'string', description: '初始密码，至少 8 位。' },
      fullName: { type: 'string', description: '姓名。' },
      title: { type: 'string', description: '职位。' },
      role: { type: 'string', enum: ['user', 'admin'], description: '角色，默认 user。' },
      status: { type: 'string', enum: ['active', 'inactive', 'suspended'], description: '状态，默认 active。' },
    }, ['email', 'password']),
  };

  constructor(private readonly users: UsersService) {
    super();
  }

  extractParams(query: string): Partial<UserCreateParams> | null {
    if (!/新建用户|创建用户|添加用户|新增成员|开通账号|注册账号/.test(query)) return null;
    const params: Partial<UserCreateParams> = {};
    const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(query);
    if (email) params.email = email[0];
    if (/管理员|admin/i.test(query)) params.role = 'admin';
    return params;
  }

  /**
   * Business rules live in the service: e-mail uniqueness (409), role/status
   * legality (400) and password length (400). Calling the service here means
   * the assistant reports exactly what the REST API would.
   */
  async validate(params: UserCreateParams, _ctx: ToolContext): Promise<string | null> {
    if (!params?.email) return '缺少邮箱';
    if (!params?.password) return '缺少初始密码';

    const existing = await this.users.findByEmail(params.email.trim().toLowerCase());
    if (existing) return `邮箱 ${maskEmail(params.email)} 已注册，不能重复创建`;
    return null;
  }

  async getPreview(params: UserCreateParams, _ctx: ToolContext): Promise<WritePreviewInput> {
    return {
      targetLabel: `用户 ${params.email}`,
      affectedCount: 1,
      changes: [
        { field: 'email', label: '邮箱', from: null, to: params.email },
        { field: 'fullName', label: '姓名', from: null, to: params.fullName ?? '-' },
        { field: 'role', label: '角色', from: null, to: params.role ?? 'user' },
        { field: 'status', label: '状态', from: null, to: params.status ?? 'active' },
      ],
      warnings: ['将创建一条新的用户记录，初始密码由本次请求设定'],
    };
  }

  @AuditedTool()
  async execute(
    params: UserCreateParams,
    _ctx: ToolContext,
  ): Promise<ToolResult<UserWriteResult>> {
    const created = await this.users.createManaged({
      email: params.email,
      password: params.password,
      fullName: params.fullName ?? null,
      title: params.title ?? null,
      role: params.role ?? 'user',
      status: params.status ?? 'active',
    });

    return toolSuccess(
      this.definition.name,
      'text',
      {
        id: created.id,
        email: created.email,
        fullName: created.fullName,
        role: created.role,
        status: created.status,
      } satisfies UserWriteResult,
      {
        message: `已创建用户 ${created.email}（${created.fullName || '未填写姓名'}），ID ${created.id}`,
        meta: { action: 'create', rollbackAvailable: true },
      },
    );
  }

  async rollback(record: RollbackRecord, ctx: ToolContext): Promise<ToolResult<unknown>> {
    // Reserved: the snapshot holds everything needed to delete the row back.
    const id = record.snapshot.id as string | undefined;
    if (!id) {
      return toolSuccess(this.definition.name, 'text', null, {
        message: '回滚快照缺少用户 ID，无法撤销',
      });
    }
    await this.users.removeManaged(id, ctx.user.userId);
    return toolSuccess(this.definition.name, 'text', { id }, {
      message: `已撤销新增，用户 ${id} 已删除`,
    });
  }
}
