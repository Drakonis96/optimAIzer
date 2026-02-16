import { BaseProvider } from './base';
import { Provider } from '../types';
import { getApiKey, getProviderBaseUrl, providerRequiresApiKey } from '../config';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GoogleProvider } from './google';
import { GroqProvider } from './groq';
import { OpenRouterProvider } from './openrouter';
import { OllamaProvider } from './ollama';
import { LMStudioProvider } from './lmstudio';

/**
 * Factory: creates the correct provider adapter for the given provider ID.
 * API keys are resolved from the secure server-side config only.
 */
export function createProvider(providerId: Provider): BaseProvider {
  const apiKey = getApiKey(providerId);
  if (providerRequiresApiKey(providerId) && !apiKey) {
    throw new Error(`No API key configured for provider: ${providerId}. Set it in the .env file or via the settings panel.`);
  }

  switch (providerId) {
    case 'openai':
      return new OpenAIProvider(apiKey);
    case 'anthropic':
      return new AnthropicProvider(apiKey);
    case 'google':
      return new GoogleProvider(apiKey);
    case 'groq':
      return new GroqProvider(apiKey);
    case 'openrouter':
      return new OpenRouterProvider(apiKey);
    case 'ollama':
      return new OllamaProvider(getProviderBaseUrl('ollama'));
    case 'lmstudio':
      return new LMStudioProvider(getProviderBaseUrl('lmstudio'));
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

export { OpenAIProvider, AnthropicProvider, GoogleProvider, GroqProvider, OpenRouterProvider, OllamaProvider, LMStudioProvider };
