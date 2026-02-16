import { ChatMessage, ReasoningEffort, StreamChunk, ToolingOptions, Provider } from '../types';

export interface NativeFunctionTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface NativeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatWithToolsParams extends ChatParams {
  tools: NativeFunctionTool[];
}

export interface ChatWithToolsResult {
  content: string;
  toolCalls: NativeToolCall[];
}

/**
 * Base interface for all AI provider adapters.
 * Each provider implements this to normalize the API interaction.
 */
export interface BaseProvider {
  readonly name: string;
  readonly id: string;

  /**
   * Send a chat completion request and return the full response.
   */
  chat(params: ChatParams): Promise<string>;

  /**
   * Native function/tool calling (optional, provider-specific).
   * Returns assistant text plus normalized tool calls.
   */
  chatWithTools?(params: ChatWithToolsParams): Promise<ChatWithToolsResult>;

  /**
   * Send a chat completion request with streaming (SSE).
   * Yields StreamChunk objects.
   */
  chatStream(params: ChatParams): AsyncGenerator<StreamChunk>;
}

export interface ChatParams {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  tooling?: ToolingOptions;
  signal?: AbortSignal;
}

export interface ProviderToolSupport {
  webSearch: boolean;
  codeExecution: boolean;
}

export const PROVIDER_TOOL_SUPPORT: Record<Provider, ProviderToolSupport> = {
  anthropic: { webSearch: true, codeExecution: true },
  google: { webSearch: true, codeExecution: true },
  groq: { webSearch: false, codeExecution: false },
  lmstudio: { webSearch: false, codeExecution: false },
  ollama: { webSearch: false, codeExecution: false },
  openai: { webSearch: true, codeExecution: true },
  openrouter: { webSearch: true, codeExecution: false },
};

export function getEnabledToolingForProvider(provider: Provider, tooling?: ToolingOptions): ToolingOptions {
  if (!tooling) return {};
  const support = PROVIDER_TOOL_SUPPORT[provider];
  return {
    webSearch: Boolean(tooling.webSearch && support.webSearch),
    codeExecution: Boolean(tooling.codeExecution && support.codeExecution),
  };
}

/**
 * Helper to build messages array with system prompt for OpenAI-compatible APIs.
 */
export function buildMessagesWithSystem(
  messages: ChatMessage[],
  systemPrompt?: string
): ChatMessage[] {
  const result: ChatMessage[] = [];
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt });
  }
  result.push(...messages);
  return result;
}
