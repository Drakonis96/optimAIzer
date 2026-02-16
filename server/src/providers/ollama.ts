import { BaseProvider, ChatParams, ChatWithToolsParams, ChatWithToolsResult, NativeToolCall, buildMessagesWithSystem } from './base';
import { StreamChunk } from '../types';

/**
 * Ollama local API adapter.
 */
export class OllamaProvider implements BaseProvider {
  readonly name = 'Ollama';
  readonly id = 'ollama';

  constructor(private baseUrl: string) {}

  private resolveMaxTokens(maxTokens?: number): number | undefined {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
      return undefined;
    }
    return Math.floor(maxTokens);
  }

  private resolveTemperature(temperature?: number): number | undefined {
    if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
      return undefined;
    }
    return Math.max(0, Math.min(2, temperature));
  }

  private parseToolCallArguments(raw: unknown): Record<string, unknown> {
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    }
    if (raw && typeof raw === 'object') {
      return raw as Record<string, unknown>;
    }
    return {};
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
    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: false,
    };
    const options: Record<string, unknown> = {};

    if (maxTokens !== undefined) {
      options.num_predict = maxTokens;
    }
    const temperature = this.resolveTemperature(params.temperature);
    if (temperature !== undefined) {
      options.temperature = temperature;
    }
    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    return data.message?.content || '';
  }

  async chatWithTools(params: ChatWithToolsParams): Promise<ChatWithToolsResult> {
    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: false,
      tools: this.buildFunctionTools(params.tools),
    };
    const options: Record<string, unknown> = {};

    if (maxTokens !== undefined) {
      options.num_predict = maxTokens;
    }
    const temperature = this.resolveTemperature(params.temperature);
    if (temperature !== undefined) {
      options.temperature = temperature;
    }
    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    const message = data.message || {};
    const content = typeof message.content === 'string' ? message.content : '';
    const toolCalls = this.extractNativeToolCalls(message);
    return { content, toolCalls };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      stream: true,
    };
    const options: Record<string, unknown> = {};

    if (maxTokens !== undefined) {
      options.num_predict = maxTokens;
    }
    const temperature = this.resolveTemperature(params.temperature);
    if (temperature !== undefined) {
      options.temperature = temperature;
    }
    if (Object.keys(options).length > 0) {
      body.options = options;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `Ollama API error (${response.status}): ${error}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed);
            const content = parsed.message?.content;
            if (typeof content === 'string' && content.length > 0) {
              yield { type: 'token', content };
            }
            if (parsed.done === true) {
              yield { type: 'done' };
              return;
            }
            if (parsed.error) {
              yield { type: 'error', error: String(parsed.error) };
              return;
            }
          } catch {
            // Ignore malformed chunks.
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          const content = parsed.message?.content;
          if (typeof content === 'string' && content.length > 0) {
            yield { type: 'token', content };
          }
        } catch {
          // Ignore malformed trailing chunk.
        }
      }
      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }
}
