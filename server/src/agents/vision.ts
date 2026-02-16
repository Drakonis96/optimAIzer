// ---------------------------------------------------------------------------
// Vision Analysis Service — Analyze images using LLM vision capabilities
// ---------------------------------------------------------------------------
// Uses the agent's configured provider/model when it supports vision,
// otherwise falls back to OpenAI gpt-4o-mini, Google gemini-2.0-flash-lite,
// or Anthropic claude-3-haiku.
// ---------------------------------------------------------------------------

import { createProvider } from '../providers';
import { getApiKey, getProviderBaseUrl } from '../config';
import { Provider } from '../types';

export interface VisionAnalysisResult {
  description: string;
  provider: string;
  model: string;
}

// Models known to support vision (partial list, errs on the side of trying)
const VISION_CAPABLE_MODELS: Record<string, RegExp> = {
  openai: /gpt-4|gpt-4o|gpt-4\.1|o[1-9]/i,
  anthropic: /claude-3|claude-4/i,
  google: /gemini/i,
  groq: /llama.*vision|llava|gemma.*it/i,
  openrouter: /gpt-4|claude-3|gemini|llava|vision/i,
  ollama: /llava|bakllava|moondream|cogvlm|minicpm/i,
  lmstudio: /llava|bakllava|moondream|cogvlm|minicpm/i,
};

function isVisionCapable(provider: string, model: string): boolean {
  const regex = VISION_CAPABLE_MODELS[provider];
  if (!regex) return false;
  return regex.test(model);
}

// Fallback providers in priority order for vision
const VISION_FALLBACKS: Array<{ provider: Provider; model: string }> = [
  { provider: 'google', model: 'gemini-2.0-flash-lite' },
  { provider: 'openai', model: 'gpt-4o-mini' },
  { provider: 'anthropic', model: 'claude-3-5-haiku-latest' },
  { provider: 'groq', model: 'llama-3.2-90b-vision-preview' },
];

/**
 * Analyze an image using the best available vision-capable LLM.
 * Tries the agent's own provider/model first, then falls back.
 */
export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string,
  prompt: string,
  agentProvider?: Provider,
  agentModel?: string
): Promise<VisionAnalysisResult> {
  const base64Image = imageBuffer.toString('base64');
  const dataUrl = `data:${mimeType};base64,${base64Image}`;

  // Build candidate list: agent's own provider first, then fallbacks
  const candidates: Array<{ provider: Provider; model: string }> = [];

  if (agentProvider && agentModel && isVisionCapable(agentProvider, agentModel)) {
    candidates.push({ provider: agentProvider, model: agentModel });
  }

  for (const fallback of VISION_FALLBACKS) {
    if (getApiKey(fallback.provider)) {
      // Don't duplicate if already in candidates
      if (!candidates.some(c => c.provider === fallback.provider && c.model === fallback.model)) {
        candidates.push(fallback);
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      'No hay proveedor de visión disponible. Configura una API key de OpenAI, Google, Anthropic o Groq.'
    );
  }

  const userPrompt = prompt || 'Describe esta imagen en detalle. Si contiene texto, transcríbelo.';

  for (const candidate of candidates) {
    try {
      const result = await callVisionAPI(candidate.provider, candidate.model, dataUrl, mimeType, base64Image, userPrompt);
      return {
        description: result,
        provider: candidate.provider,
        model: candidate.model,
      };
    } catch (error: any) {
      console.warn(`[Vision] ${candidate.provider}/${candidate.model} failed:`, error.message);
      continue;
    }
  }

  throw new Error('Todos los proveedores de visión fallaron. Verifica tus API keys y modelos.');
}

// ---------------------------------------------------------------------------
// Provider-specific vision API calls
// ---------------------------------------------------------------------------

async function callVisionAPI(
  provider: Provider,
  model: string,
  dataUrl: string,
  mimeType: string,
  base64Image: string,
  prompt: string
): Promise<string> {
  const apiKey = getApiKey(provider);

  switch (provider) {
    case 'openai':
    case 'groq':
    case 'openrouter':
    case 'ollama':
    case 'lmstudio':
      return callOpenAICompatibleVision(provider, model, apiKey, dataUrl, prompt);

    case 'anthropic':
      return callAnthropicVision(model, apiKey, mimeType, base64Image, prompt);

    case 'google':
      return callGoogleVision(model, apiKey, mimeType, base64Image, prompt);

    default:
      throw new Error(`Provider ${provider} no soporta visión`);
  }
}

// OpenAI-compatible vision (OpenAI, Groq, OpenRouter, Ollama, LMStudio)
async function callOpenAICompatibleVision(
  provider: Provider,
  model: string,
  apiKey: string,
  dataUrl: string,
  prompt: string
): Promise<string> {
  const baseUrls: Record<string, string> = {
    openai: 'https://api.openai.com/v1',
    groq: 'https://api.groq.com/openai/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    ollama: `${getProviderBaseUrl('ollama')}/v1`,
    lmstudio: `${getProviderBaseUrl('lmstudio')}/v1`,
  };
  const baseUrl = baseUrls[provider] || baseUrls.openai;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
          ],
        },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as any;
  return data.choices?.[0]?.message?.content || '';
}

// Anthropic vision
async function callAnthropicVision(
  model: string,
  apiKey: string,
  mimeType: string,
  base64Image: string,
  prompt: string
): Promise<string> {
  // Anthropic accepts: image/jpeg, image/png, image/gif, image/webp
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const mediaType = validTypes.includes(mimeType) ? mimeType : 'image/jpeg';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as any;
  const textBlocks = (data.content || []).filter((b: any) => b.type === 'text');
  return textBlocks.map((b: any) => b.text).join('\n') || '';
}

// Google Gemini vision
async function callGoogleVision(
  model: string,
  apiKey: string,
  mimeType: string,
  base64Image: string,
  prompt: string
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Image,
                },
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.3,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as any;
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p: any) => p.text || '').join('\n') || '';
}
