import { getApiKey } from '../config';
import { Provider } from '../types';
import { getOpenRouterApiKeyError, normalizeOpenRouterApiKey } from './openrouterAuth';

export interface ResolvedModelPricing {
  provider: Provider;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  sourceUrl: string;
  sourceLabel: string;
}

export interface ResolveModelPricingResult {
  found: boolean;
  pricing?: ResolvedModelPricing;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;
const OPENROUTER_MODELS_API_URL = 'https://openrouter.ai/api/v1/models';

const OFFICIAL_PRICING_BY_PROVIDER: Record<Provider, { label: string; url: string } | null> = {
  openai: { label: 'OpenAI Pricing', url: 'https://platform.openai.com/pricing' },
  anthropic: { label: 'Anthropic Pricing', url: 'https://www.anthropic.com/pricing' },
  google: { label: 'Google AI Pricing', url: 'https://ai.google.dev/gemini-api/docs/pricing' },
  groq: { label: 'Groq Pricing', url: 'https://groq.com/pricing/' },
  openrouter: { label: 'OpenRouter Models API', url: OPENROUTER_MODELS_API_URL },
  ollama: null,
  lmstudio: null,
};

const parseUsdValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/[,\s]/g, '');
    const parsed = Number(normalized);
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
  } finally {
    clearTimeout(timeout);
  }
};

const fetchText = async (url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> => {
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
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeModelAliases = (provider: Provider, model: string): string[] => {
  const aliases = new Set<string>();
  const trimmed = model.trim();
  if (!trimmed) return [];

  aliases.add(trimmed.toLowerCase());
  aliases.add(trimmed.toLowerCase().replace(/[_.]/g, '-'));
  aliases.add(trimmed.toLowerCase().replace(/[-_.\/]/g, ' '));

  if ((provider === 'openrouter' || provider === 'groq') && trimmed.includes('/')) {
    const [, shortModel] = trimmed.split('/', 2);
    if (shortModel) {
      aliases.add(shortModel.toLowerCase());
      aliases.add(shortModel.toLowerCase().replace(/[_.]/g, '-'));
      aliases.add(shortModel.toLowerCase().replace(/[-_.\/]/g, ' '));
    }
  }

  return Array.from(aliases).filter((entry) => entry.length >= 3);
};

const pickModelWindow = (htmlLower: string, aliases: string[]): string | null => {
  for (const alias of aliases) {
    const index = htmlLower.indexOf(alias);
    if (index < 0) continue;
    const start = Math.max(0, index - 3000);
    const end = Math.min(htmlLower.length, index + 4500);
    return htmlLower.slice(start, end);
  }
  return null;
};

const parseLabeledPrice = (windowText: string, labels: string[]): number | undefined => {
  for (const label of labels) {
    const regex = new RegExp(`${label}[^$0-9]{0,40}\\$?\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(?:\\/\\s*1m|per\\s*1m|\\/1m|per\\s*million|\\/\\s*million)`, 'i');
    const match = windowText.match(regex);
    if (!match?.[1]) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
};

const parseFallbackPair = (windowText: string): { inputPerMillionUsd: number; outputPerMillionUsd: number } | undefined => {
  const regex = /\$?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\/\s*1m|per\s*1m|\/1m|per\s*million|\/\s*million)/gi;
  const values: number[] = [];
  let match: RegExpExecArray | null = regex.exec(windowText);
  while (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed >= 0) {
      values.push(parsed);
    }
    if (values.length >= 4) break;
    match = regex.exec(windowText);
  }
  if (values.length < 2) return undefined;

  const first = values[0];
  const second = values[1];
  return {
    inputPerMillionUsd: Math.min(first, second),
    outputPerMillionUsd: Math.max(first, second),
  };
};

const resolveFromOfficialPricingPage = async (
  provider: Provider,
  model: string
): Promise<ResolveModelPricingResult> => {
  const source = OFFICIAL_PRICING_BY_PROVIDER[provider];
  if (!source) {
    return { found: false, error: `Provider ${provider} does not publish API token pricing.` };
  }

  try {
    const html = await fetchText(source.url, {
      headers: {
        'User-Agent': 'optimAIzer/1.0 (+pricing-resolver)',
      },
    });
    const htmlLower = html.toLowerCase();
    const aliases = normalizeModelAliases(provider, model);
    const modelWindow = pickModelWindow(htmlLower, aliases);
    if (!modelWindow) {
      return { found: false, error: 'Model was not found on official pricing page.' };
    }

    const inputPerMillionUsd = parseLabeledPrice(modelWindow, ['input', 'prompt', 'entrada']);
    const outputPerMillionUsd = parseLabeledPrice(modelWindow, ['output', 'completion', 'response', 'salida']);
    const fallbackPair = parseFallbackPair(modelWindow);

    const resolvedInput = inputPerMillionUsd ?? fallbackPair?.inputPerMillionUsd;
    const resolvedOutput = outputPerMillionUsd ?? fallbackPair?.outputPerMillionUsd;

    if (!Number.isFinite(resolvedInput) || !Number.isFinite(resolvedOutput)) {
      return { found: false, error: 'Could not parse input/output token pricing from official source.' };
    }

    return {
      found: true,
      pricing: {
        provider,
        model,
        inputPerMillionUsd: Math.max(0, Number(resolvedInput)),
        outputPerMillionUsd: Math.max(0, Number(resolvedOutput)),
        sourceUrl: source.url,
        sourceLabel: source.label,
      },
    };
  } catch (error: any) {
    return {
      found: false,
      error: error?.name === 'AbortError' ? 'Pricing source timed out.' : error?.message || 'Pricing lookup failed.',
    };
  }
};

const resolveOpenRouterPricing = async (model: string): Promise<ResolveModelPricingResult> => {
  const apiKey = getApiKey('openrouter');
  const normalizedApiKey = normalizeOpenRouterApiKey(apiKey);
  const keyError = getOpenRouterApiKeyError(normalizedApiKey);
  if (keyError) {
    return { found: false, error: keyError };
  }

  try {
    const data = await fetchJson(OPENROUTER_MODELS_API_URL, {
      headers: {
        Authorization: `Bearer ${normalizedApiKey}`,
        'HTTP-Referer': 'https://optimaizer.app',
        'X-Title': 'optimAIzer',
      },
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    const match = rows.find((entry: any) => String(entry?.id || '') === model);
    if (!match) {
      return { found: false, error: 'Model not found in OpenRouter catalog.' };
    }

    const pricing = extractPricingPerMillion(match);
    if (!Number.isFinite(pricing.inputPerMillionUsd) || !Number.isFinite(pricing.outputPerMillionUsd)) {
      return { found: false, error: 'OpenRouter did not return valid pricing fields for this model.' };
    }

    return {
      found: true,
      pricing: {
        provider: 'openrouter',
        model,
        inputPerMillionUsd: Math.max(0, Number(pricing.inputPerMillionUsd)),
        outputPerMillionUsd: Math.max(0, Number(pricing.outputPerMillionUsd)),
        sourceUrl: OPENROUTER_MODELS_API_URL,
        sourceLabel: 'OpenRouter Models API',
      },
    };
  } catch (error: any) {
    return { found: false, error: error?.message || 'OpenRouter pricing lookup failed.' };
  }
};

const resolveGroqPricing = async (model: string): Promise<ResolveModelPricingResult> => {
  const apiKey = getApiKey('groq');
  if (!apiKey.trim()) {
    return { found: false, error: 'No API key configured for Groq.' };
  }

  try {
    const data = await fetchJson('https://api.groq.com/openai/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const rows = Array.isArray(data?.data) ? data.data : [];
    const match = rows.find((entry: any) => String(entry?.id || '') === model);
    if (!match) {
      return { found: false, error: 'Model not found in Groq catalog.' };
    }

    const pricing = extractPricingPerMillion(match);
    if (!Number.isFinite(pricing.inputPerMillionUsd) || !Number.isFinite(pricing.outputPerMillionUsd)) {
      return resolveFromOfficialPricingPage('groq', model);
    }

    return {
      found: true,
      pricing: {
        provider: 'groq',
        model,
        inputPerMillionUsd: Math.max(0, Number(pricing.inputPerMillionUsd)),
        outputPerMillionUsd: Math.max(0, Number(pricing.outputPerMillionUsd)),
        sourceUrl: 'https://groq.com/pricing/',
        sourceLabel: 'Groq API',
      },
    };
  } catch (error: any) {
    return {
      found: false,
      error: error?.message || 'Groq pricing lookup failed.',
    };
  }
};

export const resolveModelPricingFromProvider = async (
  provider: Provider,
  model: string
): Promise<ResolveModelPricingResult> => {
  const normalizedModel = String(model || '').trim();
  if (!normalizedModel) {
    return { found: false, error: 'Model id is required.' };
  }

  if (provider === 'openrouter') {
    return resolveOpenRouterPricing(normalizedModel);
  }

  if (provider === 'groq') {
    const fromGroqApi = await resolveGroqPricing(normalizedModel);
    if (fromGroqApi.found) return fromGroqApi;
    const fromWeb = await resolveFromOfficialPricingPage(provider, normalizedModel);
    return fromWeb.found ? fromWeb : fromGroqApi;
  }

  return resolveFromOfficialPricingPage(provider, normalizedModel);
};
