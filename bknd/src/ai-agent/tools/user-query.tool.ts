import { Injectable } from '@nestjs/common';
import { UsersService } from '../../users/users.service.js';
import { BaseTool, type ToolDefinition } from './base-tool.js';
import { AuditedTool } from './tool-audit.js';
import { schema } from './tool-schema.js';
import { extractKeyword, extractTopN } from './param-extractor.js';
import {
  maskEmail,
  toolSuccess,
  type TablePayload,
  type ToolContext,
  type ToolResult,
} from './tool.types.js';

export interface UserQueryParams {
  keyword?: string;
  roles?: string[];
  titles?: string[];
  statuses?: string[];
  page?: number;
  pageSize?: number;
  sortBy?: 'full_name' | 'email' | 'role' | 'status' | 'created_at';
  sortDir?: 'asc' | 'desc';
}

/** Exactly the fields the business `users` table exposes for directory views. */
const COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'fullName', label: '姓名' },
  { key: 'email', label: '邮箱' },
  { key: 'title', label: '职位' },
  { key: 'role', label: '角色' },
  { key: 'status', label: '状态' },
];

/**
 * Read-only directory lookup.
 *
 * Injects the existing `UsersService` — it never touches the `users` table or
 * a Repository. Visibility rule: administrators see raw e-mail addresses,
 * everyone else gets a masked value (`al***@example.com`).
 */
@Injectable()
export class UserQueryTool extends BaseTool<UserQueryParams, TablePayload> {
  readonly definition: ToolDefinition = {
    name: 'user.query',
    description:
      '查询系统用户目录，返回姓名/邮箱/职位/角色/状态。当用户问"有哪些人""都有哪些成员"' +
      '"注册了谁""同事列表""账号清单"时使用；非管理员查看时邮箱自动脱敏。',
    intent: 'QUERY_DATA',
    resultType: 'table',
    keywords: ['用户', '人员', '姓名', '角色', '成员', '账号', '同事', '有多少人'],
    strongKeywords: ['用户', '人员', '姓名', '成员'],
    permission: 'user:read',
    parameters: schema({
      keyword: {
        type: 'string',
        description: '姓名或邮箱关键词模糊搜索。',
      },
      roles: { type: 'array', items: { type: 'string' }, description: '角色多选，如 ["admin","user"]。' },
      titles: { type: 'array', items: { type: 'string' }, description: '职位多选。' },
      statuses: {
        type: 'array',
        items: { type: 'string' },
        description: '状态多选，如 ["active"]。',
      },
      page: { type: 'integer', minimum: 1, description: '页码，默认 1。' },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页条数，默认 20。' },
      sortBy: { type: 'string', enum: ['full_name', 'email', 'role', 'status', 'created_at'] },
      sortDir: { type: 'string', enum: ['asc', 'desc'] },
    }),
  };

  constructor(private readonly users: UsersService) {
    super();
  }

  extractParams(query: string): Partial<UserQueryParams> | null {
    if (!/用户|人员|姓名|角色|成员|账号|同事/.test(query)) return null;

    const params: Partial<UserQueryParams> = {};
    const keyword = extractKeyword(query);
    if (keyword) params.keyword = keyword;

    const topN = extractTopN(query);
    if (topN) params.pageSize = Math.min(topN, 100);

    if (/管理员|admin/i.test(query)) params.roles = ['admin'];
    if (/停用|禁用|离职|inactive/i.test(query)) params.statuses = ['inactive'];
    if (/启用|在职|active/i.test(query)) params.statuses = ['active'];

    return params;
  }

  @AuditedTool()
  async execute(params: UserQueryParams, ctx: ToolContext): Promise<ToolResult<TablePayload>> {
    const page = Math.max(1, Math.trunc(params.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.trunc(params.pageSize ?? 20) || 20));

    const result = await this.users.query({
      keyword: params.keyword,
      roles: params.roles,
      titles: params.titles,
      statuses: params.statuses,
      page,
      pageSize,
      sortBy: params.sortBy ?? 'created_at',
      sortDir: params.sortDir ?? 'desc',
    });

    const isAdmin = Boolean(ctx.user?.isAdmin);
    const rows = result.data.map((user) => ({
      fullName: user.fullName,
      email: isAdmin ? user.email : maskEmail(user.email),
      title: user.title ?? '-',
      role: user.role,
      status: user.status,
      createdAt: user.createdAt.slice(0, 10),
    }));

    return toolSuccess(this.definition.name, 'table', { columns: COLUMNS, rows } satisfies TablePayload, {
      message:
        result.total > 0
          ? `共找到 ${result.total} 位用户${isAdmin ? '' : '（邮箱已脱敏）'}`
          : '没有匹配的用户',
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
      meta: { masked: !isAdmin },
    });
  }
}
