/**
 * Frontend API Service Layer
 * 
 * All API calls go through the backend proxy — API keys are NEVER stored or
 * transmitted from the client side. The backend handles all provider authentication.
 */

import { ModelOption, ToolingOptions } from '../types';

const API_BASE = '/api';

/** Safe JSON parse — avoids "Unexpected end of JSON input" on empty responses */
const safeJson = async (res: Response): Promise<any> => {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
};

const apiFetch = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
  });

const getErrorMessage = async (res: Response, fallback: string): Promise<string> => {
  const payload = await safeJson(res);
  return payload.error || payload.message || fallback;
};

const createRandomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const createStreamingRequestId = (): string => createRandomId();

// --- Types ---

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type UserRole = 'admin' | 'user';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  monthlyCostLimitUsd: number;
  modelAllowlistByProvider: Record<string, string[]>;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  keyCount: number;
  activeKeyId: string | null;
  activeKeyName: string;
  activeKeyMasked: string;
}

export interface ProviderApiKeySummary {
  id: string;
  name: string;
  masked: string;
  createdAt: number;
  isActive: boolean;
}

export interface BackupApiKeyEntry {
  name: string;
  key: string;
  createdAt?: number;
  isActive?: boolean;
}

export interface ProviderStatusDetail extends ProviderStatus {
  keys: ProviderApiKeySummary[];
}

export interface ProviderModelsResponse {
  provider: string;
  providerName: string;
  models: ModelOption[];
  source: 'live' | 'fallback';
  fetchedAt: number;
  requiresApiKey: boolean;
  configured: boolean;
  baseUrl?: string;
  error?: string;
}

export interface ResolvedModelPricing {
  provider: string;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  sourceUrl: string;
  sourceLabel: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export interface ConciliumCallbacks {
  onMemberToken: (index: number, model: string, provider: string, token: string) => void;
  onMemberComplete: (index: number, model: string, provider: string, content: string) => void;
  onMemberError: (index: number, model: string, provider: string, error: string) => void;
  onLeaderToken: (token: string) => void;
  onPhase: (phase: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export async function cancelStreamingRequest(requestId: string): Promise<void> {
  const trimmed = requestId.trim();
  if (!trimmed) return;

  try {
    await apiFetch('/chat/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: trimmed }),
      keepalive: true,
    });
  } catch {
    // Local abort still stops the UI stream; backend cancel best effort.
  }
}

// --- Health ---

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await apiFetch('/health');
    const data = await safeJson(res);
    return data.status === 'ok';
  } catch {
    return false;
  }
}

// --- Providers ---

export async function getProviders(): Promise<ProviderStatus[]> {
  const res = await apiFetch('/providers');
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch providers'));
  const data = await safeJson(res);
  return data.providers ?? [];
}

export async function getProviderStatus(providerId: string): Promise<ProviderStatusDetail> {
  const res = await apiFetch(`/providers/${providerId}/status`);
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch provider status'));
  return safeJson(res);
}

export async function getProviderModels(providerId: string, options?: { refresh?: boolean }): Promise<ProviderModelsResponse> {
  const query = options?.refresh ? '?refresh=1' : '';
  const res = await apiFetch(`/providers/${providerId}/models${query}`);
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch provider models'));
  return safeJson(res);
}

export async function resolveProviderModelPricing(providerId: string, model: string): Promise<ResolvedModelPricing> {
  const res = await apiFetch(`/providers/${providerId}/pricing/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, 'Failed to resolve model pricing'));
  }
  const payload = await safeJson(res);
  if (!payload?.pricing) {
    throw new Error('Pricing response is missing pricing payload.');
  }
  return payload.pricing as ResolvedModelPricing;
}

export async function addProviderApiKey(
  providerId: string,
  apiKey: string,
  options?: { name?: string; makeActive?: boolean }
): Promise<{ success: boolean; key: ProviderApiKeySummary; status: ProviderStatus }> {
  const res = await apiFetch(`/providers/${providerId}/key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey, name: options?.name, makeActive: options?.makeActive }),
  });
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, 'Failed to set API key'));
  }
  return safeJson(res);
}

export async function setProviderApiKey(providerId: string, apiKey: string): Promise<{ success: boolean; key: ProviderApiKeySummary; status: ProviderStatus }> {
  return addProviderApiKey(providerId, apiKey, { makeActive: true });
}

export async function setActiveProviderApiKey(providerId: string, keyId: string): Promise<{ success: boolean; key: ProviderApiKeySummary; status: ProviderStatus }> {
  const res = await apiFetch(`/providers/${providerId}/key/${keyId}/active`, {
    method: 'PATCH',
  });
  if (!res.ok) {
    throw new Error(await getErrorMessage(res, 'Failed to set active API key'));
  }
  return safeJson(res);
}

export async function deleteProviderApiKey(providerId: string, keyId?: string): Promise<{ success: boolean; status: ProviderStatus }> {
  const endpoint = keyId
    ? `/providers/${providerId}/key/${keyId}`
    : `/providers/${providerId}/key`;
  const res = await apiFetch(endpoint, { method: 'DELETE' });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete API key'));
  return safeJson(res);
}

export async function exportProviderApiKeysBackup(): Promise<Record<string, BackupApiKeyEntry[]>> {
  const res = await apiFetch('/providers/backup/api-keys');
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to export API keys backup'));
  const payload = await safeJson(res);
  return payload.providers || {};
}

export async function importProviderApiKeysBackup(
  providers: Record<string, BackupApiKeyEntry[]>
): Promise<void> {
  const res = await apiFetch('/providers/backup/api-keys', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers }),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to restore API keys backup'));
}

// --- Auth / Users ---

export interface CreateUserInput {
  username: string;
  password: string;
  role?: UserRole;
  monthlyCostLimitUsd?: number;
  modelAllowlistByProvider?: Record<string, string[]>;
}

export interface UpdateUserInput {
  role?: UserRole;
  monthlyCostLimitUsd?: number;
  modelAllowlistByProvider?: Record<string, string[]>;
}

export async function loginUser(username: string, password: string): Promise<AuthUser> {
  const res = await apiFetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Login failed'));
  const payload = await safeJson(res);
  return payload.user as AuthUser;
}

export async function logoutUser(): Promise<void> {
  await apiFetch('/auth/logout', { method: 'POST' });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const res = await apiFetch('/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to get current user'));
  const payload = await safeJson(res);
  return (payload.user as AuthUser) || null;
}

export async function changeCurrentUserPassword(currentPassword: string, newPassword: string): Promise<AuthUser> {
  const res = await apiFetch('/auth/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to change password'));
  const payload = await safeJson(res);
  return payload.user as AuthUser;
}

export async function listUsers(): Promise<AuthUser[]> {
  const res = await apiFetch('/auth/users');
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to load users'));
  const payload = await safeJson(res);
  return (payload.users || []) as AuthUser[];
}

export async function createUserAccount(input: CreateUserInput): Promise<AuthUser> {
  const res = await apiFetch('/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create user'));
  const payload = await safeJson(res);
  return payload.user as AuthUser;
}

export async function updateUserAccount(userId: string, patch: UpdateUserInput): Promise<AuthUser> {
  const res = await apiFetch(`/auth/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update user'));
  const payload = await safeJson(res);
  return payload.user as AuthUser;
}

export async function deleteUserAccount(userId: string): Promise<void> {
  const res = await apiFetch(`/auth/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete user'));
}

// --- Chat (SSE Streaming) ---

export async function sendChatMessage(
  params: {
    provider: string;
    model: string;
    messages: ChatMessage[];
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    reasoningEffort?: ReasoningEffort;
    tooling?: ToolingOptions;
    requestId?: string;
  },
  callbacks: StreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const requestId = params.requestId || createStreamingRequestId();
  const abortListener = () => {
    void cancelStreamingRequest(requestId);
  };

  if (signal) {
    if (signal.aborted) {
      abortListener();
    } else {
      signal.addEventListener('abort', abortListener, { once: true });
    }
  }

  try {
    const res = await apiFetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, requestId }),
      signal,
    });

    if (!res.ok) {
      const error = await safeJson(res);
      callbacks.onError(error.error || `Server error: ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError('No response body');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let doneReceived = false;
    let errorReceived = false;

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

          try {
            const data = JSON.parse(trimmed.slice(6));

            if (data.type === 'token' && data.content) {
              callbacks.onToken(data.content);
            } else if (data.type === 'done') {
              if (!doneReceived && !errorReceived) {
                doneReceived = true;
                callbacks.onDone();
              }
            } else if (data.type === 'cancelled') {
              if (!doneReceived && !errorReceived) {
                doneReceived = true;
                callbacks.onDone();
              }
            } else if (data.type === 'error') {
              if (!errorReceived && !doneReceived) {
                errorReceived = true;
                callbacks.onError(data.error || 'Unknown error');
              }
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
      if (!doneReceived && !errorReceived && !signal?.aborted) {
        callbacks.onError('Chat stream ended before completion.');
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    signal?.removeEventListener('abort', abortListener);
  }
}

// --- Chat (Convenience accumulator over streaming) ---

export async function sendChatMessageSync(params: {
  provider: string;
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  tooling?: ToolingOptions;
  requestId?: string;
}): Promise<string> {
  let content = '';
  let streamError: string | null = null;

  await sendChatMessage(params, {
    onToken: (token) => {
      content += token;
    },
    onDone: () => {},
    onError: (error) => {
      streamError = error;
    },
  });

  if (streamError) {
    throw new Error(streamError);
  }

  return content;
}

// --- Concilium (SSE Streaming) ---

export async function sendConciliumMessage(
  params: {
    members: Array<{ provider: string; model: string }>;
    leader: { provider: string; model: string };
    mode?: 'consensus' | 'factcheck' | 'codereview' | 'brainstorm' | 'debate';
    blindEval?: boolean;
    messages: ChatMessage[];
    systemPrompt?: string;
    leaderSystemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    tooling?: ToolingOptions;
    requestId?: string;
  },
  callbacks: ConciliumCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const requestId = params.requestId || createStreamingRequestId();
  const abortListener = () => {
    void cancelStreamingRequest(requestId);
  };

  if (signal) {
    if (signal.aborted) {
      abortListener();
    } else {
      signal.addEventListener('abort', abortListener, { once: true });
    }
  }

  try {
    const res = await apiFetch('/chat/concilium', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, requestId }),
      signal,
    });

    if (!res.ok) {
      const error = await safeJson(res);
      callbacks.onError(error.error || `Server error: ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      callbacks.onError('No response body');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let doneReceived = false;
    let errorReceived = false;

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

          try {
            const data = JSON.parse(trimmed.slice(6));

            switch (data.type) {
              case 'phase':
                callbacks.onPhase(data.phase);
                break;
              case 'member_token':
                callbacks.onMemberToken(data.index, data.model, data.provider, data.content);
                break;
              case 'member_complete':
                callbacks.onMemberComplete(data.index, data.model, data.provider, data.content);
                break;
              case 'member_error':
                callbacks.onMemberError(data.index, data.model, data.provider, data.error);
                break;
              case 'leader_token':
                callbacks.onLeaderToken(data.content);
                break;
              case 'done':
                if (!doneReceived) {
                  doneReceived = true;
                  callbacks.onDone();
                }
                break;
              case 'cancelled':
                if (!doneReceived && !errorReceived) {
                  doneReceived = true;
                  callbacks.onDone();
                }
                break;
              case 'error':
                if (!errorReceived && !doneReceived) {
                  errorReceived = true;
                  callbacks.onError(data.error || 'Unknown error');
                }
                break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      if (!doneReceived && !errorReceived && !signal?.aborted) {
        callbacks.onError('Concilium stream ended before completion.');
      }
    } finally {
      reader.releaseLock();
    }
  } finally {
    signal?.removeEventListener('abort', abortListener);
  }
}

// --- Summarize ---

export async function summarizeConversation(params: {
  provider: string;
  model: string;
  messages: ChatMessage[];
  requestId?: string;
}): Promise<string> {
  const requestId = params.requestId || createStreamingRequestId();
  const res = await apiFetch('/chat/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, requestId }),
  });

  if (!res.ok) {
    let errorMessage = `Failed to summarize (${res.status})`;
    try {
      const error = await safeJson(res);
      errorMessage = error.error || errorMessage;
    } catch {
      // fallback already set
    }
    throw new Error(errorMessage);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let summary = '';
  let streamError: string | null = null;

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

        let data: any;
        try {
          data = JSON.parse(trimmed.slice(6));
        } catch {
          // Skip malformed JSON
          continue;
        }

        if (data.type === 'token' && data.content) {
          summary += data.content;
        } else if (data.type === 'error') {
          streamError = data.error || 'Unknown error';
        } else if (data.type === 'cancelled') {
          throw new Error('Cancelled');
        } else if (data.type === 'done') {
          if (streamError) throw new Error(streamError);
          return summary;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (streamError) {
    throw new Error(streamError);
  }

  return summary;
}

// --- Agents API ---

export interface AgentDeployResult {
  success: boolean;
  agentId?: string;
  message?: string;
  error?: string;
}

export interface AgentStatusResult {
  running: boolean;
  isProcessing: boolean;
  queueLength: number;
  historyLength: number;
  dynamicSchedules: number;
  memorySize: number;
  mcpServers: number;
  mcpTools: number;
}

export interface AgentCostPeriodSummary {
  from: number;
  to: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  apiCalls: number;
  apiCostUsd: number;
  resourceCostUsd: number;
  totalCostUsd: number;
  resourceCounts: Record<string, number>;
}

export interface AgentCostSummaryResult {
  agentId: string;
  generatedAt: number;
  periods: {
    lastDay: AgentCostPeriodSummary;
    lastWeek: AgentCostPeriodSummary;
    lastMonth: AgentCostPeriodSummary;
    lastYear: AgentCostPeriodSummary;
  };
}

export interface TelegramVerifyResult {
  valid: boolean;
  botName?: string;
  chatIdValid?: boolean;
  message?: string;
  error?: string;
}

export interface AgentNoteApi {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentListItemApi {
  id: string;
  text: string;
  checked: boolean;
}

export interface AgentListApi {
  id: string;
  title: string;
  items: AgentListItemApi[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentScheduleApi {
  id: string;
  name: string;
  cron: string;
  instruction: string;
  enabled: boolean;
  startAt?: number;
  frequency?: string;
  conditions?: string;
  timezone?: string;
  lastRunAt?: number;
  lastStatus?: 'success' | 'error';
  lastResult?: string;
  createdAt: number;
}

export interface AgentWorkingMemoryEntryApi {
  id: string;
  label: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export async function deployAgentApi(agentData: Record<string, any>): Promise<AgentDeployResult> {
  const res = await apiFetch('/agents/deploy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(agentData),
  });
  const data = await safeJson(res);
  if (!res.ok) {
    return { success: false, error: data.error || 'Failed to deploy agent' };
  }
  return data;
}

export async function stopAgentApi(agentId: string): Promise<{ success: boolean; error?: string }> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/stop`, {
    method: 'POST',
  });
  const data = await safeJson(res);
  if (!res.ok) {
    return { success: false, error: data.error || 'Failed to stop agent' };
  }
  return data;
}

export async function getAgentStatusApi(agentId: string): Promise<AgentStatusResult> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/status`);
  if (!res.ok) {
    return { running: false, isProcessing: false, queueLength: 0, historyLength: 0, dynamicSchedules: 0, memorySize: 0, mcpServers: 0, mcpTools: 0 };
  }
  return safeJson(res);
}

export async function getAgentCostsApi(agentId: string): Promise<AgentCostSummaryResult | null> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/costs`);
  if (!res.ok) return null;
  const payload = await safeJson(res);
  if (!payload || typeof payload !== 'object' || !payload.periods) return null;
  return payload as AgentCostSummaryResult;
}

export async function getRunningAgentsApi(): Promise<string[]> {
  const res = await apiFetch('/agents/running');
  if (!res.ok) return [];
  const data = await safeJson(res);
  return data.agents || [];
}

export async function setAgentAlwaysOnApi(agentId: string, alwaysOn: boolean): Promise<{ success: boolean; error?: string }> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/always-on`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alwaysOn }),
  });
  const data = await safeJson(res);
  if (!res.ok) {
    return { success: false, error: data.error || 'Failed to set always-on' };
  }
  return data;
}

export async function getAlwaysOnAgentsApi(): Promise<string[]> {
  const res = await apiFetch('/agents/always-on');
  if (!res.ok) return [];
  const data = await safeJson(res);
  return data.agents || [];
}

export interface AgentBudgetUpdateResult {
  success: boolean;
  agentId: string;
  dailyBudgetUsd: number;
  currentDailyCostUsd: number;
  runtimeUpdated: boolean;
}

export interface AgentRuntimeConfigUpdateResult {
  success: boolean;
  agentId: string;
  updated?: {
    provider: string;
    model: string;
  };
  error?: string;
}

export async function updateAgentBudgetApi(
  agentId: string,
  dailyBudgetUsd: number
): Promise<AgentBudgetUpdateResult | null> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/budget`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dailyBudgetUsd }),
  });
  if (!res.ok) return null;
  return safeJson(res);
}

export async function updateAgentRuntimeConfigApi(
  agentId: string,
  payload: {
    provider?: string;
    model?: string;
    runtimeTuning?: unknown;
  }
): Promise<AgentRuntimeConfigUpdateResult> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/runtime-config`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await safeJson(res);
  if (!res.ok) {
    return {
      success: false,
      agentId,
      error: data.error || 'Failed to update runtime config',
    };
  }
  return data as AgentRuntimeConfigUpdateResult;
}

export async function verifyTelegramApi(botToken: string, chatId?: string): Promise<TelegramVerifyResult> {
  const res = await apiFetch('/agents/verify-telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken, chatId }),
  });
  return safeJson(res);
}

export async function resetAgentMemoryApi(agentId: string): Promise<{
  success: boolean;
  agentId: string;
  clearedPersistentMessages: number;
  clearedRuntimeMessages: number;
  clearedConfigMemories: number;
  runtimeUpdated: boolean;
}> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/memory/reset`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to reset agent memory'));
  return safeJson(res);
}

export async function getAgentWorkingMemoryApi(agentId: string): Promise<AgentWorkingMemoryEntryApi[]> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/working-memory`);
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch agent memory'));
  const payload = await safeJson(res);
  return (payload.entries || []) as AgentWorkingMemoryEntryApi[];
}

export async function updateAgentWorkingMemoryEntryApi(
  agentId: string,
  entryId: string,
  updates: { label?: string; content?: string }
): Promise<AgentWorkingMemoryEntryApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/working-memory/${encodeURIComponent(entryId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update agent memory entry'));
  const payload = await safeJson(res);
  return payload.entry as AgentWorkingMemoryEntryApi;
}

export async function deleteAgentWorkingMemoryEntryApi(agentId: string, entryId: string): Promise<void> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/working-memory/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete agent memory entry'));
}

export async function clearAgentWorkingMemoryApi(agentId: string): Promise<{ success: boolean; cleared: number }> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/working-memory/clear`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to clear agent memory'));
  return safeJson(res);
}

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  source?: 'telegram' | 'web';
}

export async function getAgentConversationApi(agentId: string): Promise<AgentChatMessage[]> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/conversation`);
  if (!res.ok) return [];
  const payload = await safeJson(res);
  return payload.messages || [];
}

export async function sendAgentMessageApi(agentId: string, text: string): Promise<{ success: boolean; error?: string }> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  return safeJson(res);
}

export async function getAgentNotesApi(agentId: string): Promise<AgentNoteApi[]> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/notes`);
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch notes'));
  const payload = await safeJson(res);
  return (payload.notes || []) as AgentNoteApi[];
}

export async function createAgentNoteApi(
  agentId: string,
  input: { title: string; content: string; tags?: string[] | string }
): Promise<AgentNoteApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create note'));
  const payload = await safeJson(res);
  return payload.note as AgentNoteApi;
}

export async function updateAgentNoteApi(
  agentId: string,
  noteId: string,
  patch: { title?: string; content?: string; tags?: string[] | string }
): Promise<AgentNoteApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/notes/${encodeURIComponent(noteId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update note'));
  const payload = await safeJson(res);
  return payload.note as AgentNoteApi;
}

export async function deleteAgentNoteApi(agentId: string, noteId: string): Promise<void> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete note'));
}

export async function getAgentListsApi(agentId: string): Promise<AgentListApi[]> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/lists`);
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch lists'));
  const payload = await safeJson(res);
  return (payload.lists || []) as AgentListApi[];
}

export async function getAgentListApi(agentId: string, listId: string): Promise<AgentListApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/lists/${encodeURIComponent(listId)}`);
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch list'));
  const payload = await safeJson(res);
  return payload.list as AgentListApi;
}

export async function createAgentListApi(
  agentId: string,
  input: { title: string; items?: string[] | string }
): Promise<AgentListApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/lists`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create list'));
  const payload = await safeJson(res);
  return payload.list as AgentListApi;
}

export async function updateAgentListApi(
  agentId: string,
  listId: string,
  patch: { title?: string }
): Promise<AgentListApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/lists/${encodeURIComponent(listId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update list'));
  const payload = await safeJson(res);
  return payload.list as AgentListApi;
}

export async function addAgentListItemsApi(
  agentId: string,
  listId: string,
  items: string[] | string
): Promise<AgentListApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/lists/${encodeURIComponent(listId)}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to add list items'));
  const payload = await safeJson(res);
  return payload.list as AgentListApi;
}

export async function updateAgentListItemApi(
  agentId: string,
  listId: string,
  itemId: string,
  patch: { text?: string; checked?: boolean }
): Promise<AgentListApi> {
  const res = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update list item'));
  const payload = await safeJson(res);
  return payload.list as AgentListApi;
}

export async function deleteAgentListItemApi(
  agentId: string,
  listId: string,
  itemId: string
): Promise<AgentListApi> {
  const res = await apiFetch(
    `/agents/${encodeURIComponent(agentId)}/lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' }
  );
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete list item'));
  const payload = await safeJson(res);
  return payload.list as AgentListApi;
}

export async function deleteAgentListApi(agentId: string, listId: string): Promise<void> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/lists/${encodeURIComponent(listId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete list'));
}

export async function getAgentSchedulesApi(agentId: string): Promise<AgentScheduleApi[]> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/schedules`);
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch schedules'));
  const payload = await safeJson(res);
  return (payload.schedules || []) as AgentScheduleApi[];
}

export async function getAgentScheduleApi(agentId: string, scheduleId: string): Promise<AgentScheduleApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}`);
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to fetch schedule'));
  const payload = await safeJson(res);
  return payload.schedule as AgentScheduleApi;
}

export async function createAgentScheduleApi(
  agentId: string,
  input: {
    id?: string;
    name: string;
    cron: string;
    instruction?: string;
    enabled?: boolean;
    startAt?: number | string | null;
    frequency?: string;
    conditions?: string;
    timezone?: string;
  }
): Promise<AgentScheduleApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to create schedule'));
  const payload = await safeJson(res);
  return payload.schedule as AgentScheduleApi;
}

export async function updateAgentScheduleApi(
  agentId: string,
  scheduleId: string,
  patch: {
    name?: string;
    cron?: string;
    instruction?: string;
    enabled?: boolean;
    startAt?: number | string | null;
    frequency?: string | null;
    conditions?: string | null;
    timezone?: string | null;
  }
): Promise<AgentScheduleApi> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to update schedule'));
  const payload = await safeJson(res);
  return payload.schedule as AgentScheduleApi;
}

export async function deleteAgentScheduleApi(agentId: string, scheduleId: string): Promise<void> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/schedules/${encodeURIComponent(scheduleId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await getErrorMessage(res, 'Failed to delete schedule'));
}

// --- MCP API ---

export interface MCPServerStatus {
  id: string;
  connected: boolean;
  toolCount: number;
  serverInfo: { name: string; version: string } | null;
}

export interface MCPToolInfo {
  qualifiedName: string;
  originalName: string;
  serverId: string;
  description: string;
}

export interface MCPStatusResult {
  running: boolean;
  servers: MCPServerStatus[];
  tools: MCPToolInfo[];
}

export interface MCPTestResult {
  success: boolean;
  serverName?: string;
  serverVersion?: string;
  toolCount?: number;
  tools?: Array<{ name: string; description: string }>;
  error?: string;
}

export interface MCPRegistryEntry {
  id: string;
  npmPackage: string;
  description: string;
}

export async function getAgentMCPStatusApi(agentId: string): Promise<MCPStatusResult> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/mcp/status`);
  if (!res.ok) {
    return { running: false, servers: [], tools: [] };
  }
  return safeJson(res);
}

export async function getAgentMCPToolsApi(agentId: string): Promise<MCPToolInfo[]> {
  const res = await apiFetch(`/agents/${encodeURIComponent(agentId)}/mcp/tools`);
  if (!res.ok) return [];
  const data = await safeJson(res);
  return data.tools || [];
}

export async function testMCPServerApi(
  serverId: string,
  config: Record<string, string> = {}
): Promise<MCPTestResult> {
  const res = await apiFetch('/agents/mcp/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverId, config }),
  });
  return safeJson(res);
}

export async function getMCPRegistryApi(): Promise<MCPRegistryEntry[]> {
  const res = await apiFetch('/agents/mcp/registry');
  if (!res.ok) return [];
  const data = await safeJson(res);
  return data.servers || [];
}

// --- Data Persistence (Server-side SQLite) ---

export async function fetchServerState(): Promise<Record<string, any>> {
  try {
    const res = await apiFetch('/data/state');
    if (!res.ok) return {};
    return safeJson(res);
  } catch {
    return {};
  }
}

export async function saveServerState(state: Record<string, any>): Promise<boolean> {
  try {
    const res = await apiFetch('/data/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function saveServerStateKey(key: string, value: any): Promise<boolean> {
  try {
    const res = await apiFetch(`/data/state/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearServerState(): Promise<boolean> {
  try {
    const res = await apiFetch('/data/state', { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Webhook APIs
// ---------------------------------------------------------------------------

export async function generateWebhookSecretApi(): Promise<{ secret: string } | null> {
  try {
    const res = await apiFetch('/webhooks/generate-secret', { method: 'POST' });
    if (!res.ok) return null;
    return safeJson(res);
  } catch {
    return null;
  }
}

export async function getWebhookInfoApi(agentId: string): Promise<{
  enabled: boolean;
  webhookUrl: string;
  allowedSources: string[];
  hasSecret: boolean;
} | null> {
  try {
    const res = await apiFetch(`/webhooks/${encodeURIComponent(agentId)}/info`);
    if (!res.ok) return null;
    return safeJson(res);
  } catch {
    return null;
  }
}

export async function sendTestWebhookApi(agentId: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const res = await apiFetch(`/webhooks/${encodeURIComponent(agentId)}/test`, { method: 'POST' });
    return safeJson(res);
  } catch {
    return { success: false, error: 'Connection error' };
  }
}
