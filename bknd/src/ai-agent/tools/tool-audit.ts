import { maskSensitive, type ToolContext, type ToolResult } from './tool.types.js';

export interface ToolAuditEvent {
  toolName: string;
  intent?: string;
  params: unknown;
  context: ToolContext | null;
  result: ToolResult<unknown> | null;
  error: unknown;
  durationMs: number;
  success: boolean;
}

type AuditHandler = (event: ToolAuditEvent) => Promise<void> | void;

/**
 * Bridge between the `@AuditedTool()` decorator and Nest's DI container.
 *
 * A decorator cannot inject dependencies, so the concrete writer (the audit
 * service) is registered once at module start-up and every decorated tool
 * execution is funnelled through it.
 */
export class ToolAuditSink {
  private static handler: AuditHandler | null = null;

  static register(handler: AuditHandler): void {
    ToolAuditSink.handler = handler;
  }

  static async emit(event: ToolAuditEvent): Promise<void> {
    if (!ToolAuditSink.handler) return;
    try {
      await ToolAuditSink.handler(event);
    } catch {
      // Auditing must never break a tool call.
    }
  }
}

/**
 * Wraps a tool's `execute(params, ctx)` so every run automatically writes an
 * `ai_operation_audit` row — including failures.
 *
 * Recorded: user id, tool name, action, (masked) input, result summary, ip,
 * user agent, duration. Sensitive fields are masked before persistence.
 */
export function AuditedTool(): MethodDecorator {
  return (
    _target: object,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor => {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    descriptor.value = async function (
      this: { definition?: { name: string; intent?: string } },
      ...args: unknown[]
    ) {
      const startedAt = Date.now();
      const params = args[0];
      const ctx = (args[1] ?? null) as ToolContext | null;

      let result: ToolResult<unknown> | null = null;
      let error: unknown = null;
      try {
        result = (await original.apply(this, args)) as ToolResult<unknown>;
      } catch (err) {
        error = err;
      }

      const durationMs = Date.now() - startedAt;
      await ToolAuditSink.emit({
        toolName: this?.definition?.name ?? 'unknown',
        intent: this?.definition?.intent,
        params: maskSensitive(params),
        context: ctx,
        result,
        error,
        durationMs,
        success: !error && (result?.code ?? 1) === 0,
      });

      if (error) throw error;
      return result;
    };

    return descriptor;
  };
}
