import {
  ManualModelPricingOverride,
  ModelOption,
  ToolingOptions,
  UsageAggregate,
  UsageAggregationPeriod,
  UsageBucket,
  UsageCostEvent,
  UsageEventSource,
} from '../types';

export interface ModelPricing {
  provider: string;
  model: string;
  modelName: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  sourceUrl: string;
  sourceLabel: string;
  note?: string;
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

export const PRICING_LAST_UPDATED = '2026-02-12';

export const PRICING_SOURCE_INDEX: Array<{ label: string; url: string }> = [
  { label: 'OpenAI Pricing', url: 'https://platform.openai.com/pricing' },
  { label: 'Anthropic Pricing', url: 'https://www.anthropic.com/pricing' },
  { label: 'Google AI Pricing', url: 'https://ai.google.dev/gemini-api/docs/pricing' },
  { label: 'Groq Pricing', url: 'https://groq.com/pricing/' },
  { label: 'OpenRouter Models API', url: 'https://openrouter.ai/api/v1/models' },
];

export const MODEL_PRICING: ModelPricing[] = [
  { provider: 'anthropic', model: 'claude-opus-4-6', modelName: 'Claude Opus 4.6', inputPerMillionUsd: 5, outputPerMillionUsd: 25, sourceUrl: 'https://www.anthropic.com/pricing', sourceLabel: 'Anthropic Pricing' },
  { provider: 'anthropic', model: 'claude-sonnet-4-5', modelName: 'Claude Sonnet 4.5', inputPerMillionUsd: 3, outputPerMillionUsd: 15, sourceUrl: 'https://www.anthropic.com/pricing', sourceLabel: 'Anthropic Pricing' },
  { provider: 'anthropic', model: 'claude-haiku-4-5', modelName: 'Claude Haiku 4.5', inputPerMillionUsd: 1, outputPerMillionUsd: 5, sourceUrl: 'https://www.anthropic.com/pricing', sourceLabel: 'Anthropic Pricing' },

  { provider: 'google', model: 'gemini-3-pro-preview', modelName: 'Gemini 3 Pro Preview', inputPerMillionUsd: 2, outputPerMillionUsd: 12, sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', sourceLabel: 'Google AI Pricing', note: 'Tarifa base para prompts <= 200K tokens.' },
  { provider: 'google', model: 'gemini-3-flash-preview', modelName: 'Gemini 3 Flash Preview', inputPerMillionUsd: 0.5, outputPerMillionUsd: 3, sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', sourceLabel: 'Google AI Pricing', note: 'Tarifa base para prompts <= 200K tokens.' },
  { provider: 'google', model: 'gemini-2.5-flash-lite', modelName: 'Gemini 2.5 Flash Lite', inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4, sourceUrl: 'https://ai.google.dev/gemini-api/docs/pricing', sourceLabel: 'Google AI Pricing', note: 'Tarifa base para prompts <= 200K tokens.' },

  { provider: 'groq', model: 'meta-llama/llama-4-maverick-17b-128e-instruct', modelName: 'Llama 4 Maverick 17B 128E Instruct', inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.6, sourceUrl: 'https://groq.com/pricing/', sourceLabel: 'Groq Pricing' },
  { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct', modelName: 'Llama 4 Scout 17B 16E Instruct', inputPerMillionUsd: 0.11, outputPerMillionUsd: 0.34, sourceUrl: 'https://groq.com/pricing/', sourceLabel: 'Groq Pricing' },
  { provider: 'groq', model: 'moonshotai/kimi-k2-instruct-0905', modelName: 'Kimi K2 Instruct 0905', inputPerMillionUsd: 1, outputPerMillionUsd: 3, sourceUrl: 'https://groq.com/pricing/', sourceLabel: 'Groq Pricing' },
  { provider: 'groq', model: 'qwen/qwen3-32b', modelName: 'Qwen3 32B', inputPerMillionUsd: 0.29, outputPerMillionUsd: 0.59, sourceUrl: 'https://groq.com/pricing/', sourceLabel: 'Groq Pricing' },

  { provider: 'openai', model: 'gpt-5.2', modelName: 'GPT-5.2', inputPerMillionUsd: 1.75, outputPerMillionUsd: 14, sourceUrl: 'https://platform.openai.com/pricing', sourceLabel: 'OpenAI Pricing' },

  { provider: 'openrouter', model: 'z-ai/glm-5', modelName: 'GLM-5', inputPerMillionUsd: 1, outputPerMillionUsd: 3.2, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'anthropic/claude-opus-4.6', modelName: 'Claude Opus 4.6', inputPerMillionUsd: 5, outputPerMillionUsd: 25, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'moonshotai/kimi-k2.5', modelName: 'Kimi K2.5', inputPerMillionUsd: 0.45, outputPerMillionUsd: 2.25, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'google/gemini-3-flash-preview', modelName: 'Gemini 3 Flash Preview', inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.5, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'deepseek/deepseek-v3.2', modelName: 'DeepSeek V3.2', inputPerMillionUsd: 0.27, outputPerMillionUsd: 0.41, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5', modelName: 'Claude Sonnet 4.5', inputPerMillionUsd: 3, outputPerMillionUsd: 15, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'x-ai/grok-4.1-fast', modelName: 'Grok 4.1 Fast', inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.5, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'minimax/minimax-m2.1', modelName: 'MiniMax M2.1', inputPerMillionUsd: 0.25, outputPerMillionUsd: 2, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', modelName: 'Gemini 2.5 Flash Lite', inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'openai/gpt-5-nano', modelName: 'GPT-5 Nano', inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.4, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'openai/gpt-oss-120b', modelName: 'GPT-OSS 120B', inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.75, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'google/gemini-3-pro-preview', modelName: 'Gemini 3 Pro Preview', inputPerMillionUsd: 2, outputPerMillionUsd: 12, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'openai/gpt-5-mini', modelName: 'GPT-5 Mini', inputPerMillionUsd: 0.25, outputPerMillionUsd: 2, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'mistralai/mistral-nemo', modelName: 'Mistral Nemo', inputPerMillionUsd: 0.02, outputPerMillionUsd: 0.04, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'openai/gpt-4o', modelName: 'GPT-4o', inputPerMillionUsd: 2.5, outputPerMillionUsd: 10, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'google/gemma-3-27b-it', modelName: 'Gemma 3 27B IT', inputPerMillionUsd: 0.04, outputPerMillionUsd: 0.15, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5', modelName: 'Claude Haiku 4.5', inputPerMillionUsd: 1, outputPerMillionUsd: 5, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
  { provider: 'openrouter', model: 'qwen/qwen3-235b-a22b-2507', modelName: 'Qwen3 235B A22B 2507', inputPerMillionUsd: 0.13, outputPerMillionUsd: 0.6, sourceUrl: 'https://openrouter.ai/api/v1/models', sourceLabel: 'OpenRouter Models API' },
];

const pricingLookup = new Map<string, ModelPricing>(
  MODEL_PRICING.map((entry) => [`${entry.provider}:${entry.model}`, entry])
);
const runtimePricingLookup = new Map<string, ModelPricing>();
const manualPricingLookup = new Map<string, ModelPricing>();

const pricingKey = (provider: string, model: string): string => `${provider}:${model}`;

export function syncRuntimeModelPricingForProvider(provider: string, models: ModelOption[]): void {
  for (const key of Array.from(runtimePricingLookup.keys())) {
    if (key.startsWith(`${provider}:`)) {
      runtimePricingLookup.delete(key);
    }
  }

  models.forEach((model) => {
    if (!model?.id || typeof model.id !== 'string') return;
    if (!Number.isFinite(model.inputPerMillionUsd) || !Number.isFinite(model.outputPerMillionUsd)) return;

    runtimePricingLookup.set(pricingKey(provider, model.id), {
      provider,
      model: model.id,
      modelName: model.name || model.id,
      inputPerMillionUsd: Math.max(0, Number(model.inputPerMillionUsd)),
      outputPerMillionUsd: Math.max(0, Number(model.outputPerMillionUsd)),
      sourceUrl: model.pricingSourceUrl || '',
      sourceLabel: model.pricingSourceLabel || 'Live Provider API',
      note: 'Runtime pricing from provider API.',
    });
  });
}

export function syncManualModelPricingOverrides(
  overrides: Record<string, ManualModelPricingOverride>
): void {
  manualPricingLookup.clear();

  Object.entries(overrides).forEach(([key, value]) => {
    if (!value || typeof value !== 'object') return;
    const separatorIndex = key.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex >= key.length - 1) return;

    const provider = key.slice(0, separatorIndex);
    const model = key.slice(separatorIndex + 1);
    const inputPerMillionUsd = Number(value.inputPerMillionUsd);
    const outputPerMillionUsd = Number(value.outputPerMillionUsd);
    if (!Number.isFinite(inputPerMillionUsd) || inputPerMillionUsd < 0) return;
    if (!Number.isFinite(outputPerMillionUsd) || outputPerMillionUsd < 0) return;

    manualPricingLookup.set(key, {
      provider,
      model,
      modelName: model,
      inputPerMillionUsd: inputPerMillionUsd,
      outputPerMillionUsd: outputPerMillionUsd,
      sourceUrl: '',
      sourceLabel: 'Manual override',
      note: 'User-provided pricing.',
    });
  });
}

export function getModelPricing(provider: string, model: string): ModelPricing | undefined {
  const key = pricingKey(provider, model);
  return manualPricingLookup.get(key) || runtimePricingLookup.get(key) || pricingLookup.get(key);
}

export function estimateTextTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / TOKENS_PER_CHAR_ESTIMATE));
}

export function estimateInputTokens(
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string
): number {
  let tokens = TOKENS_REPLY_PRIMER;

  if (systemPrompt && systemPrompt.trim()) {
    tokens += estimateTextTokens(systemPrompt) + TOKENS_PER_MESSAGE_OVERHEAD;
  }

  for (const msg of messages) {
    tokens += estimateTextTokens(msg.content || '') + TOKENS_PER_MESSAGE_OVERHEAD;
  }

  return tokens;
}

export function estimateCostUsd(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  tooling?: ToolingOptions
): { inputCostUsd: number; outputCostUsd: number; toolingCostUsd: number; totalCostUsd: number; hasPricing: boolean } {
  const pricing = getModelPricing(provider, model);
  const toolingCostUsd = estimateToolingSurchargeUsd(provider, model, tooling);
  if (!pricing) {
    return {
      inputCostUsd: 0,
      outputCostUsd: 0,
      toolingCostUsd,
      totalCostUsd: toolingCostUsd,
      hasPricing: false,
    };
  }

  const inputCostUsd = (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPerMillionUsd;
  const outputCostUsd = (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPerMillionUsd;
  return {
    inputCostUsd,
    outputCostUsd,
    toolingCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd + toolingCostUsd,
    hasPricing: true,
  };
}

export function estimateToolingSurchargeUsd(provider: string, model: string, tooling?: ToolingOptions): number {
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
}

export function buildUsageCostEvent(params: {
  provider: string;
  model: string;
  conversationId?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  apiKeyMasked?: string;
  inputTokens: number;
  outputTokens: number;
  tooling?: ToolingOptions;
  source: UsageEventSource;
  timestamp?: number;
}): UsageCostEvent {
  const timestamp = params.timestamp ?? Date.now();
  const tooling = {
    webSearch: params.tooling?.webSearch === true,
    codeExecution: params.tooling?.codeExecution === true,
  };
  const cost = estimateCostUsd(params.provider, params.model, params.inputTokens, params.outputTokens, tooling);

  return {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
    timestamp,
    conversationId: typeof params.conversationId === 'string' && params.conversationId.trim()
      ? params.conversationId
      : undefined,
    provider: params.provider,
    model: params.model,
    apiKeyId: params.apiKeyId,
    apiKeyName: params.apiKeyName,
    apiKeyMasked: params.apiKeyMasked,
    inputTokens: Math.max(0, Math.round(params.inputTokens)),
    outputTokens: Math.max(0, Math.round(params.outputTokens)),
    inputCostUsd: cost.inputCostUsd,
    outputCostUsd: cost.outputCostUsd,
    totalCostUsd: cost.totalCostUsd,
    toolingCostUsd: cost.toolingCostUsd,
    toolWebSearchEnabled: tooling.webSearch,
    toolCodeExecutionEnabled: tooling.codeExecution,
    source: params.source,
    estimated: true,
  };
}

export function summarizeUsage(events: UsageCostEvent[]): UsageAggregate {
  return events.reduce<UsageAggregate>(
    (acc, event) => {
      acc.inputTokens += event.inputTokens;
      acc.outputTokens += event.outputTokens;
      acc.totalTokens += event.inputTokens + event.outputTokens;
      acc.totalCostUsd += event.totalCostUsd;
      acc.calls += 1;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      calls: 0,
    }
  );
}

function toBucketKey(date: Date, period: UsageAggregationPeriod): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const isoWeek = getIsoWeekData(date);

  if (period === 'year') return `${year}`;
  if (period === 'week') return `${isoWeek.year}-W${String(isoWeek.week).padStart(2, '0')}`;
  if (period === 'month') return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

function getIsoWeekData(date: Date): { year: number; week: number } {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return { year: utcDate.getUTCFullYear(), week };
}

function toBucketLabel(date: Date, period: UsageAggregationPeriod, locale: string): string {
  if (period === 'year') return String(date.getFullYear());
  if (period === 'week') {
    const { year, week } = getIsoWeekData(date);
    const prefix = locale.toLowerCase().startsWith('es') ? 'Sem' : 'Wk';
    return `${prefix} ${week} · ${String(year).slice(-2)}`;
  }
  if (period === 'month') return date.toLocaleDateString(locale, { month: 'short', year: '2-digit' });
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export function aggregateUsageByPeriod(
  events: UsageCostEvent[],
  period: UsageAggregationPeriod,
  locale: string,
  limit?: number
): UsageBucket[] {
  const defaultLimit = period === 'day' ? 14 : period === 'week' ? 12 : period === 'month' ? 12 : 6;
  const maxBuckets = limit ?? defaultLimit;

  const buckets = new Map<string, UsageBucket>();

  for (const event of events) {
    const date = new Date(event.timestamp);
    const key = toBucketKey(date, period);
    const label = toBucketLabel(date, period, locale);
    const current = buckets.get(key) ?? {
      key,
      label,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      calls: 0,
    };

    current.inputTokens += event.inputTokens;
    current.outputTokens += event.outputTokens;
    current.totalTokens += event.inputTokens + event.outputTokens;
    current.totalCostUsd += event.totalCostUsd;
    current.calls += 1;
    buckets.set(key, current);
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(-maxBuckets);
}

export function aggregateUsageByModel(events: UsageCostEvent[]): Array<UsageAggregate & { provider: string; model: string }> {
  const grouped = new Map<string, UsageAggregate & { provider: string; model: string }>();

  for (const event of events) {
    const key = `${event.provider}:${event.model}`;
    const current = grouped.get(key) ?? {
      provider: event.provider,
      model: event.model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      calls: 0,
    };

    current.inputTokens += event.inputTokens;
    current.outputTokens += event.outputTokens;
    current.totalTokens += event.inputTokens + event.outputTokens;
    current.totalCostUsd += event.totalCostUsd;
    current.calls += 1;
    grouped.set(key, current);
  }

  return Array.from(grouped.values()).sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}
