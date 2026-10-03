import type { LlmProviderConfig, LlmProviderId } from './llm.types.js';

/**
 * Provider registry. Every entry is OpenAI-compatible so the same transport
 * works everywhere; add a provider by adding one row here (plus its key in .env).
 */
export const LLM_PROVIDERS: Record<LlmProviderId, LlmProviderConfig> = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
  },
  qwen: {
    // DashScope "compatible-mode" endpoint speaks the OpenAI protocol.
    id: 'qwen',
    label: '通义千问 Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI GPT',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
  kimi: {
    // Moonshot AI — the company behind Kimi.
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'KIMI_API_KEY',
    defaultModel: 'moonshot-v1-8k',
  },
  local: {
    // LM Studio / vLLM / Ollama (OpenAI-compatible mode). No key required.
    id: 'local',
    label: '本地模型 (OpenAI 兼容)',
    baseUrl: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
  },
};

/** Extra env vars tried for a provider when the primary one is unset. */
const API_KEY_FALLBACKS: Partial<Record<LlmProviderId, string[]>> = {
  kimi: ['MOONSHOT_API_KEY'],
};

export function resolveProviderConfig(
  id: LlmProviderId,
  env: Record<string, string | undefined>,
): LlmProviderConfig {
  const base = LLM_PROVIDERS[id];
  if (!base) throw new Error(`未知的 LLM provider: ${id}`);

  // A local deployment may point anywhere, so allow overriding the base URL.
  if (id === 'local' && env.LOCAL_LLM_BASE_URL) {
    return { ...base, baseUrl: env.LOCAL_LLM_BASE_URL };
  }
  return base;
}

export function resolveApiKey(
  id: LlmProviderId,
  env: Record<string, string | undefined>,
): string | undefined {
  const config = LLM_PROVIDERS[id];
  if (!config?.apiKeyEnv) return undefined;
  const direct = env[config.apiKeyEnv];
  if (direct) return direct;
  for (const fallback of API_KEY_FALLBACKS[id] ?? []) {
    if (env[fallback]) return env[fallback];
  }
  return undefined;
}
