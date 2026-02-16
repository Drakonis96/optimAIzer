import { BaseProvider, ChatParams, ChatWithToolsParams, ChatWithToolsResult, NativeToolCall, buildMessagesWithSystem } from './base';
import { StreamChunk } from '../types';
import { getOpenRouterApiKeyError, normalizeOpenRouterApiKey } from './openrouterAuth';

/**
 * OpenRouter uses an OpenAI-compatible API with its own base URL.
 */
export class OpenRouterProvider implements BaseProvider {
  readonly name = 'OpenRouter';
  readonly id = 'openrouter';

  constructor(private apiKey: string) {}

  private resolveApiKey(): string {
    const normalized = normalizeOpenRouterApiKey(this.apiKey);
    const keyError = getOpenRouterApiKeyError(normalized);
    if (keyError) {
      throw new Error(keyError);
    }
    return normalized;
  }

  private resolveMaxTokens(maxTokens?: number): number | undefined {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
      return undefined;
    }
    return Math.floor(maxTokens);
  }

  /**
   * Some models routed via OpenRouter (e.g. openai/o1-*, openai/o3-*) require
   * `max_completion_tokens` instead of `max_tokens`.
   */
  private usesMaxCompletionTokens(model: string): boolean {
    const lowered = model.toLowerCase();
    return /openai\/o[1-9]/.test(lowered) || lowered.includes('/o1-') || lowered.includes('/o3') || lowered.includes('/o4');
  }

  private applyMaxTokens(body: Record<string, unknown>, model: string, maxTokens: number | undefined): void {
    if (maxTokens === undefined) return;
    if (this.usesMaxCompletionTokens(model)) {
      body.max_completion_tokens = maxTokens;
    } else {
      body.max_tokens = maxTokens;
    }
  }

  private buildPlugins(tooling?: ChatParams['tooling']): Array<Record<string, unknown>> {
    if (!tooling?.webSearch) return [];
    return [{ id: 'web' }];
  }

  private shouldRetryWithoutPlugins(status: number, errorText: string): boolean {
    if (status < 400) return false;
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes('plugin') ||
      normalized.includes('web') ||
      normalized.includes('unsupported') ||
      normalized.includes('clerk') ||
      normalized.includes('tool')
    );
  }

  private parseToolCallArguments(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'string') {
      return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private buildFunctionTools(tools: ChatWithToolsParams['tools']): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  private extractNativeToolCalls(message: any): NativeToolCall[] {
    const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    return rawCalls
      .map((toolCall: any, index: number) => {
        const name = toolCall?.function?.name;
        if (!name || typeof name !== 'string') return null;
        return {
          id: String(toolCall?.id || `tool_call_${index + 1}`),
          name,
          arguments: this.parseToolCallArguments(toolCall?.function?.arguments),
        } satisfies NativeToolCall;
      })
      .filter((toolCall: NativeToolCall | null): toolCall is NativeToolCall => toolCall !== null);
  }

  async chat(params: ChatParams): Promise<string> {
    const apiKey = this.resolveApiKey();
    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
    };

    this.applyMaxTokens(body, params.model, maxTokens);

    const plugins = this.buildPlugins(params.tooling);
    if (plugins.length > 0) {
      body.plugins = plugins;
    }

    const request = (payload: Record<string, unknown>) =>
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://optimaizer.app',
          'X-Title': 'optimAIzer',
        },
        body: JSON.stringify(payload),
        signal: params.signal,
      });

    let response = await request(body);
    if (!response.ok && plugins.length > 0) {
      const pluginError = await response.text();
      if (this.shouldRetryWithoutPlugins(response.status, pluginError)) {
        const fallbackBody = { ...body };
        delete fallbackBody.plugins;
        response = await request(fallbackBody);
      } else {
        throw new Error(`OpenRouter API error (${response.status}): ${pluginError}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async chatWithTools(params: ChatWithToolsParams): Promise<ChatWithToolsResult> {
    const apiKey = this.resolveApiKey();
    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      tools: this.buildFunctionTools(params.tools),
      tool_choice: 'auto',
    };

    this.applyMaxTokens(body, params.model, maxTokens);

    const request = (payload: Record<string, unknown>) =>
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://optimaizer.app',
          'X-Title': 'optimAIzer',
        },
        body: JSON.stringify(payload),
        signal: params.signal,
      });

    let response = await request(body);
    if (!response.ok) {
      const errorBody = await response.text();
      // If the error is tool-related, throw so the engine can fall back to
      // text-based tool calling instead of silently retrying without tools
      // (which would cause the LLM to hallucinate tool results).
      throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
    }

    const data: any = await response.json();
    const message = data.choices?.[0]?.message || {};
    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = this.extractNativeToolCalls(message);
    return { content, toolCalls };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    let apiKey = '';
    try {
      apiKey = this.resolveApiKey();
    } catch (err: any) {
      yield { type: 'error', error: err?.message || 'Invalid OpenRouter API key.' };
      return;
    }

    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      stream: true,
    };

    this.applyMaxTokens(body, params.model, maxTokens);

    const plugins = this.buildPlugins(params.tooling);
    if (plugins.length > 0) {
      body.plugins = plugins;
    }

    const request = (payload: Record<string, unknown>) =>
      fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://optimaizer.app',
          'X-Title': 'optimAIzer',
        },
        body: JSON.stringify(payload),
        signal: params.signal,
      });

    let response = await request(body);
    if (!response.ok && plugins.length > 0) {
      const pluginError = await response.text();
      if (this.shouldRetryWithoutPlugins(response.status, pluginError)) {
        const fallbackBody = { ...body };
        delete fallbackBody.plugins;
        response = await request(fallbackBody);
      } else {
        yield { type: 'error', error: `OpenRouter API error (${response.status}): ${pluginError}` };
        return;
      }
    }

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `OpenRouter API error (${response.status}): ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let emittedTokens = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              const errorMessage =
                parsed.error?.message ||
                parsed.error?.metadata?.raw ||
                'OpenRouter stream error';
              yield { type: 'error', error: errorMessage };
              return;
            }

            const finishReason = parsed.choices?.[0]?.finish_reason;
            if (finishReason === 'error') {
              const streamErrorMessage =
                parsed.error?.message ||
                parsed.error?.metadata?.raw ||
                parsed.choices?.[0]?.message?.content ||
                'OpenRouter stream terminated with finish_reason=error';

              // OpenRouter can report finish_reason=error after emitting usable partial text.
              if (emittedTokens) {
                yield { type: 'done' };
                return;
              }

              yield { type: 'error', error: streamErrorMessage };
              return;
            }

            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              emittedTokens = true;
              yield { type: 'token', content };
            }
          } catch {
            // Skip malformed
          }
        }
      }
      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }
}
