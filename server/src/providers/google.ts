import { BaseProvider, ChatParams, ChatWithToolsParams, ChatWithToolsResult, NativeToolCall } from './base';
import { StreamChunk, ChatMessage } from '../types';

/** Maximum time (ms) to wait for a Google API response before aborting. */
const API_TIMEOUT_MS = 90_000;

/** Combine a timeout signal with an optional caller-provided signal. */
function buildSignal(callerSignal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(API_TIMEOUT_MS);
  if (!callerSignal) return timeoutSignal;
  return AbortSignal.any([timeoutSignal, callerSignal]);
}

export class GoogleProvider implements BaseProvider {
  readonly name = 'Google Gemini';
  readonly id = 'google';

  constructor(private apiKey: string) {}

  private resolveMaxTokens(maxTokens?: number): number | undefined {
    if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
      return undefined;
    }
    return Math.floor(maxTokens);
  }

  private buildTools(tooling?: ChatParams['tooling']): Array<Record<string, unknown>> {
    const tools: Array<Record<string, unknown>> = [];
    if (tooling?.webSearch) {
      tools.push({ google_search: {} });
    }
    if (tooling?.codeExecution) {
      tools.push({ code_execution: {} });
    }
    return tools;
  }

  private toGeminiSchemaType(value: unknown): string {
    const lowered = String(value || '').trim().toLowerCase();
    switch (lowered) {
      case 'object':
        return 'OBJECT';
      case 'array':
        return 'ARRAY';
      case 'number':
        return 'NUMBER';
      case 'integer':
        return 'INTEGER';
      case 'boolean':
        return 'BOOLEAN';
      case 'string':
      default:
        return 'STRING';
    }
  }

  private convertJsonSchemaToGemini(schema: unknown): Record<string, unknown> {
    if (!schema || typeof schema !== 'object') {
      return { type: 'OBJECT', properties: {} };
    }

    const source = schema as Record<string, unknown>;
    const type = this.toGeminiSchemaType(source.type);
    const output: Record<string, unknown> = { type };

    if (typeof source.description === 'string') {
      output.description = source.description;
    }

    if (Array.isArray(source.enum)) {
      output.enum = source.enum.filter((item): item is string => typeof item === 'string');
    }

    if (type === 'OBJECT') {
      const rawProperties = source.properties;
      const properties: Record<string, unknown> = {};
      if (rawProperties && typeof rawProperties === 'object') {
        Object.entries(rawProperties as Record<string, unknown>).forEach(([key, value]) => {
          properties[key] = this.convertJsonSchemaToGemini(value);
        });
      }
      output.properties = properties;

      if (Array.isArray(source.required)) {
        output.required = source.required.filter((item): item is string => typeof item === 'string');
      }
    }

    if (type === 'ARRAY' && source.items && typeof source.items === 'object') {
      output.items = this.convertJsonSchemaToGemini(source.items);
    }

    return output;
  }

  private buildFunctionTools(tools: ChatWithToolsParams['tools']): Array<Record<string, unknown>> {
    if (tools.length === 0) return [];
    return [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: this.convertJsonSchemaToGemini(tool.parameters),
        })),
      },
    ];
  }

  private extractNativeContentAndToolCalls(data: any): ChatWithToolsResult {
    const parts = data?.candidates?.[0]?.content?.parts;
    const safeParts = Array.isArray(parts) ? parts : [];
    const contentParts: string[] = [];
    const toolCalls: NativeToolCall[] = [];

    safeParts.forEach((part: any, index: number) => {
      if (typeof part?.text === 'string' && part.text.trim()) {
        contentParts.push(part.text);
      }
      const functionCall = part?.functionCall;
      if (!functionCall || typeof functionCall.name !== 'string') return;
      const args =
        functionCall.args && typeof functionCall.args === 'object'
          ? (functionCall.args as Record<string, unknown>)
          : {};
      toolCalls.push({
        id: `function_call_${index + 1}`,
        name: functionCall.name,
        arguments: args,
      });
    });

    return {
      content: contentParts.join('\n').trim(),
      toolCalls,
    };
  }

  private shouldRetryWithoutTools(status: number, errorText: string): boolean {
    if (status < 400 || status >= 500) return false;
    const normalized = errorText.toLowerCase();
    return (
      normalized.includes('tool') ||
      normalized.includes('google_search') ||
      normalized.includes('code_execution') ||
      normalized.includes('unsupported')
    );
  }

  private formatContents(messages: ChatMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages
      .filter(m => m.role !== 'system')
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }));
  }

  async chat(params: ChatParams): Promise<string> {
    const contents = this.formatContents(params.messages);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);

    const body: any = {
      contents,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
      },
    };

    if (maxTokens !== undefined) {
      body.generationConfig.maxOutputTokens = maxTokens;
    }

    if (params.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: params.systemPrompt }],
      };
    }

    const tools = this.buildTools(params.tooling);
    if (tools.length > 0) {
      body.tools = tools;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`;

    const request = (payload: Record<string, unknown>) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
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
        response = await request(fallbackBody);
      } else {
        throw new Error(`Google API error (${response.status}): ${toolError}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async chatWithTools(params: ChatWithToolsParams): Promise<ChatWithToolsResult> {
    const contents = this.formatContents(params.messages);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
      },
      tools: this.buildFunctionTools(params.tools),
      toolConfig: {
        functionCallingConfig: {
          mode: 'AUTO',
        },
      },
    };

    if (maxTokens !== undefined) {
      (body.generationConfig as Record<string, unknown>).maxOutputTokens = maxTokens;
    }

    if (params.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: params.systemPrompt }],
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent`;
    const request = (payload: Record<string, unknown>) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
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
        delete fallbackBody.toolConfig;
        response = await request(fallbackBody);
      } else {
        throw new Error(`Google API error (${response.status}): ${toolError}`);
      }
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error (${response.status}): ${error}`);
    }

    const data: any = await response.json();
    return this.extractNativeContentAndToolCalls(data);
  }

  async *chatStream(params: ChatParams): AsyncGenerator<StreamChunk> {
    const contents = this.formatContents(params.messages);
    const maxTokens = this.resolveMaxTokens(params.maxTokens);

    const body: any = {
      contents,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
      },
    };

    if (maxTokens !== undefined) {
      body.generationConfig.maxOutputTokens = maxTokens;
    }

    if (params.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: params.systemPrompt }],
      };
    }

    const tools = this.buildTools(params.tooling);
    if (tools.length > 0) {
      body.tools = tools;
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:streamGenerateContent?alt=sse`;

    const request = (payload: Record<string, unknown>) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
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
        response = await request(fallbackBody);
      } else {
        yield { type: 'error', error: `Google API error (${response.status}): ${toolError}` };
        return;
      }
    }

    if (!response.ok) {
      const error = await response.text();
      yield { type: 'error', error: `Google API error (${response.status}): ${error}` };
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
            if (parsed.error) {
              const message = parsed.error?.message || 'Google stream error';
              yield { type: 'error', error: message };
              return;
            }
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield { type: 'token', content: text };
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
