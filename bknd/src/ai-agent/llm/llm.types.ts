/**
 * Shared contracts for the multi-model adapter layer.
 *
 * Every provider we support (DeepSeek, Qwen/DashScope, OpenAI, Kimi/Moonshot and
 * a local OpenAI-compatible server) speaks the OpenAI *chat completions*
 * protocol, so a single transport implementation covers all of them; only the
 * base URL, API key and default model differ.
 */

export const LLM_PROVIDER_IDS = ['deepseek', 'qwen', 'openai', 'kimi', 'local'] as const;
export type LlmProviderId = (typeof LLM_PROVIDER_IDS)[number];

export function isLlmProviderId(value: string): value is LlmProviderId {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LlmMessage {
  role: LlmRole;
  content: string;
  /** Required when `role` is `tool`: the id of the call this answers. */
  toolCallId?: string;
  /** Tool name, for `role: 'tool'` messages. */
  name?: string;
  /** Present when an assistant message requests tool calls (multi-step turns). */
  toolCalls?: LlmToolCall[];
}

/**
 * A tool exposed to the model in the OpenAI function-calling shape.
 * Built from `ToolDefinition` so keywords and schema never disagree.
 */
export interface LlmToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
  };
}

/** A tool invocation requested by the model. */
export interface LlmToolCall {
  id: string;
  name: string;
  /** Raw JSON string produced by the model; parsed by the caller. */
  arguments: string;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  /** Overrides the provider default model for a single call. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Tools the model may call. Omit to get a plain text answer. */
  tools?: LlmToolSpec[];
  /** `auto` (default) lets the model decide, `none` forbids calls. */
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface LlmCompletionResponse {
  content: string;
  /** Model that actually served the request. */
  model: string;
  provider: LlmProviderId;
  usage?: LlmUsage;
  /** Present when the model asked for one or more tool calls. */
  toolCalls?: LlmToolCall[];
  /**
   * `true` when the provider ignored the `tools` payload (some local servers
   * do). The caller falls back to keyword routing instead of trusting an
   * empty tool-call list.
   */
  toolsUnsupported?: boolean;
}

export interface LlmProviderConfig {
  id: LlmProviderId;
  label: string;
  baseUrl: string;
  /** Environment variable holding the API key (empty for keyless local servers). */
  apiKeyEnv?: string;
  defaultModel: string;
}

export interface LlmProvider {
  readonly config: LlmProviderConfig;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}
