import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../common/auth/auth-user.js';
import { AiCacheService } from './cache/ai-cache.service.js';
import { AppendMessageDto, SendChatMessageDto, normalizeMessageType } from './dto/chat.dto.js';
import type { ChatMessageType, ChatRole } from './entities/ai-chat-message.entity.js';
import { createLlmProvider } from './llm/llm.adapter.js';
import { LLM_PROVIDERS } from './llm/llm.config.js';
import {
  isLlmProviderId,
  type LlmCompletionResponse,
  type LlmMessage,
  type LlmProvider,
  type LlmProviderId,
  type LlmToolCall,
} from './llm/llm.types.js';
import { AiChatSessionService } from './services/ai-chat-session.service.js';
import { AiOperationAuditService } from './services/ai-operation-audit.service.js';
import { ToolRegistryService } from './tools/tool-registry.service.js';
import type { ToolResult } from './tools/tool.types.js';

const logger = new Logger('AiAgentService');

/**
 * Layered system prompt.
 *
 * The data-boundary and safety layers are what stop the assistant from
 * inventing numbers when a question falls outside the data set — previously
 * the model happily answered questions about routes it has no data for.
 */
const SYSTEM_PROMPT = [
  '# 身份',
  '你是 Flight Agent 的智能数据分析助手，用简体中文回答。',
  '',
  '# 数据边界',
  '你只能依据 2009-01 至 2018-12 的美国境内航班延误数据作答。',
  '可用指标：抵达航班总数、延误 15 分钟以上航班数、取消航班数、备降航班数、总延误分钟数。',
  '可用维度：日期（年/月）、航司、到达机场。',
  '',
  '# 工具使用',
  '1. 需要真实业务数字时，必须调用工具获取，不得凭记忆或推测给出任何数字。',
  '2. 无法用现有工具回答的请求（超出数据范围、要求写入/下单/改数据），' +
    '不要调用任何工具，直接说明能力边界并给出可行的替代问法。',
  '3. 工具返回空结果时，如实说明该筛选条件下没有数据，不要编造或举例。',
  '4. 若需要多个角度才能回答，可以依次调用多个工具，再汇总结论。',
  '',
  '# 输出格式',
  '简洁、结构化，必要时使用 Markdown。',
  '工具已返回图表或表格时，正文只给一句结论，不要重复罗列全部数据。',
  '',
  '# 安全边界',
  '严禁编造航班号、起降时刻、机场名称或任何统计数字。',
  '严禁声称执行了订票、下单、修改、删除等操作：本系统只有只读查询能力。',
  '不确定时说明不确定，并向用户确认需要的筛选维度。',
].join('\n');

export interface ChatReply {
  sessionId: string;
  message: {
    id: string;
    role: ChatRole;
    type: ChatMessageType;
    content: string;
    payload: Record<string, unknown> | null;
    createdAt: string | null;
  };
  model: string;
  provider: string;
  /** `cache` when the answer came from `ai:chat_cache:`. */
  source: 'model' | 'cache';
  /** Name of the tool that produced the answer, when one matched. */
  tool: string | null;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** How the tool was selected: model function calling or keyword fallback. */
  routedBy?: 'model' | 'keyword' | 'chat';
}

/** Shape returned by the tool registry; reused by the routing helpers below. */
type ToolEnvelope = ToolResult<unknown>;

/** Max tools executed for one question — guards against runaway call loops. */
const MAX_TOOL_CALLS = 4;
/**
 * Max model↔tool round trips for one question. This is what turns the earlier
 * single-shot routing into real multi-step orchestration (compare two years,
 * then summarise) without pulling in a graph framework.
 */
const MAX_TOOL_ROUNDS = 3;
/** Characters of tool output fed back to the model when summarising. */
const MAX_TOOL_RESULT_CHARS = 4000;

/**
 * Questions that need more than one tool call (comparing two years, asking for
 * a number *and* a verdict) must reach the model even when a strong keyword
 * matched — otherwise the shortcut collapses them into a single answer, e.g.
 * "分别给我 2017 和 2018 的核心指标" returning only one year.
 */
const MULTI_STEP_PATTERN =
  /分别|各自|对比|比较|相比|并(告诉|说明|分析|比较|给出)|以及|两个|两年|多个|趋势|变化/;

interface AnswerOutcome {
  text: string;
  toolName: string | null;
  payload: Record<string, unknown> | null;
  type: ChatMessageType;
  usage?: ChatReply['usage'];
  routedBy?: 'model' | 'keyword' | 'chat';
}

/** Models occasionally emit malformed JSON; never fail the whole turn for it. */
function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mergeUsage(a?: ChatReply['usage'], b?: ChatReply['usage']): ChatReply['usage'] {
  if (!a) return b;
  if (!b) return a;
  return {
    promptTokens: (a.promptTokens ?? 0) + (b.promptTokens ?? 0),
    completionTokens: (a.completionTokens ?? 0) + (b.completionTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  };
}

@Injectable()
export class AiAgentService {
  constructor(
    private readonly config: ConfigService,
    private readonly sessions: AiChatSessionService,
    private readonly cache: AiCacheService,
    private readonly audit: AiOperationAuditService,
    private readonly tools: ToolRegistryService,
  ) {}

  /**
   * Resolve provider + model together.
   *
   * `LLM_MODEL` belongs to the *default* provider (e.g. `deepseek-chat` is not a
   * valid Qwen model), so it must not leak across providers.
   */
  private resolveTarget(overrideProvider?: string, overrideModel?: string): {
    id: LlmProviderId;
    model: string;
    provider: ReturnType<typeof createLlmProvider>;
  } {
    const defaultId = this.defaultProviderId();
    const raw = (overrideProvider ?? this.config.get<string>('LLM_PROVIDER') ?? 'deepseek').toLowerCase();
    const id: LlmProviderId = isLlmProviderId(raw) ? raw : 'deepseek';
    const provider = createLlmProvider(id, process.env);

    let model: string;
    if (overrideModel) {
      model = overrideModel;
    } else if (overrideProvider && id !== defaultId) {
      model = LLM_PROVIDERS[id].defaultModel;
    } else {
      model = this.config.get<string>('LLM_MODEL') || LLM_PROVIDERS[id].defaultModel;
    }
    return { id, model, provider };
  }

  private defaultProviderId(): LlmProviderId {
    const raw = (this.config.get<string>('LLM_PROVIDER') ?? 'deepseek').toLowerCase();
    return isLlmProviderId(raw) ? raw : 'deepseek';
  }

  async chat(
    dto: SendChatMessageDto,
    user: AuthUser,
    meta?: { ipAddress?: string | null; userAgent?: string | null },
  ): Promise<ChatReply> {
    const { id: providerId, model, provider } = this.resolveTarget(dto.provider, dto.model);
    const dimension = dto.dimension ?? 'default';
    const startedAt = Date.now();

    const sessionId = await this.sessions.resolveOrCreate(
      user,
      dto.sessionId,
      this.titleFrom(dto.content),
    );

    // Persist the user's turn first so a refresh never loses it.
    await this.sessions.appendMessage(user, sessionId, {
      role: 'user',
      messageType: 'text',
      content: dto.content,
      payload: dto.attachments?.length ? { attachments: dto.attachments } : null,
    });

    // Identical question from the same user? Reuse the cached answer.
    const cacheLookup = {
      tenantId: user.tenantId,
      userId: user.userId,
      question: dto.content,
      dimension,
      provider: providerId,
      model,
    };
    const cached = await this.cache.getChatCache<{
      content: string;
      payload: Record<string, unknown> | null;
      type: ChatMessageType;
    }>(cacheLookup);

    let replyText: string;
    let replyPayload: Record<string, unknown> | null = null;
    let replyType: ChatMessageType = 'text';
    let usage: ChatReply['usage'];
    let source: 'model' | 'cache' = 'model';
    let toolName: string | null = null;
    let routedBy: ChatReply['routedBy'];

    if (cached?.answer?.content) {
      replyText = cached.answer.content;
      replyPayload = cached.answer.payload ?? null;
      replyType = cached.answer.type ?? 'text';
      source = 'cache';
      logger.debug(`chat cache hit (${dimension}) for user ${user.userId}`);
    } else {
      // Short term memory: Redis first, PostgreSQL as the fallback source.
      const { context, source: ctxSource } = await this.cache.getOrLoadSessionContext(
        user.tenantId,
        sessionId,
        user.userId,
        () => this.sessions.loadRecentTurns(user, sessionId),
      );
      if (ctxSource === 'database') {
        logger.debug(`session ${sessionId} memory rebuilt from PostgreSQL`);
      }

      const history: LlmMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...context.turns.map((turn) => ({ role: turn.role, content: turn.content })),
      ];

      const outcome = await this.resolveAnswer({
        question: dto.content,
        history,
        provider,
        model,
        user,
        sessionId,
        meta,
      });

      toolName = outcome.toolName;
      replyText = outcome.text;
      replyPayload = outcome.payload;
      replyType = outcome.type;
      usage = outcome.usage;
      routedBy = outcome.routedBy;

      // Only successful answers are worth reusing.
      if (!replyText.startsWith('⚠️')) {
        await this.cache.setChatCache(cacheLookup, {
          content: replyText,
          payload: replyPayload,
          type: replyType,
        });
      }
    }

    const assistantMessage = await this.sessions.appendMessage(user, sessionId, {
      role: 'assistant',
      messageType: replyType,
      content: replyText,
      payload: replyPayload,
      tokenCount: usage?.totalTokens ?? null,
    });

    await this.audit.record(user, {
      action: 'chat.send',
      resourceType: 'session',
      resourceId: sessionId,
      operation: 'create',
      sessionId,
      requestPayload: { length: dto.content.length, dimension, source },
      responseSummary: { model, provider: providerId, source, tool: toolName },
      success: !replyText.startsWith('⚠️'),
      durationMs: Date.now() - startedAt,
    });

    return {
      sessionId,
      message: {
        id: assistantMessage.id,
        role: assistantMessage.role,
        type: assistantMessage.messageType,
        content: assistantMessage.content,
        payload: assistantMessage.payload ?? null,
        createdAt: assistantMessage.createdAt?.toISOString?.() ?? null,
      },
      model,
      provider: providerId,
      source,
      tool: toolName,
      usage,
      routedBy,
    };
  }

  /* ------------------------------ answer routing -------------------------- */

  /**
   * How a question reaches a tool:
   *  - `model`   : the model picks the tool via function calling (default)
   *  - `keyword` : legacy keyword scoring
   *  - `auto`    : model first, keyword only when the model is unreachable
   */
  private routingStrategy(): 'model' | 'keyword' | 'auto' {
    const raw = (this.config.get<string>('AI_TOOL_ROUTING') ?? 'auto').toLowerCase();
    return raw === 'model' || raw === 'keyword' ? raw : 'auto';
  }

  /**
   * Produces the assistant answer, choosing between tool execution and a plain
   * model reply.
   *
   * The important behavioural rule: **when the model is reachable and decides
   * not to call a tool, that decision wins.** Keyword routing is only a
   * fallback for an unreachable model — previously it ran first and happily
   * answered "帮我订机票" with 150,860 flight rows.
   */
  private async resolveAnswer(input: {
    question: string;
    history: LlmMessage[];
    provider: LlmProvider;
    model: string;
    user: AuthUser;
    sessionId: string;
    meta?: { ipAddress?: string | null; userAgent?: string | null };
  }): Promise<AnswerOutcome> {
    const strategy = this.routingStrategy();

    if (strategy === 'keyword') {
      const strong = this.tools.match(input.question);
      if (strong) {
        return this.runMatched(strong.name, strong.params, input, 'keyword');
      }
    } else if (strategy === 'auto' && !MULTI_STEP_PATTERN.test(input.question)) {
      // Unambiguous phrasing (条形图 / 气泡图 / 明细 …) never needs a model
      // round trip: identical accuracy, no tokens, far faster. Multi-step
      // questions deliberately skip this and go to the model instead.
      const strong = this.tools.matchStrong(input.question);
      if (strong) {
        return this.runMatched(strong.name, strong.params, input, 'keyword');
      }
    }

    if (strategy !== 'keyword') {
      try {
        const planned = await this.planWithModel(input);
        if (planned) return planned;
      } catch (error) {
        const message = error instanceof Error ? error.message : '模型调用失败';
        logger.warn(`model tool routing failed, falling back to keyword: ${message}`);
      }
    }

    // Last resort: full keyword scoring (model unreachable / unsupported).
    const match = this.tools.match(input.question);
    if (match) {
      return this.runMatched(match.name, match.params, input, 'keyword');
    }

    // No tool: plain conversational answer.
    try {
      const completion = await input.provider.complete({
        messages: input.history,
        model: input.model,
      });
      return {
        text: completion.content?.trim() || '（模型没有返回内容）',
        toolName: null,
        payload: null,
        type: 'text',
        usage: completion.usage,
        routedBy: 'chat',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型调用失败';
      return { text: `⚠️ ${message}`, toolName: null, payload: null, type: 'text', routedBy: 'chat' };
    }
  }

  /**
   * Asks the model (with tool specs) what to do.
   * Returns `null` only when function calling is unsupported, so the caller
   * falls back to keyword routing.
   */
  private async planWithModel(input: {
    question: string;
    history: LlmMessage[];
    provider: LlmProvider;
    model: string;
    user: AuthUser;
    sessionId: string;
    meta?: { ipAddress?: string | null; userAgent?: string | null };
  }): Promise<AnswerOutcome | null> {
    const specs = this.tools.toolSpecs();
    if (!specs.length) return null;

    const messages: LlmMessage[] = [...input.history];
    let usage: AnswerOutcome['usage'];
    /** Best successful result so far, kept so real data is never discarded. */
    let rendered: ToolEnvelope | null = null;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let completion: LlmCompletionResponse;
      try {
        completion = await input.provider.complete({
          messages,
          model: input.model,
          tools: specs,
          toolChoice: 'auto',
          // Tool selection wants determinism more than creativity.
          temperature: 0.1,
        });
      } catch (error) {
        // Tools may already have produced data worth showing.
        if (rendered) return { ...this.fromToolResult(rendered, 'model'), usage };
        throw error;
      }
      usage = mergeUsage(usage, completion.usage);

      if (completion.toolsUnsupported) {
        if (round === 0) {
          logger.warn('provider rejected the tools payload — using keyword routing');
          return null;
        }
        break;
      }

      const calls = completion.toolCalls ?? [];

      // The model chose to answer directly (often a refusal). Honour it.
      if (!calls.length) {
        return {
          text: completion.content?.trim() || '（模型没有返回内容）',
          toolName: rendered?.toolName ?? null,
          payload: rendered ? ({ ...rendered } as unknown as Record<string, unknown>) : null,
          type: rendered ? (rendered.resultType as ChatMessageType) : 'text',
          usage,
          routedBy: 'model',
        };
      }

      messages.push({ role: 'assistant', content: completion.content || '', toolCalls: calls });

      const executed: Array<{ id: string; name: string; result: ToolEnvelope }> = [];
      for (const call of calls.slice(0, MAX_TOOL_CALLS)) {
        const result = await this.tools.run(
          call.name,
          this.mergeParams(call.name, input.question, call.arguments),
          {
            user: input.user,
            sessionId: input.sessionId,
            ipAddress: input.meta?.ipAddress ?? null,
            userAgent: input.meta?.userAgent ?? null,
          },
        );
        executed.push({ id: call.id, name: call.name, result });
        if (result.code === 0 && !rendered) rendered = result;
        messages.push({
          role: 'tool',
          name: call.name,
          toolCallId: call.id,
          content: JSON.stringify({
            code: result.code,
            message: result.message,
            data: result.data,
          }).slice(0, MAX_TOOL_RESULT_CHARS),
        });
      }

      // A single successful tool on the first round already answers the
      // question — skip the summarising round trip entirely.
      if (round === 0 && executed.length === 1 && executed[0].result.code === 0) {
        return { ...this.fromToolResult(executed[0].result, 'model'), usage };
      }
      // Otherwise loop: the model sees the results and may call again.
    }

    // Round budget spent. Force one text-only call so the model summarises
    // what it gathered instead of looping forever after data it cannot get.
    if (rendered) {
      try {
        const final = await input.provider.complete({ messages, model: input.model });
        return {
          text: final.content?.trim() || rendered.message,
          toolName: rendered.toolName,
          payload: { ...rendered } as unknown as Record<string, unknown>,
          type: rendered.resultType as ChatMessageType,
          usage: mergeUsage(usage, final.usage),
          routedBy: 'model',
        };
      } catch {
        return { ...this.fromToolResult(rendered, 'model'), usage };
      }
    }
    return {
      text: '⚠️ 工具调用轮次已达上限，请简化问题后重试',
      toolName: null,
      payload: null,
      type: 'text',
      usage,
      routedBy: 'model',
    };
  }

  /** Kept out of the new loop: the round logic now handles summarisation. */

  /** Executes a keyword-selected tool with the shared execution context. */
  private async runMatched(
    name: string,
    params: Record<string, unknown>,
    input: { user: AuthUser; sessionId: string; meta?: { ipAddress?: string | null; userAgent?: string | null } },
    routedBy: 'model' | 'keyword',
  ): Promise<AnswerOutcome> {
    const result = await this.tools.run(name, params, {
      user: input.user,
      sessionId: input.sessionId,
      ipAddress: input.meta?.ipAddress ?? null,
      userAgent: input.meta?.userAgent ?? null,
    });
    return this.fromToolResult(result, routedBy);
  }

  /**
   * Model arguments win; rule-based extraction fills the gaps.
   *
   * Function calling reliably picks *which* tool to use but often omits
   * optional arguments (it left `dimension` unset, collapsing a "by airline"
   * question into a single bucket). The deterministic extractor has the
   * opposite profile, so merging them gets the strengths of both.
   */
  private mergeParams(
    toolName: string,
    question: string,
    rawArgs: string,
  ): Record<string, unknown> {
    const fromModel = parseToolArguments(rawArgs);
    const tool = this.tools.findByName(toolName);
    // `BaseTool` is stored with `never` params, so narrow the result here.
    const extracted = tool?.extractParams?.(question) as
      | Record<string, unknown>
      | null
      | undefined;
    if (!extracted) return fromModel;
    return { ...extracted, ...fromModel };
  }

  private fromToolResult(
    result: ToolEnvelope,
    routedBy: 'model' | 'keyword' = 'model',
  ): AnswerOutcome {
    return {
      text: result.code === 0 ? result.message : `⚠️ ${result.message}`,
      toolName: result.toolName,
      // The whole envelope (resultType + data + pagination) travels to the UI.
      payload: { ...result } as unknown as Record<string, unknown>,
      type: result.code === 0 ? (result.resultType as ChatMessageType) : 'text',
      routedBy,
    };
  }

  /** Append a pre-rendered message (table / chart / report / confirm payloads). */
  async appendMessage(user: AuthUser, sessionId: string, dto: AppendMessageDto) {
    const saved = await this.sessions.appendMessage(user, sessionId, {
      role: dto.role,
      messageType: normalizeMessageType(dto.type),
      content: dto.content,
      payload: dto.payload ?? null,
    });
    await this.sessions.touch(sessionId);
    return saved.toJSON();
  }

  private titleFrom(content: string): string {
    const trimmed = content.trim().replace(/\s+/g, ' ');
    return trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed || '新对话';
  }
}
