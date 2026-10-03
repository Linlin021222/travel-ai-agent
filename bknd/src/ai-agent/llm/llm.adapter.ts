import { LLM_PROVIDERS } from './llm.config.js';
import type {
  LlmCompletionRequest,
  LlmCompletionResponse,
  LlmProvider,
  LlmProviderConfig,
  LlmProviderId,
} from './llm.types.js';

interface ChatCompletionsMessage {
  content?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string | null };
  }>;
}

interface ChatCompletionsPayload {
  choices?: Array<{ message?: ChatCompletionsMessage; text?: string }>;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
}

/** Messages are sent in OpenAI wire format; only tool turns carry extra fields. */
function toWireMessages(messages: LlmCompletionRequest['messages']) {
  return messages.map((m) => {
    const base: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.role === 'tool' && m.toolCallId) base.tool_call_id = m.toolCallId;
    if (m.name) base.name = m.name;
    if (m.toolCalls?.length) {
      base.tool_calls = m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.arguments },
      }));
    }
    return base;
  });
}

/**
 * Servers that do not implement function calling reject the `tools` field
 * with 400 (or 404/422). Those are worth retrying without it.
 */
function isToolsRejection(status: number, detail: string): boolean {
  if (![400, 404, 415, 422].includes(status)) return false;
  return /tool|function|schema/i.test(detail ?? '');
}

/**
 * One OpenAI-compatible transport shared by every provider.
 * Handles auth headers, timeouts, error surfacing and response normalisation.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(
    readonly config: LlmProviderConfig,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs = 60_000,
  ) {}

  /** One round trip. Reads the body once as text so errors stay inspectable. */
  private async call(
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; status: number; payload: ChatCompletionsPayload | null; detail: string }> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    const text = await response.text().catch(() => '');
    let payload: ChatCompletionsPayload | null = null;
    try {
      payload = text ? (JSON.parse(text) as ChatCompletionsPayload) : null;
    } catch {
      payload = null;
    }
    const detail = payload?.error?.message ?? text.slice(0, 300);
    return { ok: response.ok, status: response.status, payload, detail };
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const model = request.model || this.config.defaultModel;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    // Forward caller cancellation too.
    const onAbort = () => controller.abort();
    request.signal?.addEventListener('abort', onAbort);

    try {
      const base: Record<string, unknown> = {
        model,
        messages: toWireMessages(request.messages),
        temperature: request.temperature ?? 0.3,
        ...(request.maxTokens ? { max_tokens: request.maxTokens } : {}),
        stream: false,
      };

      const wantsTools = Boolean(request.tools?.length);
      let result = await this.call(
        wantsTools
          ? { ...base, tools: request.tools, tool_choice: request.toolChoice ?? 'auto' }
          : base,
        controller.signal,
      );

      // Some servers reject the `tools` field outright; retry without it so a
      // model-driven caller can fall back to keyword routing instead of failing.
      let toolsUnsupported = false;
      if (!result.ok && wantsTools && isToolsRejection(result.status, result.detail)) {
        toolsUnsupported = true;
        result = await this.call(base, controller.signal);
      }

      if (!result.ok) {
        throw new Error(
          `${this.config.label} 调用失败 (${result.status}): ${result.detail || '未知错误'}`,
        );
      }

      const message = result.payload?.choices?.[0]?.message;
      const content = message?.content ?? '';
      const rawCalls = message?.tool_calls ?? [];
      const toolCalls = rawCalls
        .filter((c): c is NonNullable<typeof c> & { function: { name: string } } =>
          Boolean(c?.function?.name),
        )
        .map((c, index) => ({
          id: c.id ?? `call_${index}`,
          name: c.function.name as string,
          arguments: c.function.arguments ?? '{}',
        }));

      return {
        content,
        model: result.payload?.model ?? model,
        provider: this.config.id,
        usage: result.payload?.usage
          ? {
              promptTokens: result.payload.usage.prompt_tokens,
              completionTokens: result.payload.usage.completion_tokens,
              totalTokens: result.payload.usage.total_tokens,
            }
          : undefined,
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(toolsUnsupported ? { toolsUnsupported: true } : {}),
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`${this.config.label} 调用超时（>${this.timeoutMs / 1000}s）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Build the provider selected by configuration. */
export function createLlmProvider(
  providerId: LlmProviderId,
  env: Record<string, string | undefined>,
): LlmProvider {
  const config = LLM_PROVIDERS[providerId];
  const apiKey = config.apiKeyEnv ? env[config.apiKeyEnv] : undefined;

  if (config.apiKeyEnv && !apiKey) {
    throw new Error(
      `未配置 ${config.apiKeyEnv}，无法使用 ${config.label}。请在 bknd/.env 中填写，或切换 LLM_PROVIDER。`,
    );
  }
  return new OpenAiCompatibleProvider(config, apiKey);
}
