// ---------------------------------------------------------------------------
// Agent Runtime Types
// ---------------------------------------------------------------------------

import { Provider } from '../types';
import { CalendarConfig } from './calendar';
import { GmailConfig } from './gmail';
import { RadarrConfig } from './radarr';
import { SonarrConfig } from './sonarr';
import { HomeAssistantConfig } from './homeAssistant';

export interface MediaConfig {
  radarr?: RadarrConfig;
  sonarr?: SonarrConfig;
}

export interface AgentRuntimeTuning {
  fastToolsPrompt?: boolean;
  compactToolsPrompt?: boolean;
  maxMcpToolsInPrompt?: number;
  maxToolIterations?: number;
  fastConfirmationMaxToolIterations?: number;
  toolResultMaxChars?: number;
  toolResultsTotalMaxChars?: number;
  llmTimeoutMs?: number;
  toolTimeoutMs?: number;
  queueDelayUserMs?: number;
  queueDelayBackgroundMs?: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  objective: string;
  systemPrompt: string;
  provider: Provider;
  model: string;
  permissions: {
    internetAccess: boolean;
    headlessBrowser: boolean;
    notesAccess: boolean;
    schedulerAccess: boolean;
    calendarAccess: boolean;
    gmailAccess: boolean;
    mediaAccess: boolean;
    terminalAccess: boolean;
    codeExecution: boolean;
    allowedWebsites: string[];
    requireApprovalForNewSites: boolean;
    webCredentials: Array<{ site: string; username: string; password: string }>;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
  calendar?: CalendarConfig;
  gmail?: GmailConfig;
  media?: MediaConfig;
  homeAssistant?: HomeAssistantConfig;
  schedules: Array<{
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
  }>;
  mcpServers: Array<{
    id: string;
    enabled: boolean;
    config: Record<string, string>;
  }>;
  memory: string[];
  temperature?: number;
  maxTokens?: number;
  memoryRecentWindow?: number;
  memoryRecallLimit?: number;
  /** Enable Smart RAG: LLM-based relevance scoring of recalled memories (default: true) */
  enableSmartRAG?: boolean;
  /** Daily budget hard limit in USD per agent (0 = no limit) */
  dailyBudgetUsd?: number;
  /** IANA timezone for the agent (e.g. 'Europe/Madrid') */
  timezone?: string;
  /** Per-agent runtime tuning for latency/token behavior */
  runtimeTuning?: AgentRuntimeTuning;
  /** Webhook configuration for event-based proactivity */
  webhooks?: {
    enabled: boolean;
    secret: string;
    allowedSources: string[];
  };
  /** Real-time event configuration */
  realtimeEvents?: {
    /** Enable Home Assistant WebSocket for real-time state changes */
    haWebSocket?: boolean;
    /** HA entity filters — only forward events for these prefixes (e.g. ['binary_sensor.', 'alarm_control_panel.']) */
    haEntityFilters?: string[];
    /** Enable Gmail push notifications (requires GMAIL_PUBSUB_TOPIC env var) */
    gmailPush?: boolean;
    /** Debounce for HA events in ms (default: 2500) */
    haDebounceMs?: number;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface ToolCallRequest {
  name: string;
  params: Record<string, any>;
}

export interface ToolCallResult {
  name: string;
  success: boolean;
  result: string;
  error?: string;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool_result';
  content: string;
  timestamp: number;
  /** Origin channel: 'telegram' | 'web' (only set on user messages for UI purposes) */
  source?: 'telegram' | 'web';
}

export interface AgentRuntimeState {
  agentId: string;
  config: AgentConfig;
  conversationHistory: AgentMessage[];
  isRunning: boolean;
  lastActivity: number;
  pendingApprovals: string[];
}

// ---------------------------------------------------------------------------
// Terminal / Code Execution Approval
// ---------------------------------------------------------------------------

export interface PendingApproval {
  id: string;
  agentId: string;
  type: 'terminal' | 'code' | 'critical_action';
  command?: string;
  code?: string;
  language?: string;
  reason: string;
  actionLabel?: string;
  actionDetails?: string;
  createdAt: number;
  resolve: (approved: boolean) => void;
}
