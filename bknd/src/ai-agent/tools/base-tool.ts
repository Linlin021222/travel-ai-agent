import type { ResultType, ToolContext, ToolIntent, ToolResult } from './tool.types.js';

/**
 * Permissions a tool may require. The business `users` table has no role
 * column, so the policy is derived from {@link ToolDefinition.adminOnly} plus
 * the authenticated identity — see `ToolRegistryService`.
 */
export type ToolPermission =
  | 'public'
  | 'flight:read'
  | 'dashboard:read'
  | 'user:read'
  | 'user:manage';

/**
 * JSON Schema describing a tool's parameters, in the OpenAI
 * *function calling* shape so the same object can be handed straight to the
 * model. Keeping it next to the keyword lists means the two routing strategies
 * can never disagree about what a tool accepts.
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  /** Stable machine name, e.g. `flight.query`. */
  name: string;
  /** Shown in the tool catalogue and fed to intent matching. */
  description: string;
  /**
   * Parameter schema used for model-driven tool selection (function calling).
   * Optional so a tool can stay keyword-only while it is being migrated.
   */
  parameters?: ToolParameterSchema;
  intent: ToolIntent;
  /** Default renderer for this tool's payload. */
  resultType: ResultType;
  /** Chinese keywords used by `matchByIntent`. */
  keywords: string[];
  /**
   * Keywords that unambiguously identify this tool (e.g. 条形图 for the bar
   * tool). They carry a much higher score so a chart question is never stolen
   * by a generic data tool that merely shares words like 航班 or 取消.
   */
  strongKeywords?: string[];
  permission: ToolPermission;
  /** Restrict to administrators. */
  adminOnly?: boolean;
  /** Tools can be disabled at runtime without a redeploy. */
  enabled?: boolean;
}

/**
 * Base class every AI tool extends.
 *
 * Development rules enforced by this contract:
 *  1. `execute` always receives a {@link ToolContext} carrying the caller
 *     identity — a tool can never run anonymously, so cross-tenant access is
 *     impossible by construction.
 *  2. Tools inject **business services** only. Injecting a Repository or
 *     writing SQL inside a tool is prohibited: all data access must go
 *     through the existing, already-tested service layer.
 *  3. Tools return the standard {@link ToolResult} envelope so the front end
 *     can pick a renderer purely from `resultType`.
 */
export abstract class BaseTool<P = Record<string, unknown>, D = unknown> {
  abstract readonly definition: ToolDefinition;

  abstract execute(params: P, ctx: ToolContext): Promise<ToolResult<D>>;

  /**
   * Optional natural-language parameter extraction. Returning `null` tells the
   * caller the question does not look like a request for this tool.
   */
  extractParams?(query: string): Partial<P> | null;

  /** Hook for tool-specific validation beyond the shared DTO checks. */
  validate?(params: P): string | null;
}
