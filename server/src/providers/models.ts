import { getApiKey, getProviderBaseUrl, providerRequiresApiKey } from '../config';
import { Provider } from '../types';
import { getOpenRouterApiKeyError, normalizeOpenRouterApiKey } from './openrouterAuth';

export interface ProviderModelInfo {
  id: string;
  name: string;
  description?: string;
  vendor?: string;
  contextLength?: number;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
  pricingSourceUrl?: string;
  pricingSourceLabel?: string;
  pricingUpdatedAt?: number;
}

export interface ProviderModelCatalogResult {
  provider: Provider;
  models: ProviderModelInfo[];
  source: 'live' | 'fallback';
  fetchedAt: number;
  requiresApiKey: boolean;
  configured: boolean;
  error?: string;
}

const CACHE_TTL_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12_000;
const OPENROUTER_MODELS_API_URL = 'https://openrouter.ai/api/v1/models';
const OPENROUTER_MODELS_API_LABEL = 'OpenRouter Models API';
const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  groq: 'Groq',
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
};

const FALLBACK_MODELS: Record<Provider, ProviderModelInfo[]> = {
  anthropic: [
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', vendor: 'anthropic' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', vendor: 'anthropic' },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', vendor: 'anthropic' },
  ],
  google: [
    { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', vendor: 'google' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', vendor: 'google' },
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', vendor: 'google' },
  ],
  groq: [
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B 128E Instruct', vendor: 'meta-llama' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B 16E Instruct', vendor: 'meta-llama' },
    { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 Instruct 0905', vendor: 'moonshotai' },
    { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', vendor: 'qwen' },
  ],
  lmstudio: [],
  ollama: [],
  openai: [
    { id: 'gpt-5.2', name: 'GPT-5.2', vendor: 'openai' },
  ],
  openrouter: [
    { id: 'z-ai/glm-5', name: 'GLM-5', vendor: 'z-ai' },
    { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', vendor: 'anthropic' },
    { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', vendor: 'moonshotai' },
    { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', vendor: 'google' },
    { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2', vendor: 'deepseek' },
    { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'anthropic' },
    { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast', vendor: 'x-ai' },
    { id: 'minimax/minimax-m2.1', name: 'MiniMax M2.1', vendor: 'minimax' },
    { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite', vendor: 'google' },
    { id: 'openai/gpt-5-nano', name: 'GPT-5 Nano', vendor: 'openai' },
    { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', vendor: 'openai' },
    { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro Preview', vendor: 'google' },
    { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini', vendor: 'openai' },
    { id: 'mistralai/mistral-nemo', name: 'Mistral Nemo', vendor: 'mistralai' },
    { id: 'openai/gpt-4o', name: 'GPT-4o', vendor: 'openai' },
    { id: 'google/gemma-3-27b-it', name: 'Gemma 3 27B IT', vendor: 'google' },
    { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', vendor: 'anthropic' },
    { id: 'qwen/qwen3-235b-a22b-2507', name: 'Qwen3 235B A22B 2507', vendor: 'qwen' },
  ],
};

const cache = new Map<Provider, { expiresAt: number; result: ProviderModelCatalogResult }>();

const toSafeName = (id: string, candidate?: string): string =>
  (candidate || '').trim() || id;

const inferVendor = (provider: Provider, modelId: string, explicitVendor?: string): string => {
  const vendor = (explicitVendor || '').trim();
  if (vendor) return vendor;
  if (provider === 'openrouter' || provider === 'groq') {
    const slashIndex = modelId.indexOf('/');
    if (slashIndex > 0) return modelId.slice(0, slashIndex);
  }
  if (provider === 'ollama' || provider === 'lmstudio') return 'local';
  return provider;
};

const parseUsdValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
};

const readObjectValue = (obj: unknown, key: string): unknown => {
  if (!obj || typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
};

const firstParsedUsdValue = (values: unknown[]): number | undefined => {
  for (const value of values) {
    const parsed = parseUsdValue(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};

const extractPricingPerMillion = (entry: any): {
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
} => {
  const pricing = entry?.pricing;
  const inputPerTokenUsd = firstParsedUsdValue([
    readObjectValue(pricing, 'prompt'),
    readObjectValue(pricing, 'input'),
    readObjectValue(pricing, 'input_price'),
    readObjectValue(pricing, 'prompt_price'),
    entry?.input_cost_per_token,
    entry?.prompt_cost_per_token,
  ]);
  const outputPerTokenUsd = firstParsedUsdValue([
    readObjectValue(pricing, 'completion'),
    readObjectValue(pricing, 'output'),
    readObjectValue(pricing, 'output_price'),
    readObjectValue(pricing, 'response_price'),
    entry?.output_cost_per_token,
    entry?.completion_cost_per_token,
  ]);

  return {
    inputPerMillionUsd:
      inputPerTokenUsd !== undefined ? Number((inputPerTokenUsd * 1_000_000).toFixed(6)) : undefined,
    outputPerMillionUsd:
      outputPerTokenUsd !== undefined ? Number((outputPerTokenUsd * 1_000_000).toFixed(6)) : undefined,
  };
};

const normalizeModels = (provider: Provider, models: ProviderModelInfo[]): ProviderModelInfo[] => {
  const deduped = new Map<string, ProviderModelInfo>();
  models.forEach((model) => {
    if (!model?.id || typeof model.id !== 'string') return;
    if (deduped.has(model.id)) return;
    deduped.set(model.id, {
      id: model.id,
      name: toSafeName(model.id, model.name),
      description: model.description,
      contextLength:
        Number.isFinite(model.contextLength) && typeof model.contextLength === 'number'
          ? Math.max(0, Math.floor(model.contextLength))
          : undefined,
      vendor: inferVendor(provider, model.id, model.vendor),
      inputPerMillionUsd:
        Number.isFinite(model.inputPerMillionUsd) && typeof model.inputPerMillionUsd === 'number'
          ? Math.max(0, model.inputPerMillionUsd)
          : undefined,
      outputPerMillionUsd:
        Number.isFinite(model.outputPerMillionUsd) && typeof model.outputPerMillionUsd === 'number'
          ? Math.max(0, model.outputPerMillionUsd)
          : undefined,
      pricingSourceUrl: typeof model.pricingSourceUrl === 'string' ? model.pricingSourceUrl : undefined,
      pricingSourceLabel: typeof model.pricingSourceLabel === 'string' ? model.pricingSourceLabel : undefined,
      pricingUpdatedAt:
        Number.isFinite(model.pricingUpdatedAt) && typeof model.pricingUpdatedAt === 'number'
          ? model.pricingUpdatedAt
          : undefined,
    });
  });
  return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
};

const normalizeProviderFetchError = (provider: Provider, error: unknown): string => {
  const providerLabel = PROVIDER_LABELS[provider] || provider;
  const err = error as { message?: unknown; name?: unknown; cause?: { code?: unknown; message?: unknown } };
  const rawMessage = typeof err?.message === 'string' ? err.message.trim() : '';
  const rawName = typeof err?.name === 'string' ? err.name : '';
  const causeCode = typeof err?.cause?.code === 'string' ? err.cause.code : '';
  const causeMessage = typeof err?.cause?.message === 'string' ? err.cause.message : '';
  const combined = `${rawMessage} ${causeMessage}`.toLowerCase();

  if (rawName === 'AbortError' || causeCode === 'ETIMEDOUT' || combined.includes('timed out')) {
    return `${providerLabel} models request timed out. Using fallback list.`;
  }

  if (
    rawMessage.toLowerCase() === 'fetch failed' ||
    causeCode === 'ENOTFOUND' ||
    causeCode === 'EAI_AGAIN' ||
    causeCode === 'ECONNREFUSED' ||
    causeCode === 'ECONNRESET' ||
    combined.includes('fetch failed') ||
    combined.includes('network')
  ) {
    return `Network error while contacting ${providerLabel} models API. Using fallback list.`;
  }

  if (rawMessage.startsWith('HTTP 401') || rawMessage.startsWith('HTTP 403')) {
    return `${providerLabel} rejected the credentials (HTTP ${rawMessage.includes('403') ? '403' : '401'}). Check API key and permissions.`;
  }

  if (rawMessage.startsWith('HTTP 429')) {
    return `${providerLabel} rate limit reached while loading models (HTTP 429). Using fallback list.`;
  }

  return rawMessage || `Could not fetch ${providerLabel} models. Using fallback list.`;
};

const fetchJson = async (url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    return response.json();
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new Error('Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchOpenAiModels = async (apiKey: string): Promise<ProviderModelInfo[]> => {
  const data = await fetchJson('https://api.openai.com/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((entry: any) => ({
    id: String(entry.id || ''),
    name: String(entry.id || ''),
    vendor: typeof entry.owned_by === 'string' ? entry.owned_by : 'openai',
  }));
};

const fetchAnthropicModels = async (apiKey: string): Promise<ProviderModelInfo[]> => {
  const data = await fetchJson('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((entry: any) => ({
    id: String(entry.id || ''),
    name: String(entry.display_name || entry.id || ''),
    vendor: 'anthropic',
  }));
};

const fetchGoogleModels = async (apiKey: string): Promise<ProviderModelInfo[]> => {
  const data = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  const rows = Array.isArray(data?.models) ? data.models : [];
  return rows
    .filter((entry: any) => {
      const methods: string[] = Array.isArray(entry?.supportedGenerationMethods) ? entry.supportedGenerationMethods : [];
      return methods.includes('generateContent') || methods.includes('streamGenerateContent');
    })
    .map((entry: any) => {
      const rawName = String(entry.name || '');
      const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
      return {
        id,
        name: String(entry.displayName || id),
        description: typeof entry.description === 'string' ? entry.description : undefined,
        contextLength: Number(entry.inputTokenLimit),
        vendor: 'google',
      };
    });
};

const fetchGroqModels = async (apiKey: string): Promise<ProviderModelInfo[]> => {
  const data = await fetchJson('https://api.groq.com/openai/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((entry: any) => {
    const pricing = extractPricingPerMillion(entry);
    const hasPricing = pricing.inputPerMillionUsd !== undefined || pricing.outputPerMillionUsd !== undefined;
    return {
      id: String(entry.id || ''),
      name: String(entry.id || ''),
      vendor: typeof entry.owned_by === 'string' ? entry.owned_by : undefined,
      ...pricing,
      pricingSourceUrl: hasPricing ? 'https://groq.com/pricing/' : undefined,
      pricingSourceLabel: hasPricing ? 'Groq API' : undefined,
      pricingUpdatedAt: hasPricing ? Date.now() : undefined,
    };
  });
};

const fetchOpenRouterModels = async (apiKey: string): Promise<ProviderModelInfo[]> => {
  const normalizedApiKey = normalizeOpenRouterApiKey(apiKey);
  const keyError = getOpenRouterApiKeyError(normalizedApiKey);
  if (keyError) {
    throw new Error(keyError);
  }

  const data = await fetchJson(OPENROUTER_MODELS_API_URL, {
    headers: {
      Authorization: `Bearer ${normalizedApiKey}`,
      'HTTP-Referer': 'https://optimaizer.app',
      'X-Title': 'optimAIzer',
    },
  });
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((entry: any) => {
    const pricing = extractPricingPerMillion(entry);
    const hasPricing = pricing.inputPerMillionUsd !== undefined || pricing.outputPerMillionUsd !== undefined;
    return {
      id: String(entry.id || ''),
      name: String(entry.name || entry.id || ''),
      description: typeof entry.description === 'string' ? entry.description : undefined,
      contextLength: Number(entry.context_length),
      vendor: entry.id && String(entry.id).includes('/') ? String(entry.id).split('/')[0] : undefined,
      ...pricing,
      pricingSourceUrl: hasPricing ? OPENROUTER_MODELS_API_URL : undefined,
      pricingSourceLabel: hasPricing ? OPENROUTER_MODELS_API_LABEL : undefined,
      pricingUpdatedAt: hasPricing ? Date.now() : undefined,
    };
  });
};

const fetchOllamaModels = async (): Promise<ProviderModelInfo[]> => {
  const baseUrl = getProviderBaseUrl('ollama');
  const data = await fetchJson(`${baseUrl}/api/tags`);
  const rows = Array.isArray(data?.models) ? data.models : [];
  return rows.map((entry: any) => {
    const id = String(entry.model || entry.name || '');
    return {
      id,
      name: String(entry.name || id),
      vendor: 'ollama',
    };
  });
};

const fetchLmStudioModels = async (): Promise<ProviderModelInfo[]> => {
  const baseUrl = getProviderBaseUrl('lmstudio');
  const data = await fetchJson(`${baseUrl}/v1/models`);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map((entry: any) => ({
    id: String(entry.id || ''),
    name: String(entry.id || ''),
    vendor: typeof entry.owned_by === 'string' ? entry.owned_by : 'local',
  }));
};

const fetchModelsFromProvider = async (provider: Provider, apiKey: string): Promise<ProviderModelInfo[]> => {
  switch (provider) {
    case 'openai':
      return fetchOpenAiModels(apiKey);
    case 'anthropic':
      return fetchAnthropicModels(apiKey);
    case 'google':
      return fetchGoogleModels(apiKey);
    case 'groq':
      return fetchGroqModels(apiKey);
    case 'openrouter':
      return fetchOpenRouterModels(apiKey);
    case 'ollama':
      return fetchOllamaModels();
    case 'lmstudio':
      return fetchLmStudioModels();
    default:
      return [];
  }
};

export async function getProviderModelsCatalog(
  provider: Provider,
  options?: { forceRefresh?: boolean }
): Promise<ProviderModelCatalogResult> {
  const forceRefresh = options?.forceRefresh === true;
  const now = Date.now();
  const cached = cache.get(provider);
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.result;
  }

  const requiresApiKey = providerRequiresApiKey(provider);
  const apiKey = getApiKey(provider);
  const configured = !requiresApiKey || Boolean(apiKey.trim());
  const fallbackModels = normalizeModels(provider, FALLBACK_MODELS[provider] || []);

  if (requiresApiKey && !configured) {
    const fallbackResult: ProviderModelCatalogResult = {
      provider,
      models: fallbackModels,
      source: 'fallback',
      fetchedAt: now,
      requiresApiKey,
      configured,
      error: 'No API key configured for this provider.',
    };
    cache.set(provider, { expiresAt: now + CACHE_TTL_MS, result: fallbackResult });
    return fallbackResult;
  }

  try {
    const liveModels = normalizeModels(provider, await fetchModelsFromProvider(provider, apiKey));
    const models = liveModels.length > 0 ? liveModels : fallbackModels;
    const source: 'live' | 'fallback' = liveModels.length > 0 ? 'live' : 'fallback';
    const result: ProviderModelCatalogResult = {
      provider,
      models,
      source,
      fetchedAt: Date.now(),
      requiresApiKey,
      configured,
      error: liveModels.length > 0 ? undefined : 'Provider returned no models. Using fallback list.',
    };
    cache.set(provider, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    return result;
  } catch (err: any) {
    const fallbackResult: ProviderModelCatalogResult = {
      provider,
      models: fallbackModels,
      source: 'fallback',
      fetchedAt: Date.now(),
      requiresApiKey,
      configured,
      error: normalizeProviderFetchError(provider, err),
    };
    cache.set(provider, { expiresAt: Date.now() + CACHE_TTL_MS, result: fallbackResult });
    return fallbackResult;
  }
}
