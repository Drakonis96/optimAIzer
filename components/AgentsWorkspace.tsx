import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  ExternalLink,
  Eye,
  EyeOff,
  Film,
  FileText,
  Globe2,
  HelpCircle,
  ListChecks,
  Lock,
  Mail,
  MessageCircle,
  MessageSquareText,
  Monitor,
  MonitorSmartphone,
  Play,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  Square,
  Terminal,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
  Zap,
  Copy,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getAllModelsForProvider, getDefaultModelForProvider, PROVIDERS } from '../constants';
import {
  sendChatMessage,
  deployAgentApi,
  stopAgentApi,
  getAgentStatusApi,
  getAgentCostsApi,
  getRunningAgentsApi,
  verifyTelegramApi,
  resetAgentMemoryApi,
  getAgentNotesApi,
  getAgentListsApi,
  getAgentSchedulesApi,
  deleteAgentNoteApi,
  deleteAgentScheduleApi,
  deleteAgentListApi,
  updateAgentScheduleApi,
  updateAgentBudgetApi,
  generateWebhookSecretApi,
  getWebhookInfoApi,
  sendTestWebhookApi,
  setAgentAlwaysOnApi,
  getAlwaysOnAgentsApi,
  getAgentConversationApi,
  sendAgentMessageApi,
  getAgentWorkingMemoryApi,
  updateAgentWorkingMemoryEntryApi,
  deleteAgentWorkingMemoryEntryApi,
  clearAgentWorkingMemoryApi,
  updateAgentRuntimeConfigApi,
} from '../services/api';
import type {
  AgentCostSummaryResult,
  AgentStatusResult,
  AgentNoteApi,
  AgentListApi,
  AgentScheduleApi,
  AgentChatMessage,
  AgentWorkingMemoryEntryApi,
} from '../services/api';
import { Language, ModelOption, SystemPrompt } from '../types';
import { ConfirmationModal } from './ConfirmationModal';

type AgentTab = 'general' | 'instructions' | 'permissions' | 'integrations' | 'scheduler' | 'data' | 'memory';
type AgentSection = 'config' | 'chat';
type AgentStatus = 'draft' | 'active' | 'paused';
type ScheduleBuilderMode = 'weekly' | 'once';

export interface AgentWebCredential {
  id: string;
  site: string;
  username: string;
  password: string;
}

export interface AgentPermissionSettings {
  sandboxMode: true;
  internetAccess: boolean;
  notesAccess: boolean;
  schedulerAccess: boolean;
  gmailAccess: boolean;
  mediaAccess: boolean;
  terminalAccess: boolean;
  codeExecution: boolean;
  allowedWebsites: string[];
  headlessBrowser: boolean;
  webCredentials: AgentWebCredential[];
  requireApprovalForNewSites: boolean;
}

export interface MCPServerConfig {
  id: string;
  enabled: boolean;
  config: Record<string, string>;
}

export interface AgentCalendarConfig {
  google?: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    calendarId?: string;
  };
  icloud?: {
    email: string;
    appSpecificPassword: string;
    calendarName?: string;
  };
}

export interface AgentMediaConfig {
  radarr?: {
    url: string;
    apiKey: string;
  };
  sonarr?: {
    url: string;
    apiKey: string;
  };
}

export interface AgentGmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface AgentWebhookConfig {
  enabled: boolean;
  secret: string;
  allowedSources: string[];
}

export interface AgentIntegrationSettings {
  telegram: {
    botToken: string;
    chatId: string;
    tutorialStep: number;
    verified: boolean;
  };
  mcpServers: MCPServerConfig[];
  calendar?: AgentCalendarConfig;
  gmail?: AgentGmailConfig;
  media?: AgentMediaConfig;
  homeAssistant?: {
    url: string;
    token: string;
  };
  webhooks?: AgentWebhookConfig;
}

export interface AgentSchedulerTask {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
}

export interface AgentGuideMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp: number;
}

export type AgentChatMode = 'config' | 'telegram_test';

export interface AgentRuntimeTuningSettings {
  fastToolsPrompt: boolean;
  compactToolsPrompt: boolean;
  maxMcpToolsInPrompt: number;
  maxToolIterations: number;
  fastConfirmationMaxToolIterations: number;
  toolResultMaxChars: number;
  toolResultsTotalMaxChars: number;
  llmTimeoutMs: number;
  toolTimeoutMs: number;
  queueDelayUserMs: number;
  queueDelayBackgroundMs: number;
}

export interface AutonomousAgent {
  id: string;
  name: string;
  objective: string;
  status: AgentStatus;
  systemPrompt: string;
  permissions: AgentPermissionSettings;
  integrations: AgentIntegrationSettings;
  schedules: AgentSchedulerTask[];
  setupProvider: string;
  setupModel: string;
  setupSystemPromptId: string;
  setupMaxTokens: number;
  setupTemperature: number;
  chatMode: AgentChatMode;
  setupChat: AgentGuideMessage[];
  telegramTestChat: AgentGuideMessage[];
  trainingMemory: string[];
  enableSmartRAG: boolean;
  /** Daily budget hard limit in USD (0 = no limit) */
  dailyBudgetUsd: number;
  /** IANA timezone for the agent (e.g. 'Europe/Madrid') */
  timezone: string;
  runtimeTuning: AgentRuntimeTuningSettings;
  platformCompatibility: {
    macos: boolean;
    windows: boolean;
  };
  alwaysOn: boolean;
  archivedAt?: number | null;
  deletedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentWorkspaceState {
  agents: AutonomousAgent[];
  activeAgentId: string;
}

export interface AgentProviderOption {
  id: string;
  name: string;
  models: ModelOption[];
}

interface AgentsWorkspaceProps {
  language: Language;
  workspace: AgentWorkspaceState;
  preferredProviderId: string;
  preferredModelId: string;
  preferredSystemPromptId?: string;
  preferredTemperature?: number;
  preferredMaxTokens?: number;
  systemPrompts: SystemPrompt[];
  availableProviders: AgentProviderOption[];
  onWorkspaceChange: React.Dispatch<React.SetStateAction<AgentWorkspaceState>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createUniqueId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getSupportedTimezones = (): string[] => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
};

const SUPPORTED_TIMEZONES = getSupportedTimezones();
const SUPPORTED_TIMEZONE_SET = new Set(SUPPORTED_TIMEZONES);

const getDefaultAgentTimezone = (): string => {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (SUPPORTED_TIMEZONE_SET.size === 0 || SUPPORTED_TIMEZONE_SET.has(detected)) {
    return detected;
  }
  return SUPPORTED_TIMEZONE_SET.has('UTC') ? 'UTC' : SUPPORTED_TIMEZONES[0] || detected;
};

const normalizeAgentTimezone = (value: unknown): string => {
  const fallback = getDefaultAgentTimezone();
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (SUPPORTED_TIMEZONE_SET.size === 0) return trimmed;
  return SUPPORTED_TIMEZONE_SET.has(trimmed) ? trimmed : fallback;
};

const splitTimezone = (timezone: string): { region: string; place: string } | null => {
  const parts = timezone.split('/');
  if (parts.length < 2) return null;
  const region = parts[0];
  const place = parts.slice(1).join('/');
  if (!region || !place) return null;
  return { region, place };
};

const getFallbackProvider = (): string => PROVIDERS[0]?.id || 'openai';

const getProviderModelFallback = (providerId: string): string => {
  const listed = getAllModelsForProvider(providerId);
  if (listed.length > 0) return listed[0].id;
  return getDefaultModelForProvider(providerId) || '';
};

const parseLineList = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

const sanitizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const QUICK_SCHEDULE_TIMES = ['08:00', '09:00', '12:00', '15:00', '18:00', '21:00'];

const parseTimeParts = (value: string): { hour: number; minute: number } | null => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
};

const buildScheduleFromBuilder = (
  mode: ScheduleBuilderMode,
  time: string,
  weekdays: number[],
  singleDate: string
): string => {
  const parsedTime = parseTimeParts(time);
  if (!parsedTime) return '';
  const { hour, minute } = parsedTime;

  if (mode === 'once') {
    const normalizedDate = String(singleDate || '').trim();
    if (!normalizedDate) return '';
    return `once:${normalizedDate}T${time}`;
  }

  const normalizedDays = [...new Set(weekdays)]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  if (normalizedDays.length === 0) return '';
  const weekdayField = normalizedDays.length === 7 ? '*' : normalizedDays.join(',');
  return `${minute} ${hour} * * ${weekdayField}`;
};

const isKnownProvider = (providerId: string): boolean => PROVIDERS.some((provider) => provider.id === providerId);

const AGENT_SETUP_MIN_TEMPERATURE = 0;
const AGENT_SETUP_MAX_TEMPERATURE = 2;
const AGENT_SETUP_MIN_TOKENS = 128;
const AGENT_SETUP_MAX_TOKENS = 4096;
const AGENT_SETUP_DEFAULT_TEMPERATURE = 0.25;
const AGENT_SETUP_DEFAULT_MAX_TOKENS = 700;
const AGENT_RUNTIME_DEFAULTS: AgentRuntimeTuningSettings = {
  fastToolsPrompt: true,
  compactToolsPrompt: true,
  maxMcpToolsInPrompt: 12,
  maxToolIterations: 6,
  fastConfirmationMaxToolIterations: 3,
  toolResultMaxChars: 900,
  toolResultsTotalMaxChars: 3600,
  llmTimeoutMs: 70_000,
  toolTimeoutMs: 45_000,
  queueDelayUserMs: 20,
  queueDelayBackgroundMs: 80,
};
const AGENT_SETUP_RECENT_WINDOW = 12;
const AGENT_SETUP_MEMORY_LIMIT = 6;
const AGENT_SETUP_MEMORY_SNIPPET_MAX_CHARS = 220;
const MEMORY_TOKEN_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ0-9_./:#-]+/g;
const MEMORY_LOW_SIGNAL_TERMS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'for', 'from', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'so', 'that', 'the', 'their',
  'them', 'there', 'they', 'this', 'to', 'was', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you',
  'your', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'pero', 'que', 'en', 'es',
  'por', 'con', 'para', 'se', 'lo', 'le', 'les', 'su', 'sus', 'como', 'mas', 'más', 'ya', 'mi', 'tu', 'nos',
  'nuestro', 'nuestra', 'tambien', 'también', 'muy', 'todo', 'toda', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras',
]);

const clampSetupTemperature = (value: unknown, fallback = AGENT_SETUP_DEFAULT_TEMPERATURE): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(AGENT_SETUP_MIN_TEMPERATURE, Math.min(AGENT_SETUP_MAX_TEMPERATURE, Number(numeric)));
};

const clampSetupMaxTokens = (value: unknown, fallback = AGENT_SETUP_DEFAULT_MAX_TOKENS): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : Math.floor(fallback);
  return Math.max(AGENT_SETUP_MIN_TOKENS, Math.min(AGENT_SETUP_MAX_TOKENS, numeric));
};

const clampRuntimeInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : Math.floor(fallback);
  return Math.max(min, Math.min(max, numeric));
};

const normalizeRuntimeTuning = (value: unknown): AgentRuntimeTuningSettings => {
  const candidate = value && typeof value === 'object' ? (value as Partial<AgentRuntimeTuningSettings>) : {};
  return {
    fastToolsPrompt: candidate.fastToolsPrompt !== false,
    compactToolsPrompt: candidate.compactToolsPrompt !== false,
    maxMcpToolsInPrompt: clampRuntimeInteger(candidate.maxMcpToolsInPrompt, AGENT_RUNTIME_DEFAULTS.maxMcpToolsInPrompt, 0, 200),
    maxToolIterations: clampRuntimeInteger(candidate.maxToolIterations, AGENT_RUNTIME_DEFAULTS.maxToolIterations, 2, 12),
    fastConfirmationMaxToolIterations: clampRuntimeInteger(candidate.fastConfirmationMaxToolIterations, AGENT_RUNTIME_DEFAULTS.fastConfirmationMaxToolIterations, 1, 8),
    toolResultMaxChars: clampRuntimeInteger(candidate.toolResultMaxChars, AGENT_RUNTIME_DEFAULTS.toolResultMaxChars, 200, 6000),
    toolResultsTotalMaxChars: clampRuntimeInteger(candidate.toolResultsTotalMaxChars, AGENT_RUNTIME_DEFAULTS.toolResultsTotalMaxChars, 600, 24000),
    llmTimeoutMs: clampRuntimeInteger(candidate.llmTimeoutMs, AGENT_RUNTIME_DEFAULTS.llmTimeoutMs, 10_000, 240_000),
    toolTimeoutMs: clampRuntimeInteger(candidate.toolTimeoutMs, AGENT_RUNTIME_DEFAULTS.toolTimeoutMs, 10_000, 180_000),
    queueDelayUserMs: clampRuntimeInteger(candidate.queueDelayUserMs, AGENT_RUNTIME_DEFAULTS.queueDelayUserMs, 10, 2_000),
    queueDelayBackgroundMs: clampRuntimeInteger(candidate.queueDelayBackgroundMs, AGENT_RUNTIME_DEFAULTS.queueDelayBackgroundMs, 20, 5_000),
  };
};

const truncateMemorySnippet = (value: string, maxChars = AGENT_SETUP_MEMORY_SNIPPET_MAX_CHARS): string => {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1)}…`;
};

const extractMemoryTerms = (value: string): string[] => {
  const matches = (value.toLowerCase().match(MEMORY_TOKEN_PATTERN) ?? []) as string[];
  return Array.from(
    new Set(
      matches.filter((token: string) => token.length >= 3 && !MEMORY_LOW_SIGNAL_TERMS.has(token))
    )
  );
};

const buildRelevantMemorySnippets = (
  messages: AgentGuideMessage[],
  query: string,
  recentWindow: number,
  limit: number
): string[] => {
  if (messages.length <= recentWindow) return [];
  const recentIds = new Set(messages.slice(-recentWindow).map((message) => message.id));
  const queryTerms = extractMemoryTerms(query);
  if (queryTerms.length === 0) return [];

  const scored = messages
    .filter((message) => !recentIds.has(message.id))
    .map((message, index, source) => {
      const terms = extractMemoryTerms(message.content);
      const overlap = terms.filter((term) => queryTerms.includes(term)).length;
      if (overlap === 0) return null;
      const recencyBoost = (index + 1) / source.length;
      const roleBoost = message.role === 'user' ? 0.3 : 0.15;
      const score = overlap * 3 + recencyBoost + roleBoost;
      return { message, score };
    })
    .filter((item): item is { message: AgentGuideMessage; score: number } => Boolean(item))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .sort((a, b) => a.message.timestamp - b.message.timestamp);

  return scored.map(({ message }) => {
    const roleLabel = message.role === 'user' ? 'user' : 'assistant';
    return `[${roleLabel}] ${truncateMemorySnippet(message.content)}`;
  });
};

// ---------------------------------------------------------------------------
// MCP Marketplace Catalog
// ---------------------------------------------------------------------------

interface MCPCatalogEntry {
  id: string;
  name: string;
  description: { es: string; en: string };
  category: 'search' | 'browser' | 'data' | 'communication' | 'productivity' | 'database';
  icon: string;
  configFields: Array<{
    key: string;
    label: { es: string; en: string };
    type: 'text' | 'password';
    placeholder: string;
    required: boolean;
    help?: { es: string; en: string };
  }>;
  setupHelp?: { es: string; en: string };
  setupUrl?: string;
}

const MCP_CATALOG: MCPCatalogEntry[] = [
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: {
      es: 'Búsqueda web con privacidad usando la API de Brave',
      en: 'Privacy-focused web search using Brave API',
    },
    category: 'search',
    icon: '🔍',
    configFields: [
      {
        key: 'apiKey',
        label: { es: 'Clave de API', en: 'API Key' },
        type: 'password',
        placeholder: 'BSA...',
        required: true,
        help: {
          es: 'Regístrate gratis en brave.com/search/api y copia tu clave',
          en: 'Sign up free at brave.com/search/api and copy your key',
        },
      },
    ],
    setupUrl: 'https://brave.com/search/api/',
    setupHelp: {
      es: '1. Ve a brave.com/search/api\n2. Crea una cuenta gratis\n3. Copia la API Key y pégala aquí',
      en: '1. Go to brave.com/search/api\n2. Create a free account\n3. Copy the API Key and paste it here',
    },
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: {
      es: 'Navegador automático para abrir páginas web — sin configuración',
      en: 'Automatic browser to open web pages — no config needed',
    },
    category: 'browser',
    icon: '🌐',
    configFields: [],
    setupHelp: {
      es: 'No necesita configuración. Solo activa y listo.',
      en: 'No configuration needed. Just enable and go.',
    },
  },
  {
    id: 'playwright',
    name: 'Playwright',
    description: {
      es: 'Navegador avanzado para automatización web — sin configuración',
      en: 'Advanced browser for web automation — no config needed',
    },
    category: 'browser',
    icon: '🎭',
    configFields: [],
    setupHelp: {
      es: 'No necesita configuración. Solo activa y listo.',
      en: 'No configuration needed. Just enable and go.',
    },
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: {
      es: 'Descarga contenido de cualquier página web — sin configuración',
      en: 'Download content from any web page — no config needed',
    },
    category: 'data',
    icon: '📡',
    configFields: [],
    setupHelp: {
      es: 'No necesita configuración. Solo activa y listo.',
      en: 'No configuration needed. Just enable and go.',
    },
  },
  {
    id: 'memory',
    name: 'Memory',
    description: {
      es: 'Memoria extra para el agente entre sesiones — sin configuración',
      en: 'Extra memory for the agent across sessions — no config needed',
    },
    category: 'data',
    icon: '🧠',
    configFields: [],
    setupHelp: {
      es: 'No necesita configuración. Solo activa y listo.',
      en: 'No configuration needed. Just enable and go.',
    },
  },
  {
    id: 'github',
    name: 'GitHub',
    description: {
      es: 'Accede a repositorios, issues y PRs de GitHub',
      en: 'Access GitHub repositories, issues, and PRs',
    },
    category: 'productivity',
    icon: '🐙',
    configFields: [
      {
        key: 'token',
        label: { es: 'Token de acceso', en: 'Access token' },
        type: 'password',
        placeholder: 'ghp_...',
        required: true,
        help: {
          es: 'Ve a GitHub → Settings → Developer settings → Personal access tokens → Generate',
          en: 'Go to GitHub → Settings → Developer settings → Personal access tokens → Generate',
        },
      },
    ],
    setupUrl: 'https://github.com/settings/tokens',
    setupHelp: {
      es: '1. Abre github.com/settings/tokens\n2. Haz clic en "Generate new token"\n3. Dale permisos de lectura\n4. Copia el token y pégalo aquí',
      en: '1. Open github.com/settings/tokens\n2. Click "Generate new token"\n3. Grant read permissions\n4. Copy the token and paste it here',
    },
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: {
      es: 'Accede y gestiona archivos en Google Drive',
      en: 'Access and manage Google Drive files',
    },
    category: 'productivity',
    icon: '📁',
    configFields: [
      {
        key: 'credentials',
        label: { es: 'Credenciales (JSON)', en: 'Credentials (JSON)' },
        type: 'text',
        placeholder: '{"client_id": ...}',
        required: true,
        help: {
          es: 'Descarga el JSON de credenciales desde Google Cloud Console → APIs',
          en: 'Download credentials JSON from Google Cloud Console → APIs',
        },
      },
    ],
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
    setupHelp: {
      es: '1. Abre Google Cloud Console\n2. Crea un proyecto\n3. Habilita la API de Google Drive\n4. Crea credenciales OAuth\n5. Descarga el JSON y pégalo aquí',
      en: '1. Open Google Cloud Console\n2. Create a project\n3. Enable Google Drive API\n4. Create OAuth credentials\n5. Download the JSON and paste here',
    },
  },
  {
    id: 'slack',
    name: 'Slack',
    description: {
      es: 'Envía y lee mensajes en canales de Slack',
      en: 'Send and read messages in Slack channels',
    },
    category: 'communication',
    icon: '💬',
    configFields: [
      {
        key: 'botToken',
        label: { es: 'Token del bot', en: 'Bot Token' },
        type: 'password',
        placeholder: 'xoxb-...',
        required: true,
        help: {
          es: 'Crea una app en api.slack.com → OAuth → Bot Token',
          en: 'Create an app at api.slack.com → OAuth → Bot Token',
        },
      },
    ],
    setupUrl: 'https://api.slack.com/apps',
    setupHelp: {
      es: '1. Ve a api.slack.com/apps\n2. Crea una nueva app\n3. Ve a OAuth & Permissions\n4. Copia el Bot User OAuth Token',
      en: '1. Go to api.slack.com/apps\n2. Create a new app\n3. Go to OAuth & Permissions\n4. Copy the Bot User OAuth Token',
    },
  },
  {
    id: 'notion',
    name: 'Notion',
    description: {
      es: 'Lee y escribe en tus bases de datos y páginas de Notion',
      en: 'Read and write Notion databases and pages',
    },
    category: 'productivity',
    icon: '📝',
    configFields: [
      {
        key: 'apiKey',
        label: { es: 'Clave de integración', en: 'Integration Key' },
        type: 'password',
        placeholder: 'ntn_...',
        required: true,
        help: {
          es: 'Crea una integración en notion.so/my-integrations y copia el token',
          en: 'Create an integration at notion.so/my-integrations and copy the token',
        },
      },
    ],
    setupUrl: 'https://www.notion.so/my-integrations',
    setupHelp: {
      es: '1. Ve a notion.so/my-integrations\n2. Crea nueva integración\n3. Copia el "Internal Integration Secret"\n4. En Notion, comparte las páginas con tu integración',
      en: '1. Go to notion.so/my-integrations\n2. Create new integration\n3. Copy the "Internal Integration Secret"\n4. In Notion, share pages with your integration',
    },
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: {
      es: 'Consulta bases de datos PostgreSQL',
      en: 'Query PostgreSQL databases',
    },
    category: 'database',
    icon: '🗄️',
    configFields: [
      {
        key: 'connectionString',
        label: { es: 'URL de conexión', en: 'Connection URL' },
        type: 'password',
        placeholder: 'postgresql://user:pass@host/db',
        required: true,
        help: {
          es: 'Formato: postgresql://usuario:contraseña@servidor:5432/basedatos',
          en: 'Format: postgresql://user:password@host:5432/database',
        },
      },
    ],
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: {
      es: 'Base de datos SQLite local',
      en: 'Local SQLite database',
    },
    category: 'database',
    icon: '💾',
    configFields: [
      {
        key: 'dbPath',
        label: { es: 'Ruta del archivo', en: 'File path' },
        type: 'text',
        placeholder: '/sandbox/data.db',
        required: true,
        help: {
          es: 'Ruta donde se guarda la base de datos (se crea automáticamente)',
          en: 'Path where the database file will be stored (created automatically)',
        },
      },
    ],
  },
  {
    id: 'filesystem',
    name: 'Filesystem (Sandbox)',
    description: {
      es: 'Lee y escribe archivos en una carpeta segura',
      en: 'Read and write files in a secure folder',
    },
    category: 'data',
    icon: '📂',
    configFields: [
      {
        key: 'allowedDirs',
        label: { es: 'Carpeta permitida', en: 'Allowed folder' },
        type: 'text',
        placeholder: '/sandbox/workspace',
        required: false,
        help: {
          es: 'Carpeta a la que tendrá acceso el agente. Déjalo vacío para usar /tmp',
          en: 'Folder the agent can access. Leave empty for /tmp',
        },
      },
    ],
  },
  {
    id: 'exa',
    name: 'Exa',
    description: {
      es: 'Búsqueda inteligente con IA — encuentra resultados más relevantes',
      en: 'AI-powered smart search — find more relevant results',
    },
    category: 'search',
    icon: '⚡',
    configFields: [
      {
        key: 'apiKey',
        label: { es: 'Clave de API', en: 'API Key' },
        type: 'password',
        placeholder: 'exa-...',
        required: true,
        help: {
          es: 'Regístrate en exa.ai y copia tu clave de API',
          en: 'Sign up at exa.ai and copy your API key',
        },
      },
    ],
    setupUrl: 'https://exa.ai',
    setupHelp: {
      es: '1. Regístrate en exa.ai\n2. Ve a la sección de API Keys\n3. Copia la clave y pégala aquí',
      en: '1. Sign up at exa.ai\n2. Go to the API Keys section\n3. Copy the key and paste it here',
    },
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    description: {
      es: 'Extrae información estructurada de cualquier web',
      en: 'Extract structured content from any webpage',
    },
    category: 'browser',
    icon: '🔥',
    configFields: [
      {
        key: 'apiKey',
        label: { es: 'Clave de API', en: 'API Key' },
        type: 'password',
        placeholder: 'fc-...',
        required: true,
        help: {
          es: 'Regístrate en firecrawl.dev y copia tu clave',
          en: 'Sign up at firecrawl.dev and copy your key',
        },
      },
    ],
    setupUrl: 'https://firecrawl.dev',
  },
  {
    id: 'google-maps',
    name: 'Google Maps',
    description: {
      es: 'Busca direcciones, rutas y comercios cercanos',
      en: 'Search addresses, routes, and nearby businesses',
    },
    category: 'data',
    icon: '🗺️',
    configFields: [
      {
        key: 'apiKey',
        label: { es: 'Clave de API', en: 'API Key' },
        type: 'password',
        placeholder: 'AIza...',
        required: true,
        help: {
          es: 'Crea una clave en Google Cloud Console → APIs → Google Maps',
          en: 'Create a key in Google Cloud Console → APIs → Google Maps',
        },
      },
    ],
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
  },
];

const MCP_CATEGORIES = {
  search: { es: 'Búsqueda', en: 'Search', icon: '🔍' },
  browser: { es: 'Navegador', en: 'Browser', icon: '🌐' },
  data: { es: 'Datos', en: 'Data', icon: '📊' },
  communication: { es: 'Comunicación', en: 'Communication', icon: '💬' },
  productivity: { es: 'Productividad', en: 'Productivity', icon: '📋' },
  database: { es: 'Base de datos', en: 'Database', icon: '🗄️' },
} as const;

// ---------------------------------------------------------------------------
// i18n copy
// ---------------------------------------------------------------------------

const getCopy = (language: Language) => {
  if (language === 'es') {
    return {
      title: 'Agentes autónomos',
      subtitle: 'Crea y gestiona agentes potentes en un entorno seguro tipo sandbox.',
      newAgent: 'Nuevo agente',
      deleteAgent: 'Eliminar agente',
      emptyStateTitle: 'No hay agentes',
      emptyStateBody: 'Crea tu primer agente para empezar la configuración.',
      status: { draft: 'Borrador', active: 'Activo', paused: 'Pausado' },
      tabs: {
        general: 'General',
        instructions: 'Instrucciones base',
        permissions: 'Permisos y entorno',
        integrations: 'Integraciones',
        scheduler: 'Scheduler',
        assistant: 'Chat interno',
        data: 'Datos del agente',
        memory: 'Memoria',
      },
      capabilitiesTitle: 'Capacidades del agente',
      capabilities: [
        'Ejecución segura en sandbox aislado',
        'Navegador headless para automatizar tareas web',
        'Navegación por internet controlada',
        'Acceso a webs con login y consulta de información en tiempo real',
        'Marketplace de MCPs con instalación en un clic',
        'Comunicación exclusiva por bot de Telegram',
        'Acceso al terminal del sistema (con autorización)',
        'Ejecución de código en el dispositivo (con autorización)',
      ],

      fields: {
        name: 'Nombre del agente',
        objective: 'Objetivo operativo',
        systemPrompt: 'System prompt (instrucciones base)',
        status: 'Estado',
        provider: 'Proveedor del chat interno',
        model: 'Modelo del chat interno',
      },
      instructionsHelp:
        'Define el comportamiento principal del agente. Esta base guiará cómo ejecuta tareas, reporta avances y solicita confirmaciones.',
      permissions: {
        sandboxTitle: 'Entorno de ejecución',
        sandboxBody: 'El agente opera en un entorno aislado y seguro por defecto. No tiene acceso directo a tu ordenador, sistema de archivos ni terminal, salvo que actives los permisos correspondientes.',
        internetAccess: 'Acceso a internet',
        headlessBrowser: 'Navegador headless',
        notesAccess: 'Acceso a notas',
        schedulerAccess: 'Acceso a scheduler',
        terminalAccess: 'Acceso al terminal',
        codeExecution: 'Ejecución de código',
        allowedWebsites: 'Sitios web permitidos (uno por línea)',
        requireApproval: 'Pedir aprobación para sitios nuevos',
      webCredentialsTitle: 'Credenciales web',
      webCredentialsBody: 'Añade credenciales para que el agente pueda iniciar sesión y consultar sitios web en tu nombre de forma segura.',
      addCredential: 'Añadir credencial',
        site: 'Sitio web',
        username: 'Usuario',
        password: 'Contraseña',
        guardrailsTitle: 'Seguridad del entorno',
        guardrailsBody:
          'El agente solo puede actuar dentro de los permisos configurados. Cada ejecución de terminal o código requiere aprobación explícita del usuario por Telegram antes de ejecutarse.',
        systemAccessTitle: '⚠️ Acceso al sistema activado',
        systemAccessBody:
          'Has activado permisos que permiten al agente interactuar con el sistema operativo. El agente pedirá autorización antes de cada acción, pero ten cuidado con los comandos que apruebas. Usa esto solo en entornos controlados.',
      },
      integrations: {
        telegramTitle: 'Canal de comunicación (solo Telegram)',
        telegramBody: 'Este agente reporta y recibe instrucciones únicamente por bot de Telegram.',
        botToken: 'Bot token',
        chatId: 'Chat ID permitido',
        verified: 'Canal verificado',
        tutorial: 'Tutorial guiado',
        previous: 'Anterior',
        next: 'Siguiente',
        mcpTitle: 'Marketplace de MCPs',
        mcpSubtitle: 'Añade capacidades a tu agente con un clic. Configura solo lo necesario.',
        mcpSearch: 'Buscar MCP...',
        mcpInstalled: 'Instalados',
        mcpAvailable: 'Disponibles',
        mcpInstall: 'Añadir',
        mcpRemove: 'Quitar',
        mcpConfigure: 'Configurar',
        mcpNoConfig: 'Sin configuración necesaria',
        mcpAllCategories: 'Todas',
        webhookTitle: 'Webhooks (Proactividad por eventos)',
        webhookBody: 'Recibe eventos externos (GitHub, Stripe, etc.) y el agente los analiza automáticamente. Si el evento es urgente, te notifica por Telegram.',
        webhookEnabled: 'Webhooks activados',
        webhookSecret: 'Secreto de firma (HMAC-SHA256)',
        webhookGenerateSecret: 'Generar secreto',
        webhookAllowedSources: 'Fuentes permitidas (vacío = todas)',
        webhookAllowedSourcesPlaceholder: 'github, stripe, gitlab...',
        webhookUrl: 'URL del webhook',
        webhookUrlInfo: 'Usa esta URL en la configuración de webhooks del servicio externo.',
        webhookCopied: '¡Copiado!',
        webhookTestSend: 'Enviar evento de prueba',
        webhookTestSuccess: '✅ Evento de prueba enviado correctamente',
        webhookTestError: '❌ Error al enviar evento de prueba',
        telegramSteps: [
          '1) Crea un bot con @BotFather y copia el token.',
          '2) Añade el token aquí y guarda.',
          '3) Escribe a tu bot y obtén el chat_id permitido.',
          '4) Valida el canal y confirma modo exclusivo Telegram.',
        ],
      },
      scheduler: {
        title: 'Tareas programadas',
        empty: 'No hay tareas programadas.',
        taskName: 'Nombre de tarea',
        schedule: 'Horario',
        schedulePlaceholder: 'Ej: lunes 09:00, cada día 14:00, 15/03/2026 10:00',
        prompt: 'Prompt',
        promptPlaceholder: 'Instrucción que recibirá la IA al ejecutarse',
        addTask: 'Añadir tarea',
        enabled: 'Activa',
        scheduleHelp: 'Puedes usar: día de la semana + hora, "cada día HH:MM", una fecha concreta DD/MM/YYYY HH:MM, o expresión cron.',
      },
      sections: {
        config: 'Configuración',
        chat: 'Chat',
      },
      chatSection: {
        title: 'Chat en tiempo real',
        subtitle: 'Conversación en vivo con el agente vía Telegram.',
        empty: 'No hay mensajes aún. Despliega el agente y comienza a interactuar.',
        placeholder: 'Escribe un mensaje al agente...',
        send: 'Enviar',
        notDeployed: 'El agente debe estar desplegado para chatear.',
        loading: 'Cargando historial...',
      },
      costs: {
        title: 'Coste en tiempo real',
        lastDay: 'Último día',
        lastWeek: 'Última semana',
        lastMonth: 'Último mes',
        lastYear: 'Último año',
        apiCalls: 'Llamadas API',
        tokens: 'Tokens',
        resources: 'Recursos',
        updated: 'Actualizado',
        noData: 'Sin datos',
      },
      budget: {
        title: 'Control de presupuesto diario',
        description: 'Establece un límite de gasto diario. Cuando se alcance, el agente te pedirá permiso por Telegram antes de seguir gastando.',
        label: 'Límite diario (USD)',
        placeholder: '0.00 = sin límite',
        active: 'Activo',
        inactive: 'Sin límite',
        saved: 'Presupuesto guardado',
        saveFailed: 'Error al guardar presupuesto',
      },
      timezone: {
        title: 'Zona horaria',
        description: 'Zona horaria que usará el agente para fechas, horas, recordatorios y programación.',
        regionLabel: 'Región',
        placeLabel: 'Lugar',
        detected: 'Detectada automáticamente',
      },
      performance: {
        title: 'Rendimiento del agente',
        description: 'Ajustes avanzados por agente para latencia, consumo de tokens y fluidez de tools/MCP.',
        fastToolsPrompt: 'Prompt rápido de tools',
        compactToolsPrompt: 'Prompt compacto de tools',
        maxMcpToolsInPrompt: 'Máx tools MCP en prompt',
        maxToolIterations: 'Máx iteraciones de tools',
        fastConfirmationMaxToolIterations: 'Iteraciones en confirmación rápida',
        toolResultMaxChars: 'Máx chars por resultado tool',
        toolResultsTotalMaxChars: 'Máx chars total resultados',
        llmTimeoutMs: 'Timeout LLM (ms)',
        toolTimeoutMs: 'Timeout tools (ms)',
        queueDelayUserMs: 'Cola usuario (ms)',
        queueDelayBackgroundMs: 'Cola background (ms)',
      },
      assistant: {
        title: 'Chat interno de configuración',
        subtitle:
          'Selecciona proveedor y modelo para que el asistente te guíe paso a paso durante la configuración del agente.',
        configMode: 'Chat de configuración',
        telegramMode: 'Chat de prueba Telegram',
        modelActive: 'Modelo activo',
        systemPromptPreset: 'System prompt del chat interno',
        systemPromptDefault: 'Guía por defecto',
        maxTokens: 'Máx tokens',
        temperature: 'Temperatura',
      memoryHint: 'Memoria inteligente activa: historial reciente + recuerdos relevantes para ahorrar tokens.',
      resetMemoryHint: 'Si el agente se desvió o quieres reiniciar contexto, puedes restablecer su memoria persistida y de runtime.',
      resetMemory: 'Restablecer memoria',
      resetMemoryBusy: 'Restableciendo...',
      resetMemoryConfirmTitle: '¿Restablecer memoria del agente?',
      resetMemoryConfirmMessage: 'Se eliminarán la memoria conversacional persistida y la memoria de runtime de este agente. Esta acción no se puede deshacer.',
      resetMemoryConfirmAction: 'Sí, restablecer',
      resetMemorySuccess: 'Memoria restablecida correctamente.',
      resetMemoryError: 'No se pudo restablecer la memoria del agente.',
      usageTitle: 'Instrucciones de uso',
        usageTips: [
          'Escribe objetivos y restricciones para ajustar el agente mediante la conversación.',
          'Usa Markdown en tus mensajes (listas, bloques de código, tablas).',
          'Detén una generación con el botón Detener o con Esc / Ctrl+. / Cmd+.',
        ],
        placeholder: 'Escribe una pregunta sobre la configuración del agente...',
        send: 'Enviar',
        stop: 'Detener',
        sending: 'Consultando modelo...',
        clearChat: 'Limpiar chat',
        guidancePrefix: 'Guía del modelo',
        telegramTestHint: 'Simulación de conversación con el bot como si estuvieras en Telegram.',
        noModel: 'Selecciona proveedor y modelo para continuar.',
      },
      checklist: {
        systemPrompt: 'Define un system prompt completo para el comportamiento base.',
        telegramToken: 'Configura el bot token de Telegram.',
        telegramChat: 'Configura el chat ID autorizado de Telegram.',
        scheduler: 'Añade al menos una tarea al scheduler.',
        mcpServer: 'Añade al menos un servidor MCP.',
        approval: 'Activa la aprobación para sitios web nuevos.',
      },
    } as const;
  }

  return {
    title: 'Autonomous agents',
    subtitle: 'Create and manage powerful agents in a secure sandbox environment.',
    newAgent: 'New agent',
    deleteAgent: 'Delete agent',
    emptyStateTitle: 'No agents yet',
    emptyStateBody: 'Create your first agent to begin setup.',
    status: { draft: 'Draft', active: 'Active', paused: 'Paused' },
    tabs: {
      general: 'General',
      instructions: 'Base instructions',
      permissions: 'Permissions & environment',
      integrations: 'Integrations',
      scheduler: 'Scheduler',
      data: 'Agent data',
      memory: 'Memory',
    },
    capabilitiesTitle: 'Agent capabilities',
    capabilities: [
      'Secure execution in isolated sandbox',
      'Headless browser for web task automation',
      'Controlled internet navigation',
      'Website access with login and real-time information lookup',
      'MCP marketplace with one-click install',
      'Communicate exclusively via Telegram bot',
      'System terminal access (with authorization)',
      'Code execution on device (with authorization)',
    ],

    fields: {
      name: 'Agent name',
      objective: 'Operational objective',
      systemPrompt: 'System prompt (base instructions)',
      status: 'Status',
      provider: 'Internal chat provider',
      model: 'Internal chat model',
    },
    instructionsHelp:
      'Define the primary behavior of the agent. This foundation controls how it executes tasks, reports progress, and requests confirmations.',
    permissions: {
      sandboxTitle: 'Execution environment',
      sandboxBody: 'The agent operates in an isolated, secure environment by default. It has no direct access to your computer, file system, or terminal unless you enable the corresponding permissions.',
      internetAccess: 'Internet access',
      headlessBrowser: 'Headless browser',
      notesAccess: 'Notes access',
      schedulerAccess: 'Scheduler access',
      terminalAccess: 'Terminal access',
      codeExecution: 'Code execution',
      allowedWebsites: 'Allowed websites (one per line)',
      requireApproval: 'Require approval for new sites',
      webCredentialsTitle: 'Web credentials',
      webCredentialsBody: 'Add credentials so the agent can sign in and securely access websites on your behalf.',
      addCredential: 'Add credential',
      site: 'Website',
      username: 'Username',
      password: 'Password',
      guardrailsTitle: 'Environment security',
      guardrailsBody:
        'The agent can only act within the configured permissions. Every terminal or code execution requires explicit user approval via Telegram before running.',
      systemAccessTitle: '⚠️ System access enabled',
      systemAccessBody:
        'You have enabled permissions that allow the agent to interact with the operating system. The agent will request authorization before each action, but be careful with the commands you approve. Use this only in controlled environments.',
    },
    integrations: {
      telegramTitle: 'Communication channel (Telegram only)',
      telegramBody: 'This agent reports and receives instructions exclusively through a Telegram bot.',
      botToken: 'Bot token',
      chatId: 'Authorized chat ID',
      verified: 'Channel verified',
      tutorial: 'Guided tutorial',
      previous: 'Previous',
      next: 'Next',
      mcpTitle: 'MCP Marketplace',
      mcpSubtitle: 'Add capabilities to your agent with one click. Configure only what you need.',
      mcpSearch: 'Search MCP...',
      mcpInstalled: 'Installed',
      mcpAvailable: 'Available',
      mcpInstall: 'Add',
      mcpRemove: 'Remove',
      mcpConfigure: 'Configure',
      mcpNoConfig: 'No configuration needed',
      mcpAllCategories: 'All',
      webhookTitle: 'Webhooks (Event-based proactivity)',
      webhookBody: 'Receive external events (GitHub, Stripe, etc.) and the agent analyzes them automatically. If the event is urgent, it notifies you via Telegram.',
      webhookEnabled: 'Webhooks enabled',
      webhookSecret: 'Signing secret (HMAC-SHA256)',
      webhookGenerateSecret: 'Generate secret',
      webhookAllowedSources: 'Allowed sources (empty = all)',
      webhookAllowedSourcesPlaceholder: 'github, stripe, gitlab...',
      webhookUrl: 'Webhook URL',
      webhookUrlInfo: 'Use this URL in the external service\'s webhook configuration.',
      webhookCopied: 'Copied!',
      webhookTestSend: 'Send test event',
      webhookTestSuccess: '✅ Test event sent successfully',
      webhookTestError: '❌ Error sending test event',
      telegramSteps: [
        '1) Create a bot with @BotFather and copy the token.',
        '2) Paste the token here and save.',
        '3) Message your bot and obtain the allowed chat_id.',
        '4) Validate the channel and confirm Telegram-only mode.',
      ],
    },
    scheduler: {
      title: 'Scheduled tasks',
      empty: 'No scheduled tasks yet.',
      taskName: 'Task name',
      schedule: 'Schedule',
      schedulePlaceholder: 'E.g: monday 09:00, every day 14:00, 15/03/2026 10:00',
      prompt: 'Prompt',
      promptPlaceholder: 'Instruction the AI will receive when triggered',
      addTask: 'Add task',
      enabled: 'Enabled',
      scheduleHelp: 'You can use: day of week + time, "every day HH:MM", a specific date DD/MM/YYYY HH:MM, or a cron expression.',
    },
    sections: {
      config: 'Configuration',
      chat: 'Chat',
    },
    chatSection: {
      title: 'Real-time chat',
      subtitle: 'Live conversation with the agent via Telegram.',
      empty: 'No messages yet. Deploy the agent and start interacting.',
      placeholder: 'Write a message to the agent...',
      send: 'Send',
      notDeployed: 'The agent must be deployed to chat.',
      loading: 'Loading history...',
    },
    costs: {
      title: 'Real-time cost',
      lastDay: 'Last day',
      lastWeek: 'Last week',
      lastMonth: 'Last month',
      lastYear: 'Last year',
      apiCalls: 'API calls',
      tokens: 'Tokens',
      resources: 'Resources',
      updated: 'Updated',
      noData: 'No data',
    },
    budget: {
      title: 'Daily budget control',
      description: 'Set a daily spending limit. When reached, the agent will ask for your permission via Telegram before spending more.',
      label: 'Daily limit (USD)',
      placeholder: '0.00 = no limit',
      active: 'Active',
      inactive: 'No limit',
      saved: 'Budget saved',
      saveFailed: 'Failed to save budget',
    },
    timezone: {
      title: 'Timezone',
      description: 'Timezone the agent will use for dates, times, reminders and scheduling.',
      regionLabel: 'Region',
      placeLabel: 'Place',
      detected: 'Auto-detected',
    },
    performance: {
      title: 'Agent performance',
      description: 'Per-agent advanced settings for latency, token usage, and tool/MCP responsiveness.',
      fastToolsPrompt: 'Fast tools prompt',
      compactToolsPrompt: 'Compact tools prompt',
      maxMcpToolsInPrompt: 'Max MCP tools in prompt',
      maxToolIterations: 'Max tool iterations',
      fastConfirmationMaxToolIterations: 'Fast confirmation iterations',
      toolResultMaxChars: 'Max chars per tool result',
      toolResultsTotalMaxChars: 'Max chars total tool results',
      llmTimeoutMs: 'LLM timeout (ms)',
      toolTimeoutMs: 'Tool timeout (ms)',
      queueDelayUserMs: 'User queue delay (ms)',
      queueDelayBackgroundMs: 'Background queue delay (ms)',
    },
    assistant: {
      title: 'Internal configuration chat',
      subtitle:
        'Choose provider and model so the assistant can guide you step by step while configuring the agent.',
      configMode: 'Configuration chat',
      telegramMode: 'Telegram test chat',
      modelActive: 'Active model',
      systemPromptPreset: 'Internal chat system prompt',
      systemPromptDefault: 'Default guide',
      maxTokens: 'Max tokens',
      temperature: 'Temperature',
      memoryHint: 'Smart memory enabled: recent history + relevant recalls to optimize tokens.',
      resetMemoryHint: 'If the agent drifted or you want a fresh context, reset its persisted and runtime memory.',
      resetMemory: 'Reset memory',
      resetMemoryBusy: 'Resetting...',
      resetMemoryConfirmTitle: 'Reset this agent memory?',
      resetMemoryConfirmMessage: 'This will delete persisted conversation memory and runtime memory for this agent. This action cannot be undone.',
      resetMemoryConfirmAction: 'Yes, reset',
      resetMemorySuccess: 'Agent memory reset completed.',
      resetMemoryError: 'Could not reset agent memory.',
      usageTitle: 'Usage instructions',
      usageTips: [
        'Provide goals and constraints to tune the agent through conversation.',
        'Use Markdown in messages (lists, code blocks, tables).',
        'Stop generation with the Stop button or Esc / Ctrl+. / Cmd+.',
      ],
      placeholder: 'Ask something about agent setup...',
      send: 'Send',
      stop: 'Stop',
      sending: 'Querying model...',
      clearChat: 'Clear chat',
      guidancePrefix: 'Model guidance',
      telegramTestHint: 'Simulated conversation with the bot as if you were in Telegram.',
      noModel: 'Select provider and model to continue.',
    },
    checklist: {
      systemPrompt: 'Define a complete system prompt for base behavior.',
      telegramToken: 'Configure the Telegram bot token.',
      telegramChat: 'Configure the authorized Telegram chat ID.',
      scheduler: 'Add at least one scheduled task.',
      mcpServer: 'Add at least one MCP server.',
      approval: 'Enable approval for new websites.',
    },
  } as const;
};

type UICopy = ReturnType<typeof getCopy> & { language: Language };

// ---------------------------------------------------------------------------
// Agent creation & initial messages
// ---------------------------------------------------------------------------

const isTemplateGuideMessage = (content: string): boolean => {
  const trimmed = content.trim();
  return (
    /^Guía del modelo \([^)]+\)\./i.test(trimmed) ||
    /^Model guide \([^)]+\)\./i.test(trimmed) ||
    /^Guía del modelo activo\./i.test(trimmed) ||
    /^Guide for the active model\./i.test(trimmed)
  );
};

const createInitialGuideMessage = (language: Language, provider: string, model: string): AgentGuideMessage => ({
  id: createUniqueId(),
  role: 'assistant',
  content:
    language === 'es'
      ? `Guía del modelo (${provider}/${model}). Empezamos con 3 preguntas: 1) ¿Cuál es el objetivo principal del agente? 2) ¿Qué webs necesita visitar? 3) ¿Qué MCPs quieres instalar?`
      : `Model guide (${provider}/${model}). Let's start with 3 questions: 1) What is the main agent objective? 2) Which websites does it need to visit? 3) Which MCPs do you want to install?`,
  timestamp: Date.now(),
});

const createInitialTelegramTestMessage = (language: Language): AgentGuideMessage => ({
  id: createUniqueId(),
  role: 'assistant',
  content:
    language === 'es'
      ? 'Canal de prueba Telegram listo. Envíame instrucciones como si fueras el usuario final del bot.'
      : 'Telegram test channel is ready. Send instructions as if you were the end user chatting with the bot.',
  timestamp: Date.now(),
});

export const createAutonomousAgent = (
  language: Language,
  index: number,
  preferred?: {
    providerId?: string;
    modelId?: string;
    systemPromptId?: string;
    temperature?: number;
    maxTokens?: number;
  }
): AutonomousAgent => {
  const preferredProviderId = preferred?.providerId && isKnownProvider(preferred.providerId)
    ? preferred.providerId
    : undefined;
  const provider = preferredProviderId || getFallbackProvider();
  const model = preferred?.modelId || getProviderModelFallback(provider);
  const normalizedModel = getAllModelsForProvider(provider).some((item) => item.id === model)
    ? model
    : getProviderModelFallback(provider);
  const now = Date.now();
  return {
    id: createUniqueId(),
    name: language === 'es' ? `Agente ${index}` : `Agent ${index}`,
    objective: '',
    status: 'draft',
    systemPrompt:
      language === 'es'
        ? 'Eres un agente autónomo metódico y disciplinado. Usa tools/MCP cuando corresponda y nunca inventes acciones. Sé proactivo, pero si falta información crítica pregunta primero (ej.: destinatario, asunto y mensaje). No contactes con terceros ni hagas acciones sensibles/irreversibles sin confirmación explícita del usuario. Antes de ejecutar, muestra un resumen final y pide confirmación. Tras cada acción, devuelve un recibo claro con resultado e ID si aplica.'
        : 'You are a methodical and disciplined autonomous agent. Use tools/MCP when appropriate and never fabricate actions. Be proactive, but if critical information is missing ask first (e.g., recipient, subject, message). Do not contact third parties or run sensitive/irreversible actions without explicit user confirmation. Before execution, show a final summary and ask for confirmation. After each action, provide a clear receipt with result and ID when applicable.',
    permissions: {
      sandboxMode: true,
      internetAccess: true,
      notesAccess: true,
      schedulerAccess: true,
      gmailAccess: true,
      mediaAccess: true,
      terminalAccess: false,
      codeExecution: false,
      allowedWebsites: [],
      headlessBrowser: true,
      webCredentials: [],
      requireApprovalForNewSites: true,
    },
    integrations: {
      telegram: {
        botToken: '',
        chatId: '',
        tutorialStep: 0,
        verified: false,
      },
      mcpServers: [],
      calendar: {},
      gmail: undefined,
      media: {},
      homeAssistant: undefined,
      webhooks: {
        enabled: false,
        secret: '',
        allowedSources: [],
      },
    },
    schedules: [],
    setupProvider: provider,
    setupModel: normalizedModel,
    setupSystemPromptId: typeof preferred?.systemPromptId === 'string' ? preferred.systemPromptId : '',
    setupMaxTokens: clampSetupMaxTokens(preferred?.maxTokens, AGENT_SETUP_DEFAULT_MAX_TOKENS),
    setupTemperature: clampSetupTemperature(preferred?.temperature, AGENT_SETUP_DEFAULT_TEMPERATURE),
    chatMode: 'config',
    setupChat: [createInitialGuideMessage(language, provider, normalizedModel)],
    telegramTestChat: [createInitialTelegramTestMessage(language)],
    trainingMemory: [],
    enableSmartRAG: true,
    dailyBudgetUsd: 0,
    timezone: getDefaultAgentTimezone(),
    runtimeTuning: { ...AGENT_RUNTIME_DEFAULTS },
    platformCompatibility: {
      macos: true,
      windows: true,
    },
    alwaysOn: false,
    archivedAt: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
};

export const createDefaultAgentWorkspaceState = (language: Language): AgentWorkspaceState => {
  const defaultAgent = createAutonomousAgent(language, 1);
  return {
    agents: [defaultAgent],
    activeAgentId: defaultAgent.id,
  };
};

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

const sanitizeGuideMessages = (value: unknown, language: Language, provider: string, model: string): AgentGuideMessage[] => {
  if (!Array.isArray(value)) return [createInitialGuideMessage(language, provider, model)];
  const normalized = value
    .filter((item) => item && (item as AgentGuideMessage).role && typeof (item as AgentGuideMessage).content === 'string')
    .map((item) => {
      const candidate = item as Partial<AgentGuideMessage>;
      return {
        id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : createUniqueId(),
        role: candidate.role === 'user' ? 'user' : 'assistant',
        content: typeof candidate.content === 'string' ? candidate.content.trim() : '',
        timestamp: Number.isFinite(candidate.timestamp) ? Number(candidate.timestamp) : Date.now(),
      } as AgentGuideMessage;
    })
    .filter((item) => item.content.length > 0);

  if (normalized.length === 0) return [createInitialGuideMessage(language, provider, model)];

  const hasUserMessages = normalized.some((message) => message.role === 'user');
  if (!hasUserMessages) {
    return normalized.map((message, index) => {
      if (index === 0 && message.role === 'assistant' && isTemplateGuideMessage(message.content)) {
        return {
          ...message,
          content: createInitialGuideMessage(language, provider, model).content,
        };
      }
      return message;
    });
  }

  return normalized;
};

const sanitizeSchedulerTasks = (value: unknown): AgentSchedulerTask[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((task) => task && typeof (task as AgentSchedulerTask).name === 'string')
    .map((task) => {
      const candidate = task as Partial<AgentSchedulerTask>;
      return {
        id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : createUniqueId(),
        name: typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 80) : '',
        schedule: typeof candidate.schedule === 'string' ? candidate.schedule.trim().slice(0, 120) : '',
        prompt: typeof candidate.prompt === 'string' ? candidate.prompt.trim().slice(0, 2000) : '',
        enabled: candidate.enabled !== false,
      };
    })
    .filter((task) => task.name.length > 0 && task.schedule.length > 0);
};

const sanitizeWebCredentials = (value: unknown): AgentWebCredential[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c: any) => c && typeof c.site === 'string')
    .map((c: any) => ({
      id: typeof c.id === 'string' && c.id.trim() ? c.id : createUniqueId(),
      site: String(c.site).trim(),
      username: typeof c.username === 'string' ? c.username : '',
      password: typeof c.password === 'string' ? c.password : '',
    }));
};

const sanitizeMCPServers = (value: unknown): MCPServerConfig[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s: any) => s && typeof s.id === 'string')
    .map((s: any) => ({
      id: String(s.id),
      enabled: s.enabled !== false,
      config: s.config && typeof s.config === 'object' && !Array.isArray(s.config) ? { ...s.config } : {},
    }));
};

const sanitizeCalendarConfig = (value: unknown): AgentCalendarConfig | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const calendar = value as Partial<AgentCalendarConfig>;
  const normalized: AgentCalendarConfig = {};

  if (calendar.google && typeof calendar.google === 'object') {
    const google = calendar.google as Partial<AgentCalendarConfig['google']>;
    const clientId = typeof google?.clientId === 'string' ? google.clientId.trim() : '';
    const clientSecret = typeof google?.clientSecret === 'string' ? google.clientSecret.trim() : '';
    const refreshToken = typeof google?.refreshToken === 'string' ? google.refreshToken.trim() : '';
    const calendarId = typeof google?.calendarId === 'string' ? google.calendarId.trim() : '';

    if (clientId || clientSecret || refreshToken || calendarId) {
      normalized.google = {
        clientId,
        clientSecret,
        refreshToken,
        calendarId,
      };
    }
  }

  if (calendar.icloud && typeof calendar.icloud === 'object') {
    const icloud = calendar.icloud as Partial<AgentCalendarConfig['icloud']>;
    const email = typeof icloud?.email === 'string' ? icloud.email.trim() : '';
    const appSpecificPassword = typeof icloud?.appSpecificPassword === 'string'
      ? icloud.appSpecificPassword.trim().replace(/[\s-]/g, '')
      : '';
    const calendarName = typeof icloud?.calendarName === 'string' ? icloud.calendarName.trim() : '';

    if (email || appSpecificPassword || calendarName) {
      normalized.icloud = {
        email,
        appSpecificPassword,
        calendarName,
      };
    }
  }

  if (!normalized.google && !normalized.icloud) return undefined;
  return normalized;
};

const sanitizeGmailConfig = (value: unknown): AgentGmailConfig | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const gmail = value as Partial<AgentGmailConfig>;
  const clientId = typeof gmail?.clientId === 'string' ? gmail.clientId.trim() : '';
  const clientSecret = typeof gmail?.clientSecret === 'string' ? gmail.clientSecret.trim() : '';
  const refreshToken = typeof gmail?.refreshToken === 'string' ? gmail.refreshToken.trim() : '';

  if (!clientId && !clientSecret && !refreshToken) return undefined;
  return { clientId, clientSecret, refreshToken };
};

const sanitizeMediaConfig = (value: unknown): AgentMediaConfig | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const media = value as Partial<AgentMediaConfig>;
  const normalized: AgentMediaConfig = {};

  if (media.radarr && typeof media.radarr === 'object') {
    const r = media.radarr as Partial<NonNullable<AgentMediaConfig['radarr']>>;
    const url = typeof r?.url === 'string' ? r.url.trim() : '';
    const apiKey = typeof r?.apiKey === 'string' ? r.apiKey.trim() : '';
    if (url || apiKey) {
      normalized.radarr = { url, apiKey };
    }
  }

  if (media.sonarr && typeof media.sonarr === 'object') {
    const s = media.sonarr as Partial<NonNullable<AgentMediaConfig['sonarr']>>;
    const url = typeof s?.url === 'string' ? s.url.trim() : '';
    const apiKey = typeof s?.apiKey === 'string' ? s.apiKey.trim() : '';
    if (url || apiKey) {
      normalized.sonarr = { url, apiKey };
    }
  }

  if (!normalized.radarr && !normalized.sonarr) return undefined;
  return normalized;
};

const sanitizeAgent = (value: unknown, index: number, language: Language): AutonomousAgent => {
  const defaults = createAutonomousAgent(language, index + 1);
  if (!value || typeof value !== 'object') return defaults;
  const candidate = value as Partial<AutonomousAgent>;

  const provider = isKnownProvider(candidate.setupProvider || '') ? String(candidate.setupProvider) : defaults.setupProvider;
  const knownModels = getAllModelsForProvider(provider);
  const setupModel = typeof candidate.setupModel === 'string' && knownModels.some((model) => model.id === candidate.setupModel)
    ? candidate.setupModel
    : getProviderModelFallback(provider);

  const permissions = candidate.permissions && typeof candidate.permissions === 'object'
    ? candidate.permissions
    : defaults.permissions;
  const integrations = candidate.integrations && typeof candidate.integrations === 'object'
    ? candidate.integrations
    : defaults.integrations;

  const normalized: AutonomousAgent = {
    ...defaults,
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : defaults.id,
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim().slice(0, 60) : defaults.name,
    objective: typeof candidate.objective === 'string' ? candidate.objective.slice(0, 280) : '',
    status: candidate.status === 'active' || candidate.status === 'paused' ? candidate.status : 'draft',
    systemPrompt: typeof candidate.systemPrompt === 'string' ? candidate.systemPrompt : defaults.systemPrompt,
    permissions: {
      sandboxMode: true,
      internetAccess: permissions.internetAccess !== false,
      notesAccess: (permissions as any).notesAccess !== false,
      schedulerAccess: (permissions as any).schedulerAccess !== false,
      gmailAccess: (permissions as any).gmailAccess !== false,
      mediaAccess: (permissions as any).mediaAccess !== false,
      terminalAccess: (permissions as any).terminalAccess === true,
      codeExecution: (permissions as any).codeExecution === true,
      allowedWebsites: sanitizeStringArray((permissions as any).allowedWebsites),
      headlessBrowser: permissions.headlessBrowser !== false,
      webCredentials: sanitizeWebCredentials((permissions as any).webCredentials),
      requireApprovalForNewSites: (permissions as any).requireApprovalForNewSites !== false,
    },
    integrations: {
      telegram: {
        botToken:
          integrations.telegram && typeof integrations.telegram === 'object' && typeof integrations.telegram.botToken === 'string'
            ? integrations.telegram.botToken.trim()
            : '',
        chatId:
          integrations.telegram && typeof integrations.telegram === 'object' && typeof integrations.telegram.chatId === 'string'
            ? integrations.telegram.chatId.trim()
            : '',
        tutorialStep: Math.max(
          0,
          Math.min(
            3,
            integrations.telegram && typeof integrations.telegram === 'object' && Number.isFinite(integrations.telegram.tutorialStep)
              ? Number(integrations.telegram.tutorialStep)
              : 0
          )
        ),
        verified:
          integrations.telegram && typeof integrations.telegram === 'object'
            ? integrations.telegram.verified === true
            : false,
      },
      mcpServers: sanitizeMCPServers((integrations as any).mcpServers),
      calendar: sanitizeCalendarConfig((integrations as any).calendar),
      gmail: sanitizeGmailConfig((integrations as any).gmail),
      media: sanitizeMediaConfig((integrations as any).media),
      homeAssistant: (() => {
        const ha = (integrations as any).homeAssistant;
        if (!ha || typeof ha !== 'object') return undefined;
        const url = typeof ha.url === 'string' ? ha.url.trim() : '';
        const token = typeof ha.token === 'string' ? ha.token.trim() : '';
        if (!url && !token) return undefined;
        return { url, token };
      })(),
    },
    schedules: sanitizeSchedulerTasks(candidate.schedules),
    setupProvider: provider,
    setupModel,
    setupSystemPromptId: typeof candidate.setupSystemPromptId === 'string' ? candidate.setupSystemPromptId : '',
    setupMaxTokens: clampSetupMaxTokens(candidate.setupMaxTokens, defaults.setupMaxTokens),
    setupTemperature: clampSetupTemperature(candidate.setupTemperature, defaults.setupTemperature),
    chatMode: candidate.chatMode === 'telegram_test' ? 'telegram_test' : 'config',
    setupChat: sanitizeGuideMessages(candidate.setupChat, language, provider, setupModel),
    telegramTestChat: sanitizeGuideMessages(candidate.telegramTestChat, language, provider, setupModel),
    trainingMemory: sanitizeStringArray(candidate.trainingMemory),
    enableSmartRAG: candidate.enableSmartRAG !== false,
    dailyBudgetUsd: typeof candidate.dailyBudgetUsd === 'number' && Number.isFinite(candidate.dailyBudgetUsd) && candidate.dailyBudgetUsd > 0
      ? candidate.dailyBudgetUsd
      : 0,
    timezone: normalizeAgentTimezone(candidate.timezone),
    runtimeTuning: normalizeRuntimeTuning((candidate as any).runtimeTuning),
    platformCompatibility: {
      macos:
        candidate.platformCompatibility && typeof candidate.platformCompatibility === 'object'
          ? candidate.platformCompatibility.macos !== false
          : true,
      windows:
        candidate.platformCompatibility && typeof candidate.platformCompatibility === 'object'
          ? candidate.platformCompatibility.windows !== false
          : true,
    },
    alwaysOn: candidate.alwaysOn === true,
    archivedAt: Number.isFinite(candidate.archivedAt) ? Number(candidate.archivedAt) : null,
    deletedAt: Number.isFinite(candidate.deletedAt) ? Number(candidate.deletedAt) : null,
    createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : defaults.createdAt,
    updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : Date.now(),
  };

  return normalized;
};

export const sanitizeAgentWorkspaceState = (value: unknown, language: Language): AgentWorkspaceState => {
  if (!value || typeof value !== 'object') {
    return createDefaultAgentWorkspaceState(language);
  }

  const candidate = value as Partial<AgentWorkspaceState>;
  const agents = Array.isArray(candidate.agents)
    ? candidate.agents.map((agent, index) => sanitizeAgent(agent, index, language))
    : [];

  if (agents.length === 0) return createDefaultAgentWorkspaceState(language);

  const activeAgentId =
    typeof candidate.activeAgentId === 'string' && agents.some((agent) => agent.id === candidate.activeAgentId)
      ? candidate.activeAgentId
      : agents[0].id;

  return { agents, activeAgentId };
};

// ---------------------------------------------------------------------------
// Checklist & guide logic
// ---------------------------------------------------------------------------

const getChecklistItems = (agent: AutonomousAgent, copy: ReturnType<typeof getCopy>): string[] => {
  const items: string[] = [];
  if (!agent.systemPrompt.trim()) items.push(copy.checklist.systemPrompt);
  if (!agent.integrations.telegram.botToken.trim()) items.push(copy.checklist.telegramToken);
  if (!agent.integrations.telegram.chatId.trim()) items.push(copy.checklist.telegramChat);
  if (agent.schedules.length === 0) items.push(copy.checklist.scheduler);
  if (agent.integrations.mcpServers.length === 0) items.push(copy.checklist.mcpServer);
  if (!agent.permissions.requireApprovalForNewSites) items.push(copy.checklist.approval);
  return items;
};

const buildGuideSystemPrompt = (language: Language): string => {
  if (language === 'es') {
    return [
      'Eres un experto en configurar agentes autónomos.',
      'Guía al usuario paso a paso para completar la configuración.',
      'El agente opera en un sandbox por defecto: navega por internet, usa navegador headless y MCPs.',
      'Si el usuario activa el acceso al terminal o la ejecución de código, el agente podrá interactuar con el sistema operativo (siempre con aprobación del usuario).',
      'Analiza primero el estado actual y luego propone el siguiente paso más importante.',
      'Haz de 1 a 3 preguntas concretas para desbloquear configuración.',
      'Usa formato breve:',
      '1) Estado actual',
      '2) Siguiente paso',
      '3) Preguntas',
    ].join('\n');
  }

  return [
    'You are an expert in autonomous-agent setup.',
    'Guide the user step by step to complete configuration.',
    'The agent runs in a sandbox by default: it browses the internet, uses a headless browser, and MCPs.',
    'If the user enables terminal access or code execution, the agent can interact with the operating system (always with user approval).',
    'First assess current state, then propose the single highest-priority next step.',
    'Ask 1 to 3 concrete questions that unblock setup.',
    'Use a concise format:',
    '1) Current state',
    '2) Next step',
    '3) Questions',
  ].join('\n');
};

const buildGuideContextMessage = (agent: AutonomousAgent, pendingChecklist: string[], language: Language): string => {
  const context = {
    agent: {
      name: agent.name,
      objective: agent.objective,
      status: agent.status,
      systemPromptLength: agent.systemPrompt.trim().length,
    },
    internalChat: {
      provider: agent.setupProvider,
      model: agent.setupModel,
      maxTokens: agent.setupMaxTokens,
      temperature: agent.setupTemperature,
      systemPromptPresetId: agent.setupSystemPromptId || null,
    },
    permissions: {
      sandboxMode: agent.permissions.sandboxMode,
      internetAccess: agent.permissions.internetAccess,
      notesAccess: agent.permissions.notesAccess,
      schedulerAccess: agent.permissions.schedulerAccess,
      headlessBrowser: agent.permissions.headlessBrowser,
      terminalAccess: agent.permissions.terminalAccess,
      codeExecution: agent.permissions.codeExecution,
      allowedWebsites: agent.permissions.allowedWebsites,
      credentialCount: agent.permissions.webCredentials.length,
      requireApprovalForNewSites: agent.permissions.requireApprovalForNewSites,
    },
    integrations: {
      telegramConfigured: Boolean(agent.integrations.telegram.botToken && agent.integrations.telegram.chatId),
      telegramVerified: agent.integrations.telegram.verified,
      mcpServers: agent.integrations.mcpServers.filter((s) => s.enabled).map((s) => s.id),
    },
    scheduler: {
      taskCount: agent.schedules.length,
      tasks: agent.schedules.map((task) => ({ name: task.name, schedule: task.schedule, enabled: task.enabled })),
    },
    trainingMemory: agent.trainingMemory.slice(-20),
    compatibility: agent.platformCompatibility,
    pendingChecklist,
  };

  if (language === 'es') {
    return `Estado actual del agente (JSON):\n${JSON.stringify(context, null, 2)}`;
  }
  return `Current agent setup state (JSON):\n${JSON.stringify(context, null, 2)}`;
};

const buildTelegramTestSystemPrompt = (language: Language): string => {
  if (language === 'es') {
    return [
      'Eres un bot de Telegram de prueba para un agente autónomo.',
      'Responde como lo haría el bot final en Telegram, en mensajes claros y cortos.',
      'Respeta siempre los límites de los permisos configurados.',
      'Si la solicitud excede permisos, recházala y pide autorización explícita.',
      'Si el usuario pide acciones de terminal o código, informa que requerirán aprobación.',
      'Admite Markdown de Telegram/Markdown estándar.',
    ].join('\n');
  }

  return [
    'You are a Telegram bot simulator for an autonomous agent.',
    'Respond exactly like the final Telegram bot would: clear and concise messages.',
    'Always enforce configured permission limits.',
    'If a request exceeds permissions, refuse and request explicit authorization.',
    'If the user asks for terminal or code actions, inform them approval will be required.',
    'Support Telegram/standard Markdown output.',
  ].join('\n');
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const markdownComponents = {
  code({ inline, className, children, ...props }: any) {
    if (inline) {
      return (
        <code className="px-1 py-0.5 rounded bg-zinc-200 dark:bg-zinc-800 text-[11px]" {...props}>
          {children}
        </code>
      );
    }
    return (
      <pre className="p-2 rounded-lg bg-zinc-200 dark:bg-zinc-900 overflow-x-auto text-[11px]">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
} as const;

const WebCredentialRow: React.FC<{
  credential: AgentWebCredential;
  copy: ReturnType<typeof getCopy>;
  onChange: (updated: AgentWebCredential) => void;
  onDelete: () => void;
}> = ({ credential, copy, onChange, onDelete }) => {
  const [showPassword, setShowPassword] = useState(false);
  return (
    <div className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto] items-end rounded-lg border border-border p-2.5 bg-background/50">
      <div className="space-y-1">
        <label className="text-[11px] text-zinc-500 dark:text-zinc-400">{copy.permissions.site}</label>
        <input
          value={credential.site}
          onChange={(e) => onChange({ ...credential, site: e.target.value })}
          placeholder="https://..."
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-zinc-500 dark:text-zinc-400">{copy.permissions.username}</label>
        <input
          value={credential.username}
          onChange={(e) => onChange({ ...credential, username: e.target.value })}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] text-zinc-500 dark:text-zinc-400">{copy.permissions.password}</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={credential.password}
            onChange={(e) => onChange({ ...credential, password: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            {showPassword ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};

const MCPMarketplace: React.FC<{
  agent: AutonomousAgent;
  language: Language;
  copy: ReturnType<typeof getCopy>;
  onUpdate: (updater: (agent: AutonomousAgent) => AutonomousAgent) => void;
}> = ({ agent, language, copy, onUpdate }) => {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [configuringId, setConfiguringId] = useState<string | null>(null);
  const [showSetupHelp, setShowSetupHelp] = useState<string | null>(null);

  const lang = language === 'es' ? 'es' : 'en';
  const installedIds = new Set(agent.integrations.mcpServers.map((s) => s.id));

  const filteredCatalog = MCP_CATALOG.filter((entry) => {
    if (installedIds.has(entry.id)) return false;
    if (activeCategory !== 'all' && entry.category !== activeCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return entry.name.toLowerCase().includes(q) || entry.description[lang].toLowerCase().includes(q);
    }
    return true;
  });

  const installMCP = (entry: MCPCatalogEntry) => {
    onUpdate((a) => ({
      ...a,
      integrations: {
        ...a.integrations,
        mcpServers: [...a.integrations.mcpServers, { id: entry.id, enabled: true, config: {} }],
      },
    }));
    if (entry.configFields.length > 0) {
      setConfiguringId(entry.id);
    }
  };

  const removeMCP = (id: string) => {
    onUpdate((a) => ({
      ...a,
      integrations: {
        ...a.integrations,
        mcpServers: a.integrations.mcpServers.filter((s) => s.id !== id),
      },
    }));
    if (configuringId === id) setConfiguringId(null);
  };

  const updateMCPConfig = (id: string, key: string, value: string) => {
    onUpdate((a) => ({
      ...a,
      integrations: {
        ...a.integrations,
        mcpServers: a.integrations.mcpServers.map((s) =>
          s.id === id ? { ...s, config: { ...s.config, [key]: value } } : s
        ),
      },
    }));
  };

  const toggleMCP = (id: string) => {
    onUpdate((a) => ({
      ...a,
      integrations: {
        ...a.integrations,
        mcpServers: a.integrations.mcpServers.map((s) =>
          s.id === id ? { ...s, enabled: !s.enabled } : s
        ),
      },
    }));
  };

  const installedServers = agent.integrations.mcpServers;

  return (
    <div className="rounded-xl border border-border p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Server size={15} />
          {copy.integrations.mcpTitle}
        </h4>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{copy.integrations.mcpSubtitle}</p>
      </div>

      {/* Installed MCPs */}
      {installedServers.length > 0 && (
        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {copy.integrations.mcpInstalled} ({installedServers.length})
          </h5>
          {installedServers.map((server) => {
            const catalogEntry = MCP_CATALOG.find((e) => e.id === server.id);
            if (!catalogEntry) return null;
            const isConfiguring = configuringId === server.id;
            return (
              <div key={server.id} className="rounded-lg border border-border p-3 bg-background/50 space-y-2">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{catalogEntry.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{catalogEntry.name}</p>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {catalogEntry.description[lang]}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleMCP(server.id)}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      server.enabled
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                        : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}
                  >
                    {server.enabled ? 'ON' : 'OFF'}
                  </button>
                  {catalogEntry.configFields.length > 0 && (
                    <button
                      onClick={() => setConfiguringId(isConfiguring ? null : server.id)}
                      className="px-2 py-1 rounded-md text-[11px] font-medium border border-border text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {copy.integrations.mcpConfigure}
                    </button>
                  )}
                  <button
                    onClick={() => removeMCP(server.id)}
                    className="p-1.5 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {isConfiguring && catalogEntry.configFields.length > 0 && (
                  <div className="grid gap-2 pt-2 border-t border-border mt-2">
                    {/* Setup help guide (expandable) */}
                    {catalogEntry.setupHelp && (
                      <div className="rounded-md bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 overflow-hidden">
                        <button
                          onClick={() => setShowSetupHelp(showSetupHelp === server.id ? null : server.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100/50 dark:hover:bg-blue-800/20 transition-colors"
                        >
                          <HelpCircle size={13} />
                          {lang === 'es' ? '¿Cómo configurar?' : 'How to set up?'}
                          {showSetupHelp === server.id ? <ChevronDown size={12} className="ml-auto" /> : <ChevronRight size={12} className="ml-auto" />}
                        </button>
                        {showSetupHelp === server.id && (
                          <div className="px-3 pb-2.5 text-[11px] text-blue-600 dark:text-blue-400 whitespace-pre-line leading-relaxed border-t border-blue-200/50 dark:border-blue-800/30 pt-2">
                            {catalogEntry.setupHelp[lang]}
                            {catalogEntry.setupUrl && (
                              <a
                                href={catalogEntry.setupUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
                              >
                                <ExternalLink size={11} />
                                {lang === 'es' ? 'Abrir sitio web' : 'Open website'}
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {catalogEntry.configFields.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {field.label[lang]}
                          {field.required && <span className="text-red-400 ml-0.5">*</span>}
                        </label>
                        <input
                          type={field.type}
                          value={server.config[field.key] || ''}
                          onChange={(e) => updateMCPConfig(server.id, field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                        {field.help && (
                          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 flex items-start gap-1">
                            <HelpCircle size={10} className="mt-0.5 shrink-0" />
                            {field.help[lang]}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {isConfiguring && catalogEntry.configFields.length === 0 && (
                  <div className="pt-2 border-t border-border space-y-2">
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 size={12} />
                      {lang === 'es' ? '¡Listo! No necesita configuración.' : 'Ready! No configuration needed.'}
                    </p>
                    {catalogEntry.setupHelp && (
                      <p className="text-[10px] text-zinc-400">{catalogEntry.setupHelp[lang]}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Search & category filter */}
      <div className="space-y-2">
        <h5 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{copy.integrations.mcpAvailable}</h5>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={copy.integrations.mcpSearch}
            className="w-full rounded-lg border border-border bg-background pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveCategory('all')}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
              activeCategory === 'all'
                ? 'bg-primary text-white'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            {copy.integrations.mcpAllCategories}
          </button>
          {Object.entries(MCP_CATEGORIES).map(([key, cat]) => (
            <button
              key={key}
              onClick={() => setActiveCategory(key)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                activeCategory === key
                  ? 'bg-primary text-white'
                  : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              {cat.icon} {cat[lang]}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog grid */}
      <div className="grid gap-2 md:grid-cols-2">
        {filteredCatalog.map((entry) => (
          <div
            key={entry.id}
            className="rounded-lg border border-border p-3 hover:border-primary/40 transition-colors bg-background/50"
          >
            <div className="flex items-start gap-2.5">
              <span className="text-lg mt-0.5">{entry.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{entry.name}</p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {entry.description[lang]}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  {entry.configFields.length === 0 ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 size={10} />
                      {lang === 'es' ? 'Sin configuración' : 'No config needed'}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                      <HelpCircle size={10} />
                      {lang === 'es' ? `${entry.configFields.length} campo(s) a rellenar` : `${entry.configFields.length} field(s) to fill`}
                    </span>
                  )}
                  {entry.setupUrl && (
                    <a
                      href={entry.setupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-[10px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      <ExternalLink size={9} />
                      {lang === 'es' ? 'Web' : 'Web'}
                    </a>
                  )}
                </div>
              </div>
              <button
                onClick={() => installMCP(entry)}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-white hover:opacity-90 transition-opacity"
              >
                <Plus size={11} />
                {copy.integrations.mcpInstall}
              </button>
            </div>
          </div>
        ))}
        {filteredCatalog.length === 0 && (
          <p className="text-xs text-zinc-400 col-span-2 text-center py-4">
            {language === 'es'
              ? 'No hay MCPs disponibles con estos filtros'
              : 'No MCPs available with these filters'}
          </p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const AgentsWorkspace: React.FC<AgentsWorkspaceProps> = ({
  language,
  workspace,
  preferredProviderId,
  preferredModelId,
  preferredSystemPromptId,
  preferredTemperature,
  preferredMaxTokens,
  systemPrompts,
  availableProviders,
  onWorkspaceChange,
}) => {
  const copy = useMemo<UICopy>(() => ({ ...getCopy(language), language }), [language]);
  const activeAgent =
    workspace.agents.find(
      (agent) => agent.id === workspace.activeAgentId && !agent.deletedAt && !agent.archivedAt
    ) ||
    workspace.agents.find((agent) => !agent.deletedAt && !agent.archivedAt) ||
    null;

  const [activeTab, setActiveTab] = useState<AgentTab>('general');
  const [activeSection, setActiveSection] = useState<AgentSection>('config');
  const [chatInput, setChatInput] = useState('');
  const [taskName, setTaskName] = useState('');
  const [scheduleMode, setScheduleMode] = useState<ScheduleBuilderMode>('weekly');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleWeekdays, setScheduleWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [scheduleSingleDate, setScheduleSingleDate] = useState('');
  const [taskSchedule, setTaskSchedule] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [isGuideSending, setIsGuideSending] = useState(false);
  const guideAbortRef = useRef<AbortController | null>(null);
  const activeChatMode: AgentChatMode = activeAgent?.chatMode || 'config';

  // --- Telegram live chat state ---
  const [liveChatMessages, setLiveChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; timestamp: number; source?: 'telegram' | 'web' }>>([]);
  const [liveChatInput, setLiveChatInput] = useState('');
  const [isLoadingLiveChat, setIsLoadingLiveChat] = useState(false);
  const [isSendingLiveMessage, setIsSendingLiveMessage] = useState(false);
  const liveChatEndRef = useRef<HTMLDivElement | null>(null);
  const liveChatPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveChatAgentIdRef = useRef<string | null>(null);

  // --- Agent deployment state ---
  const [deployedAgentIds, setDeployedAgentIds] = useState<Set<string>>(new Set());
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatusResult>>({});
  const [agentCosts, setAgentCosts] = useState<Record<string, AgentCostSummaryResult>>({});
  const [isDeploying, setIsDeploying] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [alwaysOnAgentIds, setAlwaysOnAgentIds] = useState<Set<string>>(new Set());
  const runtimeConfigSyncRef = useRef<Map<string, string>>(new Map());
  const [isVerifyingTelegram, setIsVerifyingTelegram] = useState(false);
  const [telegramVerifyResult, setTelegramVerifyResult] = useState<string | null>(null);
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<string | null>(null);
  const [isTestingRadarr, setIsTestingRadarr] = useState(false);
  const [radarrTestResult, setRadarrTestResult] = useState<string | null>(null);
  const [isTestingSonarr, setIsTestingSonarr] = useState(false);
  const [sonarrTestResult, setSonarrTestResult] = useState<string | null>(null);
  const [isTestingHA, setIsTestingHA] = useState(false);
  const [haTestResult, setHATestResult] = useState<string | null>(null);
  const [showResetMemoryConfirm, setShowResetMemoryConfirm] = useState(false);
  const [isResettingMemory, setIsResettingMemory] = useState(false);
  const [memoryResetResult, setMemoryResetResult] = useState<string | null>(null);

  // --- Agent data state (notes, lists, schedules) ---
  const [agentNotes, setAgentNotes] = useState<AgentNoteApi[]>([]);
  const [agentLists, setAgentLists] = useState<AgentListApi[]>([]);
  const [agentSchedules, setAgentSchedules] = useState<AgentScheduleApi[]>([]);
  const [agentWorkingMemory, setAgentWorkingMemory] = useState<AgentWorkingMemoryEntryApi[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isLoadingWorkingMemory, setIsLoadingWorkingMemory] = useState(false);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryLabel, setEditingMemoryLabel] = useState('');
  const [editingMemoryContent, setEditingMemoryContent] = useState('');
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [isSavingMemory, setIsSavingMemory] = useState(false);
  const [showClearWorkingMemoryConfirm, setShowClearWorkingMemoryConfirm] = useState(false);
  const [isClearingWorkingMemory, setIsClearingWorkingMemory] = useState(false);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);

  useEffect(() => {
    setTaskSchedule(buildScheduleFromBuilder(scheduleMode, scheduleTime, scheduleWeekdays, scheduleSingleDate));
  }, [scheduleMode, scheduleTime, scheduleWeekdays, scheduleSingleDate]);
  const [expandedCalendarSections, setExpandedCalendarSections] = useState<{ google: boolean; icloud: boolean }>({
    google: true,
    icloud: false,
  });
  const [expandedMediaSections, setExpandedMediaSections] = useState<{ radarr: boolean; sonarr: boolean; homeAssistant: boolean }>({
    radarr: false,
    sonarr: false,
    homeAssistant: false,
  });
  const [gmailExpanded, setGmailExpanded] = useState(false);
  const [gmailTestResult, setGmailTestResult] = useState<string | null>(null);
  const [gmailTestLoading, setGmailTestLoading] = useState(false);
  const [gmailAuthLoading, setGmailAuthLoading] = useState(false);

  // --- Delete-confirmation state (two-step with code) ---
  const [pendingDelete, setPendingDelete] = useState<{ type: 'note' | 'list' | 'schedule' | 'memory'; id: string } | null>(null);

  // Keep running agents synced with backend runtime state
  useEffect(() => {
    const syncRunningAgents = async () => {
      try {
        const [ids, alwaysOnIds] = await Promise.all([
          getRunningAgentsApi(),
          getAlwaysOnAgentsApi(),
        ]);
        setDeployedAgentIds(new Set(ids));
        setAlwaysOnAgentIds(new Set(alwaysOnIds));
      } catch {
        // ignore transient network/auth issues
      }
    };

    syncRunningAgents();
    const interval = setInterval(syncRunningAgents, 10000);
    return () => clearInterval(interval);
  }, []);

  // Poll agent status for deployed agents
  useEffect(() => {
    if (deployedAgentIds.size === 0) return;
    const pollStatus = async () => {
      const statuses: Record<string, AgentStatusResult> = {};
      const costs: Record<string, AgentCostSummaryResult> = {};
      for (const id of deployedAgentIds) {
        try {
          const [status, costSummary] = await Promise.all([
            getAgentStatusApi(id),
            getAgentCostsApi(id),
          ]);
          statuses[id] = status;
          if (costSummary) {
            costs[id] = costSummary;
          }
        } catch { /* ignore */ }
      }
      setAgentStatuses(statuses);
      setAgentCosts((prev) => ({ ...prev, ...costs }));
    };
    pollStatus();
    const interval = setInterval(pollStatus, 10000);
    return () => clearInterval(interval);
  }, [deployedAgentIds]);

  useEffect(() => {
    if (!activeAgent) return;
    let mounted = true;
    const pollActiveAgentCosts = async () => {
      try {
        const summary = await getAgentCostsApi(activeAgent.id);
        if (!summary || !mounted) return;
        setAgentCosts((prev) => ({ ...prev, [activeAgent.id]: summary }));
      } catch {
        // ignore transient failures
      }
    };
    pollActiveAgentCosts();
    const interval = setInterval(pollActiveAgentCosts, 15000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeAgent?.id]);

  useEffect(() => {
    setMemoryResetResult(null);
    setShowResetMemoryConfirm(false);
    setExpandedCalendarSections({ google: true, icloud: false });
    setAgentWorkingMemory([]);
    setEditingMemoryId(null);
    setEditingMemoryLabel('');
    setEditingMemoryContent('');
    setMemoryError(null);
  }, [activeAgent?.id]);

  // Fetch agent data (notes/lists/schedules) when data tab is active
  useEffect(() => {
    if (!activeAgent || activeTab !== 'data') return;
    let mounted = true;
    const fetchData = async () => {
      setIsLoadingData(true);
      try {
        const [notes, lists, schedules] = await Promise.all([
          getAgentNotesApi(activeAgent.id).catch(() => [] as AgentNoteApi[]),
          getAgentListsApi(activeAgent.id).catch(() => [] as AgentListApi[]),
          getAgentSchedulesApi(activeAgent.id).catch(() => [] as AgentScheduleApi[]),
        ]);
        if (!mounted) return;
        setAgentNotes(notes);
        setAgentLists(lists);
        setAgentSchedules(schedules);
      } catch {
        // ignore
      } finally {
        if (mounted) setIsLoadingData(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeAgent?.id, activeTab]);

  useEffect(() => {
    if (!activeAgent || activeTab !== 'memory') return;
    let mounted = true;
    const fetchWorkingMemory = async () => {
      setIsLoadingWorkingMemory(true);
      setMemoryError(null);
      try {
        const entries = await getAgentWorkingMemoryApi(activeAgent.id);
        if (!mounted) return;
        setAgentWorkingMemory(entries);
      } catch {
        if (mounted) {
          setMemoryError(language === 'es' ? 'No se pudo cargar la memoria.' : 'Could not load memory.');
        }
      } finally {
        if (mounted) setIsLoadingWorkingMemory(false);
      }
    };
    fetchWorkingMemory();
    const interval = setInterval(fetchWorkingMemory, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeAgent?.id, activeTab, language]);

  const requestDeleteNote = (noteId: string) => setPendingDelete({ type: 'note', id: noteId });
  const requestDeleteList = (listId: string) => setPendingDelete({ type: 'list', id: listId });
  const requestDeleteSchedule = (scheduleId: string) => setPendingDelete({ type: 'schedule', id: scheduleId });
  const requestDeleteMemoryEntry = (entryId: string) => setPendingDelete({ type: 'memory', id: entryId });

  const executePendingDelete = async () => {
    if (!activeAgent || !pendingDelete) return;
    try {
      switch (pendingDelete.type) {
        case 'note':
          await deleteAgentNoteApi(activeAgent.id, pendingDelete.id);
          setAgentNotes((prev) => prev.filter((n) => n.id !== pendingDelete.id));
          break;
        case 'list':
          await deleteAgentListApi(activeAgent.id, pendingDelete.id);
          setAgentLists((prev) => prev.filter((l) => l.id !== pendingDelete.id));
          break;
        case 'schedule':
          await deleteAgentScheduleApi(activeAgent.id, pendingDelete.id);
          setAgentSchedules((prev) => prev.filter((s) => s.id !== pendingDelete.id));
          break;
        case 'memory':
          await deleteAgentWorkingMemoryEntryApi(activeAgent.id, pendingDelete.id);
          setAgentWorkingMemory((prev) => prev.filter((entry) => entry.id !== pendingDelete.id));
          if (editingMemoryId === pendingDelete.id) {
            setEditingMemoryId(null);
            setEditingMemoryLabel('');
            setEditingMemoryContent('');
          }
          break;
      }
    } catch { /* ignore */ }
    setPendingDelete(null);
  };

  const startEditingMemory = (entry: AgentWorkingMemoryEntryApi) => {
    setMemoryError(null);
    setEditingMemoryId(entry.id);
    setEditingMemoryLabel(entry.label);
    setEditingMemoryContent(entry.content);
  };

  const cancelEditingMemory = () => {
    setEditingMemoryId(null);
    setEditingMemoryLabel('');
    setEditingMemoryContent('');
    setMemoryError(null);
  };

  const saveEditedMemory = async () => {
    if (!activeAgent || !editingMemoryId || isSavingMemory) return;
    const nextLabel = editingMemoryLabel.trim();
    if (!nextLabel) {
      setMemoryError(language === 'es' ? 'La etiqueta no puede estar vacía.' : 'Label cannot be empty.');
      return;
    }
    setIsSavingMemory(true);
    setMemoryError(null);
    try {
      const updated = await updateAgentWorkingMemoryEntryApi(activeAgent.id, editingMemoryId, {
        label: nextLabel,
        content: editingMemoryContent,
      });
      setAgentWorkingMemory((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)));
      cancelEditingMemory();
    } catch {
      setMemoryError(language === 'es' ? 'No se pudo guardar el cambio.' : 'Could not save changes.');
    } finally {
      setIsSavingMemory(false);
    }
  };

  const clearWorkingMemory = async () => {
    if (!activeAgent || isClearingWorkingMemory) return;
    setIsClearingWorkingMemory(true);
    setMemoryError(null);
    try {
      await clearAgentWorkingMemoryApi(activeAgent.id);
      setAgentWorkingMemory([]);
      cancelEditingMemory();
      setShowClearWorkingMemoryConfirm(false);
    } catch {
      setMemoryError(language === 'es' ? 'No se pudo vaciar la memoria.' : 'Could not clear memory.');
    } finally {
      setIsClearingWorkingMemory(false);
    }
  };

  const handleToggleSchedule = async (scheduleId: string, enabled: boolean) => {
    if (!activeAgent) return;
    try {
      const updated = await updateAgentScheduleApi(activeAgent.id, scheduleId, { enabled });
      setAgentSchedules((prev) => prev.map((s) => (s.id === scheduleId ? updated : s)));
    } catch { /* ignore */ }
  };

  // handleDeleteSchedule replaced by requestDeleteSchedule above

  const handleDeployAgent = async () => {
    if (!activeAgent || isDeploying) return;
    setIsDeploying(true);
    setDeployError(null);
    try {
      const token = activeAgent.integrations.telegram.botToken.trim();
      const chatId = activeAgent.integrations.telegram.chatId.trim();
      const verify = await verifyTelegramApi(token, chatId || undefined);
      const chatIsValid = chatId ? verify.chatIdValid === true : false;
      if (!verify.valid || !chatIsValid) {
        const verifyError =
          verify.error ||
          verify.message ||
          (language === 'es'
            ? 'No se pudo verificar Telegram. Revisa bot token y chat ID.'
            : 'Could not verify Telegram. Check bot token and chat ID.');
        setDeployError(verifyError);
        setTelegramVerifyResult(`❌ ${verifyError}`);
        updateActiveAgent((agent) => ({
          ...agent,
          integrations: {
            ...agent.integrations,
            telegram: { ...agent.integrations.telegram, verified: false },
          },
        }));
        return;
      }

      updateActiveAgent((agent) => ({
        ...agent,
        integrations: {
          ...agent.integrations,
          telegram: { ...agent.integrations.telegram, verified: true },
        },
      }));
      setTelegramVerifyResult(verify.message || `✅ Bot @${verify.botName} verificado`);

      const result = await deployAgentApi(activeAgent);
      if (result.success) {
        setDeployedAgentIds((prev) => new Set([...prev, activeAgent.id]));
        updateActiveAgent((agent) => ({ ...agent, status: 'active' }));
      } else {
        setDeployError(result.error || 'Error al desplegar el agente');
      }
    } catch (error: any) {
      setDeployError(error.message || 'Error de conexión');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleStopAgent = async () => {
    if (!activeAgent || isStopping) return;
    setIsStopping(true);
    try {
      const result = await stopAgentApi(activeAgent.id);
      if (result.success) {
        updateActiveAgent((agent) => ({ ...agent, status: 'paused' }));
        setDeployedAgentIds((prev) => {
          const next = new Set(prev);
          next.delete(activeAgent.id);
          return next;
        });
      } else {
        setDeployError(
          result.error ||
            (language === 'es'
              ? 'No se pudo detener el agente en este momento.'
              : 'Could not stop the agent right now.')
        );
      }
    } catch {
      setDeployError(
        language === 'es'
          ? 'Error de conexión al detener el agente.'
          : 'Connection error while stopping the agent.'
      );
    } finally {
      setIsStopping(false);
    }
  };

  const handleRestartAgent = async () => {
    if (!activeAgent || isRestarting || isDeploying || isStopping) return;
    setIsRestarting(true);
    setDeployError(null);
    try {
      // Stop first (ignore if not running)
      if (deployedAgentIds.has(activeAgent.id)) {
        const stopResult = await stopAgentApi(activeAgent.id);
        if (!stopResult.success) {
          setDeployError(
            stopResult.error ||
              (language === 'es' ? 'No se pudo detener el agente.' : 'Could not stop the agent.')
          );
          return;
        }
        setDeployedAgentIds((prev) => {
          const next = new Set(prev);
          next.delete(activeAgent.id);
          return next;
        });
        // Small delay to let the backend clean up
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      // Now deploy again
      const result = await deployAgentApi(activeAgent);
      if (result.success) {
        setDeployedAgentIds((prev) => new Set([...prev, activeAgent.id]));
        updateActiveAgent((agent) => ({ ...agent, status: 'active' }));
      } else {
        setDeployError(result.error || (language === 'es' ? 'Error al reiniciar el agente' : 'Error restarting agent'));
      }
    } catch (error: any) {
      setDeployError(error.message || (language === 'es' ? 'Error de conexión' : 'Connection error'));
    } finally {
      setIsRestarting(false);
    }
  };

  const handleToggleAlwaysOn = async () => {
    if (!activeAgent) return;
    const newValue = !alwaysOnAgentIds.has(activeAgent.id);
    // Optimistic update
    setAlwaysOnAgentIds((prev) => {
      const next = new Set(prev);
      if (newValue) {
        next.add(activeAgent.id);
      } else {
        next.delete(activeAgent.id);
      }
      return next;
    });
    updateActiveAgent((agent) => ({ ...agent, alwaysOn: newValue }));
    try {
      const result = await setAgentAlwaysOnApi(activeAgent.id, newValue);
      if (!result.success) {
        // Revert on failure
        setAlwaysOnAgentIds((prev) => {
          const next = new Set(prev);
          if (!newValue) {
            next.add(activeAgent.id);
          } else {
            next.delete(activeAgent.id);
          }
          return next;
        });
        updateActiveAgent((agent) => ({ ...agent, alwaysOn: !newValue }));
        setDeployError(result.error || (language === 'es' ? 'Error al cambiar always-on' : 'Error toggling always-on'));
      }
    } catch {
      // Revert on failure
      setAlwaysOnAgentIds((prev) => {
        const next = new Set(prev);
        if (!newValue) {
          next.add(activeAgent.id);
        } else {
          next.delete(activeAgent.id);
        }
        return next;
      });
      updateActiveAgent((agent) => ({ ...agent, alwaysOn: !newValue }));
      setDeployError(language === 'es' ? 'Error de conexión' : 'Connection error');
    }
  };

  const handleVerifyTelegram = async () => {
    if (!activeAgent || isVerifyingTelegram) return;
    setIsVerifyingTelegram(true);
    setTelegramVerifyResult(null);
    try {
      const hasChatId = Boolean(activeAgent.integrations.telegram.chatId.trim());
      const result = await verifyTelegramApi(
        activeAgent.integrations.telegram.botToken,
        activeAgent.integrations.telegram.chatId || undefined
      );
      if (!result.valid) {
        setTelegramVerifyResult(`❌ ${result.error || 'Verificación fallida'}`);
        updateActiveAgent((agent) => ({
          ...agent,
          integrations: {
            ...agent.integrations,
            telegram: { ...agent.integrations.telegram, verified: false },
          },
        }));
        return;
      }

      if (hasChatId && !result.chatIdValid) {
        setTelegramVerifyResult(`❌ ${result.error || 'Chat ID inválido o inaccesible para el bot.'}`);
        updateActiveAgent((agent) => ({
          ...agent,
          integrations: {
            ...agent.integrations,
            telegram: { ...agent.integrations.telegram, verified: false },
          },
        }));
        return;
      }

      setTelegramVerifyResult(result.message || `✅ Bot @${result.botName} verificado`);
      updateActiveAgent((agent) => ({
        ...agent,
        integrations: {
          ...agent.integrations,
          telegram: { ...agent.integrations.telegram, verified: hasChatId ? result.chatIdValid === true : false },
        },
      }));
    } catch (error: any) {
      setTelegramVerifyResult(`❌ Error: ${error.message}`);
    } finally {
      setIsVerifyingTelegram(false);
    }
  };

  const handleTestRadarr = async () => {
    if (!activeAgent || isTestingRadarr) return;
    setIsTestingRadarr(true);
    setRadarrTestResult(null);
    try {
      const url = activeAgent.integrations.media?.radarr?.url;
      const apiKey = activeAgent.integrations.media?.radarr?.apiKey;
      if (!url || !apiKey) {
        setRadarrTestResult(language === 'es' ? '❌ URL y API Key son obligatorios' : '❌ URL and API Key are required');
        return;
      }
      const res = await fetch('/api/agents/media/test-radarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url, apiKey }),
      });
      const data = await res.json();
      if (data.success) {
        setRadarrTestResult(`✅ Radarr v${data.version} — ${language === 'es' ? 'Conexión exitosa' : 'Connection successful'}`);
      } else {
        setRadarrTestResult(`❌ ${data.error || 'Connection failed'}`);
      }
    } catch (error: any) {
      setRadarrTestResult(`❌ Error: ${error.message}`);
    } finally {
      setIsTestingRadarr(false);
    }
  };

  const handleTestSonarr = async () => {
    if (!activeAgent || isTestingSonarr) return;
    setIsTestingSonarr(true);
    setSonarrTestResult(null);
    try {
      const url = activeAgent.integrations.media?.sonarr?.url;
      const apiKey = activeAgent.integrations.media?.sonarr?.apiKey;
      if (!url || !apiKey) {
        setSonarrTestResult(language === 'es' ? '❌ URL y API Key son obligatorios' : '❌ URL and API Key are required');
        return;
      }
      const res = await fetch('/api/agents/media/test-sonarr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url, apiKey }),
      });
      const data = await res.json();
      if (data.success) {
        setSonarrTestResult(`✅ Sonarr v${data.version} — ${language === 'es' ? 'Conexión exitosa' : 'Connection successful'}`);
      } else {
        setSonarrTestResult(`❌ ${data.error || 'Connection failed'}`);
      }
    } catch (error: any) {
      setSonarrTestResult(`❌ Error: ${error.message}`);
    } finally {
      setIsTestingSonarr(false);
    }
  };

  const handleTestHomeAssistant = async () => {
    if (!activeAgent || isTestingHA) return;
    setIsTestingHA(true);
    setHATestResult(null);
    try {
      const url = activeAgent.integrations.homeAssistant?.url;
      const token = activeAgent.integrations.homeAssistant?.token;
      if (!url || !token) {
        setHATestResult(language === 'es' ? '❌ URL y Token son obligatorios' : '❌ URL and Token are required');
        return;
      }
      const res = await fetch('/api/agents/homeassistant/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url, token }),
      });
      const data = await res.json();
      if (data.success) {
        setHATestResult(`✅ Home Assistant v${data.version} — ${data.locationName || ''} — ${language === 'es' ? 'Conexión exitosa' : 'Connection successful'}`);
      } else {
        setHATestResult(`❌ ${data.error || 'Connection failed'}`);
      }
    } catch (error: any) {
      setHATestResult(`❌ Error: ${error.message}`);
    } finally {
      setIsTestingHA(false);
    }
  };

  const handleResetAgentMemory = async () => {
    if (!activeAgent || isResettingMemory) return;
    setIsResettingMemory(true);
    setMemoryResetResult(null);

    try {
      const result = await resetAgentMemoryApi(activeAgent.id);
      updateAgentById(activeAgent.id, (agent) => ({
        ...agent,
        trainingMemory: [],
        setupChat: [createInitialGuideMessage(language, agent.setupProvider, agent.setupModel)],
        telegramTestChat: [createInitialTelegramTestMessage(language)],
      }));

      const details =
        language === 'es'
          ? `Mensajes persistidos eliminados: ${result.clearedPersistentMessages}.`
          : `Persisted messages deleted: ${result.clearedPersistentMessages}.`;
      setMemoryResetResult(`✅ ${copy.assistant.resetMemorySuccess} ${details}`);
    } catch (error: any) {
      setMemoryResetResult(`❌ ${error?.message || copy.assistant.resetMemoryError}`);
    } finally {
      setIsResettingMemory(false);
    }
  };

  // ── Live chat: polling & send ──────────────────────────────────────

  const agentStatus = activeAgent ? agentStatuses[activeAgent.id] : undefined;
  const isAgentDeployed = activeAgent
    ? (agentStatus ? agentStatus.running : deployedAgentIds.has(activeAgent.id))
    : false;

  useEffect(() => {
    const nextAgentId = activeAgent?.id || null;
    if (liveChatAgentIdRef.current === nextAgentId) return;
    liveChatAgentIdRef.current = nextAgentId;
    setLiveChatMessages([]);
  }, [activeAgent?.id]);

  const fetchLiveChatHistory = useCallback(async () => {
    if (!activeAgent) return;
    try {
      const messages = await getAgentConversationApi(activeAgent.id);
      setLiveChatMessages((prev) => {
        if (messages.length === 0 && prev.length > 0) return prev;
        if (messages.length < prev.length) return prev;
        return messages;
      });
    } catch {
      // silent
    }
  }, [activeAgent?.id]);

  // Start polling when chat section is active & agent is deployed
  useEffect(() => {
    if (activeSection !== 'chat' || !activeAgent || !isAgentDeployed) {
      if (liveChatPollRef.current) {
        clearInterval(liveChatPollRef.current);
        liveChatPollRef.current = null;
      }
      return;
    }
    // Fetch immediately, then poll every 2s
    setIsLoadingLiveChat(true);
    fetchLiveChatHistory().finally(() => setIsLoadingLiveChat(false));
    liveChatPollRef.current = setInterval(fetchLiveChatHistory, 2000);
    return () => {
      if (liveChatPollRef.current) {
        clearInterval(liveChatPollRef.current);
        liveChatPollRef.current = null;
      }
    };
  }, [activeSection, activeAgent?.id, isAgentDeployed, fetchLiveChatHistory]);

  // Auto-scroll live chat
  useEffect(() => {
    liveChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [liveChatMessages.length]);

  const handleSendLiveMessage = async () => {
    if (!activeAgent || !liveChatInput.trim() || isSendingLiveMessage) return;
    const text = liveChatInput.trim();
    setIsSendingLiveMessage(true);
    setLiveChatInput('');
    // Optimistic: add the user message immediately
    setLiveChatMessages((prev) => [...prev, { role: 'user', content: text, timestamp: Date.now(), source: 'web' }]);
    try {
      await sendAgentMessageApi(activeAgent.id, text);
      // Fetch latest to catch up quickly
      setTimeout(fetchLiveChatHistory, 500);
    } catch {
      // message is already shown optimistically
    } finally {
      setIsSendingLiveMessage(false);
    }
  };

  const agentCostSummary = activeAgent ? agentCosts[activeAgent.id] : undefined;
  const moneyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(language === 'es' ? 'es-ES' : 'en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
    [language]
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(language === 'es' ? 'es-ES' : 'en-US'),
    [language]
  );
  const timezoneSortLocale = language === 'es' ? 'es-ES' : 'en-US';
  const timezoneCatalog = useMemo(() => {
    const source = SUPPORTED_TIMEZONES.length > 0 ? SUPPORTED_TIMEZONES : [getDefaultAgentTimezone()];
    const sorted = [...source].sort((a, b) => a.localeCompare(b, timezoneSortLocale, { sensitivity: 'base' }));
    const placesByRegion = new Map<string, string[]>();
    for (const timezone of sorted) {
      const parsed = splitTimezone(timezone);
      if (!parsed) continue;
      const current = placesByRegion.get(parsed.region) || [];
      current.push(parsed.place);
      placesByRegion.set(parsed.region, current);
    }
    const regions = Array.from(placesByRegion.keys()).sort((a, b) => a.localeCompare(b, timezoneSortLocale, { sensitivity: 'base' }));
    for (const region of regions) {
      const places = placesByRegion.get(region) || [];
      places.sort((a, b) => a.localeCompare(b, timezoneSortLocale, { sensitivity: 'base' }));
      placesByRegion.set(region, places);
    }
    return { regions, placesByRegion };
  }, [timezoneSortLocale]);
  const activeTimezoneParts = useMemo(() => {
    const parsed = activeAgent ? splitTimezone(normalizeAgentTimezone(activeAgent.timezone)) : null;
    if (
      parsed &&
      timezoneCatalog.placesByRegion.has(parsed.region) &&
      (timezoneCatalog.placesByRegion.get(parsed.region) || []).includes(parsed.place)
    ) {
      return parsed;
    }
    const fallbackParsed = splitTimezone(getDefaultAgentTimezone());
    if (fallbackParsed) return fallbackParsed;
    const fallbackRegion = timezoneCatalog.regions[0] || '';
    const fallbackPlace = (timezoneCatalog.placesByRegion.get(fallbackRegion) || [])[0] || '';
    return fallbackRegion && fallbackPlace ? { region: fallbackRegion, place: fallbackPlace } : null;
  }, [activeAgent, timezoneCatalog]);
  const selectedTimezoneRegion = activeTimezoneParts?.region || '';
  const placesForSelectedTimezoneRegion = useMemo(
    () => (selectedTimezoneRegion ? timezoneCatalog.placesByRegion.get(selectedTimezoneRegion) || [] : []),
    [selectedTimezoneRegion, timezoneCatalog]
  );

  useEffect(() => {
    return () => {
      if (guideAbortRef.current) {
        guideAbortRef.current.abort();
        guideAbortRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isGuideSending) return;
    const handleKeydown = (event: KeyboardEvent) => {
      const isStopKey =
        event.key === 'Escape' ||
        ((event.metaKey || event.ctrlKey) && event.key === '.');
      if (!isStopKey) return;
      event.preventDefault();
      stopGuideRequest();
    };
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, [isGuideSending]);

  const updateWorkspace = (updater: (prev: AgentWorkspaceState) => AgentWorkspaceState) =>
    onWorkspaceChange((prev) => updater(prev));

  const updateAgentById = (agentId: string, updater: (agent: AutonomousAgent) => AutonomousAgent) => {
    updateWorkspace((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) => {
        if (agent.id !== agentId) return agent;
        const updated = updater(agent);
        return { ...updated, updatedAt: Date.now() };
      }),
    }));
  };

  const updateActiveAgent = (updater: (agent: AutonomousAgent) => AutonomousAgent) => {
    if (!activeAgent) return;
    updateAgentById(activeAgent.id, updater);
  };

  useEffect(() => {
    if (!activeAgent) return;

    // Always sync agent provider/model with global Settings values
    const providerOption =
      availableProviders.find((item) => item.id === preferredProviderId) ||
      availableProviders[0];
    if (!providerOption) return;

    const targetModel =
      providerOption.models.find((model) => model.id === preferredModelId)?.id ||
      providerOption.models[0]?.id ||
      '';

    const needsUpdate =
      activeAgent.setupProvider !== providerOption.id ||
      activeAgent.setupModel !== targetModel ||
      !activeAgent.chatMode;

    if (!needsUpdate) return;

    updateAgentById(activeAgent.id, (agent) => ({
      ...agent,
      setupProvider: providerOption.id,
      setupModel: targetModel,
      chatMode: agent.chatMode || 'config',
    }));
  }, [
    activeAgent?.id,
    activeAgent?.setupProvider,
    activeAgent?.setupModel,
    activeAgent?.chatMode,
    availableProviders,
    preferredProviderId,
    preferredModelId,
  ]);

  useEffect(() => {
    if (!activeAgent) return;
    if (!deployedAgentIds.has(activeAgent.id)) return;

    const signature = JSON.stringify({
      provider: activeAgent.setupProvider,
      model: activeAgent.setupModel,
      runtimeTuning: activeAgent.runtimeTuning,
    });

    const previous = runtimeConfigSyncRef.current.get(activeAgent.id);
    if (previous === signature) return;
    runtimeConfigSyncRef.current.set(activeAgent.id, signature);

    updateAgentRuntimeConfigApi(activeAgent.id, {
      provider: activeAgent.setupProvider,
      model: activeAgent.setupModel,
      runtimeTuning: activeAgent.runtimeTuning,
    }).then((result) => {
      if (!result.success) {
        console.warn('[AgentsWorkspace] Runtime config sync failed:', result.error || 'unknown error');
      }
    }).catch((error) => {
      console.warn('[AgentsWorkspace] Runtime config sync error:', error?.message || error);
    });
  }, [
    activeAgent?.id,
    activeAgent?.setupProvider,
    activeAgent?.setupModel,
    activeAgent?.runtimeTuning,
    deployedAgentIds,
  ]);

  useEffect(() => {
    if (!activeAgent) return;
    const selectedId = activeAgent.setupSystemPromptId;
    if (!selectedId) return;
    if (systemPrompts.some((prompt) => prompt.id === selectedId)) return;
    updateAgentById(activeAgent.id, (agent) => ({
      ...agent,
      setupSystemPromptId: '',
    }));
  }, [activeAgent?.id, activeAgent?.setupSystemPromptId, systemPrompts]);

  useEffect(() => {
    if (!activeAgent) return;
    const setupChat = activeAgent.setupChat || [];
    if (setupChat.length === 0) {
      updateAgentById(activeAgent.id, (agent) => ({
        ...agent,
        setupChat: [createInitialGuideMessage(language, agent.setupProvider, agent.setupModel)],
      }));
      return;
    }
    const hasUserMessages = setupChat.some((message) => message.role === 'user');
    if (hasUserMessages) return;
    const first = setupChat[0];
    if (!first || first.role !== 'assistant' || !isTemplateGuideMessage(first.content)) return;
    const expected = createInitialGuideMessage(language, activeAgent.setupProvider, activeAgent.setupModel).content;
    if (first.content.trim() === expected.trim()) return;

    updateAgentById(activeAgent.id, (agent) => ({
      ...agent,
      setupChat: agent.setupChat.map((message, index) =>
        index === 0 && message.role === 'assistant'
          ? { ...message, content: expected }
          : message
      ),
    }));
  }, [
    activeAgent?.id,
    activeAgent?.setupProvider,
    activeAgent?.setupModel,
    activeAgent?.setupChat,
    language,
  ]);

  const createAgent = () => {
    const newAgent = createAutonomousAgent(language, workspace.agents.length + 1, {
      providerId: preferredProviderId,
      modelId: preferredModelId,
      systemPromptId: preferredSystemPromptId,
      temperature: preferredTemperature,
      maxTokens: preferredMaxTokens,
    });
    updateWorkspace((prev) => ({
      agents: [newAgent, ...prev.agents],
      activeAgentId: newAgent.id,
    }));
    setActiveTab('general');
  };

  const deleteActiveAgent = () => {
    if (!activeAgent) return;

    if (workspace.agents.length <= 1) {
      const fallback = createAutonomousAgent(language, 1, {
        providerId: preferredProviderId,
        modelId: preferredModelId,
        systemPromptId: preferredSystemPromptId,
        temperature: preferredTemperature,
        maxTokens: preferredMaxTokens,
      });
      updateWorkspace(() => ({
        agents: [fallback],
        activeAgentId: fallback.id,
      }));
      return;
    }

    updateWorkspace((prev) => {
      const remaining = prev.agents.filter((agent) => agent.id !== activeAgent.id);
      return {
        agents: remaining,
        activeAgentId: remaining[0]?.id || '',
      };
    });
  };

  const addScheduleTask = () => {
    if (!taskName.trim() || !taskSchedule.trim() || !activeAgent) return;
    updateActiveAgent((agent) => ({
      ...agent,
      schedules: [
        ...agent.schedules,
        {
          id: createUniqueId(),
          name: taskName.trim(),
          schedule: taskSchedule.trim(),
          prompt: taskPrompt.trim(),
          enabled: true,
        },
      ],
    }));
    setTaskName('');
    setScheduleMode('weekly');
    setScheduleTime('09:00');
    setScheduleWeekdays([1, 2, 3, 4, 5]);
    setScheduleSingleDate('');
    setTaskSchedule('');
    setTaskPrompt('');
  };

  const stopGuideRequest = () => {
    if (guideAbortRef.current) {
      guideAbortRef.current.abort();
      guideAbortRef.current = null;
    }
  };

  const sendGuideMessage = async () => {
    if (!activeAgent || !chatInput.trim() || isGuideSending) return;
    if (!activeAgent.setupProvider || !activeAgent.setupModel) return;

    const targetAgentId = activeAgent.id;
    const userInput = chatInput.trim();
    const assistantMsgId = createUniqueId();
    const chatKey: 'setupChat' | 'telegramTestChat' =
      activeChatMode === 'telegram_test' ? 'telegramTestChat' : 'setupChat';
    const sourceChat = chatKey === 'telegramTestChat' ? activeAgent.telegramTestChat : activeAgent.setupChat;

    const userMsg: AgentGuideMessage = {
      id: createUniqueId(),
      role: 'user',
      content: userInput,
      timestamp: Date.now(),
    };

    const assistantMsg: AgentGuideMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now() + 1,
    };

    setChatInput('');
    setIsGuideSending(true);

    updateAgentById(targetAgentId, (agent) => ({
      ...agent,
      [chatKey]: [...agent[chatKey], userMsg, assistantMsg],
      trainingMemory:
        chatKey === 'setupChat'
          ? [...agent.trainingMemory, userInput]
          : agent.trainingMemory,
    }));

    const pendingChecklist = getChecklistItems(activeAgent, copy);
    const redactMcpConfig = (config: Record<string, string>): Record<string, string> =>
      Object.fromEntries(
        Object.keys(config).map((key) => [key, config[key] ? '[REDACTED]' : ''])
      );
    const telegramContextPayload = {
      mode: 'telegram_test',
      bot: {
        telegramChatId: activeAgent.integrations.telegram.chatId ? '[REDACTED]' : null,
        verified: activeAgent.integrations.telegram.verified,
      },
      objective: activeAgent.objective,
      systemPrompt: activeAgent.systemPrompt,
      permissions: {
        ...activeAgent.permissions,
        webCredentials: activeAgent.permissions.webCredentials.map((credential) => ({
          id: credential.id,
          siteConfigured: Boolean(credential.site.trim()),
          usernameConfigured: Boolean(credential.username.trim()),
          passwordConfigured: Boolean(credential.password),
        })),
      },
      integrations: {
        ...activeAgent.integrations,
        telegram: {
          ...activeAgent.integrations.telegram,
          botToken: activeAgent.integrations.telegram.botToken ? '[REDACTED]' : '',
          chatId: activeAgent.integrations.telegram.chatId ? '[REDACTED]' : '',
        },
        mcpServers: activeAgent.integrations.mcpServers.map((server) => ({
          ...server,
          config: redactMcpConfig(server.config),
        })),
      },
      scheduler: activeAgent.schedules,
    };
    const selectedSystemPrompt = activeAgent.setupSystemPromptId
      ? systemPrompts.find((prompt) => prompt.id === activeAgent.setupSystemPromptId)
      : undefined;
    const selectedSystemPromptContent = selectedSystemPrompt?.content?.trim() || '';
    const modeSystemPrompt =
      chatKey === 'setupChat'
        ? buildGuideSystemPrompt(language)
        : buildTelegramTestSystemPrompt(language);
    const effectiveSystemPrompt = selectedSystemPromptContent
      ? `${selectedSystemPromptContent}\n\n${modeSystemPrompt}`
      : modeSystemPrompt;

    const combinedChat = [...sourceChat, userMsg];
    const recentChat = combinedChat.slice(-AGENT_SETUP_RECENT_WINDOW);
    const relevantMemories = buildRelevantMemorySnippets(
      combinedChat,
      userInput,
      AGENT_SETUP_RECENT_WINDOW,
      AGENT_SETUP_MEMORY_LIMIT
    );
    const memoryContextMessage = relevantMemories.length > 0
      ? {
          role: 'system' as const,
          content:
            language === 'es'
              ? `Memoria relevante del historial (usa solo si aplica):\n${relevantMemories.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n')}`
              : `Relevant recalled memory from history (use only if applicable):\n${relevantMemories.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n')}`,
        }
      : null;

    const guideMessages = [
      {
        role: 'system' as const,
        content:
          chatKey === 'setupChat'
            ? buildGuideContextMessage(activeAgent, pendingChecklist, language)
            : language === 'es'
              ? `Contexto de simulación Telegram (JSON):\n${JSON.stringify(telegramContextPayload, null, 2)}`
              : `Telegram simulation context (JSON):\n${JSON.stringify(telegramContextPayload, null, 2)}`,
      },
      ...(memoryContextMessage ? [memoryContextMessage] : []),
      ...recentChat
        .map((message) => ({
          role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: message.content,
        })),
    ];

    const abortController = new AbortController();
    guideAbortRef.current = abortController;
    let streamedContent = '';

    try {
      await sendChatMessage(
        {
          provider: activeAgent.setupProvider,
          model: activeAgent.setupModel,
          messages: guideMessages,
          systemPrompt: effectiveSystemPrompt,
          maxTokens: clampSetupMaxTokens(activeAgent.setupMaxTokens, AGENT_SETUP_DEFAULT_MAX_TOKENS),
          temperature: clampSetupTemperature(activeAgent.setupTemperature, AGENT_SETUP_DEFAULT_TEMPERATURE),
          tooling: { webSearch: false, codeExecution: false },
        },
        {
          onToken: (token) => {
            streamedContent += token;
            updateAgentById(targetAgentId, (agent) => ({
              ...agent,
              [chatKey]: agent[chatKey].map((message) =>
                message.id === assistantMsgId
                  ? { ...message, content: message.content + token }
                  : message
              ),
            }));
          },
          onDone: () => {
            setIsGuideSending(false);
            guideAbortRef.current = null;
          },
          onError: (error) => {
            if (abortController.signal.aborted) {
              updateAgentById(targetAgentId, (agent) => ({
                ...agent,
                [chatKey]: agent[chatKey].filter(
                  (message) => !(message.id === assistantMsgId && !message.content.trim())
                ),
              }));
              setIsGuideSending(false);
              guideAbortRef.current = null;
              return;
            }
            updateAgentById(targetAgentId, (agent) => ({
              ...agent,
              [chatKey]: agent[chatKey].map((message) => {
                if (message.id !== assistantMsgId) return message;
                const base = message.content.trim() ? message.content : streamedContent;
                const errorLabel = language === 'es' ? 'Error de configuración' : 'Setup error';
                return {
                  ...message,
                  content: `${base}${base ? '\n\n' : ''}⚠️ ${errorLabel}: ${error}`,
                };
              }),
            }));
            setIsGuideSending(false);
            guideAbortRef.current = null;
          },
        },
        abortController.signal
      );
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        const fallbackError = error?.message || (language === 'es' ? 'No se pudo completar la consulta.' : 'Could not complete the request.');
        updateAgentById(targetAgentId, (agent) => ({
          ...agent,
          [chatKey]: agent[chatKey].map((message) =>
            message.id === assistantMsgId
              ? {
                  ...message,
                  content: `⚠️ ${fallbackError}`,
                }
              : message
          ),
        }));
      } else {
        updateAgentById(targetAgentId, (agent) => ({
          ...agent,
          [chatKey]: agent[chatKey].filter(
            (message) => !(message.id === assistantMsgId && !message.content.trim())
          ),
        }));
      }
      setIsGuideSending(false);
      guideAbortRef.current = null;
    }
  };

  const providerOptionForActive =
    availableProviders.find((item) => item.id === activeAgent?.setupProvider) || availableProviders[0];
  const providerModels = providerOptionForActive?.models || [];
  const tabs: Array<{ id: AgentTab; label: string }> = [
    { id: 'general', label: copy.tabs.general },
    { id: 'instructions', label: copy.tabs.instructions },
    { id: 'permissions', label: copy.tabs.permissions },
    { id: 'integrations', label: copy.tabs.integrations },
    { id: 'scheduler', label: copy.tabs.scheduler },
    { id: 'data', label: copy.tabs.data },
    { id: 'memory', label: copy.tabs.memory },
  ];

  if (!activeAgent) {
    return (
      <div className="h-full p-6 md:p-8 bg-background overflow-y-auto">
        <div className="max-w-3xl mx-auto rounded-2xl border border-border bg-surface p-8 text-center">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{copy.emptyStateTitle}</h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{copy.emptyStateBody}</p>
          <button
            onClick={createAgent}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={15} />
            {copy.newAgent}
          </button>
        </div>
      </div>
    );
  }

  const telegramStep = activeAgent.integrations.telegram.tutorialStep;
  const telegramSteps = copy.integrations.telegramSteps;
  const activeChatMessages = activeChatMode === 'telegram_test' ? activeAgent.telegramTestChat : activeAgent.setupChat;
  const selectedCalendarProvider: 'google' | 'icloud' | null = activeAgent.integrations.calendar?.google
    ? 'google'
    : activeAgent.integrations.calendar?.icloud
      ? 'icloud'
      : null;
  const setCalendarProvider = (provider: 'google' | 'icloud', enabled: boolean) => {
    updateActiveAgent((agent) => {
      const currentCalendar = agent.integrations.calendar || {};
      if (!enabled) {
        return {
          ...agent,
          integrations: {
            ...agent.integrations,
            calendar: {
              ...currentCalendar,
              [provider]: undefined,
            },
          },
        };
      }

      if (provider === 'google') {
        return {
          ...agent,
          integrations: {
            ...agent.integrations,
            calendar: {
              ...currentCalendar,
              google: currentCalendar.google || { clientId: '', clientSecret: '', refreshToken: '', calendarId: '' },
              icloud: undefined,
            },
          },
        };
      }

      return {
        ...agent,
        integrations: {
          ...agent.integrations,
          calendar: {
            ...currentCalendar,
            icloud: currentCalendar.icloud || { email: '', appSpecificPassword: '', calendarName: '' },
            google: undefined,
          },
        },
      };
    });

    if (enabled) {
      setExpandedCalendarSections({
        google: provider === 'google',
        icloud: provider === 'icloud',
      });
    }
  };
  const costPeriods: Array<{ key: keyof AgentCostSummaryResult['periods']; label: string }> = [
    { key: 'lastDay', label: copy.costs.lastDay },
    { key: 'lastWeek', label: copy.costs.lastWeek },
    { key: 'lastMonth', label: copy.costs.lastMonth },
    { key: 'lastYear', label: copy.costs.lastYear },
  ];
  const formatCost = (value: number): string => moneyFormatter.format(Number.isFinite(value) ? value : 0);
  const formatCount = (value: number): string => numberFormatter.format(Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  const latestCostTimestamp = agentCostSummary?.generatedAt
    ? new Date(agentCostSummary.generatedAt).toLocaleTimeString(language === 'es' ? 'es-ES' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="h-full bg-background overflow-y-auto p-4 md:p-6 space-y-4">
      <section className="space-y-4">
        {/* ── Top-level section toggle: Config / Chat ── */}
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="border-b border-border px-4 py-3 flex gap-1">
            <button
              onClick={() => setActiveSection('config')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeSection === 'config'
                  ? 'bg-primary text-white shadow-md'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <Settings size={16} />
              {copy.sections.config}
            </button>
            <button
              onClick={() => setActiveSection('chat')}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                activeSection === 'chat'
                  ? 'bg-primary text-white shadow-md'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <MessageCircle size={16} />
              {copy.sections.chat}
            </button>
          </div>

          {/* Sub-tabs for config section */}
          {activeSection === 'config' && (
            <div className="border-b border-border px-3 py-2 flex flex-wrap gap-2">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'bg-primary text-white'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {activeSection === 'config' && activeTab === 'general' && (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{copy.title}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{copy.subtitle}</p>

          {/* Deploy / Stop bar */}
          <div className="mt-3 rounded-xl border border-border p-3 bg-background/40 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${isAgentDeployed ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                {activeAgent.name}
              </span>
              {isAgentDeployed && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  {language === 'es' ? 'EN VIVO' : 'LIVE'}
                </span>
              )}
              {isAgentDeployed && agentStatus && (
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {isStopping
                    ? (language === 'es' ? '⏳ Deteniendo agente...' : '⏳ Stopping agent...')
                    : isRestarting
                    ? (language === 'es' ? '🔄 Reiniciando agente...' : '🔄 Restarting agent...')
                    : agentStatus.isProcessing
                    ? (language === 'es' ? '⚡ Procesando...' : '⚡ Processing...')
                    : `📨 ${agentStatus.historyLength} msgs | 📅 ${agentStatus.dynamicSchedules} tasks | 🧠 ${agentStatus.memorySize} mem`
                  }
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Always-On toggle */}
              {(isAgentDeployed || activeAgent.integrations.telegram.botToken) && (
                <button
                  onClick={handleToggleAlwaysOn}
                  title={
                    alwaysOnAgentIds.has(activeAgent.id)
                      ? (language === 'es' ? 'Always-On activo: el agente se reiniciará automáticamente si el servidor se reinicia' : 'Always-On active: agent will auto-restart if the server restarts')
                      : (language === 'es' ? 'Always-On inactivo: el agente no se reiniciará automáticamente' : 'Always-On inactive: agent will not auto-restart')
                  }
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-200 ${
                    alwaysOnAgentIds.has(activeAgent.id)
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {alwaysOnAgentIds.has(activeAgent.id) ? (
                    <ToggleRight size={14} className="text-blue-600 dark:text-blue-400" />
                  ) : (
                    <ToggleLeft size={14} />
                  )}
                  <span className="hidden sm:inline">Always-On</span>
                </button>
              )}

              {!isAgentDeployed ? (
                <button
                  onClick={handleDeployAgent}
                  disabled={isDeploying || !activeAgent.integrations.telegram.botToken || !activeAgent.integrations.telegram.chatId}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDeploying ? (
                    <>
                      <Zap size={14} className="animate-spin" />
                      {language === 'es' ? 'Desplegando...' : 'Deploying...'}
                    </>
                  ) : (
                    <>
                      <Play size={14} />
                      {language === 'es' ? 'Desplegar agente' : 'Deploy agent'}
                    </>
                  )}
                </button>
              ) : (
                <>
                  {/* Restart button */}
                  <button
                    onClick={handleRestartAgent}
                    disabled={isRestarting || isStopping || isDeploying}
                    title={language === 'es' ? 'Reiniciar agente' : 'Restart agent'}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isRestarting ? (
                      <>
                        <RotateCw size={14} className="animate-spin" />
                        <span className="hidden sm:inline">{language === 'es' ? 'Reiniciando...' : 'Restarting...'}</span>
                      </>
                    ) : (
                      <>
                        <RotateCw size={14} />
                        <span className="hidden sm:inline">{language === 'es' ? 'Reiniciar' : 'Restart'}</span>
                      </>
                    )}
                  </button>

                  {/* Stop button with animation */}
                  <button
                    onClick={handleStopAgent}
                    disabled={isStopping || isRestarting}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isStopping ? (
                      <>
                        <Zap size={14} className="animate-spin" />
                        {language === 'es' ? 'Deteniendo...' : 'Stopping...'}
                      </>
                    ) : (
                      <>
                        <Square size={14} />
                        {language === 'es' ? 'Detener agente' : 'Stop agent'}
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {deployError && (
            <div className="mt-2 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50/70 dark:bg-red-950/20 p-2.5 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertTriangle size={13} className="shrink-0" />
              {deployError}
            </div>
          )}

          {!activeAgent.integrations.telegram.botToken && (
            <div className="mt-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 p-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
              <AlertTriangle size={13} className="shrink-0" />
              {language === 'es'
                ? 'Configura el bot de Telegram en la pestaña "Integraciones" para poder desplegar el agente.'
                : 'Configure the Telegram bot in the "Integrations" tab to deploy the agent.'}
            </div>
          )}

          {/* ── Reset memory & history ── */}
          <div className="mt-3 rounded-xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  {copy.assistant.resetMemoryHint}
                </p>
              </div>
              <button
                onClick={() => setShowResetMemoryConfirm(true)}
                disabled={isResettingMemory}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 dark:border-amber-700 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-60 transition-colors"
              >
                <Trash2 size={13} />
                {isResettingMemory ? copy.assistant.resetMemoryBusy : copy.assistant.resetMemory}
              </button>
            </div>
            {memoryResetResult && (
              <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{memoryResetResult}</p>
            )}
          </div>

          {/* Provider / Model info */}
          <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <BrainCircuit size={15} />
              {language === 'es' ? 'Configuración IA' : 'AI Configuration'}
            </h3>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div className="rounded-lg border border-border bg-background/70 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Provider</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-mono">
                  {availableProviders.find((p) => p.id === activeAgent.setupProvider)?.name || activeAgent.setupProvider}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background/70 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Model</p>
                <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100 font-mono truncate">
                  {providerModels.find((m) => m.id === activeAgent.setupModel)?.name || activeAgent.setupModel}
                </p>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              {language === 'es'
                ? 'Estos valores se configuran en Settings → AI Configuration.'
                : 'These values are configured in Settings → AI Configuration.'}
            </p>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {copy.costs.title}
              </h3>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {copy.costs.updated}: {latestCostTimestamp || copy.costs.noData}
              </span>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {costPeriods.map(({ key, label }) => {
                const periodData = agentCostSummary?.periods?.[key];
                const resourceSummary = periodData
                  ? Object.entries(periodData.resourceCounts || {})
                      .filter(([, value]) => Number(value) > 0)
                      .map(([resource, value]) => `${resource}: ${formatCount(Number(value))}`)
                      .join(' · ')
                  : '';
                return (
                  <div
                    key={key}
                    className="rounded-lg border border-border bg-background/70 p-2.5"
                  >
                    <p className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
                    <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                      {formatCost(periodData?.totalCostUsd || 0)}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {copy.costs.apiCalls}: {formatCount(periodData?.apiCalls || 0)} · {copy.costs.tokens}:{' '}
                      {formatCount(periodData?.totalTokens || 0)}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                      {copy.costs.resources}: {resourceSummary || copy.costs.noData}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Daily Budget Control */}
          <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              💰 {copy.budget.title}
            </h3>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {copy.budget.description}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[11px] uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  {copy.budget.label}
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-sm text-zinc-500">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={activeAgent.dailyBudgetUsd || ''}
                    placeholder={copy.budget.placeholder}
                    onChange={(e) => {
                      const value = parseFloat(e.target.value);
                      updateActiveAgent((agent) => ({
                        ...agent,
                        dailyBudgetUsd: Number.isFinite(value) && value > 0 ? value : 0,
                      }));
                    }}
                    onBlur={async () => {
                      // Sync budget with running agent if deployed
                      if (deployedAgentIds.has(activeAgent.id)) {
                        const result = await updateAgentBudgetApi(
                          activeAgent.id,
                          activeAgent.dailyBudgetUsd || 0
                        );
                        if (result) {
                          console.log(`[Budget] Synced: $${result.dailyBudgetUsd} (daily cost: $${result.currentDailyCostUsd.toFixed(4)})`);
                        }
                      }
                    }}
                    className="w-32 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>
              <div className="text-right">
                {activeAgent.dailyBudgetUsd > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 dark:bg-amber-900/20 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    🛡️ {copy.budget.active}: ${activeAgent.dailyBudgetUsd.toFixed(2)}/day
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                    {copy.budget.inactive}
                  </span>
                )}
              </div>
            </div>
            {activeAgent.dailyBudgetUsd > 0 && agentCostSummary?.periods?.lastDay && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                  <span>${(agentCostSummary.periods.lastDay.totalCostUsd || 0).toFixed(4)}</span>
                  <span>${activeAgent.dailyBudgetUsd.toFixed(2)}</span>
                </div>
                <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      (agentCostSummary.periods.lastDay.totalCostUsd || 0) >= activeAgent.dailyBudgetUsd
                        ? 'bg-red-500'
                        : (agentCostSummary.periods.lastDay.totalCostUsd || 0) >= activeAgent.dailyBudgetUsd * 0.8
                          ? 'bg-amber-500'
                          : 'bg-emerald-500'
                    }`}
                    style={{
                      width: `${Math.min(100, ((agentCostSummary.periods.lastDay.totalCostUsd || 0) / activeAgent.dailyBudgetUsd) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Timezone */}
          <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              🌍 {copy.timezone.title}
            </h3>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              {copy.timezone.description}
            </p>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 grid gap-2 sm:grid-cols-2 max-w-xl">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{copy.timezone.regionLabel}</label>
                  <select
                    value={selectedTimezoneRegion}
                    onChange={(e) => {
                      const nextRegion = e.target.value;
                      const firstPlace = (timezoneCatalog.placesByRegion.get(nextRegion) || [])[0];
                      if (!firstPlace) return;
                      updateActiveAgent((agent) => ({
                        ...agent,
                        timezone: `${nextRegion}/${firstPlace}`,
                      }));
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {timezoneCatalog.regions.map((region) => (
                      <option key={region} value={region}>{region}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{copy.timezone.placeLabel}</label>
                  <select
                    value={activeTimezoneParts?.place || ''}
                    onChange={(e) => {
                      const nextPlace = e.target.value;
                      if (!selectedTimezoneRegion || !nextPlace) return;
                      updateActiveAgent((agent) => ({
                        ...agent,
                        timezone: `${selectedTimezoneRegion}/${nextPlace}`,
                      }));
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {placesForSelectedTimezoneRegion.map((place) => (
                      <option key={place} value={place}>{place}</option>
                    ))}
                  </select>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 dark:bg-blue-900/20 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:text-blue-300">
                {(() => {
                  try {
                    const now = new Date();
                    return now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: activeAgent.timezone, timeZoneName: 'short' });
                  } catch {
                    return '⚠️';
                  }
                })()}
              </span>
            </div>
          </div>

          {/* Runtime tuning */}
          <div className="mt-3 rounded-xl border border-border bg-background/40 p-3 space-y-3">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              ⚡ {copy.performance.title}
            </h3>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{copy.performance.description}</p>

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="inline-flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                <span>{copy.performance.fastToolsPrompt}</span>
                <input
                  type="checkbox"
                  checked={activeAgent.runtimeTuning.fastToolsPrompt}
                  onChange={(e) =>
                    updateActiveAgent((agent) => ({
                      ...agent,
                      runtimeTuning: { ...agent.runtimeTuning, fastToolsPrompt: e.target.checked },
                    }))
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                />
              </label>
              <label className="inline-flex items-center justify-between rounded-lg border border-border bg-background/60 px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300">
                <span>{copy.performance.compactToolsPrompt}</span>
                <input
                  type="checkbox"
                  checked={activeAgent.runtimeTuning.compactToolsPrompt}
                  onChange={(e) =>
                    updateActiveAgent((agent) => ({
                      ...agent,
                      runtimeTuning: { ...agent.runtimeTuning, compactToolsPrompt: e.target.checked },
                    }))
                  }
                  className="rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                />
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { key: 'maxMcpToolsInPrompt', label: copy.performance.maxMcpToolsInPrompt, min: 0, max: 200 },
                { key: 'maxToolIterations', label: copy.performance.maxToolIterations, min: 2, max: 12 },
                { key: 'fastConfirmationMaxToolIterations', label: copy.performance.fastConfirmationMaxToolIterations, min: 1, max: 8 },
                { key: 'toolResultMaxChars', label: copy.performance.toolResultMaxChars, min: 200, max: 6000 },
                { key: 'toolResultsTotalMaxChars', label: copy.performance.toolResultsTotalMaxChars, min: 600, max: 24000 },
                { key: 'llmTimeoutMs', label: copy.performance.llmTimeoutMs, min: 10000, max: 240000 },
                { key: 'toolTimeoutMs', label: copy.performance.toolTimeoutMs, min: 10000, max: 180000 },
                { key: 'queueDelayUserMs', label: copy.performance.queueDelayUserMs, min: 10, max: 2000 },
                { key: 'queueDelayBackgroundMs', label: copy.performance.queueDelayBackgroundMs, min: 20, max: 5000 },
              ].map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">{field.label}</label>
                  <input
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={(activeAgent.runtimeTuning as any)[field.key]}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (!Number.isFinite(value)) return;
                      updateActiveAgent((agent) => ({
                        ...agent,
                        runtimeTuning: {
                          ...agent.runtimeTuning,
                          [field.key]: Math.max(field.min, Math.min(field.max, Math.floor(value))),
                        } as AgentRuntimeTuningSettings,
                      }));
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-border p-4 bg-background/40">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
                <Bot size={15} />
                {copy.capabilitiesTitle}
              </h3>
              <ul className="mt-2 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                {copy.capabilities.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 size={12} className="mt-0.5 text-emerald-500 shrink-0" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>


          </div>
        </div>
        )}

        {activeSection === 'config' && activeTab !== 'general' && (
        <div className="rounded-2xl border border-border bg-surface overflow-hidden">
          <div className="p-4 md:p-5 space-y-4">
            {/* ───────── Instructions tab ───────── */}
            {activeTab === 'instructions' && (
              <>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">{copy.instructionsHelp}</p>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{copy.fields.name}</label>
                    <input
                      value={activeAgent.name}
                      onChange={(event) => updateActiveAgent((agent) => ({ ...agent, name: event.target.value.slice(0, 60) }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{copy.fields.status}</label>
                    <select
                      value={activeAgent.status}
                      onChange={(event) => updateActiveAgent((agent) => ({ ...agent, status: event.target.value as AgentStatus }))}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="draft">{copy.status.draft}</option>
                      <option value="active">{copy.status.active}</option>
                      <option value="paused">{copy.status.paused}</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{copy.fields.objective}</label>
                  <textarea
                    value={activeAgent.objective}
                    onChange={(event) => updateActiveAgent((agent) => ({ ...agent, objective: event.target.value.slice(0, 280) }))}
                    rows={3}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{copy.fields.systemPrompt}</label>
                  <textarea
                    value={activeAgent.systemPrompt}
                    onChange={(event) => updateActiveAgent((agent) => ({ ...agent, systemPrompt: event.target.value }))}
                    rows={8}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              </>
            )}

            {/* ───────── Permissions (Sandbox) tab ───────── */}
            {activeTab === 'permissions' && (
              <div className="space-y-4">
                {/* Environment security / System access (top position) */}
                {(activeAgent.permissions.terminalAccess && activeAgent.permissions.codeExecution) ? (
                  <div className="rounded-xl border border-red-300/80 dark:border-red-900/40 bg-red-50/70 dark:bg-red-950/20 p-4">
                    <h4 className="text-sm font-semibold flex items-center gap-2 text-red-700 dark:text-red-300">
                      <AlertTriangle size={15} />
                      {copy.permissions.systemAccessTitle}
                    </h4>
                    <p className="mt-1 text-xs text-red-700/90 dark:text-red-300/90">
                      {copy.permissions.systemAccessBody}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-amber-200/80 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 p-3">
                    <h4 className="text-xs font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-300">
                      <Shield size={13} />
                      {copy.permissions.guardrailsTitle}
                    </h4>
                    <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">
                      {copy.permissions.guardrailsBody}
                    </p>
                  </div>
                )}

                {/* Permission toggles */}
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <button
                    onClick={() =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: { ...a.permissions, internetAccess: !a.permissions.internetAccess },
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activeAgent.permissions.internetAccess
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                        : 'border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <Globe2
                      size={18}
                      className={
                        activeAgent.permissions.internetAccess
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-400'
                      }
                    />
                    <p className="mt-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {copy.permissions.internetAccess}
                    </p>
                  </button>

                  <button
                    onClick={() =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: { ...a.permissions, headlessBrowser: !a.permissions.headlessBrowser },
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activeAgent.permissions.headlessBrowser
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                        : 'border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <Monitor
                      size={18}
                      className={
                        activeAgent.permissions.headlessBrowser
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-400'
                      }
                    />
                    <p className="mt-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {copy.permissions.headlessBrowser}
                    </p>
                  </button>

                  <button
                    onClick={() =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: { ...a.permissions, notesAccess: !a.permissions.notesAccess },
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activeAgent.permissions.notesAccess
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                        : 'border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <MessageSquareText
                      size={18}
                      className={
                        activeAgent.permissions.notesAccess
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-400'
                      }
                    />
                    <p className="mt-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {copy.permissions.notesAccess}
                    </p>
                  </button>

                  <button
                    onClick={() =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: { ...a.permissions, schedulerAccess: !a.permissions.schedulerAccess },
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activeAgent.permissions.schedulerAccess
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                        : 'border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <Clock3
                      size={18}
                      className={
                        activeAgent.permissions.schedulerAccess
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-400'
                      }
                    />
                    <p className="mt-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {copy.permissions.schedulerAccess}
                    </p>
                  </button>

                  <button
                    onClick={() =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: { ...a.permissions, mediaAccess: !a.permissions.mediaAccess },
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activeAgent.permissions.mediaAccess
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                        : 'border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <Film
                      size={18}
                      className={
                        activeAgent.permissions.mediaAccess
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-400'
                      }
                    />
                    <p className="mt-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {language === 'es' ? 'Acceso a media (Radarr/Sonarr)' : 'Media access (Radarr/Sonarr)'}
                    </p>
                  </button>

                  <button
                    onClick={() =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: { ...a.permissions, terminalAccess: !a.permissions.terminalAccess },
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activeAgent.permissions.terminalAccess
                        ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                        : 'border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <Terminal
                      size={18}
                      className={
                        activeAgent.permissions.terminalAccess
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-zinc-400'
                      }
                    />
                    <p className="mt-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {copy.permissions.terminalAccess}
                    </p>
                  </button>

                  <button
                    onClick={() =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: { ...a.permissions, codeExecution: !a.permissions.codeExecution },
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activeAgent.permissions.codeExecution
                        ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                        : 'border-border hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <Code2
                      size={18}
                      className={
                        activeAgent.permissions.codeExecution
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-zinc-400'
                      }
                    />
                    <p className="mt-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {copy.permissions.codeExecution}
                    </p>
                  </button>

                  <button
                    onClick={() =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: {
                          ...a.permissions,
                          requireApprovalForNewSites: !a.permissions.requireApprovalForNewSites,
                        },
                      }))
                    }
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      activeAgent.permissions.requireApprovalForNewSites
                        ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
                        : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
                    }`}
                  >
                    <Lock
                      size={18}
                      className={
                        activeAgent.permissions.requireApprovalForNewSites
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-amber-500'
                      }
                    />
                    <p className="mt-1.5 text-xs font-medium text-zinc-800 dark:text-zinc-200">
                      {copy.permissions.requireApproval}
                    </p>
                  </button>
                </div>

                {/* Allowed websites */}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    {copy.permissions.allowedWebsites}
                  </label>
                  <textarea
                    value={activeAgent.permissions.allowedWebsites.join('\n')}
                    onChange={(e) =>
                      updateActiveAgent((a) => ({
                        ...a,
                        permissions: {
                          ...a.permissions,
                          allowedWebsites: parseLineList(e.target.value),
                        },
                      }))
                    }
                    rows={3}
                    placeholder="https://example.com"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>

                {/* Web credentials */}
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <Lock size={14} />
                      {copy.permissions.webCredentialsTitle}
                    </h4>
                    <button
                      onClick={() =>
                        updateActiveAgent((a) => ({
                          ...a,
                          permissions: {
                            ...a.permissions,
                            webCredentials: [
                              ...a.permissions.webCredentials,
                              { id: createUniqueId(), site: '', username: '', password: '' },
                            ],
                          },
                        }))
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                    >
                      <Plus size={12} />
                      {copy.permissions.addCredential}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {copy.permissions.webCredentialsBody}
                  </p>
                  {activeAgent.permissions.webCredentials.map((cred) => (
                    <WebCredentialRow
                      key={cred.id}
                      credential={cred}
                      copy={copy}
                      onChange={(updated) =>
                        updateActiveAgent((a) => ({
                          ...a,
                          permissions: {
                            ...a.permissions,
                            webCredentials: a.permissions.webCredentials.map((c) =>
                              c.id === cred.id ? updated : c
                            ),
                          },
                        }))
                      }
                      onDelete={() =>
                        updateActiveAgent((a) => ({
                          ...a,
                          permissions: {
                            ...a.permissions,
                            webCredentials: a.permissions.webCredentials.filter((c) => c.id !== cred.id),
                          },
                        }))
                      }
                    />
                  ))}
                </div>


              </div>
            )}

            {/* ───────── Integrations tab ───────── */}
            {activeTab === 'integrations' && (
              <div className="space-y-4">
                {/* Telegram */}
                <div className="rounded-xl border border-border p-3">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {copy.integrations.telegramTitle}
                  </h4>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {copy.integrations.telegramBody}
                  </p>

                  <div className="grid gap-3 md:grid-cols-2 mt-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {copy.integrations.botToken}
                      </label>
                      <input
                        value={activeAgent.integrations.telegram.botToken}
                        onChange={(event) => {
                          setTelegramVerifyResult(null);
                          updateActiveAgent((agent) => ({
                            ...agent,
                            integrations: {
                              ...agent.integrations,
                              telegram: {
                                ...agent.integrations.telegram,
                                botToken: event.target.value.trim(),
                                verified: false,
                              },
                            },
                          }))
                        }}
                        placeholder="1234567890:AA..."
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {copy.integrations.chatId}
                      </label>
                      <input
                        value={activeAgent.integrations.telegram.chatId}
                        onChange={(event) => {
                          setTelegramVerifyResult(null);
                          updateActiveAgent((agent) => ({
                            ...agent,
                            integrations: {
                              ...agent.integrations,
                              telegram: {
                                ...agent.integrations.telegram,
                                chatId: event.target.value.trim(),
                                verified: false,
                              },
                            },
                          }))
                        }}
                        placeholder="12345678"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                  </div>

                  <div className="mt-3 rounded-lg border border-border p-3 bg-background/50">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                        {copy.integrations.tutorial}
                      </span>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {telegramStep + 1}/{telegramSteps.length}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      {telegramSteps[telegramStep]}
                    </p>
                    <div className="mt-3 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() =>
                          updateActiveAgent((agent) => ({
                            ...agent,
                            integrations: {
                              ...agent.integrations,
                              telegram: {
                                ...agent.integrations.telegram,
                                tutorialStep: Math.max(0, agent.integrations.telegram.tutorialStep - 1),
                              },
                            },
                          }))
                        }
                        disabled={telegramStep <= 0}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
                      >
                        {copy.integrations.previous}
                      </button>
                      <button
                        onClick={() =>
                          updateActiveAgent((agent) => ({
                            ...agent,
                            integrations: {
                              ...agent.integrations,
                              telegram: {
                                ...agent.integrations.telegram,
                                tutorialStep: Math.min(
                                  telegramSteps.length - 1,
                                  agent.integrations.telegram.tutorialStep + 1
                                ),
                              },
                            },
                          }))
                        }
                        disabled={telegramStep >= telegramSteps.length - 1}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 disabled:opacity-50"
                      >
                        {copy.integrations.next}
                      </button>

                      {/* Verify Telegram button */}
                      <button
                        onClick={handleVerifyTelegram}
                        disabled={isVerifyingTelegram || !activeAgent.integrations.telegram.botToken}
                        className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                      >
                        {isVerifyingTelegram
                          ? (language === 'es' ? 'Verificando...' : 'Verifying...')
                          : (language === 'es' ? '🔍 Verificar conexión' : '🔍 Verify connection')
                        }
                      </button>

                      <button
                        onClick={() =>
                          updateActiveAgent((agent) => ({
                            ...agent,
                            integrations: {
                              ...agent.integrations,
                              telegram: {
                                ...agent.integrations.telegram,
                                verified: !agent.integrations.telegram.verified,
                              },
                            },
                          }))
                        }
                        className={`ml-auto rounded-md px-2.5 py-1.5 text-xs font-medium ${
                          activeAgent.integrations.telegram.verified
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                            : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                        }`}
                      >
                        {copy.integrations.verified}
                      </button>
                    </div>
                    {telegramVerifyResult && (
                      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 border-t border-border pt-2">
                        {telegramVerifyResult}
                      </p>
                    )}
                  </div>
                </div>

                {/* Webhooks Integration */}
                <div className="rounded-xl border border-border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                      <Zap size={15} />
                      {copy.integrations.webhookTitle}
                    </h4>
                    <button
                      onClick={() =>
                        updateActiveAgent((agent) => ({
                          ...agent,
                          integrations: {
                            ...agent.integrations,
                            webhooks: {
                              ...(agent.integrations.webhooks || { enabled: false, secret: '', allowedSources: [] }),
                              enabled: !(agent.integrations.webhooks?.enabled),
                            },
                          },
                        }))
                      }
                      className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                      title={copy.integrations.webhookEnabled}
                    >
                      {activeAgent.integrations.webhooks?.enabled ? (
                        <ToggleRight size={22} className="text-emerald-500" />
                      ) : (
                        <ToggleLeft size={22} />
                      )}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {copy.integrations.webhookBody}
                  </p>

                  {activeAgent.integrations.webhooks?.enabled && (
                    <div className="space-y-3 pt-1">
                      {/* Webhook Secret */}
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                          <Shield size={12} />
                          {copy.integrations.webhookSecret}
                        </label>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <input
                              type={showWebhookSecret ? 'text' : 'password'}
                              value={activeAgent.integrations.webhooks?.secret || ''}
                              onChange={(e) =>
                                updateActiveAgent((agent) => ({
                                  ...agent,
                                  integrations: {
                                    ...agent.integrations,
                                    webhooks: {
                                      ...(agent.integrations.webhooks || { enabled: true, secret: '', allowedSources: [] }),
                                      secret: e.target.value,
                                    },
                                  },
                                }))
                              }
                              placeholder="whsec_..."
                              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm pr-8 font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                            <button
                              type="button"
                              onClick={() => setShowWebhookSecret((v) => !v)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                            >
                              {showWebhookSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                          <button
                            onClick={async () => {
                              const result = await generateWebhookSecretApi();
                              if (result?.secret) {
                                updateActiveAgent((agent) => ({
                                  ...agent,
                                  integrations: {
                                    ...agent.integrations,
                                    webhooks: {
                                      ...(agent.integrations.webhooks || { enabled: true, secret: '', allowedSources: [] }),
                                      secret: result.secret,
                                    },
                                  },
                                }));
                              }
                            }}
                            className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            <RefreshCw size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Allowed Sources */}
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {copy.integrations.webhookAllowedSources}
                        </label>
                        <input
                          value={(activeAgent.integrations.webhooks?.allowedSources || []).join(', ')}
                          onChange={(e) =>
                            updateActiveAgent((agent) => ({
                              ...agent,
                              integrations: {
                                ...agent.integrations,
                                webhooks: {
                                  ...(agent.integrations.webhooks || { enabled: true, secret: '', allowedSources: [] }),
                                  allowedSources: e.target.value
                                    .split(',')
                                    .map((s) => s.trim().toLowerCase())
                                    .filter(Boolean),
                                },
                              },
                            }))
                          }
                          placeholder={copy.integrations.webhookAllowedSourcesPlaceholder}
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      </div>

                      {/* Webhook URL (shown when agent is deployed) */}
                      {deployedAgentIds.has(activeAgent.id) && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                            {copy.integrations.webhookUrl}
                          </label>
                          <div className="flex gap-2">
                            <code className="flex-1 rounded-lg border border-border bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-xs font-mono text-zinc-600 dark:text-zinc-400 break-all">
                              {`${window.location.origin}/api/webhooks/${activeAgent.id}`}
                            </code>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(`${window.location.origin}/api/webhooks/${activeAgent.id}`);
                                setWebhookCopied(true);
                                setTimeout(() => setWebhookCopied(false), 2000);
                              }}
                              className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                              title={copy.integrations.webhookCopied}
                            >
                              {webhookCopied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                            </button>
                          </div>
                          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                            {copy.integrations.webhookUrlInfo}
                          </p>

                          {/* Test button */}
                          <button
                            onClick={async () => {
                              setWebhookTestResult(null);
                              const result = await sendTestWebhookApi(activeAgent.id);
                              setWebhookTestResult(result.success
                                ? copy.integrations.webhookTestSuccess
                                : `${copy.integrations.webhookTestError}: ${result.error || ''}`
                              );
                              setTimeout(() => setWebhookTestResult(null), 5000);
                            }}
                            className="mt-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors flex items-center gap-1.5"
                          >
                            <Zap size={12} />
                            {copy.integrations.webhookTestSend}
                          </button>
                          {webhookTestResult && (
                            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                              {webhookTestResult}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Calendar Integration */}
                <div className="rounded-xl border border-border p-3 space-y-3">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Calendar size={15} />
                    {language === 'es' ? 'Calendarios' : 'Calendars'}
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {language === 'es'
                      ? 'Conecta tu Google Calendar o iCloud Calendar para que el agente pueda crear, listar y gestionar eventos.'
                      : 'Connect your Google Calendar or iCloud Calendar so the agent can create, list, and manage events.'}
                  </p>

                  {/* Google Calendar */}
                  <div className={`rounded-lg border p-3 space-y-2 transition-colors ${selectedCalendarProvider && selectedCalendarProvider !== 'google' ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/30 opacity-70' : 'border-border'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">📅</span>
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Google Calendar</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={selectedCalendarProvider === 'google'}
                            onChange={(event) => setCalendarProvider('google', event.target.checked)}
                            className="rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                          />
                          {language === 'es' ? 'Usar' : 'Use'}
                        </label>
                        {selectedCalendarProvider === 'google' && (
                          <button
                            onClick={() =>
                              setExpandedCalendarSections((prev) => ({
                                ...prev,
                                google: !prev.google,
                              }))
                            }
                            className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-border text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            {expandedCalendarSections.google
                              ? (language === 'es' ? 'Ocultar' : 'Hide')
                              : (language === 'es' ? 'Mostrar' : 'Show')}
                          </button>
                        )}
                      </div>
                    </div>
                    {selectedCalendarProvider && selectedCalendarProvider !== 'google' && (
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {language === 'es' ? 'Desactivado porque iCloud está seleccionado.' : 'Disabled because iCloud is selected.'}
                      </p>
                    )}
                    {selectedCalendarProvider === 'google' && expandedCalendarSections.google && activeAgent.integrations.calendar?.google !== undefined && (
                      <div className="grid gap-2 pt-2 border-t border-border">
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">Client ID <span className="text-red-400">*</span></label>
                          <input
                            value={activeAgent.integrations.calendar.google?.clientId || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, calendar: { ...a.integrations.calendar, google: { ...a.integrations.calendar?.google!, clientId: e.target.value } } },
                            }))}
                            placeholder="xxx.apps.googleusercontent.com"
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">Client Secret <span className="text-red-400">*</span></label>
                          <input
                            type="password"
                            value={activeAgent.integrations.calendar.google?.clientSecret || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, calendar: { ...a.integrations.calendar, google: { ...a.integrations.calendar?.google!, clientSecret: e.target.value } } },
                            }))}
                            placeholder="GOCSPX-..."
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">Refresh Token <span className="text-red-400">*</span></label>
                          <input
                            type="password"
                            value={activeAgent.integrations.calendar.google?.refreshToken || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, calendar: { ...a.integrations.calendar, google: { ...a.integrations.calendar?.google!, refreshToken: e.target.value } } },
                            }))}
                            placeholder="1//0..."
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {language === 'es' ? 'ID del Calendario (opcional)' : 'Calendar ID (optional)'}
                          </label>
                          <input
                            value={activeAgent.integrations.calendar.google?.calendarId || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, calendar: { ...a.integrations.calendar, google: { ...a.integrations.calendar?.google!, calendarId: e.target.value } } },
                            }))}
                            placeholder="primary"
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                          {language === 'es'
                            ? '💡 Necesitas crear credenciales OAuth2 en Google Cloud Console → APIs → Calendar API. Luego obtén el refresh token con el flujo de autorización.'
                            : '💡 Create OAuth2 credentials in Google Cloud Console → APIs → Calendar API. Then obtain the refresh token via the authorization flow.'}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* iCloud Calendar */}
                  <div className={`rounded-lg border p-3 space-y-2 transition-colors ${selectedCalendarProvider && selectedCalendarProvider !== 'icloud' ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-100/70 dark:bg-zinc-900/30 opacity-70' : 'border-border'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">🍎</span>
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">iCloud Calendar</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={selectedCalendarProvider === 'icloud'}
                            onChange={(event) => setCalendarProvider('icloud', event.target.checked)}
                            className="rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                          />
                          {language === 'es' ? 'Usar' : 'Use'}
                        </label>
                        {selectedCalendarProvider === 'icloud' && (
                          <button
                            onClick={() =>
                              setExpandedCalendarSections((prev) => ({
                                ...prev,
                                icloud: !prev.icloud,
                              }))
                            }
                            className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-border text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            {expandedCalendarSections.icloud
                              ? (language === 'es' ? 'Ocultar' : 'Hide')
                              : (language === 'es' ? 'Mostrar' : 'Show')}
                          </button>
                        )}
                      </div>
                    </div>
                    {selectedCalendarProvider && selectedCalendarProvider !== 'icloud' && (
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {language === 'es' ? 'Desactivado porque Google Calendar está seleccionado.' : 'Disabled because Google Calendar is selected.'}
                      </p>
                    )}
                    {selectedCalendarProvider === 'icloud' && expandedCalendarSections.icloud && activeAgent.integrations.calendar?.icloud !== undefined && (
                      <div className="grid gap-2 pt-2 border-t border-border">
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {language === 'es' ? 'Email de Apple ID' : 'Apple ID Email'} <span className="text-red-400">*</span>
                          </label>
                          <input
                            value={activeAgent.integrations.calendar.icloud?.email || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, calendar: { ...a.integrations.calendar, icloud: { ...a.integrations.calendar?.icloud!, email: e.target.value } } },
                            }))}
                            placeholder="tu@icloud.com"
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {language === 'es' ? 'Contraseña de app específica' : 'App-Specific Password'} <span className="text-red-400">*</span>
                          </label>
                          <input
                            type="password"
                            value={activeAgent.integrations.calendar.icloud?.appSpecificPassword || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, calendar: { ...a.integrations.calendar, icloud: { ...a.integrations.calendar?.icloud!, appSpecificPassword: e.target.value } } },
                            }))}
                            placeholder="xxxx-xxxx-xxxx-xxxx"
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {language === 'es' ? 'Nombre del calendario (opcional)' : 'Calendar Name (optional)'}
                          </label>
                          <input
                            value={activeAgent.integrations.calendar.icloud?.calendarName || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, calendar: { ...a.integrations.calendar, icloud: { ...a.integrations.calendar?.icloud!, calendarName: e.target.value } } },
                            }))}
                            placeholder={language === 'es' ? 'Personal' : 'Home'}
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                          {language === 'es'
                            ? '💡 Ve a appleid.apple.com → Seguridad → Contraseñas de apps → Generar. No uses tu contraseña normal de Apple.'
                            : '💡 Go to appleid.apple.com → Security → App-Specific Passwords → Generate. Do not use your regular Apple password.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Gmail Integration */}
                <div className="rounded-xl border border-border p-3 space-y-3">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Mail size={15} />
                    Gmail
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {language === 'es'
                      ? 'Conecta tu cuenta de Gmail para que el agente pueda leer, buscar y enviar correos electrónicos en tu nombre.'
                      : 'Connect your Gmail account so the agent can read, search and send emails on your behalf.'}
                  </p>

                  {/* Security Warning */}
                  <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                          {language === 'es' ? '⚠️ Lee esto antes de continuar' : '⚠️ Read this before continuing'}
                        </p>
                        <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                          {language === 'es'
                            ? 'Al conectar Gmail, le das al agente acceso para leer todos tus correos, buscar mensajes y enviar emails desde tu cuenta. Esto significa que:'
                            : 'By connecting Gmail, you give the agent access to read all your emails, search messages and send emails from your account. This means:'}
                        </p>
                        <ul className="text-[11px] text-amber-700 dark:text-amber-400 list-disc pl-4 space-y-0.5">
                          <li>{language === 'es' ? 'El agente podrá ver el contenido de tus correos (incluidos datos personales, contraseñas, etc.)' : 'The agent will be able to see your email content (including personal data, passwords, etc.)'}</li>
                          <li>{language === 'es' ? 'El agente podrá enviar correos en tu nombre si se lo pides' : 'The agent can send emails on your behalf if you ask it to'}</li>
                          <li>{language === 'es' ? 'Los correos enviados por el agente vendrán de tu dirección real' : 'Emails sent by the agent will come from your real address'}</li>
                          <li>{language === 'es' ? 'Revoca el acceso en cualquier momento desde myaccount.google.com/permissions' : 'Revoke access at any time from myaccount.google.com/permissions'}</li>
                        </ul>
                        <p className="text-[10px] text-amber-600 dark:text-amber-500 font-medium mt-1">
                          {language === 'es'
                            ? '💡 Consejo: Usa una cuenta de correo secundaria si no quieres exponer tu correo principal.'
                            : '💡 Tip: Use a secondary email account if you don\'t want to expose your main inbox.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Gmail Enable/Disable */}
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">📧</span>
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Gmail</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                          <input
                            type="checkbox"
                            checked={activeAgent.integrations.gmail !== undefined}
                            onChange={(event) => {
                              if (event.target.checked) {
                                updateActiveAgent((a) => ({
                                  ...a,
                                  integrations: {
                                    ...a.integrations,
                                    gmail: a.integrations.gmail || { clientId: '', clientSecret: '', refreshToken: '' },
                                  },
                                }));
                                setGmailExpanded(true);
                              } else {
                                updateActiveAgent((a) => ({
                                  ...a,
                                  integrations: { ...a.integrations, gmail: undefined },
                                }));
                                setGmailExpanded(false);
                                setGmailTestResult(null);
                              }
                            }}
                            className="rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                          />
                          {language === 'es' ? 'Activar' : 'Enable'}
                        </label>
                        {activeAgent.integrations.gmail !== undefined && (
                          <button
                            onClick={() => setGmailExpanded(!gmailExpanded)}
                            className="px-2.5 py-1 rounded-md text-[11px] font-medium border border-border text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                          >
                            {gmailExpanded
                              ? (language === 'es' ? 'Ocultar' : 'Hide')
                              : (language === 'es' ? 'Configurar' : 'Configure')}
                          </button>
                        )}
                      </div>
                    </div>

                    {activeAgent.integrations.gmail !== undefined && gmailExpanded && (
                      <div className="grid gap-2 pt-2 border-t border-border">
                        {/* Setup Instructions */}
                        <div className="rounded-md bg-zinc-50 dark:bg-zinc-900/50 border border-border p-3 space-y-2">
                          <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
                            {language === 'es' ? '📋 Cómo obtener las credenciales:' : '📋 How to get credentials:'}
                          </p>
                          <ol className="text-[10px] text-zinc-600 dark:text-zinc-400 space-y-1.5 list-decimal pl-4 leading-relaxed">
                            <li>
                              {language === 'es'
                                ? <>Ve a <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.cloud.google.com</a> e inicia sesión con tu cuenta de Google.</>
                                : <>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">console.cloud.google.com</a> and sign in with your Google account.</>
                              }
                            </li>
                            <li>
                              {language === 'es'
                                ? 'Crea un proyecto nuevo (o selecciona uno existente).'
                                : 'Create a new project (or select an existing one).'}
                            </li>
                            <li>
                              {language === 'es'
                                ? <>Ve a "APIs y servicios" → "Biblioteca" → busca <strong>"Gmail API"</strong> → haz clic en <strong>"Habilitar"</strong>.</>
                                : <>Go to "APIs & services" → "Library" → search for <strong>"Gmail API"</strong> → click <strong>"Enable"</strong>.</>
                              }
                            </li>
                            <li>
                              {language === 'es'
                                ? <>Ve a "APIs y servicios" → "Credenciales" → <strong>"Crear credenciales"</strong> → selecciona <strong>"ID de cliente de OAuth"</strong>.</>
                                : <>Go to "APIs & services" → "Credentials" → <strong>"Create credentials"</strong> → select <strong>"OAuth client ID"</strong>.</>
                              }
                            </li>
                            <li>
                              {language === 'es'
                                ? <>Tipo de aplicación: <strong>"Aplicación web"</strong>. En "URIs de redireccionamiento autorizados" añade: <code className="bg-zinc-200 dark:bg-zinc-800 px-1 rounded text-[9px]">{window.location.origin}/oauth/google/callback</code></>
                                : <>Application type: <strong>"Web application"</strong>. In "Authorized redirect URIs" add: <code className="bg-zinc-200 dark:bg-zinc-800 px-1 rounded text-[9px]">{window.location.origin}/oauth/google/callback</code></>
                              }
                            </li>
                            <li>
                              {language === 'es'
                                ? 'Copia el Client ID y el Client Secret, pégalos abajo y haz clic en "Autorizar Gmail".'
                                : 'Copy the Client ID and Client Secret, paste them below and click "Authorize Gmail".'}
                            </li>
                          </ol>
                          <div className="rounded-md border border-amber-300/60 dark:border-amber-500/40 bg-amber-50/70 dark:bg-amber-950/20 px-2.5 py-2 text-[10px] text-amber-900 dark:text-amber-200 leading-relaxed">
                            {language === 'es'
                              ? <>⚠️ Si aparece <strong>Error 403: access_denied</strong>, ve a Google Cloud Console → <strong>API y servicios</strong> → <strong>Pantalla de consentimiento OAuth</strong>. Ahí cambia a <strong>Público</strong> y luego pulsa <strong>Publicar app</strong>, o añade tu cuenta en <strong>Usuarios de prueba</strong>.</>
                              : <>⚠️ If you see <strong>Error 403: access_denied</strong>, go to Google Cloud Console → <strong>APIs & Services</strong> → <strong>OAuth consent screen</strong>. There, switch to <strong>Public</strong> and then click <strong>Publish app</strong>, or add your account under <strong>Test users</strong>.</>}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">Client ID <span className="text-red-400">*</span></label>
                          <input
                            value={activeAgent.integrations.gmail?.clientId || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, gmail: { ...a.integrations.gmail!, clientId: e.target.value } },
                            }))}
                            placeholder="xxx.apps.googleusercontent.com"
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">Client Secret <span className="text-red-400">*</span></label>
                          <input
                            type="password"
                            value={activeAgent.integrations.gmail?.clientSecret || ''}
                            onChange={(e) => updateActiveAgent((a) => ({
                              ...a,
                              integrations: { ...a.integrations, gmail: { ...a.integrations.gmail!, clientSecret: e.target.value } },
                            }))}
                            placeholder="GOCSPX-..."
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                          />
                        </div>
                        {/* Authorize Gmail — OAuth popup flow */}
                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-500 dark:text-zinc-400">Refresh Token</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="password"
                              value={activeAgent.integrations.gmail?.refreshToken || ''}
                              onChange={(e) => updateActiveAgent((a) => ({
                                ...a,
                                integrations: { ...a.integrations, gmail: { ...a.integrations.gmail!, refreshToken: e.target.value } },
                              }))}
                              placeholder={language === 'es' ? 'Se rellena automáticamente al autorizar' : 'Auto-filled when you authorize'}
                              className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                            <button
                              disabled={gmailAuthLoading || !activeAgent.integrations.gmail?.clientId || !activeAgent.integrations.gmail?.clientSecret}
                              onClick={async () => {
                                if (!activeAgent.integrations.gmail?.clientId || !activeAgent.integrations.gmail?.clientSecret) return;
                                setGmailAuthLoading(true);
                                setGmailTestResult(null);
                                const redirectUri = `${window.location.origin}/oauth/google/callback`;
                                try {
                                  // 1. Get auth URL from server
                                  const urlRes = await fetch('/api/agents/gmail/auth-url', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ clientId: activeAgent.integrations.gmail.clientId, redirectUri }),
                                  });
                                  const { authUrl, state } = await urlRes.json();
                                  if (!authUrl) throw new Error('Failed to generate auth URL');

                                  // 2. Open popup
                                  const popup = window.open(authUrl, 'gmail-oauth', 'width=600,height=700,left=200,top=100');
                                  if (!popup) { setGmailTestResult(language === 'es' ? '❌ No se pudo abrir la ventana. Permite las ventanas emergentes.' : '❌ Popup blocked. Please allow popups.'); setGmailAuthLoading(false); return; }

                                  // 3. Listen for callback message
                                  const handler = async (event: MessageEvent) => {
                                    if (event.source !== popup) return;
                                    if (event.data?.type !== 'google-oauth-callback') return;
                                    window.removeEventListener('message', handler);
                                    const { code, error } = event.data;
                                    if (error || !code) {
                                      if (error === 'access_denied') {
                                        setGmailTestResult(
                                          language === 'es'
                                            ? '❌ Acceso denegado por Google (403). Ve a API y servicios → Pantalla de consentimiento OAuth, publica la app (Público) o añade tu cuenta en Usuarios de prueba.'
                                            : '❌ Access denied by Google (403). Go to APIs & Services → OAuth consent screen, publish the app (Public), or add your account under Test users.'
                                        );
                                      } else {
                                        setGmailTestResult(`❌ ${error || (language === 'es' ? 'Autorización cancelada' : 'Authorization cancelled')}`);
                                      }
                                      setGmailAuthLoading(false);
                                      return;
                                    }
                                    // 4. Exchange code for tokens
                                    try {
                                      const exchRes = await fetch('/api/agents/gmail/exchange-code', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                          code,
                                          clientId: activeAgent.integrations.gmail!.clientId,
                                          clientSecret: activeAgent.integrations.gmail!.clientSecret,
                                          redirectUri,
                                        }),
                                      });
                                      const exchData = await exchRes.json();
                                      if (exchData.refreshToken) {
                                        updateActiveAgent((a) => ({
                                          ...a,
                                          integrations: { ...a.integrations, gmail: { ...a.integrations.gmail!, refreshToken: exchData.refreshToken } },
                                        }));
                                        setGmailTestResult(language === 'es' ? '✅ Gmail autorizado correctamente. Refresh Token guardado.' : '✅ Gmail authorized. Refresh Token saved.');
                                      } else {
                                        setGmailTestResult(`❌ ${exchData.error || (language === 'es' ? 'No se recibió el Refresh Token' : 'Refresh Token not received')}`);
                                      }
                                    } catch (exchErr: any) {
                                      setGmailTestResult(`❌ ${exchErr.message || (language === 'es' ? 'Error al intercambiar el código' : 'Code exchange failed')}`);
                                    } finally {
                                      setGmailAuthLoading(false);
                                    }
                                  };
                                  window.addEventListener('message', handler);

                                  // Timeout: clean up if popup closed without callback
                                  const checkClosed = setInterval(() => {
                                    if (popup.closed) {
                                      clearInterval(checkClosed);
                                      // Give time for the message to arrive
                                      setTimeout(() => {
                                        window.removeEventListener('message', handler);
                                        setGmailAuthLoading(false);
                                      }, 2000);
                                    }
                                  }, 500);
                                } catch (err: any) {
                                  setGmailTestResult(`❌ ${err.message || (language === 'es' ? 'Error al iniciar autorización' : 'Failed to start authorization')}`);
                                  setGmailAuthLoading(false);
                                }
                              }}
                              className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                            >
                              {gmailAuthLoading
                                ? (language === 'es' ? 'Autorizando...' : 'Authorizing...')
                                : (language === 'es' ? '🔑 Autorizar Gmail' : '🔑 Authorize Gmail')}
                            </button>
                          </div>
                        </div>

                        {/* Test connection */}
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            disabled={gmailTestLoading || !activeAgent.integrations.gmail?.clientId || !activeAgent.integrations.gmail?.clientSecret || !activeAgent.integrations.gmail?.refreshToken}
                            onClick={async () => {
                              if (!activeAgent.integrations.gmail) return;
                              setGmailTestLoading(true);
                              setGmailTestResult(null);
                              try {
                                const res = await fetch('/api/agents/gmail/test', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    clientId: activeAgent.integrations.gmail.clientId,
                                    clientSecret: activeAgent.integrations.gmail.clientSecret,
                                    refreshToken: activeAgent.integrations.gmail.refreshToken,
                                  }),
                                });
                                const data = await res.json();
                                if (data.success) {
                                  setGmailTestResult(`✅ ${data.message}`);
                                } else {
                                  setGmailTestResult(`❌ ${data.error || 'Error de conexión'}`);
                                }
                              } catch (err: any) {
                                setGmailTestResult(`❌ ${err.message || 'Error de conexión'}`);
                              } finally {
                                setGmailTestLoading(false);
                              }
                            }}
                            className="rounded-md bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                          >
                            {gmailTestLoading
                              ? (language === 'es' ? 'Verificando...' : 'Verifying...')
                              : (language === 'es' ? '🔍 Probar conexión' : '🔍 Test connection')}
                          </button>
                        </div>
                        {gmailTestResult && (
                          <p className="text-xs text-zinc-600 dark:text-zinc-400 border-t border-border pt-2">
                            {gmailTestResult}
                          </p>
                        )}

                        {/* Revoke info */}
                        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                          {language === 'es'
                            ? '🔒 Para revocar el acceso en cualquier momento, ve a myaccount.google.com/permissions y elimina esta aplicación.'
                            : '🔒 To revoke access at any time, go to myaccount.google.com/permissions and remove this application.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Radarr & Sonarr Media Management */}
                <div className="rounded-xl border border-border p-4 space-y-4">
                  <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    <Film size={15} />
                    {language === 'es' ? 'Media — Radarr & Sonarr' : 'Media — Radarr & Sonarr'}
                  </h5>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {language === 'es'
                      ? 'Conecta Radarr (películas) y Sonarr (series) para buscar, descargar y gestionar tu biblioteca multimedia.'
                      : 'Connect Radarr (movies) and Sonarr (TV series) to search, download, and manage your media library.'}
                  </p>

                  {/* Radarr */}
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setExpandedMediaSections((prev) => ({ ...prev, radarr: !prev.radarr }))}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                      >
                        {expandedMediaSections.radarr ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        🎬 Radarr
                      </button>
                      {expandedMediaSections.radarr && (
                        <button
                          onClick={handleTestRadarr}
                          disabled={isTestingRadarr || !activeAgent.integrations.media?.radarr?.url || !activeAgent.integrations.media?.radarr?.apiKey}
                          className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {isTestingRadarr
                            ? (language === 'es' ? 'Probando...' : 'Testing...')
                            : (language === 'es' ? '🔍 Probar conexión' : '🔍 Test connection')}
                        </button>
                      )}
                    </div>
                    {expandedMediaSections.radarr && (<>
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        URL <span className="text-red-400">*</span>
                      </label>
                      <input
                        value={activeAgent.integrations.media?.radarr?.url || ''}
                        onChange={(e) => updateActiveAgent((a) => ({
                          ...a,
                          integrations: {
                            ...a.integrations,
                            media: {
                              ...a.integrations.media,
                              radarr: { ...a.integrations.media?.radarr, url: e.target.value, apiKey: a.integrations.media?.radarr?.apiKey || '' },
                            },
                          },
                        }))}
                        placeholder="http://192.168.1.100:7878"
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        API Key <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password"
                        value={activeAgent.integrations.media?.radarr?.apiKey || ''}
                        onChange={(e) => updateActiveAgent((a) => ({
                          ...a,
                          integrations: {
                            ...a.integrations,
                            media: {
                              ...a.integrations.media,
                              radarr: { url: a.integrations.media?.radarr?.url || '', apiKey: e.target.value },
                            },
                          },
                        }))}
                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    {radarrTestResult && (
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 border-t border-border pt-2">
                        {radarrTestResult}
                      </p>
                    )}
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {language === 'es'
                        ? '💡 Settings → General → Security → API Key en tu panel de Radarr.'
                        : '💡 Settings → General → Security → API Key in your Radarr dashboard.'}
                    </p>
                    </>)}
                  </div>

                  {/* Sonarr */}
                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setExpandedMediaSections((prev) => ({ ...prev, sonarr: !prev.sonarr }))}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                      >
                        {expandedMediaSections.sonarr ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        📺 Sonarr
                      </button>
                      {expandedMediaSections.sonarr && (
                        <button
                          onClick={handleTestSonarr}
                          disabled={isTestingSonarr || !activeAgent.integrations.media?.sonarr?.url || !activeAgent.integrations.media?.sonarr?.apiKey}
                          className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {isTestingSonarr
                            ? (language === 'es' ? 'Probando...' : 'Testing...')
                            : (language === 'es' ? '🔍 Probar conexión' : '🔍 Test connection')}
                        </button>
                      )}
                    </div>
                    {expandedMediaSections.sonarr && (<>
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        URL <span className="text-red-400">*</span>
                      </label>
                      <input
                        value={activeAgent.integrations.media?.sonarr?.url || ''}
                        onChange={(e) => updateActiveAgent((a) => ({
                          ...a,
                          integrations: {
                            ...a.integrations,
                            media: {
                              ...a.integrations.media,
                              sonarr: { ...a.integrations.media?.sonarr, url: e.target.value, apiKey: a.integrations.media?.sonarr?.apiKey || '' },
                            },
                          },
                        }))}
                        placeholder="http://192.168.1.100:8989"
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        API Key <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password"
                        value={activeAgent.integrations.media?.sonarr?.apiKey || ''}
                        onChange={(e) => updateActiveAgent((a) => ({
                          ...a,
                          integrations: {
                            ...a.integrations,
                            media: {
                              ...a.integrations.media,
                              sonarr: { url: a.integrations.media?.sonarr?.url || '', apiKey: e.target.value },
                            },
                          },
                        }))}
                        placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    {sonarrTestResult && (
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 border-t border-border pt-2">
                        {sonarrTestResult}
                      </p>
                    )}
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {language === 'es'
                        ? '💡 Settings → General → Security → API Key en tu panel de Sonarr.'
                        : '💡 Settings → General → Security → API Key in your Sonarr dashboard.'}
                    </p>
                    </>)}
                  </div>
                </div>

                {/* Home Assistant — Smart Home */}
                <div className="rounded-xl border border-border p-4 space-y-4">
                  <h5 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                    🏠
                    {language === 'es' ? 'Home Assistant — Hogar Inteligente' : 'Home Assistant — Smart Home'}
                  </h5>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {language === 'es'
                      ? 'Conecta con Home Assistant para controlar luces, interruptores, climatización, persianas, escenas y más. Compatible con Google Home, Alexa y todos los dispositivos integrados en HA.'
                      : 'Connect to Home Assistant to control lights, switches, climate, covers, scenes and more. Compatible with Google Home, Alexa and all devices integrated in HA.'}
                  </p>

                  <div className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setExpandedMediaSections((prev) => ({ ...prev, homeAssistant: !prev.homeAssistant }))}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                      >
                        {expandedMediaSections.homeAssistant ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        🏠 Home Assistant
                      </button>
                      {expandedMediaSections.homeAssistant && (
                        <button
                          onClick={handleTestHomeAssistant}
                          disabled={isTestingHA || !activeAgent.integrations.homeAssistant?.url || !activeAgent.integrations.homeAssistant?.token}
                          className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {isTestingHA
                            ? (language === 'es' ? 'Probando...' : 'Testing...')
                            : (language === 'es' ? '🔍 Probar conexión' : '🔍 Test connection')}
                        </button>
                      )}
                    </div>
                    {expandedMediaSections.homeAssistant && (<>
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        URL <span className="text-red-400">*</span>
                      </label>
                      <input
                        value={activeAgent.integrations.homeAssistant?.url || ''}
                        onChange={(e) => updateActiveAgent((a) => ({
                          ...a,
                          integrations: {
                            ...a.integrations,
                            homeAssistant: {
                              url: e.target.value,
                              token: a.integrations.homeAssistant?.token || '',
                            },
                          },
                        }))}
                        placeholder="http://192.168.1.50:8123"
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {language === 'es' ? 'Token de acceso' : 'Access Token'} <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="password"
                        value={activeAgent.integrations.homeAssistant?.token || ''}
                        onChange={(e) => updateActiveAgent((a) => ({
                          ...a,
                          integrations: {
                            ...a.integrations,
                            homeAssistant: {
                              url: a.integrations.homeAssistant?.url || '',
                              token: e.target.value,
                            },
                          },
                        }))}
                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    {haTestResult && (
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 border-t border-border pt-2">
                        {haTestResult}
                      </p>
                    )}
                    <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {language === 'es'
                        ? '💡 Perfil de HA → Tokens de acceso de larga duración → Crear token. La URL debe ser accesible desde el servidor del agente.'
                        : '💡 HA Profile → Long-Lived Access Tokens → Create Token. The URL must be reachable from the agent server.'}
                    </p>
                    </>)}
                  </div>
                </div>

                {/* MCP Marketplace */}
                <MCPMarketplace
                  agent={activeAgent}
                  language={language}
                  copy={copy}
                  onUpdate={updateActiveAgent}
                />
              </div>
            )}

            {/* ───────── Scheduler tab ───────── */}
            {activeTab === 'scheduler' && (
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Clock3 size={15} />
                  {copy.scheduler.title}
                </h4>

                {/* Add task form */}
                <div className="rounded-xl border border-border bg-background/40 p-4 space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {copy.scheduler.taskName}
                      </label>
                      <input
                        value={taskName}
                        onChange={(event) => setTaskName(event.target.value)}
                        placeholder={copy.scheduler.taskName}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                        {copy.scheduler.schedule}
                      </label>
                      <div className="space-y-2 rounded-lg border border-border bg-background px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setScheduleMode('weekly')}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              scheduleMode === 'weekly'
                                ? 'bg-primary text-white'
                                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                            }`}
                          >
                            {language === 'es' ? 'Semanal' : 'Weekly'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setScheduleMode('once')}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                              scheduleMode === 'once'
                                ? 'bg-primary text-white'
                                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                            }`}
                          >
                            {language === 'es' ? 'Día único' : 'Single day'}
                          </button>
                        </div>

                        <div className="space-y-1">
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                            {language === 'es' ? 'Hora' : 'Time'}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {QUICK_SCHEDULE_TIMES.map((time) => (
                              <button
                                key={time}
                                type="button"
                                onClick={() => setScheduleTime(time)}
                                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                                  scheduleTime === time
                                    ? 'bg-primary text-white'
                                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                                }`}
                              >
                                {time}
                              </button>
                            ))}
                            <input
                              type="time"
                              value={scheduleTime}
                              onChange={(event) => setScheduleTime(event.target.value)}
                              className="rounded-md border border-border bg-background px-2 py-1 text-[11px]"
                            />
                          </div>
                        </div>

                        {scheduleMode === 'weekly' ? (
                          <div className="space-y-1">
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {language === 'es' ? 'Días de la semana' : 'Weekdays'}
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {[
                                { day: 1, es: 'L', en: 'Mon' },
                                { day: 2, es: 'M', en: 'Tue' },
                                { day: 3, es: 'X', en: 'Wed' },
                                { day: 4, es: 'J', en: 'Thu' },
                                { day: 5, es: 'V', en: 'Fri' },
                                { day: 6, es: 'S', en: 'Sat' },
                                { day: 0, es: 'D', en: 'Sun' },
                              ].map((item) => {
                                const active = scheduleWeekdays.includes(item.day);
                                return (
                                  <button
                                    key={item.day}
                                    type="button"
                                    onClick={() => {
                                      setScheduleWeekdays((prev) => {
                                        if (prev.includes(item.day)) {
                                          return prev.filter((day) => day !== item.day);
                                        }
                                        return [...prev, item.day];
                                      });
                                    }}
                                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                                      active
                                        ? 'bg-primary text-white'
                                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                                    }`}
                                  >
                                    {language === 'es' ? item.es : item.en}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                              {language === 'es' ? 'Fecha (calendario)' : 'Date (calendar)'}
                            </p>
                            <input
                              type="date"
                              value={scheduleSingleDate}
                              onChange={(event) => setScheduleSingleDate(event.target.value)}
                              className="rounded-md border border-border bg-background px-2 py-1 text-[11px]"
                            />
                          </div>
                        )}

                        <div className="rounded-md bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
                          <span className="font-medium">{language === 'es' ? 'Programación' : 'Schedule'}:</span>{' '}
                          {taskSchedule || (language === 'es' ? 'Completa hora y selección.' : 'Complete time and selection.')}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {copy.scheduler.prompt}
                    </label>
                    <textarea
                      value={taskPrompt}
                      onChange={(event) => setTaskPrompt(event.target.value)}
                      placeholder={copy.scheduler.promptPlaceholder}
                      rows={3}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-y min-h-[60px]"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 max-w-md">
                      {copy.scheduler.scheduleHelp}
                    </p>
                    <button
                      onClick={addScheduleTask}
                      disabled={!taskName.trim() || !taskSchedule.trim()}
                      className="rounded-lg bg-primary px-4 py-2 text-sm text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <Plus size={14} />
                      {copy.scheduler.addTask}
                    </button>
                  </div>
                </div>

                {activeAgent.schedules.length === 0 && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{copy.scheduler.empty}</p>
                )}

                <div className="space-y-2">
                  {activeAgent.schedules.map((task) => (
                    <div key={task.id} className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() =>
                            updateActiveAgent((agent) => ({
                              ...agent,
                              schedules: agent.schedules.map((item) =>
                                item.id === task.id ? { ...item, enabled: !item.enabled } : item
                              ),
                            }))
                          }
                          className={`px-2 py-1 rounded-md text-[11px] font-medium shrink-0 ${
                            task.enabled
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
                              : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                          }`}
                        >
                          {copy.scheduler.enabled}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{task.name}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate flex items-center gap-1">
                            <Clock3 size={10} className="shrink-0" />
                            {task.schedule}
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            updateActiveAgent((agent) => ({
                              ...agent,
                              schedules: agent.schedules.filter((item) => item.id !== task.id),
                            }))
                          }
                          className="p-1.5 rounded-md text-zinc-500 hover:text-red-500 dark:text-zinc-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {task.prompt && (
                        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="font-medium text-zinc-700 dark:text-zinc-300">{copy.scheduler.prompt}:</span>{' '}
                          {task.prompt}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'data' && (
              <div className="space-y-4">
            {isLoadingData ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw size={20} className="animate-spin text-primary mr-2" />
                <span className="text-sm text-zinc-500">{language === 'es' ? 'Cargando datos...' : 'Loading data...'}</span>
              </div>
            ) : (
              <>
                {/* Notes Section */}
                <div className="rounded-xl border border-border bg-surface p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
                    <FileText size={16} className="text-primary" />
                    {language === 'es' ? 'Notas' : 'Notes'} ({agentNotes.length})
                  </h3>
                  {agentNotes.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      {language === 'es'
                        ? 'El agente aún no ha creado notas.'
                        : 'The agent has not created any notes yet.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {agentNotes.map((note) => (
                        <div key={note.id} className="rounded-lg border border-border bg-white dark:bg-zinc-800 overflow-hidden">
                          <button
                            onClick={() => setExpandedNoteId(expandedNoteId === note.id ? null : note.id)}
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 transition-colors"
                          >
                            {expandedNoteId === note.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            <span className="text-sm font-medium flex-1 truncate">{note.title}</span>
                            <span className="text-[10px] text-zinc-400">
                              {new Date(note.updatedAt).toLocaleDateString()}
                            </span>
                          </button>
                          {expandedNoteId === note.id && (
                            <div className="px-3 pb-3 border-t border-border">
                              <pre className="whitespace-pre-wrap text-xs text-zinc-700 dark:text-zinc-300 mt-2 mb-2 max-h-48 overflow-auto">
                                {note.content}
                              </pre>
                              {note.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mb-2">
                                  {note.tags.map((tag) => (
                                    <span
                                      key={tag}
                                      className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <button
                                onClick={() => requestDeleteNote(note.id)}
                                className="text-[11px] text-red-500 hover:text-red-600 flex items-center gap-1"
                              >
                                <Trash2 size={12} />
                                {language === 'es' ? 'Eliminar' : 'Delete'}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Lists Section */}
                <div className="rounded-xl border border-border bg-surface p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
                    <ListChecks size={16} className="text-primary" />
                    {language === 'es' ? 'Listas' : 'Lists'} ({agentLists.length})
                  </h3>
                  {agentLists.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      {language === 'es'
                        ? 'El agente aún no ha creado listas.'
                        : 'The agent has not created any lists yet.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {agentLists.map((list) => (
                        <div key={list.id} className="rounded-lg border border-border bg-white dark:bg-zinc-800 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">{list.title}</span>
                            <button
                              onClick={() => requestDeleteList(list.id)}
                              className="text-red-500 hover:text-red-600"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          <ul className="space-y-1">
                            {list.items.map((item) => (
                              <li key={item.id} className="flex items-center gap-2 text-xs">
                                <span
                                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                                    item.checked
                                      ? 'bg-primary border-primary text-white'
                                      : 'border-zinc-300 dark:border-zinc-600'
                                  }`}
                                >
                                  {item.checked && <CheckCircle2 size={10} />}
                                </span>
                                <span
                                  className={
                                    item.checked
                                      ? 'line-through text-zinc-400'
                                      : 'text-zinc-700 dark:text-zinc-300'
                                  }
                                >
                                  {item.text}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <span className="text-[10px] text-zinc-400 mt-1 block">
                            {new Date(list.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Schedules Section */}
                <div className="rounded-xl border border-border bg-surface p-4">
                  <h3 className="flex items-center gap-2 text-sm font-semibold mb-3">
                    <Calendar size={16} className="text-primary" />
                    {language === 'es' ? 'Tareas programadas' : 'Scheduled Tasks'} ({agentSchedules.length})
                  </h3>
                  {agentSchedules.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      {language === 'es'
                        ? 'El agente aún no ha programado tareas.'
                        : 'The agent has not scheduled any tasks yet.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {agentSchedules.map((sched) => (
                        <div key={sched.id} className="rounded-lg border border-border bg-white dark:bg-zinc-800 p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium">{sched.name}</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleToggleSchedule(sched.id, !sched.enabled)}
                                className="flex items-center"
                                title={sched.enabled ? (language === 'es' ? 'Desactivar' : 'Disable') : (language === 'es' ? 'Activar' : 'Enable')}
                              >
                                {sched.enabled ? (
                                  <ToggleRight size={20} className="text-green-500" />
                                ) : (
                                  <ToggleLeft size={20} className="text-zinc-400" />
                                )}
                              </button>
                              <button
                                onClick={() => requestDeleteSchedule(sched.id)}
                                className="text-red-500 hover:text-red-600"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{sched.instruction}</p>
                          <div className="flex flex-wrap gap-3 text-[10px] text-zinc-400">
                            <span className="flex items-center gap-1">
                              <Clock3 size={10} /> Cron: <code className="bg-zinc-100 dark:bg-zinc-700 px-1 rounded">{sched.cron}</code>
                            </span>
                            {sched.frequency && (
                              <span>{language === 'es' ? 'Frecuencia' : 'Frequency'}: {sched.frequency}</span>
                            )}
                            {sched.timezone && <span>TZ: {sched.timezone}</span>}
                            {sched.lastRunAt && (
                              <span>
                                {language === 'es' ? 'Última ejecución' : 'Last run'}: {new Date(sched.lastRunAt).toLocaleString()}
                                {sched.lastStatus && (
                                  <span className={sched.lastStatus === 'success' ? 'text-green-500 ml-1' : 'text-red-500 ml-1'}>
                                    ({sched.lastStatus})
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                          {sched.lastResult && (
                            <details className="mt-1">
                              <summary className="text-[10px] text-zinc-400 cursor-pointer">
                                {language === 'es' ? 'Ver resultado' : 'View result'}
                              </summary>
                              <pre className="text-[10px] whitespace-pre-wrap text-zinc-500 mt-1 max-h-24 overflow-auto">
                                {sched.lastResult}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
              </div>
            )}

            {activeTab === 'memory' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <BrainCircuit size={16} className="text-primary" />
                      {language === 'es' ? 'Memoria del agente' : 'Agent memory'} ({agentWorkingMemory.length})
                    </h3>
                    <button
                      onClick={() => setShowClearWorkingMemoryConfirm(true)}
                      disabled={agentWorkingMemory.length === 0 || isClearingWorkingMemory}
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-300/70 px-2.5 py-1.5 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:border-red-700/60 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                      {isClearingWorkingMemory
                        ? (language === 'es' ? 'Vaciando...' : 'Clearing...')
                        : (language === 'es' ? 'Vaciar memoria' : 'Clear memory')}
                    </button>
                  </div>

                  {memoryError && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                      {memoryError}
                    </div>
                  )}

                  {isLoadingWorkingMemory ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw size={18} className="animate-spin text-primary mr-2" />
                      <span className="text-sm text-zinc-500">
                        {language === 'es' ? 'Cargando memoria...' : 'Loading memory...'}
                      </span>
                    </div>
                  ) : agentWorkingMemory.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      {language === 'es'
                        ? 'No hay recuerdos guardados todavía.'
                        : 'No memory entries saved yet.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {agentWorkingMemory.map((entry) => {
                        const isEditing = editingMemoryId === entry.id;
                        return (
                          <div key={entry.id} className="rounded-lg border border-border bg-white dark:bg-zinc-800 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-[11px] text-zinc-400">
                                  {new Date(entry.updatedAt).toLocaleString()}
                                </p>
                              </div>
                              {!isEditing && (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => startEditingMemory(entry)}
                                    className="rounded px-2 py-1 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                  >
                                    {language === 'es' ? 'Editar' : 'Edit'}
                                  </button>
                                  <button
                                    onClick={() => requestDeleteMemoryEntry(entry.id)}
                                    className="rounded px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                  >
                                    {language === 'es' ? 'Borrar' : 'Delete'}
                                  </button>
                                </div>
                              )}
                            </div>

                            {isEditing ? (
                              <>
                                <input
                                  value={editingMemoryLabel}
                                  onChange={(e) => setEditingMemoryLabel(e.target.value)}
                                  placeholder={language === 'es' ? 'Etiqueta' : 'Label'}
                                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                                />
                                <textarea
                                  value={editingMemoryContent}
                                  onChange={(e) => setEditingMemoryContent(e.target.value)}
                                  rows={4}
                                  placeholder={language === 'es' ? 'Contenido de memoria' : 'Memory content'}
                                  className="w-full rounded-md border border-border bg-background px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={cancelEditingMemory}
                                    className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                  >
                                    {language === 'es' ? 'Cancelar' : 'Cancel'}
                                  </button>
                                  <button
                                    onClick={saveEditedMemory}
                                    disabled={isSavingMemory}
                                    className="rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                                  >
                                    {isSavingMemory
                                      ? (language === 'es' ? 'Guardando...' : 'Saving...')
                                      : (language === 'es' ? 'Guardar' : 'Save')}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{entry.label}</p>
                                <pre className="whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400 max-h-48 overflow-auto">
                                  {entry.content}
                                </pre>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        )}

        {/* ── Chat section (live Telegram-style) ── */}
        {activeSection === 'chat' && (
          <div className="rounded-2xl border border-border bg-surface overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 200px)', minHeight: '400px' }}>
            {/* Chat header */}
            <div className="border-b border-border px-4 py-3 flex items-center gap-3 shrink-0">
              <div className={`w-2.5 h-2.5 rounded-full ${isAgentDeployed ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                  {copy.chatSection.title}
                </h3>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {copy.chatSection.subtitle} — {activeAgent.name}
                </p>
              </div>
              {isAgentDeployed && agentStatus && (
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {agentStatus.isProcessing
                    ? (language === 'es' ? '⚡ Procesando...' : '⚡ Processing...')
                    : `📨 ${agentStatus.historyLength} msgs`}
                </span>
              )}
            </div>

            {/* Messages area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!isAgentDeployed ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center space-y-3">
                    <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mx-auto">
                      <MessageCircle size={28} className="text-zinc-400" />
                    </div>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {copy.chatSection.notDeployed}
                    </p>
                  </div>
                </div>
              ) : isLoadingLiveChat && liveChatMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw size={20} className="animate-spin text-primary mr-2" />
                  <span className="text-sm text-zinc-500">{copy.chatSection.loading}</span>
                </div>
              ) : liveChatMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    {copy.chatSection.empty}
                  </p>
                </div>
              ) : (
                <>
                  {liveChatMessages.map((msg, idx) => (
                    <div
                      key={`${msg.timestamp}-${idx}`}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                          msg.role === 'user'
                            ? 'bg-primary text-white rounded-br-md'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md'
                        }`}
                      >
                        <div className="text-[10px] opacity-60 mb-1">
                          {msg.role === 'user'
                            ? (msg.source === 'telegram'
                              ? (language === 'es' ? 'Tú · Telegram' : 'You · Telegram')
                              : (language === 'es' ? 'Tú' : 'You'))
                            : activeAgent.name}
                          {' · '}
                          {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={markdownComponents}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))}
                  <div ref={liveChatEndRef} />
                </>
              )}
            </div>

            {/* Input area */}
            {isAgentDeployed && (
              <div className="border-t border-border px-4 py-3 shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    value={liveChatInput}
                    onChange={(e) => setLiveChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendLiveMessage();
                      }
                    }}
                    disabled={isSendingLiveMessage}
                    placeholder={copy.chatSection.placeholder}
                    className="flex-1 rounded-xl border border-border bg-background px-4 py-2.5 text-sm disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    onClick={handleSendLiveMessage}
                    disabled={isSendingLiveMessage || !liveChatInput.trim()}
                    className="rounded-xl bg-primary p-2.5 text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                  >
                    <Send size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-3 text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <span>
            {language === 'es'
              ? 'El agente opera en un sandbox aislado. No tiene acceso a tu sistema operativo. Solo puede navegar por internet, usar el navegador headless y los MCPs configurados.'
              : 'The agent runs in an isolated sandbox. It has no access to your operating system. It can only browse the internet, use the headless browser, and configured MCPs.'}
          </span>
        </div>
      </section>

      <ConfirmationModal
        isOpen={showResetMemoryConfirm}
        onClose={() => setShowResetMemoryConfirm(false)}
        onConfirm={handleResetAgentMemory}
        title={copy.assistant.resetMemoryConfirmTitle}
        message={copy.assistant.resetMemoryConfirmMessage}
        confirmText={copy.assistant.resetMemoryConfirmAction}
        cancelText={language === 'es' ? 'Cancelar' : 'Cancel'}
        isDestructive
      />

      <ConfirmationModal
        isOpen={showClearWorkingMemoryConfirm}
        onClose={() => setShowClearWorkingMemoryConfirm(false)}
        onConfirm={clearWorkingMemory}
        title={language === 'es' ? '¿Vaciar memoria del agente?' : 'Clear agent memory?'}
        message={language === 'es'
          ? 'Se eliminarán todos los recuerdos de la memoria de trabajo. Esta acción no se puede deshacer.'
          : 'All working-memory entries will be deleted. This action cannot be undone.'}
        confirmText={language === 'es' ? 'Sí, vaciar' : 'Yes, clear'}
        cancelText={language === 'es' ? 'Cancelar' : 'Cancel'}
        isDestructive
      />

      {/* Delete data confirmation (two-step with 4-digit code) */}
      <ConfirmationModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={executePendingDelete}
        title={language === 'es' ? 'Confirmar eliminación' : 'Confirm deletion'}
        message={
          language === 'es'
            ? '¿Estás seguro de que deseas eliminar este elemento? Esta acción no se puede deshacer.'
            : 'Are you sure you want to delete this item? This action cannot be undone.'
        }
        confirmText={language === 'es' ? 'Confirmar' : 'Confirm'}
        cancelText={language === 'es' ? 'Cancelar' : 'Cancel'}
        isDestructive
        requireCode
        yesText={language === 'es' ? 'Sí' : 'Yes'}
        noText="No"
        codePromptText={
          language === 'es'
            ? 'Introduce los 4 dígitos para confirmar:'
            : 'Enter the 4 digits to confirm:'
        }
        codeErrorText={
          language === 'es'
            ? 'Código incorrecto, inténtalo de nuevo.'
            : 'Incorrect code, try again.'
        }
      />
    </div>
  );
};
