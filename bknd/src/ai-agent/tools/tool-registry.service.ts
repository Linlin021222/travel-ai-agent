import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { LlmToolSpec } from '../llm/llm.types.js';
import { AiOperationAuditService } from '../services/ai-operation-audit.service.js';
import { BaseTool, type ToolDefinition, type ToolPermission } from './base-tool.js';
import { ToolAuditSink, type ToolAuditEvent } from './tool-audit.js';
import {
  TOOL_ERR_DISABLED,
  TOOL_ERR_FORBIDDEN,
  TOOL_ERR_INTERNAL,
  TOOL_ERR_NOT_FOUND,
  TOOL_ERR_VALIDATION,
  toolFailure,
  type ToolContext,
  type ToolIntent,
  type ToolResult,
} from './tool.types.js';

export interface ToolSummary {
  name: string;
  description: string;
  intent: ToolIntent;
  resultType: string;
  permission: ToolPermission;
  adminOnly: boolean;
  enabled: boolean;
  keywords: string[];
}

export interface ToolMatch {
  name: string;
  score: number;
  params: Record<string, unknown>;
}

/** Weight of a `strongKeywords` hit — far above any plain keyword length. */
const STRONG_KEYWORD_WEIGHT = 10;

const PERMISSION_LABELS: Record<ToolPermission, string> = {
  public: '无需权限',
  'flight:read': '航班数据读取',
  'dashboard:read': '看板数据读取',
  'user:read': '用户数据读取（非管理员脱敏）',
  'user:manage': '用户管理（仅管理员）',
};

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
  private readonly tools = new Map<string, BaseTool<never, unknown>>();
  /** Runtime overrides; undefined means "use the definition default". */
  private readonly enabledOverrides = new Map<string, boolean>();

  constructor(private readonly audit: AiOperationAuditService) {}

  onModuleInit(): void {
    ToolAuditSink.register((event) => this.writeAudit(event));
  }

  /* ----------------------------- registration ----------------------------- */

  register(tool: BaseTool<never, unknown>): void {
    this.tools.set(tool.definition.name, tool);
    this.logger.log(`tool registered: ${tool.definition.name} (${tool.definition.intent})`);
  }

  registerAll(tools: BaseTool<never, unknown>[]): void {
    for (const tool of tools) this.register(tool);
  }

  /* -------------------------------- lookup -------------------------------- */

  findByName(name: string): BaseTool<never, unknown> | undefined {
    return this.tools.get(name);
  }

  list(): ToolSummary[] {
    return [...this.tools.values()].map((tool) => this.summarise(tool));
  }

  /**
   * Tool specs handed to the model for function calling.
   *
   * Only enabled tools that declare a parameter schema are exposed, so a
   * disabled tool can never be invoked and the model never sees a tool it
   * cannot describe. Permission is still re-checked in {@link run}.
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

  private summarise(tool: BaseTool<never, unknown>): ToolSummary {
    const def = tool.definition;
    return {
      name: def.name,
      description: def.description,
      intent: def.intent,
      resultType: def.resultType,
      permission: def.permission,
      adminOnly: Boolean(def.adminOnly),
      enabled: this.isEnabled(def.name),
      keywords: [...def.keywords],
    };
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
    const extracted = this.tools.get(best.name)?.extractParams?.(query);
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
        operation: 'read',
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
