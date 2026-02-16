import { ToolingOptions } from '../types';

interface ModelPricing {
  provider: string;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const TOKENS_PER_CHAR_ESTIMATE = 4;
const TOKENS_PER_MESSAGE_OVERHEAD = 4;
const TOKENS_REPLY_PRIMER = 2;

const TOOLING_SURCHARGE_BY_PROVIDER = {
  openai: {
    webSearchUsdPerRequest: 0.01,
    codeExecutionUsdPerRequest: 0.03,
  },
  anthropic: {
    webSearchUsdPerRequest: 0.01,
    codeExecutionUsdPerRequest: 0.0042,
  },
  google: {
    webSearchUsdPerRequest: 0.014,
    codeExecutionUsdPerRequest: 0,
  },
  openrouter: {
    webSearchUsdPerRequest: 0.02,
    codeExecutionUsdPerRequest: 0,
  },
  groq: {
    webSearchUsdPerRequest: 0,
    codeExecutionUsdPerRequest: 0,
  },
} as const;

const MODEL_PRICING: ModelPricing[] = [
  { provider: 'anthropic', model: 'claude-opus-4-6', inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  { provider: 'anthropic', model: 'claude-sonnet-4-5', inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  { provider: 'anthropic', model: 'claude-haiku-4-5', inputPerMillionUsd: 1, outputPerMillionUsd: 5 },

  { provider: 'google', model: 'gemini-3-pro-preview', inputPerMillionUsd: 2, outputPerMillionUsd: 12 },
  { provider: 'google', model: 'gemini-3-flash-preview', inputPerMillionUsd: 0.5, outputPerMillionUsd: 3 },
  { provider: 'google', model: 'gemini-2.5-flash-lite', inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },

  { provider: 'groq', model: 'meta-llama/llama-4-maverick-17b-128e-instruct', inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.6 },
  { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', inputPerMillionUsd: 0.11, outputPerMillionUsd: 0.34 },
  { provider: 'groq', model: 'moonshotai/kimi-k2-instruct-0905', inputPerMillionUsd: 1, outputPerMillionUsd: 3 },
  { provider: 'groq', model: 'qwen/qwen3-32b', inputPerMillionUsd: 0.29, outputPerMillionUsd: 0.59 },

  { provider: 'openai', model: 'gpt-5.2', inputPerMillionUsd: 1.75, outputPerMillionUsd: 14 },

  { provider: 'openrouter', model: 'z-ai/glm-5', inputPerMillionUsd: 1, outputPerMillionUsd: 3.2 },
  { provider: 'openrouter', model: 'anthropic/claude-opus-4.6', inputPerMillionUsd: 5, outputPerMillionUsd: 25 },
  { provider: 'openrouter', model: 'moonshotai/kimi-k2.5', inputPerMillionUsd: 0.45, outputPerMillionUsd: 2.25 },
  { provider: 'openrouter', model: 'google/gemini-3-flash-preview', inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.5 },
  { provider: 'openrouter', model: 'deepseek/deepseek-v3.2', inputPerMillionUsd: 0.27, outputPerMillionUsd: 0.41 },
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  { provider: 'openrouter', model: 'x-ai/grok-4.1-fast', inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.5 },
  { provider: 'openrouter', model: 'minimax/minimax-m2.1', inputPerMillionUsd: 0.25, outputPerMillionUsd: 2 },
  { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 },
  { provider: 'openrouter', model: 'openai/gpt-5-nano', inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4 },
  { provider: 'openrouter', model: 'openai/gpt-oss-120b', inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.75 },
  { provider: 'openrouter', model: 'google/gemini-3-pro-preview', inputPerMillionUsd: 2, outputPerMillionUsd: 12 },
  { provider: 'openrouter', model: 'openai/gpt-5-mini', inputPerMillionUsd: 0.25, outputPerMillionUsd: 2 },
  { provider: 'openrouter', model: 'mistralai/mistral-nemo', inputPerMillionUsd: 0.02, outputPerMillionUsd: 0.04 },
  { provider: 'openrouter', model: 'openai/gpt-4o', inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  { provider: 'openrouter', model: 'google/gemma-3-27b-it', inputPerMillionUsd: 0.04, outputPerMillionUsd: 0.15 },
  { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', inputPerMillionUsd: 1, outputPerMillionUsd: 5 },
  { provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507', inputPerMillionUsd: 0.13, outputPerMillionUsd: 0.6 },
];

const pricingLookup = new Map<string, ModelPricing>(
  MODEL_PRICING.map((entry) => [`${entry.provider}:${entry.model}`, entry])
);

const getModelPricing = (provider: string, model: string): ModelPricing | undefined =>
  pricingLookup.get(`${provider}:${model}`);

export const estimateTextTokens = (text: string): number => {
  const normalized = (text || '').trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / TOKENS_PER_CHAR_ESTIMATE));
};

export const estimateInputTokens = (
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string
): number => {
  let tokens = TOKENS_REPLY_PRIMER;

  if (systemPrompt && systemPrompt.trim()) {
    tokens += estimateTextTokens(systemPrompt) + TOKENS_PER_MESSAGE_OVERHEAD;
  }

  for (const message of messages) {
    tokens += estimateTextTokens(message.content || '') + TOKENS_PER_MESSAGE_OVERHEAD;
  }

  return tokens;
};

export const estimateToolingSurchargeUsd = (provider: string, model: string, tooling?: ToolingOptions): number => {
  if (!tooling?.webSearch && !tooling?.codeExecution) return 0;

  const providerSurcharge = TOOLING_SURCHARGE_BY_PROVIDER[provider as keyof typeof TOOLING_SURCHARGE_BY_PROVIDER];
  if (!providerSurcharge) return 0;

  let webSearchSurcharge = 0;
  if (tooling.webSearch) {
    webSearchSurcharge = providerSurcharge.webSearchUsdPerRequest;
    if (provider === 'google' && model.includes('gemini-2.5')) {
      webSearchSurcharge = 0.035;
    }
  }

  const codeExecutionSurcharge = tooling.codeExecution ? providerSurcharge.codeExecutionUsdPerRequest : 0;
  return webSearchSurcharge + codeExecutionSurcharge;
};

export const estimateCostUsd = (
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  tooling?: ToolingOptions
): { totalCostUsd: number; hasPricing: boolean } => {
  const pricing = getModelPricing(provider, model);
  const toolingCostUsd = estimateToolingSurchargeUsd(provider, model, tooling);
  if (!pricing) {
    return {
      totalCostUsd: toolingCostUsd,
      hasPricing: false,
    };
  }

  const inputCostUsd = (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCostUsd = (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPerMillionUsd;

  return {
    totalCostUsd: inputCostUsd + outputCostUsd + toolingCostUsd,
    hasPricing: true,
  };
};
