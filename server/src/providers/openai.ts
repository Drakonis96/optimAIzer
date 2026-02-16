import { BaseProvider, ChatParams, ChatWithToolsParams, ChatWithToolsResult, NativeToolCall, buildMessagesWithSystem } from './base';
import { StreamChunk } from '../types';

/** Maximum time (ms) to wait for an OpenAI API response before aborting. */
const API_TIMEOUT_MS = 90_000;

/** Combine a timeout signal with an optional caller-provided signal. */
function buildSignal(callerSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(API_TIMEOUT_MS);
  if (!callerSignal) return timeoutSignal;
  return AbortSignal.any([timeoutSignal, callerSignal]);
}

export class OpenAIProvider implements BaseProvider {
  readonly name = 'OpenAI';
  readonly id = 'openai';

  constructor(private apiKey: string) {}

  private resolveMaxTokens(maxTokens?: number): number | undefined {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
      return undefined;
    }
    return Math.floor(maxTokens);
  }

  /**
   * Some OpenAI models (o1, o3, o3-mini, o4-mini, etc.) require
   * `max_completion_tokens` instead of `max_tokens`.
   */
  private usesMaxCompletionTokens(model: string): boolean {
    const lowered = model.toLowerCase();
    return /^o[1-9]/.test(lowered) || lowered.includes('o1-') || lowered.includes('o3') || lowered.includes('o4');
  }

  private applyMaxTokens(body: Record<string, unknown>, _model: string, maxTokens: number | undefined): void {
    if (maxTokens === undefined) return;
    // OpenAI now expects max_completion_tokens for all current models.
    body.max_completion_tokens = maxTokens;
  }

  private normalizeReasoningEffort(effort?: ChatParams['reasoningEffort']): string | undefined {
    if (!effort) return undefined;
    // OpenAI currently supports up to "high"; map legacy app value.
    if (effort === 'xhigh') return 'high';
    return effort;
  }

  private buildTools(tooling?: ChatParams['tooling']): Array<Record<string, unknown>> {
    const tools: Array<Record<string, unknown>> = [];
    if (tooling?.webSearch) {
      tools.push({
        type: 'web_search_preview',
        user_location: {
          type: 'approximate',
          country: 'US',
        },
      });
    }
    if (tooling?.codeExecution) {
      tools.push({
        type: 'code_interpreter',
        container: { type: 'auto' },
      });
    }
    return tools;
  }

  private shouldRetryWithoutTools(status: number, errorText: string): boolean {
    if (status < 400 || status >= 500) return false;
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes('tool') ||
      normalized.includes('unsupported') ||
      normalized.includes('unknown parameter') ||
      normalized.includes('web_search') ||
      normalized.includes('code_interpreter')
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
    const messages = buildMessagesWithSystem(params.messages, params.systemPrompt);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const body: Record<string, unknown> = {
      model: params.model,
      messages,
      temperature: params.temperature ?? 0.7,
    };

    this.applyMaxTokens(body, params.model, maxTokens);

    const reasoningEffort = this.normalizeReasoningEffort(params.reasoningEffort);
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }

    const tools = this.buildTools(params.tooling);
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const request = (payload: Record<string, unknown>) =>
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: params.signal,
      });

    let response = await request(body);
    if (!response.ok && tools.length > 0) {
      const toolError = await response.text();
      if (this.shouldRetryWithoutTools(response.status, toolError)) {
        const fallbackBody = { ...body };
        delete fallbackBody.tools;
        delete fallbackBody.tool_choice;
        response = await request(fallbackBody);
      } else {
        throw new Error(`OpenAI API error (${response.status}): ${toolError}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
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

    this.applyMaxTokens(body, params.model, maxTokens);

    const reasoningEffort = this.normalizeReasoningEffort(params.reasoningEffort);
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }

    const request = (payload: Record<string, unknown>) =>
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: buildSignal(params.signal),
      });

    let response = await request(body);
    if (!response.ok) {
      const toolError = await response.text();
      if (this.shouldRetryWithoutTools(response.status, toolError)) {
        const fallbackBody = { ...body };
        delete fallbackBody.tools;
        delete fallbackBody.tool_choice;
        response = await request(fallbackBody);
      } else {
        throw new Error(`OpenAI API error (${response.status}): ${toolError}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
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

    this.applyMaxTokens(body, params.model, maxTokens);

    const reasoningEffort = this.normalizeReasoningEffort(params.reasoningEffort);
    if (reasoningEffort) {
      body.reasoning_effort = reasoningEffort;
    }

    const tools = this.buildTools(params.tooling);
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const request = (payload: Record<string, unknown>) =>
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: buildSignal(params.signal),
      });

    let response = await request(body);
    if (!response.ok && tools.length > 0) {
      const toolError = await response.text();
      if (this.shouldRetryWithoutTools(response.status, toolError)) {
        const fallbackBody = { ...body };
        delete fallbackBody.tools;
        delete fallbackBody.tool_choice;
        response = await request(fallbackBody);
      } else {
        yield { type: 'error', error: `OpenAI API error (${response.status}): ${toolError}` };
        return;
      }
    }

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `OpenAI API error (${response.status}): ${error}` };
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { type: 'done' };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              const message = parsed.error?.message || 'OpenAI stream error';
              yield { type: 'error', error: message };
              return;
            }
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield { type: 'token', content };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }
}
