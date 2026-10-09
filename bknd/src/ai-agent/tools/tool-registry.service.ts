import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { LlmToolSpec } from '../llm/llm.types.js';
import { AiOperationAuditService } from '../services/ai-operation-audit.service.js';
import { BaseTool, type ToolDefinition, type ToolPermission } from './base-tool.js';
import { ToolAuditSink, type ToolAuditEvent } from './tool-audit.js';
import {
  TOOL_ERR_CONFIRM_REQUIRED,
  TOOL_ERR_DISABLED,
  TOOL_ERR_FORBIDDEN,
  TOOL_ERR_INTERNAL,
  TOOL_ERR_NOT_FOUND,
  TOOL_ERR_VALIDATION,
  maskSensitive,
  toolFailure,
  toolSuccess,
  type ToolContext,
  type ToolIntent,
  type ToolResult,
  type WritePreviewPayload,
} from './tool.types.js';
import { BaseWriteTool, isWriteTool, type WriteToolDefinition } from './write/base-write-tool.js';
import { WriteGuardService } from './write/write-guard.service.js';

/** Read and write tools live behind one catalogue entry type. */
export type AnyTool = BaseTool<never, unknown> | BaseWriteTool<never, unknown>;

export interface ToolSummary {
  name: string;
  description: string;
  intent: ToolIntent;
  resultType: string;
  permission: ToolPermission;
  adminOnly: boolean;
  enabled: boolean;
  keywords: string[];
  /** Write tools only. */
  write?: boolean;
  action?: string;
  autoExecute?: boolean;
  destructive?: boolean;
}

export interface ToolMatch {
  name: string;
  score: number;
  params: Record<string, unknown>;
}

/** Weight of a `strongKeywords` hit — far above any plain keyword length. */
const STRONG_KEYWORD_WEIGHT = 10;

/**
 * Verbs that mean "change something".
 *
 * Without this, 「帮我新建一个用户」 is answered by `user.query`: the read tool
 * owns the strong keyword 用户 and wins on score, so the write tool would never
 * be reached. Any question carrying one of these verbs gives write tools a
 * decisive bonus — and blocks the strong-keyword shortcut from answering with a
 * read tool.
 */
const WRITE_INTENT = /(新建|创建|新增|添加|开通|录入|删除|移除|注销|删掉|批量删除|修改|更新|变更|调整|停用|启用|改成|设为)/;
const WRITE_INTENT_WEIGHT = 20;
/** Score for a write tool whose action does **not** match the verb. */
const WRITE_INTENT_PARTIAL = 5;

/** Which mutation a question is asking for, from its verb alone. */
const WRITE_VERBS: Array<{ action: string; re: RegExp }> = [
  { action: 'batchDelete', re: /批量(删除|移除|注销)|删除多个|批量删/ },
  { action: 'create', re: /新建|创建|新增|添加|开通|录入|注册/ },
  { action: 'update', re: /修改|更新|变更|调整|改成|设为|停用|启用/ },
  { action: 'delete', re: /删除|移除|注销|删掉/ },
];

function writeActionOf(query: string): string | null {
  for (const { action, re } of WRITE_VERBS) {
    if (re.test(query)) return action;
  }
  return null;
}

const PERMISSION_LABELS: Record<ToolPermission, string> = {
  public: '无需权限',
  'flight:read': '航班数据读取',
  'dashboard:read': '看板数据读取',
  'user:read': '用户数据读取（非管理员脱敏）',
  'user:manage': '用户管理（仅管理员）',
  'flight:write': '航班记录写入（仅管理员）',
};

const WRITE_ACTION_LABELS: Record<string, string> = {
  create: '新增',
  update: '修改',
  delete: '删除',
  batchDelete: '批量删除',
};

/** Parameters are masked before they reach the audit table. */
function maskParams(params: unknown): unknown {
  return maskSensitive(params);
}

/**
 * Single catalogue for every AI tool.
 *
 * Responsibilities:
 *  - auto registration (Nest injects all `BaseTool` providers)
 *  - lookup by name and keyword/intent matching
 *  - runtime enable/disable without redeploy
 *  - permission check **before** execution
 *  - standardised failure envelopes so the UI can always render something
 */
@Injectable()
export class ToolRegistryService implements OnModuleInit {
  private readonly logger = new Logger('ToolRegistry');
  private readonly tools = new Map<string, AnyTool>();
  /** Runtime overrides; undefined means "use the definition default". */
  private readonly enabledOverrides = new Map<string, boolean>();

  constructor(
    private readonly audit: AiOperationAuditService,
    private readonly writeGuard: WriteGuardService,
  ) {}

  onModuleInit(): void {
    ToolAuditSink.register((event) => this.writeAudit(event));
  }

  /* ----------------------------- registration ----------------------------- */

  register(tool: AnyTool): void {
    this.tools.set(tool.definition.name, tool);
    const kind = isWriteTool(tool) ? 'write' : 'read';
    this.logger.log(
      `tool registered: ${tool.definition.name} (${tool.definition.intent}, ${kind})`,
    );
  }

  registerAll(tools: AnyTool[]): void {
    for (const tool of tools) this.register(tool);
  }

  /* -------------------------------- lookup -------------------------------- */

  findByName(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  findWriteTool(name: string): BaseWriteTool<never, unknown> | undefined {
    const tool = this.tools.get(name);
    return tool && isWriteTool(tool) ? tool : undefined;
  }

  list(): ToolSummary[] {
    return [...this.tools.values()].map((tool) => this.summarise(tool));
  }

  /**
   * Tool specs handed to the model for function calling.
   *
   * Only enabled tools that declare a parameter schema are exposed, so a
   * disabled tool can never be invoked.
   *
   * Write tools **are** offered — otherwise the model answers 「帮我新建一个用户」
   * in prose because it has no tool for it. Letting the model *select* a write
   * tool is not letting it *execute* one: the call still stops at the preview
   * gate and needs a human-confirmed token, and every argument is re-validated
   * by the guard before anything is written.
   */
  toolSpecs(): LlmToolSpec[] {
    return [...this.tools.values()]
      .filter((tool) => this.isEnabled(tool.definition.name) && tool.definition.parameters)
      .map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.definition.name,
          description: tool.definition.description,
          parameters: tool.definition.parameters as unknown as Record<string, unknown>,
        },
      }));
  }

  private summarise(tool: AnyTool): ToolSummary {
    const def = tool.definition;
    const base: ToolSummary = {
      name: def.name,
      description: def.description,
      intent: def.intent,
      resultType: def.resultType,
      permission: def.permission,
      adminOnly: Boolean(def.adminOnly),
      enabled: this.isEnabled(def.name),
      keywords: [...def.keywords],
    };
    if (isWriteTool(tool)) {
      const writeDef = def as WriteToolDefinition;
      return {
        ...base,
        write: true,
        action: writeDef.action,
        autoExecute: writeDef.autoExecute !== false,
        destructive: Boolean(writeDef.destructive),
      };
    }
    return base;
  }

  /* ---------------------------- enable / disable -------------------------- */

  isEnabled(name: string): boolean {
    const override = this.enabledOverrides.get(name);
    if (override !== undefined) return override;
    return this.tools.get(name)?.definition.enabled !== false;
  }

  setEnabled(name: string, enabled: boolean): boolean {
    if (!this.tools.has(name)) return false;
    this.enabledOverrides.set(name, enabled);
    this.logger.log(`tool ${name} ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }

  /* ------------------------------ intent match ---------------------------- */

  /**
   * Cheap keyword scoring: the longest matching keyword wins, and longer
   * keywords outrank shorter ones so "气泡图" beats a bare "图".
   * Returns the best tool plus any parameters it could extract itself.
   */
  match(query: string, intent?: ToolIntent): ToolMatch | null {
    const haystack = (query ?? '').toLowerCase();
    if (!haystack.trim()) return null;

    let best: ToolMatch | null = null;
    for (const tool of this.tools.values()) {
      if (!this.isEnabled(tool.definition.name)) continue;
      if (intent && tool.definition.intent !== intent) continue;

      let score = 0;
      for (const keyword of tool.definition.keywords) {
        if (haystack.includes(keyword.toLowerCase())) score += keyword.length;
      }
      // Strong keywords decide ties: "…的条形图" must not be answered by a
      // plain table tool that happens to share the word 航班.
      for (const keyword of tool.definition.strongKeywords ?? []) {
        if (haystack.includes(keyword.toLowerCase())) score += STRONG_KEYWORD_WEIGHT;
      }
      // "新建一个用户" must not be answered by the read-only directory tool.
      // The entity word decides *which* entity, the verb decides *which action*:
      // matching both is worth far more than matching only the entity, so
      // "删除用户" cannot land on `user.create`.
      if (isWriteTool(tool)) {
        const def2 = tool.definition as WriteToolDefinition;
        const entityHit = (def2.entityKeywords ?? []).some((word) => haystack.includes(word));
        if (entityHit && WRITE_INTENT.test(haystack)) {
          score += writeActionOf(haystack) === def2.action ? WRITE_INTENT_WEIGHT : WRITE_INTENT_PARTIAL;
        }
      }
      if (tool.definition.name.toLowerCase().includes(haystack)) score += 4;
      if (score === 0) continue;
      if (!best || score > best.score) {
        best = { name: tool.definition.name, score, params: {} };
      }
    }

    if (!best) return null;

    const extracted = this.tools.get(best.name)?.extractParams?.(query);
    return { ...best, params: (extracted ?? {}) as Record<string, unknown> };
  }

  /**
   * High-confidence match using **only** `strongKeywords`.
   *
   * Phrases like 条形图 / 气泡图 / 明细 unambiguously name one tool, so this
   * route skips the model entirely: same accuracy, no tokens, ~20x faster.
   * Anything ambiguous deliberately returns `null` and falls through to
   * model selection — which is what stops "帮我订机票" (a plain `机票` keyword
   * hit) from being answered with flight rows.
   */
  matchStrong(query: string): ToolMatch | null {
    const haystack = (query ?? '').toLowerCase();
    if (!haystack.trim()) return null;

    let best: ToolMatch | null = null;
    for (const tool of this.tools.values()) {
      if (!this.isEnabled(tool.definition.name)) continue;

      let score = 0;
      for (const keyword of tool.definition.strongKeywords ?? []) {
        if (haystack.includes(keyword.toLowerCase())) score += keyword.length;
      }
      if (score === 0) continue;
      if (!best || score > best.score) best = { name: tool.definition.name, score, params: {} };
    }

    if (!best) return null;

    // A question that clearly wants a change must not be short-circuited into a
    // read tool: fall through to full matching, where write tools are boosted.
    const bestTool = this.tools.get(best.name);
    if (WRITE_INTENT.test(haystack) && !isWriteTool(bestTool)) return null;

    const extracted = bestTool?.extractParams?.(query);
    return { ...best, params: (extracted ?? {}) as Record<string, unknown> };
  }

  /* -------------------------------- execution ----------------------------- */

  async run<P extends Record<string, unknown>>(
    name: string,
    params: P,
    ctx: ToolContext | null,
  ): Promise<ToolResult<unknown>> {
    const startedAt = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return toolFailure(name, TOOL_ERR_NOT_FOUND, `工具「${name}」不存在`);
    }

    const def: ToolDefinition = tool.definition;

    if (!this.isEnabled(name)) {
      return toolFailure(name, TOOL_ERR_DISABLED, `工具「${def.name}」已停用`, {
        resultType: def.resultType,
      });
    }

    // Identity is mandatory: anonymous tool execution is forbidden by design.
    if (!ctx?.user?.userId) {
      return toolFailure(name, TOOL_ERR_FORBIDDEN, '缺少用户身份，禁止执行工具', {
        resultType: def.resultType,
      });
    }

    const denied = this.permissionDenied(def, ctx);
    if (denied) {
      return toolFailure(name, TOOL_ERR_FORBIDDEN, denied, { resultType: def.resultType });
    }

    // Write tools are dispatched by the interception layer, never by `run`
    // itself: an unconfirmed call degrades to a preview.
    if (isWriteTool(tool)) {
      return this.runWrite(tool as BaseWriteTool<never, unknown>, params, ctx, startedAt);
    }

    const validationError = tool.validate?.(params as never) ?? null;
    if (validationError) {
      return toolFailure(name, TOOL_ERR_VALIDATION, validationError, {
        resultType: def.resultType,
      });
    }

    try {
      const result = await tool.execute(params as never, ctx);
      return { ...result, durationMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.warn(`tool ${name} failed: ${this.describeError(error)}`);
      return toolFailure(name, TOOL_ERR_INTERNAL, this.userFacingError(error), {
        resultType: def.resultType,
        meta: { reason: this.describeError(error) },
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private permissionDenied(def: ToolDefinition, ctx: ToolContext): string | null {
    if (def.adminOnly && !ctx.user.isAdmin) {
      return `工具「${def.name}」仅管理员可用（需要 ${PERMISSION_LABELS[def.permission]} 权限）`;
    }
    return null;
  }

  /* -------------------------------------------------------------------------- */
  /* Write-tool interception layer                                              */
  /* -------------------------------------------------------------------------- */

  /**
   * Produces the confirmation preview for a write tool.
   *
   * Three checks run first (parameter legality, permission, business rules).
   * Only then is a single-use token issued, so a preview is never generated
   * for a request that could not have been executed anyway.
   */
  async preview<P extends Record<string, unknown>>(
    name: string,
    params: P,
    ctx: ToolContext | null,
  ): Promise<ToolResult<unknown>> {
    const startedAt = Date.now();
    const tool = this.findWriteTool(name);
    if (!tool) {
      return toolFailure(name, TOOL_ERR_NOT_FOUND, `写入工具「${name}」不存在`, {
        resultType: 'preview',
      });
    }
    if (!this.isEnabled(name)) {
      return toolFailure(name, TOOL_ERR_DISABLED, `工具「${name}」已停用`, {
        resultType: 'preview',
      });
    }
    if (!ctx?.user?.userId) {
      return toolFailure(name, TOOL_ERR_FORBIDDEN, '缺少用户身份，禁止执行写入操作', {
        resultType: 'preview',
      });
    }
    const denied = this.permissionDenied(tool.definition, ctx);
    if (denied) {
      return toolFailure(name, TOOL_ERR_FORBIDDEN, denied, { resultType: 'preview' });
    }

    // Same three checks as an execution: parameter legality, permission and
    // business rules. A preview is never issued for a request that could not
    // have been executed — otherwise the user would confirm a doomed change.
    const check = await this.writeGuard.precheck(
      tool as BaseWriteTool<Record<string, unknown>, unknown>,
      params as Record<string, unknown>,
      ctx,
      tool.dto,
    );
    if (!check.ok) {
      return toolFailure(name, check.code, check.message, {
        resultType: 'preview',
        meta: { stage: check.stage, details: check.details ?? null },
        durationMs: Date.now() - startedAt,
      });
    }

    return this.buildPreview(tool, params, ctx, startedAt);
  }

  /**
   * Executes a write tool **only** with a valid confirmation token.
   *
   * The token is bound to the tool, the caller and a hash of the parameters,
   * so it cannot be replayed, transferred or reused with edited arguments.
   */
  async executeConfirmed<P extends Record<string, unknown>>(
    name: string,
    params: P,
    ctx: ToolContext | null,
    token: string,
  ): Promise<ToolResult<unknown>> {
    const startedAt = Date.now();
    const tool = this.findWriteTool(name);
    if (!tool) {
      return toolFailure(name, TOOL_ERR_NOT_FOUND, `写入工具「${name}」不存在`, {
        resultType: 'preview',
      });
    }
    if (!this.isEnabled(name)) {
      return toolFailure(name, TOOL_ERR_DISABLED, `工具「${name}」已停用`, {
        resultType: 'preview',
      });
    }
    if (!ctx?.user?.userId) {
      return toolFailure(name, TOOL_ERR_FORBIDDEN, '缺少用户身份，禁止执行写入操作', {
        resultType: 'preview',
      });
    }
    const denied = this.permissionDenied(tool.definition, ctx);
    if (denied) {
      return toolFailure(name, TOOL_ERR_FORBIDDEN, denied, { resultType: 'preview' });
    }

    if (!token) {
      return toolFailure(
        name,
        TOOL_ERR_CONFIRM_REQUIRED,
        '写入操作必须先生成预览并由用户确认后再执行',
        { resultType: 'preview', meta: { stage: 'confirm' } },
      );
    }

    const consumed = await this.writeGuard.consume({
      token,
      toolName: name,
      params,
      ctx,
    });
    if (!consumed.ok) {
      return toolFailure(name, TOOL_ERR_CONFIRM_REQUIRED, consumed.reason ?? '确认令牌无效', {
        resultType: 'preview',
        meta: { stage: 'confirm' },
      });
    }

    // The token owns the arguments, so a client can confirm without resending
    // them (and without resending a password).
    return this.runWrite(
      tool,
      (consumed.params ?? params) as P,
      { ...ctx, execution: { confirmed: true, token } },
      startedAt,
    );
  }

  /**
   * Shared write path: pre-validation, then either a preview or the real
   * mutation. `run()` and `executeConfirmed()` both land here so the rules
   * cannot drift apart.
   */
  private async runWrite<P extends Record<string, unknown>>(
    tool: BaseWriteTool<never, unknown>,
    params: P,
    ctx: ToolContext | null,
    startedAt: number,
  ): Promise<ToolResult<unknown>> {
    const name = tool.definition.name;

    const check = await this.writeGuard.precheck(
      tool as BaseWriteTool<Record<string, unknown>, unknown>,
      params as Record<string, unknown>,
      ctx,
      tool.dto,
    );
    if (!check.ok) {
      return toolFailure(name, check.code, check.message, {
        resultType: 'preview',
        meta: { stage: check.stage, details: check.details ?? null },
        durationMs: Date.now() - startedAt,
      });
    }

    const confirmed = ctx?.execution?.confirmed === true;
    const autoAllowed = tool.definition.autoExecute === true;
    if (!confirmed && !autoAllowed) {
      // Red line: a write tool never mutates on its own.
      return this.buildPreview(tool, params, ctx as ToolContext, startedAt);
    }

    // Re-validate right before the mutation: the row may have changed between
    // preview and confirmation.
    const recheck = await this.writeGuard.precheck(
      tool as BaseWriteTool<Record<string, unknown>, unknown>,
      params as Record<string, unknown>,
      ctx,
      tool.dto,
    );
    if (!recheck.ok) {
      return toolFailure(name, recheck.code, recheck.message, {
        resultType: 'preview',
        meta: { stage: recheck.stage, details: recheck.details ?? null },
        durationMs: Date.now() - startedAt,
      });
    }

    try {
      const result = await tool.execute(params as never, ctx as ToolContext);
      return { ...result, durationMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.warn(`write tool ${name} failed: ${this.describeError(error)}`);
      return toolFailure(name, TOOL_ERR_INTERNAL, this.userFacingError(error), {
        resultType: 'preview',
        meta: { reason: this.describeError(error) },
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private async buildPreview<P extends Record<string, unknown>>(
    tool: BaseWriteTool<never, unknown>,
    params: P,
    ctx: ToolContext,
    startedAt: number,
  ): Promise<ToolResult<WritePreviewPayload | null>> {
    const name = tool.definition.name;

    try {
      const input = await tool.getPreview(params as never, ctx);
      const { token, expiresInSec } = await this.writeGuard.issue({
        toolName: name,
        params: params as Record<string, unknown>,
        ctx,
      });
      const payload = tool.buildPreview(input, token, expiresInSec);

      await this.audit.record(
        ctx.user,
        {
          action: 'tool.write_preview',
          resourceType: 'tool',
          resourceId: name,
          // Nothing has been mutated yet — this row records the *intent*.
          operation: 'read',
          sessionId: ctx.sessionId ?? null,
          requestPayload: { tool: name, action: tool.definition.action, params: maskParams(params) },
          responseSummary: {
            code: 0,
            affectedCount: payload.affectedCount,
            targetLabel: payload.targetLabel,
            requiresConfirmation: true,
          },
          statusCode: 0,
          success: true,
          durationMs: Date.now() - startedAt,
        },
        { ipAddress: ctx.ipAddress ?? undefined, userAgent: ctx.userAgent ?? undefined },
      );

      return toolSuccess(name, 'preview', payload, {
        message:
          `即将${WRITE_ACTION_LABELS[tool.definition.action]}：${payload.targetLabel}，` +
          `影响 ${payload.affectedCount} 条记录，请确认后执行`,
        meta: { stage: 'preview', action: tool.definition.action },
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = this.userFacingError(error);
      const code = message === '工具执行失败，请稍后重试' ? TOOL_ERR_INTERNAL : TOOL_ERR_VALIDATION;
      return toolFailure(name, code, message, {
        resultType: 'preview',
        meta: { stage: 'preview' },
        durationMs: Date.now() - startedAt,
      });
    }
  }

  private userFacingError(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message: unknown }).message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.join('；');
      }
      return error.message;
    }
    return '工具执行失败，请稍后重试';
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /* --------------------------------- audit -------------------------------- */

  private async writeAudit(event: ToolAuditEvent): Promise<void> {
    const ctx = event.context;
    await this.audit.record(
      ctx?.user ?? { userId: 'anonymous', email: '', tenantId: 'anonymous', isAdmin: false },
      {
        action: 'tool.execute',
        resourceType: 'tool',
        resourceId: event.toolName,
        // Write tools report their action in `meta.action`, so the audit row
        // says create/update/delete instead of a generic bucket.
        operation: this.auditOperation(event),
        sessionId: ctx?.sessionId ?? null,
        requestPayload: {
          tool: event.toolName,
          intent: event.intent ?? null,
          // Already masked by the decorator.
          params: event.params ?? null,
        },
        responseSummary: {
          code: event.result?.code ?? TOOL_ERR_INTERNAL,
          resultType: event.result?.resultType ?? null,
          message: event.result?.message ?? this.describeError(event.error),
          rowCount: this.rowCount(event.result),
        },
        statusCode: event.result?.code ?? TOOL_ERR_INTERNAL,
        success: event.success,
        durationMs: event.durationMs,
      },
      { ipAddress: ctx?.ipAddress ?? undefined, userAgent: ctx?.userAgent ?? undefined },
    );
  }

  /** Maps a tool result onto one of the audit table's operation values. */
  private auditOperation(event: ToolAuditEvent): 'create' | 'read' | 'update' | 'delete' {
    if (event.intent !== 'WRITE_DATA') return 'read';
    const action = (event.result?.meta as { action?: string } | null | undefined)?.action;
    if (action === 'create' || action === 'update' || action === 'delete') return action;
    if (action === 'batchDelete') return 'delete';
    return 'read';
  }

  private rowCount(result: ToolResult<unknown> | null): number | null {
    if (!result) return null;
    if (result.pagination?.total !== undefined) return result.pagination.total;
    const data = result.data as { rows?: unknown[]; points?: unknown[]; cards?: unknown[]; nodes?: unknown[] } | null;
    if (!data) return null;
    if (Array.isArray(data.rows)) return data.rows.length;
    if (Array.isArray(data.points)) return data.points.length;
    if (Array.isArray(data.cards)) return data.cards.length;
    if (Array.isArray(data.nodes)) return data.nodes.length;
    return null;
  }
}
