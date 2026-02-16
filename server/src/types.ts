// --- Server-side Types ---

export type Provider = 'openai' | 'anthropic' | 'google' | 'groq' | 'openrouter' | 'ollama' | 'lmstudio';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type ConciliumMode = 'consensus' | 'factcheck' | 'codereview' | 'brainstorm' | 'debate';

export interface ToolingOptions {
  webSearch?: boolean;
  codeExecution?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  provider: Provider;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  tooling?: ToolingOptions;
  requestId?: string;
}

export interface ConciliumRequest {
  members: Array<{ provider: Provider; model: string }>;
  leader: { provider: Provider; model: string };
  mode?: ConciliumMode;
  blindEval?: boolean;
  messages: ChatMessage[];
  systemPrompt?: string;
  leaderSystemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  tooling?: ToolingOptions;
  requestId?: string;
}

export interface ConciliumMemberResult {
  model: string;
  provider: Provider;
  content: string;
  error?: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface StreamChunk {
  type: 'token' | 'done' | 'error';
  content?: string;
  error?: string;
}

export interface ProviderStatus {
  id: Provider;
  name: string;
  configured: boolean;
  keyCount: number;
  activeKeyId: string | null;
  activeKeyName: string;
  activeKeyMasked: string;
}

export interface ApiKeyUpdateRequest {
  apiKey: string;
  name?: string;
  makeActive?: boolean;
}
