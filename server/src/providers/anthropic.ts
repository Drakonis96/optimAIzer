import { BaseProvider, ChatParams, ChatWithToolsParams, ChatWithToolsResult, NativeToolCall } from './base';
import { StreamChunk, ChatMessage } from '../types';

export class AnthropicProvider implements BaseProvider {
  readonly name = 'Anthropic';
  readonly id = 'anthropic';
  private readonly defaultMaxTokens = 8192;
  private readonly promptCachingBeta = 'prompt-caching-2024-07-31';
  private readonly codeExecutionBeta = 'code-execution-2025-08-25';

  constructor(private apiKey: string) {}

  private resolveMaxTokens(maxTokens?: number): number {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
      return this.defaultMaxTokens;
    }
    return Math.floor(maxTokens);
  }

  private resolveTemperature(temperature?: number): number | undefined {
    if (typeof temperature !== 'number' || !Number.isFinite(temperature)) {
      return undefined;
    }
    return Math.max(0, Math.min(1, temperature));
  }

  private formatMessages(messages: ChatMessage[]): { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
    let system: string | undefined;
    const formatted: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else {
        formatted.push({ role: msg.role, content: msg.content } as { role: 'user' | 'assistant'; content: string });
      }
    }

    // Anthropic expects user/assistant conversational turns.
    // Drop leading assistant prefill turns from local UI history.
    while (formatted.length > 0 && formatted[0].role === 'assistant') {
      formatted.shift();
    }

    // Merge consecutive messages with same role into a single turn.
    const normalized: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of formatted) {
      const last = normalized[normalized.length - 1];
      if (last && last.role === msg.role) {
        last.content += `\n\n${msg.content}`;
      } else {
        normalized.push({ ...msg });
      }
    }

    return { system, messages: normalized };
  }

  private buildTools(tooling?: ChatParams['tooling']): Array<Record<string, unknown>> {
    const tools: Array<Record<string, unknown>> = [];
    if (tooling?.webSearch) {
      tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
      });
    }
    if (tooling?.codeExecution) {
      tools.push({
        type: 'code_execution_20250825',
        name: 'code_execution',
      });
    }
    return tools;
  }

  private buildHeaders(options?: { tooling?: ChatParams['tooling']; promptCaching?: boolean }): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
    };
    const betas: string[] = [];
    if (options?.tooling?.codeExecution) {
      betas.push(this.codeExecutionBeta);
    }
    if (options?.promptCaching) {
      betas.push(this.promptCachingBeta);
    }
    if (betas.length > 0) {
      headers['anthropic-beta'] = betas.join(',');
    }
    return headers;
  }

  private shouldRetryWithoutOptionalFeatures(status: number, errorText: string): boolean {
    if (status < 400 || status >= 500) return false;
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes('tool') ||
      normalized.includes('unsupported') ||
      normalized.includes('web_search') ||
      normalized.includes('code_execution') ||
      normalized.includes('anthropic-beta') ||
      normalized.includes('prompt_caching') ||
      normalized.includes('prompt-caching') ||
      normalized.includes('cache_control')
    );
  }

  private shouldEnablePromptCaching(params: ChatParams, formatted: { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> }): boolean {
    if (params.tooling?.codeExecution) return false;
    const hasSystem = Boolean((params.systemPrompt || formatted.system || '').trim());
    const hasPrefixMessages = formatted.messages.length > 1;
    if (!hasSystem && !hasPrefixMessages) return false;
    const approximatePrefixChars = formatted.messages
      .slice(0, Math.max(0, formatted.messages.length - 1))
      .reduce((total, message) => total + message.content.length, 0) + (params.systemPrompt || formatted.system || '').length;
    return approximatePrefixChars >= 100;
  }

  private buildContentBlock(text: string, cacheable: boolean): Record<string, unknown> {
    const block: Record<string, unknown> = {
      type: 'text',
      text,
    };
    if (cacheable) {
      block.cache_control = { type: 'ephemeral' };
    }
    return block;
  }

  private buildRequestBody(options: {
    params: ChatParams;
    formatted: { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> };
    maxTokens: number;
    temperature?: number;
    tools: Array<Record<string, unknown>>;
    stream: boolean;
    promptCaching: boolean;
  }): Record<string, unknown> {
    const { params, formatted, maxTokens, temperature, tools, stream, promptCaching } = options;
    const systemText = params.systemPrompt || formatted.system;
    const lastMessageIndex = formatted.messages.length - 1;
    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: maxTokens,
      stream,
      messages: formatted.messages.map((message, index) => ({
        role: message.role,
        content: [
          this.buildContentBlock(message.content, promptCaching && index < lastMessageIndex),
        ],
      })),
    };

    if (!stream) {
      delete body.stream;
    }

    if (temperature !== undefined) {
      body.temperature = temperature;
    }

    if (systemText) {
      body.system = promptCaching
        ? [this.buildContentBlock(systemText, true)]
        : systemText;
    }

    if (tools.length > 0) {
      body.tools = tools;
    }

    return body;
  }

  private buildNativeFunctionTools(tools: ChatWithToolsParams['tools']): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  private extractNativeContentAndToolCalls(data: any): ChatWithToolsResult {
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const contentParts: string[] = [];
    const toolCalls: NativeToolCall[] = [];

    blocks.forEach((block: any, index: number) => {
      if (block?.type === 'text' && typeof block.text === 'string') {
        contentParts.push(block.text);
        return;
      }
      if (block?.type !== 'tool_use' || typeof block.name !== 'string') {
        return;
      }
      const rawInput = block.input;
      const input =
        rawInput && typeof rawInput === 'object'
          ? (rawInput as Record<string, unknown>)
          : {};
      toolCalls.push({
        id: String(block.id || `tool_use_${index + 1}`),
        name: block.name,
        arguments: input,
      });
    });

    return {
      content: contentParts.join('\n').trim(),
      toolCalls,
    };
  }

  async chat(params: ChatParams): Promise<string> {
    const allMessages: ChatMessage[] = [...params.messages];
    const maxTokens = this.resolveMaxTokens(params.maxTokens);

    // Normalize to Anthropic's expected turn format.
    const formatted = this.formatMessages(allMessages);
    const temperature = this.resolveTemperature(params.temperature);
    const tools = this.buildTools(params.tooling);
    const enablePromptCaching = this.shouldEnablePromptCaching(params, formatted);
    const body = this.buildRequestBody({
      params,
      formatted,
      maxTokens,
      temperature,
      tools,
      stream: false,
      promptCaching: enablePromptCaching,
    });

    const request = (payload: Record<string, unknown>, options: { withToolingHeaders: boolean; withPromptCaching: boolean }) =>
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: this.buildHeaders({
          tooling: options.withToolingHeaders ? params.tooling : undefined,
          promptCaching: options.withPromptCaching,
        }),
        body: JSON.stringify(payload),
        signal: params.signal,
      });

    let response = await request(body, {
      withToolingHeaders: tools.length > 0,
      withPromptCaching: enablePromptCaching,
    });
    if (!response.ok && (tools.length > 0 || enablePromptCaching)) {
      const optionalFeatureError = await response.text();
      if (this.shouldRetryWithoutOptionalFeatures(response.status, optionalFeatureError)) {
        const fallbackBody = this.buildRequestBody({
          params,
          formatted,
          maxTokens,
          temperature,
          tools: [],
          stream: false,
          promptCaching: false,
        });
        response = await request(fallbackBody, {
          withToolingHeaders: false,
          withPromptCaching: false,
        });
      } else {
        throw new Error(`Anthropic API error (${response.status}): ${optionalFeatureError}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    return data.content?.[0]?.text || '';
  }

  async chatWithTools(params: ChatWithToolsParams): Promise<ChatWithToolsResult> {
    const allMessages: ChatMessage[] = [...params.messages];
    const formatted = this.formatMessages(allMessages);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const temperature = this.resolveTemperature(params.temperature);
    const tools = this.buildNativeFunctionTools(params.tools);
    const body = this.buildRequestBody({
      params,
      formatted,
      maxTokens,
      temperature,
      tools,
      stream: false,
      promptCaching: false,
    });

    const request = (payload: Record<string, unknown>, options: { withPromptCaching: boolean }) =>
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: this.buildHeaders({
          tooling: undefined,
          promptCaching: options.withPromptCaching,
        }),
        body: JSON.stringify(payload),
        signal: params.signal,
      });

    let response = await request(body, { withPromptCaching: false });
    if (!response.ok) {
      const toolError = await response.text();
      if (this.shouldRetryWithoutOptionalFeatures(response.status, toolError)) {
        const fallbackBody = this.buildRequestBody({
          params,
          formatted,
          maxTokens,
          temperature,
          tools: [],
          stream: false,
          promptCaching: false,
        });
        response = await request(fallbackBody, { withPromptCaching: false });
      } else {
        throw new Error(`Anthropic API error (${response.status}): ${toolError}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    return this.extractNativeContentAndToolCalls(data);
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const allMessages: ChatMessage[] = [...params.messages];
    const formatted = this.formatMessages(allMessages);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);
    const temperature = this.resolveTemperature(params.temperature);
    const tools = this.buildTools(params.tooling);
    const enablePromptCaching = this.shouldEnablePromptCaching(params, formatted);
    const body = this.buildRequestBody({
      params,
      formatted,
      maxTokens,
      temperature,
      tools,
      stream: true,
      promptCaching: enablePromptCaching,
    });

    const request = (payload: Record<string, unknown>, options: { withToolingHeaders: boolean; withPromptCaching: boolean }) =>
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: this.buildHeaders({
          tooling: options.withToolingHeaders ? params.tooling : undefined,
          promptCaching: options.withPromptCaching,
        }),
        body: JSON.stringify(payload),
        signal: params.signal,
      });

    let response = await request(body, {
      withToolingHeaders: tools.length > 0,
      withPromptCaching: enablePromptCaching,
    });
    if (!response.ok && (tools.length > 0 || enablePromptCaching)) {
      const optionalFeatureError = await response.text();
      if (this.shouldRetryWithoutOptionalFeatures(response.status, optionalFeatureError)) {
        const fallbackBody = this.buildRequestBody({
          params,
          formatted,
          maxTokens,
          temperature,
          tools: [],
          stream: true,
          promptCaching: false,
        });
        response = await request(fallbackBody, {
          withToolingHeaders: false,
          withPromptCaching: false,
        });
      } else {
        yield { type: 'error', error: `Anthropic API error (${response.status}): ${optionalFeatureError}` };
        return;
      }
    }

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `Anthropic API error (${response.status}): ${error}` };
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
          try {
            const parsed = JSON.parse(data);

            if (parsed.type === 'content_block_delta') {
              const text = parsed.delta?.text;
              if (text) {
                yield { type: 'token', content: text };
              }
            } else if (parsed.type === 'error') {
              const message = parsed.error?.message || 'Anthropic stream error';
              yield { type: 'error', error: message };
              return;
            } else if (parsed.type === 'message_stop') {
              yield { type: 'done' };
              return;
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
