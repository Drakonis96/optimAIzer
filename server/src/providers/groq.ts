import { BaseProvider, ChatParams, ChatWithToolsParams, ChatWithToolsResult, NativeToolCall, buildMessagesWithSystem } from './base';
import { StreamChunk } from '../types';

/**
 * Groq uses an OpenAI-compatible API.
 */
export class GroqProvider implements BaseProvider {
  readonly name = 'Groq';
  readonly id = 'groq';

  constructor(private apiKey: string) {}

  private resolveMaxTokens(maxTokens?: number): number | undefined {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
      return undefined;
    }
    return Math.floor(maxTokens);
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
    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
    };

    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async chatWithTools(params: ChatWithToolsParams): Promise<ChatWithToolsResult> {
    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
      tools: this.buildFunctionTools(params.tools),
      tool_choice: 'auto',
    };

    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    const message = data.choices?.[0]?.message || {};
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
      temperature: params.temperature ?? 0.7,
      stream: true,
    };

    if (maxTokens !== undefined) {
      body.max_tokens = maxTokens;
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `Groq API error (${response.status}): ${error}` };
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
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              const message = parsed.error?.message || 'Groq stream error';
              yield { type: 'error', error: message };
              return;
            }
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
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
