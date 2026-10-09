import type { ToolDefinition, ToolPermission } from '../base-tool.js';
import type {
  ToolContext,
  ToolResult,
  WriteAction,
  WritePreviewPayload,
} from '../tool.types.js';

/**
 * Definition of a write tool.
 *
 * Differences from {@link ToolDefinition}:
 *  - `intent` is always `WRITE_DATA`, so a write tool can never be picked up by
 *    a read-only routing path;
 *  - `write: true` is the marker the registry checks before it allows mutation;
 *  - `autoExecute` is **false by default** — a write tool must be dispatched by
 *    the interception layer after the user confirmed a preview.
 */
export interface WriteToolDefinition extends Omit<ToolDefinition, 'intent'> {
  intent: 'WRITE_DATA';
  write: true;
  /** Which of the four business mutations the tool performs. */
  action: WriteAction;
  /**
   * The entity this tool writes — 用户 / 航班记录.
   *
   * Routing needs it: 「新建一个用户」 contains no keyword of `user.create`
   * verbatim ("新建一个用户" ≠ "新建用户"), so intent matching combines a change
   * verb with these words to tell the seven write tools apart. Without them
   * every write question would land on whichever tool happens to come first.
   */
  entityKeywords: string[];
  /**
   * Whether a confirmed call may run without an extra "are you sure" step.
   * Must stay `false` in production: it exists only for scripted tests.
   */
  autoExecute?: boolean;
  /** Deletes and batch deletes are irreversible — surfaced in the preview. */
  destructive?: boolean;
}

export interface WritePreviewInput {
  targetLabel: string;
  affectedCount: number;
  changes: Array<{ field: string; label: string; from: unknown; to: unknown }>;
  warnings?: string[];
}

export interface RollbackRecord {
  toolName: string;
  action: WriteAction;
  /** Whatever the business service returned, enough to undo the change. */
  snapshot: Record<string, unknown>;
  executedAt: string;
}

/**
 * Base class for every AI write tool.
 *
 * Physically separated from {@link import('../base-tool.js').BaseTool} on
 * purpose: read and write tools share no file, so a write tool cannot be
 * registered into a read-only path by accident.
 *
 * The four required methods form the safety chain:
 *
 * ```
 * validate()  ->  getPreview()  ->  [user confirms]  ->  execute()  ->  rollback()
 * ```
 *
 * Development red lines enforced here:
 *  1. A write tool **never** runs automatically. The registry converts an
 *     unconfirmed call into a preview; only a call carrying the matching
 *     confirmation token reaches `execute()`.
 *  2. Tools inject **business services** only — no Repository, no SQL.
 *  3. `validate()` must call the business service's own checks (uniqueness,
 *     status legality, …) so AI errors are byte-identical to the REST API's.
 */
export abstract class BaseWriteTool<P = Record<string, unknown>, D = unknown> {
  abstract readonly definition: WriteToolDefinition;

  /** Marker for the registry — cheaper and safer than `instanceof` across bundles. */
  readonly isWriteTool = true as const;

  /**
   * Pre-validation. Runs before a preview is produced and again before
   * execution. Returns `null` when everything is fine, otherwise a structured
   * error that is safe to show to the end user.
   */
  abstract validate(params: P, ctx: ToolContext): Promise<string | null>;

  /** Builds the "this is what will happen" payload the user confirms. */
  abstract getPreview(params: P, ctx: ToolContext): Promise<WritePreviewInput>;

  /** Performs the mutation. Only reachable through the interception layer. */
  abstract execute(params: P, ctx: ToolContext): Promise<ToolResult<D>>;

  /**
   * Undo hook. Reserved for now — the first write week ships it as a no-op
   * with a snapshot so the second week can wire real compensation.
   */
  abstract rollback(record: RollbackRecord, ctx: ToolContext): Promise<ToolResult<unknown>>;

  /** Optional natural-language parameter extraction, same contract as read tools. */
  extractParams?(query: string): Partial<P> | null;

  /**
   * The *business* DTO whose class-validator rules guard this tool.
   *
   * Reusing it means an assistant request and a REST request fail with the
   * same messages instead of two dialects of error.
   */
  readonly dto?: new () => object;

  /**
   * Assembles the standard preview payload. Subclasses return the *content*
   * only, so the token, warnings and shape stay consistent across tools.
   */
  buildPreview(
    input: WritePreviewInput,
    token: string,
    expiresInSec: number,
  ): WritePreviewPayload {
    return {
      previewType: 'write-preview',
      toolName: this.definition.name,
      action: this.definition.action,
      targetLabel: input.targetLabel,
      affectedCount: input.affectedCount,
      changes: input.changes,
      warnings: [...(input.warnings ?? []), ...this.defaultWarnings()],
      requiresConfirmation: true,
      confirmationToken: token,
      expiresInSec,
    };
  }

  private defaultWarnings(): string[] {
    const warnings: string[] = ['该操作会修改业务数据，执行后需要人工确认'];
    if (this.definition.destructive) {
      warnings.push('删除操作不可恢复，请确认目标范围');
    }
    return warnings;
  }
}

/** Narrowing helper: read tools do not declare `isWriteTool`. */
export function isWriteTool(tool: unknown): tool is BaseWriteTool<never, unknown> {
  return typeof tool === 'object' && tool !== null && (tool as { isWriteTool?: boolean }).isWriteTool === true;
}

export type { ToolPermission };
