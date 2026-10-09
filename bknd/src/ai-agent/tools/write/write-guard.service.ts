import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { AI_REDIS } from '../../cache/ai-redis.module.js';
import {
  AI_CACHE_DEFAULT_TTL,
  aiWriteConfirmKey,
  hashQuery,
} from '../../cache/cache-keys.js';
import {
  TOOL_ERR_FORBIDDEN,
  TOOL_ERR_VALIDATION,
  type ToolContext,
} from '../tool.types.js';
import { type BaseWriteTool, type WriteToolDefinition } from './base-write-tool.js';

export interface PrecheckResult {
  ok: boolean;
  code: number;
  message: string;
  /** Field-level details, same shape the REST ValidationPipe returns. */
  details?: string[];
  stage?: 'dto' | 'permission' | 'business';
}

export interface ConfirmationTicket {
  toolName: string;
  userId: string;
  paramsHash: string;
  /**
   * The exact arguments the preview was issued for.
   *
   * Storing them server-side means a client can confirm with the token alone,
   * so no parameters (and no password) have to round-trip through the UI.
   */
  paramsJson: string;
  issuedAt: number;
}

export interface ConsumeResult {
  ok: boolean;
  reason?: string;
  /** Arguments to execute — taken from the ticket when the client omits them. */
  params?: Record<string, unknown>;
}

/** Any class-validator DTO a write tool wants to reuse. */
export type DtoClass = new () => object;

/**
 * Single gate every write tool must pass.
 *
 * Three checks, in this order, and any failure stops the flow:
 *
 * 1. **Parameter legality** — reuses the *existing business DTO* through
 *    `class-validator`, so an AI request and a REST request fail with the same
 *    messages instead of two dialects of error.
 * 2. **Permission** — the caller identity is passed straight through; a user
 *    without the required role never reaches business validation.
 * 3. **Business rules** — delegated to the tool's `validate()`, which calls the
 *    business service's own checks (uniqueness, status legality, …).
 *
 * The guard also issues and consumes the single-use confirmation tokens that
 * make "no automatic execution" enforceable rather than conventional.
 */
@Injectable()
export class WriteGuardService {
  private readonly logger = new Logger(WriteGuardService.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(AI_REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.ttlSeconds = Number(this.config.get<string>('AI_WRITE_CONFIRM_TTL'))
      || AI_CACHE_DEFAULT_TTL.writeConfirm;
  }

  /**
   * Runs all three checks. `dto` is optional: tools without a business DTO
   * still get permission and business-rule validation.
   */
  async precheck<P extends Record<string, unknown>>(
    tool: BaseWriteTool<P, unknown>,
    params: P,
    ctx: ToolContext | null,
    dto?: DtoClass,
  ): Promise<PrecheckResult> {
    if (!ctx?.user?.userId) {
      return {
        ok: false,
        code: TOOL_ERR_FORBIDDEN,
        message: '缺少用户身份，禁止执行写入操作',
        stage: 'permission',
      };
    }

    const def: WriteToolDefinition = tool.definition;
    if (def.adminOnly && !ctx.user.isAdmin) {
      return {
        ok: false,
        code: TOOL_ERR_FORBIDDEN,
        message: `工具「${def.name}」仅管理员可用，写入操作已终止`,
        stage: 'permission',
      };
    }

    if (dto) {
      const dtoErrors = await this.validateDto(dto, params);
      if (dtoErrors.length) {
        return {
          ok: false,
          code: TOOL_ERR_VALIDATION,
          message: `参数校验未通过：${dtoErrors[0]}`,
          details: dtoErrors,
          stage: 'dto',
        };
      }
    }

    try {
      const businessError = await tool.validate(params, ctx);
      if (businessError) {
        return {
          ok: false,
          code: TOOL_ERR_VALIDATION,
          message: businessError,
          stage: 'business',
        };
      }
    } catch (error) {
      // Business services throw HttpException; surface the same text the REST
      // API would return (e.g. 「该邮箱已注册」).
      return {
        ok: false,
        code: TOOL_ERR_VALIDATION,
        message: this.httpMessage(error),
        stage: 'business',
      };
    }

    return { ok: true, code: 0, message: 'ok', stage: 'business' };
  }

  private async validateDto(dto: DtoClass, params: Record<string, unknown>): Promise<string[]> {
    const instance = plainToInstance(dto, params ?? {});
    const errors = await validate(instance, {
      whitelist: true,
      forbidNonWhitelisted: false,
      skipMissingProperties: false,
    });
    return flattenErrors(errors);
  }

  private httpMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'getResponse' in error) {
      const response = (error as { getResponse(): unknown }).getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message: unknown }).message;
        if (typeof message === 'string') return message;
        if (Array.isArray(message)) return message.join('；');
      }
    }
    return error instanceof Error ? error.message : '业务校验失败';
  }

  /* --------------------------- confirmation tokens -------------------------- */

  /**
   * Issues a single-use token bound to the caller **and** to a hash of the
   * parameters, so a preview cannot be confirmed with edited arguments.
   */
  async issue(params: {
    toolName: string;
    params: Record<string, unknown>;
    ctx: ToolContext;
  }): Promise<{ token: string; expiresInSec: number }> {
    const token = randomBytes(18).toString('hex');
    const ticket: ConfirmationTicket = {
      toolName: params.toolName,
      userId: params.ctx.user.userId,
      paramsHash: hashQuery([JSON.stringify(stabilise(params.params))]),
      paramsJson: JSON.stringify(params.params ?? {}),
      issuedAt: Date.now(),
    };
    await this.redis.set(aiWriteConfirmKey(token), JSON.stringify(ticket), 'EX', this.ttlSeconds);
    return { token, expiresInSec: this.ttlSeconds };
  }

  /**
   * Consumes (deletes) the token and returns the arguments to execute.
   *
   * The client may omit `params` entirely — the ticket's copy is used — which
   * is what lets the UI confirm with a token alone. When the client *does*
   * send parameters (scripts, curl), they are checked against the stored hash
   * first, so a preview can never be confirmed with edited arguments.
   */
  async consume(params: {
    token: string;
    toolName: string;
    params?: Record<string, unknown>;
    ctx: ToolContext;
  }): Promise<ConsumeResult> {
    const key = aiWriteConfirmKey(params.token);
    const raw = await this.redis.get(key);
    if (!raw) return { ok: false, reason: '确认令牌不存在或已过期，请重新生成预览' };

    let ticket: ConfirmationTicket;
    try {
      ticket = JSON.parse(raw) as ConfirmationTicket;
    } catch {
      await this.redis.del(key);
      return { ok: false, reason: '确认令牌已损坏，请重新生成预览' };
    }

    if (ticket.toolName !== params.toolName) {
      return { ok: false, reason: '确认令牌与工具不匹配' };
    }
    if (ticket.userId !== params.ctx.user.userId) {
      this.logger.warn(
        `write token owner mismatch: ${ticket.userId} vs ${params.ctx.user.userId}`,
      );
      return { ok: false, reason: '确认令牌不属于当前用户' };
    }

    const supplied = params.params && Object.keys(params.params).length ? params.params : null;
    if (supplied) {
      const expected = hashQuery([JSON.stringify(stabilise(supplied))]);
      if (ticket.paramsHash !== expected) {
        return { ok: false, reason: '参数已变更，请重新生成预览后再执行' };
      }
    }

    // Single use: whatever happens next, the token is gone.
    await this.redis.del(key);

    if (supplied) return { ok: true, params: supplied };
    try {
      return { ok: true, params: JSON.parse(ticket.paramsJson) as Record<string, unknown> };
    } catch {
      return { ok: false, reason: '确认令牌内容已损坏，请重新生成预览' };
    }
  }
}

/** Depth-first walk of `ValidationError` trees into readable Chinese messages. */
function flattenErrors(errors: ValidationError[], prefix = ''): string[] {
  const out: string[] = [];
  for (const error of errors) {
    const path = prefix ? `${prefix}.${error.property}` : error.property;
    if (error.children?.length) {
      out.push(...flattenErrors(error.children, path));
      continue;
    }
    const constraints = Object.values(error.constraints ?? {});
    out.push(constraints.length ? `${path}: ${constraints.join('；')}` : `${path}: 参数不合法`);
  }
  return out;
}

/** Key-order-insensitive clone so `{a,b}` and `{b,a}` hash identically. */
function stabilise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilise);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) output[key] = stabilise(source[key]);
    return output;
  }
  return value ?? null;
}
