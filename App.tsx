
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SidebarLeft } from './components/SidebarLeft';
import { SidebarRight } from './components/SidebarRight';
import { ChatArea } from './components/ChatArea';
import { TopBar } from './components/TopBar';
import { SettingsModal } from './components/SettingsModal';
import { ExportButton } from './components/ExportButton'; 
import { LoginScreen } from './components/LoginScreen';
import { NotesWorkspace } from './components/NotesWorkspace';
import {
  AgentsWorkspace,
  createAutonomousAgent,
  createDefaultAgentWorkspaceState,
  sanitizeAgentWorkspaceState,
  type AgentProviderOption,
  type AgentWorkspaceState,
} from './components/AgentsWorkspace';
import { Message, Conversation, AppSettings, SystemPrompt, Folder, Quote, CouncilAnswer, ArenaAnswer, UsageCostEvent, ProviderModelFilterSettings, ProviderModelSyncStatus, QuickInsertPrompt, MessageAttachment, WorkspaceView, NoteDocument, NotesWorkspaceState, ConciliumMode, ConciliumPreset } from './types';
import { INITIAL_CONVERSATIONS, INITIAL_MESSAGES, DEFAULT_SYSTEM_PROMPTS, INITIAL_FOLDERS, THEME_COLORS, SYSTEM_PROMPTS_DATA, getDefaultModelForProvider, getAllModelsForProvider, getModelsForProvider, getDefaultRagEmbeddingModelForProvider, getRagEmbeddingModelsForProvider, inferModelVendor, isModelAvailableForProvider, isRagEmbeddingModelKnownForProvider, providerSupportsRagEmbeddings, supportsReasoningEffort, PROVIDERS, getEffectiveToolingForProvider, providerRequiresApiKey, providerSupportsTemperature, providerSupportsVendorFilter, setRuntimeModelsForProvider, setVisibleModelFilterForProvider } from './constants';
import { Menu, PanelRightOpen } from 'lucide-react';
import {
  sendChatMessage,
  sendConciliumMessage,
  summarizeConversation,
  getProviderModels,
  resolveProviderModelPricing,
  getProviders,
  deleteProviderApiKey,
  cancelStreamingRequest,
  createStreamingRequestId,
  fetchServerState,
  saveServerState,
  saveServerStateKey,
  clearServerState,
  loginUser,
  logoutUser,
  getCurrentUser,
  exportProviderApiKeysBackup,
  importProviderApiKeysBackup,
  type ProviderStatus,
  type AuthUser,
} from './services/api';
import {
  buildUsageCostEvent,
  estimateCostUsd,
  estimateInputTokens,
  estimateTextTokens,
  getModelPricing,
  summarizeUsage,
  syncManualModelPricingOverrides,
  syncRuntimeModelPricingForProvider,
} from './utils/costs';
import { getVectorStore, resetVectorStore, type VectorDocument } from './utils/vectorStore';
import {
  getConversationDocStore,
  clearConversationDocStore,
  clearAllDocStores,
  reindexConversationAttachments,
} from './utils/documentProcessor';
import { resolveStartupWorkspace } from './utils/uiBehavior';

const MAX_STORED_USAGE_EVENTS = 3000;
const INITIAL_CONTEXT_SUMMARY = '• System initialized\n• Waiting for interactions...';
const MAX_INFINITE_MEMORY_HITS = 4;
const MEMORY_SNIPPET_MAX_CHARS = 220;
const LEGACY_PLACEHOLDER_CONVERSATION_IDS = new Set(['1', '2', '3', '4']);
const LEGACY_PLACEHOLDER_FOLDER_IDS = new Set(['f1', 'f2']);
const DEFAULT_TEMPERATURE = 0.7;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;
const PERSONALIZATION_FIELD_MAX_CHARS = 200;
const RUNTIME_PRICING_PROVIDER_IDS = ['openrouter'] as const;
const RUNTIME_PRICING_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const SUMMARY_SYSTEM_PROMPT = 'You are a precise summarizer. Output only bullet points in a concise format.';
const SUMMARY_BASE_PROMPT_PREFIX = 'Summarize the following conversation into concise bullet points. Focus on key topics discussed, decisions made, and important context. Keep it under 200 words.';
const SUMMARY_TOKEN_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ0-9_./:#-]+/g;
const SUMMARY_LOW_SIGNAL_STOP_WORDS = new Set([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my', 'no', 'nor', 'not',
  'of', 'on', 'or', 'our', 'out', 'own', 'say', 'she', 'so', 'some', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'to', 'too', 'up', 'us', 'very', 'was', 'we', 'what', 'when', 'where',
  'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'you', 'your',
  // Spanish
  'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'de', 'del', 'al', 'y', 'o', 'pero', 'que', 'en', 'es',
  'por', 'con', 'para', 'se', 'no', 'lo', 'le', 'les', 'su', 'sus', 'como', 'más', 'ya', 'este', 'esta', 'estos',
  'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'mi', 'tu', 'nos', 'nuestro', 'nuestra', 'nuestros',
  'nuestras', 'han', 'ha', 'hay', 'fue', 'ser', 'estar', 'son', 'están', 'era', 'sin', 'sobre', 'también', 'muy',
  'tiene', 'tienen', 'todo', 'toda', 'todos', 'todas', 'otro', 'otra', 'otros', 'otras', 'entre', 'desde', 'hasta',
  'durante',
]);

type SummaryMessage = { role: 'user' | 'assistant' | 'system'; content: string };

interface SettingsErrorBoundaryProps {
  language: AppSettings['language'];
  onClose: () => void;
  children: React.ReactNode;
}

interface SettingsErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class SettingsErrorBoundary extends React.Component<SettingsErrorBoundaryProps, SettingsErrorBoundaryState> {
  state: SettingsErrorBoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): SettingsErrorBoundaryState {
    return { hasError: true, errorMessage: error?.message || '' };
  }

  componentDidCatch(error: Error): void {
    console.error('SettingsModal render error:', error);
  }

  componentDidUpdate(prevProps: SettingsErrorBoundaryProps): void {
    if (!prevProps.children && this.props.children && this.state.hasError) {
      this.setState({ hasError: false, errorMessage: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      const isEs = this.props.language === 'es';
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border w-full max-w-md rounded-xl shadow-2xl p-6">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {isEs ? 'No se pudo abrir Ajustes' : 'Could not open Settings'}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
              {isEs
                ? 'Ocurrió un error al renderizar esta vista. Cierra esta ventana e inténtalo de nuevo.'
                : 'An error occurred while rendering this view. Close this window and try again.'}
            </p>
            {this.state.errorMessage && (
              <p className="text-xs text-red-500 mt-3 break-words">
                {this.state.errorMessage}
              </p>
            )}
            <div className="mt-5 flex justify-end">
              <button
                onClick={this.props.onClose}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primaryHover text-white transition-colors"
              >
                {isEs ? 'Cerrar' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const createUniqueId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createDefaultProviderModelFilter = (): ProviderModelFilterSettings => ({
  mode: 'all',
  vendorAllowlist: [],
  pinnedModelIds: [],
});

const createDefaultModelFiltersByProvider = (): Record<string, ProviderModelFilterSettings> =>
  Object.fromEntries(PROVIDERS.map((provider) => [provider.id, createDefaultProviderModelFilter()]));

const sanitizeTemperature = (value: unknown, fallback = DEFAULT_TEMPERATURE): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(MIN_TEMPERATURE, Math.min(MAX_TEMPERATURE, Number(value)));
};

const sanitizeProviderModelFilter = (value: unknown): ProviderModelFilterSettings => {
  if (!value || typeof value !== 'object') {
    return createDefaultProviderModelFilter();
  }
  const candidate = value as Partial<ProviderModelFilterSettings>;
  const mode: ProviderModelFilterSettings['mode'] =
    candidate.mode === 'vendor' || candidate.mode === 'pinned' || candidate.mode === 'all'
      ? candidate.mode
      : 'all';
  const vendorAllowlist = Array.isArray(candidate.vendorAllowlist)
    ? Array.from(new Set(candidate.vendorAllowlist.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))
    : [];
  const pinnedModelIds = Array.isArray(candidate.pinnedModelIds)
    ? Array.from(new Set(candidate.pinnedModelIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))
    : [];

  return {
    mode,
    vendorAllowlist,
    pinnedModelIds,
  };
};

const sanitizeManualModelPricingOverrides = (
  value: unknown
): AppSettings['manualModelPricingByProviderModelKey'] => {
  if (!value || typeof value !== 'object') return {};

  const output: AppSettings['manualModelPricingByProviderModelKey'] = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, rawOverride]) => {
    if (typeof key !== 'string') return;
    if (!key.includes(':')) return;
    if (!rawOverride || typeof rawOverride !== 'object') return;

    const candidate = rawOverride as Partial<{
      inputPerMillionUsd: unknown;
      outputPerMillionUsd: unknown;
    }>;
    const inputPerMillionUsd = Number(candidate.inputPerMillionUsd);
    const outputPerMillionUsd = Number(candidate.outputPerMillionUsd);
    if (!Number.isFinite(inputPerMillionUsd) || inputPerMillionUsd < 0) return;
    if (!Number.isFinite(outputPerMillionUsd) || outputPerMillionUsd < 0) return;

    output[key] = {
      inputPerMillionUsd: Math.max(0, inputPerMillionUsd),
      outputPerMillionUsd: Math.max(0, outputPerMillionUsd),
    };
  });

  return output;
};

const isProviderAvailable = (providerId: string): boolean =>
  PROVIDERS.some((provider) => provider.id === providerId);

const CONCILIUM_MODES: ConciliumMode[] = ['consensus', 'factcheck', 'codereview', 'brainstorm', 'debate'];

const sanitizeConciliumMode = (value: unknown, fallback: ConciliumMode = 'consensus'): ConciliumMode =>
  typeof value === 'string' && CONCILIUM_MODES.includes(value as ConciliumMode)
    ? (value as ConciliumMode)
    : fallback;

const getConciliumResponseLabel = (index: number, blindEval: boolean): string => {
  if (!blindEval) return `Response ${index + 1}`;
  const codePoint = 'A'.charCodeAt(0) + index;
  return `Response ${String.fromCharCode(codePoint)}`;
};

const getConciliumModeTaskInstructions = (mode: ConciliumMode): string => {
  switch (mode) {
    case 'factcheck':
      return 'Identify contradictory claims across responses. Mark which are correct/incorrect with evidence.';
    case 'codereview':
      return 'Evaluate each code solution for correctness, performance, and readability. Produce the optimal version.';
    case 'brainstorm':
      return 'Combine all unique ideas without discarding any. Organize by category.';
    case 'debate':
      return 'Highlight key disagreements. Let models defend their stance. Synthesize based on strongest arguments.';
    case 'consensus':
    default:
      return 'Find areas of agreement/disagreement and provide a balanced final synthesis.';
  }
};

const createDefaultConciliumPresets = (): ConciliumPreset[] => [
  {
    id: 'code-council',
    name: 'Code Council',
    members: [
      { provider: 'openai', model: 'gpt-5.2' },
      { provider: 'anthropic', model: 'claude-sonnet-4-5' },
      { provider: 'groq', model: 'qwen/qwen3-32b' },
    ],
    leader: { provider: 'anthropic', model: 'claude-opus-4-6' },
    mode: 'codereview',
  },
  {
    id: 'research-council',
    name: 'Research Council',
    members: [
      { provider: 'openai', model: 'gpt-5.2' },
      { provider: 'google', model: 'gemini-3-pro-preview' },
      { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    ],
    leader: { provider: 'openai', model: 'gpt-5.2' },
    mode: 'factcheck',
  },
  {
    id: 'budget-council',
    name: 'Budget Council',
    members: [
      { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
      { provider: 'groq', model: 'meta-llama/llama-4-maverick-17b-128e-instruct' },
      { provider: 'groq', model: 'qwen/qwen3-32b' },
    ],
    leader: { provider: 'openrouter', model: 'openai/gpt-5-nano' },
    mode: 'consensus',
  },
];

const normalizeConciliumMembers = (
  value: unknown,
  fallbackMembers: Array<{ provider: string; model: string }>
): Array<{ provider: string; model: string }> => {
  const fallbackProvider = fallbackMembers[0]?.provider || 'openai';
  const safeFallbackMembers =
    fallbackMembers.length > 0
      ? fallbackMembers
      : [{ provider: fallbackProvider, model: getDefaultModelForProvider(fallbackProvider) }];

  const parsed = Array.isArray(value)
    ? value
      .filter((member): member is { provider?: unknown; model?: unknown } => !!member && typeof member === 'object')
      .slice(0, CONCILIUM_MAX_MEMBERS)
      .map((member, index) => {
        const fallback = safeFallbackMembers[Math.min(index, safeFallbackMembers.length - 1)];
        const provider = typeof member.provider === 'string' && isProviderAvailable(member.provider)
          ? member.provider
          : fallback.provider;
        const model = typeof member.model === 'string' && member.model.trim()
          ? member.model
          : getDefaultModelForProvider(provider);
        return { provider, model };
      })
    : [];

  const normalized = parsed.length > 0 ? parsed : safeFallbackMembers.slice(0, CONCILIUM_MAX_MEMBERS);
  while (normalized.length < CONCILIUM_MIN_MEMBERS) {
    const fallback = safeFallbackMembers[normalized.length % safeFallbackMembers.length];
    normalized.push({
      provider: fallback.provider,
      model: fallback.model || getDefaultModelForProvider(fallback.provider),
    });
  }
  return normalized.slice(0, CONCILIUM_MAX_MEMBERS);
};

const sanitizeConciliumPresets = (value: unknown, defaultPresets: ConciliumPreset[]): ConciliumPreset[] => {
  const defaultMap = new Map(defaultPresets.map((preset) => [preset.id, preset]));
  const parsed = Array.isArray(value)
    ? value
      .filter((preset): preset is {
        id?: unknown;
        name?: unknown;
        mode?: unknown;
        leader?: unknown;
        members?: unknown;
      } => !!preset && typeof preset === 'object')
      .map((preset) => {
        if (typeof preset.id !== 'string' || !preset.id.trim()) return null;
        if (typeof preset.name !== 'string' || !preset.name.trim()) return null;
        const normalizedMode = sanitizeConciliumMode(preset.mode, 'consensus');

        const rawLeader = preset.leader as { provider?: unknown; model?: unknown } | undefined;
        const fallbackLeader = defaultMap.get(preset.id)?.leader || defaultPresets[0]?.leader || { provider: 'openai', model: 'gpt-5.2' };
        const leaderProvider = typeof rawLeader?.provider === 'string' && isProviderAvailable(rawLeader.provider)
          ? rawLeader.provider
          : fallbackLeader.provider;
        const leaderModel = typeof rawLeader?.model === 'string' && rawLeader.model.trim()
          ? rawLeader.model
          : getDefaultModelForProvider(leaderProvider);

        const fallbackMembers = defaultMap.get(preset.id)?.members || defaultPresets[0]?.members || [
          { provider: leaderProvider, model: getDefaultModelForProvider(leaderProvider) },
        ];
        const members = normalizeConciliumMembers(preset.members, fallbackMembers);

        return {
          id: preset.id.trim(),
          name: preset.name.trim().slice(0, 40),
          mode: normalizedMode,
          leader: {
            provider: leaderProvider,
            model: leaderModel,
          },
          members,
        } as ConciliumPreset;
      })
      .filter((preset): preset is ConciliumPreset => Boolean(preset))
    : [];

  const merged = [...defaultPresets];
  const seen = new Set(defaultPresets.map((preset) => preset.id));
  parsed.forEach((preset) => {
    if (defaultMap.has(preset.id)) {
      const index = merged.findIndex((item) => item.id === preset.id);
      if (index >= 0) {
        merged[index] = preset;
      }
      return;
    }
    if (seen.has(preset.id)) return;
    seen.add(preset.id);
    merged.push(preset);
  });

  return merged;
};

const sanitizeStoredUsageEvents = (value: unknown): UsageCostEvent[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((event) => !!event && typeof event.timestamp === 'number' && typeof event.provider === 'string' && typeof event.model === 'string')
    .map((event) => ({
      ...event,
      conversationId: typeof event.conversationId === 'string' && event.conversationId.trim()
        ? event.conversationId
        : undefined,
      apiKeyId: typeof event.apiKeyId === 'string' ? event.apiKeyId : undefined,
      apiKeyName: typeof event.apiKeyName === 'string' ? event.apiKeyName : undefined,
      apiKeyMasked: typeof event.apiKeyMasked === 'string' ? event.apiKeyMasked : undefined,
      inputTokens: Number.isFinite(event.inputTokens) ? event.inputTokens : 0,
      outputTokens: Number.isFinite(event.outputTokens) ? event.outputTokens : 0,
      inputCostUsd: Number.isFinite(event.inputCostUsd) ? event.inputCostUsd : 0,
      outputCostUsd: Number.isFinite(event.outputCostUsd) ? event.outputCostUsd : 0,
      totalCostUsd: Number.isFinite(event.totalCostUsd) ? event.totalCostUsd : 0,
      toolingCostUsd: Number.isFinite(event.toolingCostUsd) ? event.toolingCostUsd : 0,
      toolWebSearchEnabled: event.toolWebSearchEnabled === true,
      toolCodeExecutionEnabled: event.toolCodeExecutionEnabled === true,
      source: event.source || 'chat',
      estimated: event.estimated !== false,
    }))
    .slice(-MAX_STORED_USAGE_EVENTS);
};

const LEGACY_USAGE_EVENT_MIGRATION_MAX_DISTANCE_MS = 6 * 60 * 60 * 1000;

const migrateLegacyUsageEventsByConversation = (
  usageEvents: UsageCostEvent[],
  messagesByConversation: Record<string, Message[]>
): { events: UsageCostEvent[]; migratedCount: number } => {
  if (usageEvents.length === 0) return { events: usageEvents, migratedCount: 0 };

  const messageTimestampsByConversation = Object.entries(messagesByConversation)
    .map(([conversationId, messages]) => {
      const timestamps = (Array.isArray(messages) ? messages : [])
        .map((message) => message?.timestamp)
        .filter((timestamp): timestamp is number => typeof timestamp === 'number' && Number.isFinite(timestamp))
        .sort((left, right) => left - right);

      return { conversationId, timestamps };
    })
    .filter((entry) => entry.timestamps.length > 0);

  if (messageTimestampsByConversation.length === 0) {
    return { events: usageEvents, migratedCount: 0 };
  }

  let migratedCount = 0;
  const migratedEvents = usageEvents.map((event) => {
    if (event.conversationId) return event;

    let bestConversationId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of messageTimestampsByConversation) {
      for (const timestamp of candidate.timestamps) {
        const distance = Math.abs(timestamp - event.timestamp);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestConversationId = candidate.conversationId;
        }

        if (distance === 0) break;
        if (timestamp > event.timestamp && distance > bestDistance) break;
      }
    }

    if (!bestConversationId || bestDistance > LEGACY_USAGE_EVENT_MIGRATION_MAX_DISTANCE_MS) {
      return event;
    }

    migratedCount += 1;
    return {
      ...event,
      conversationId: bestConversationId,
    };
  });

  return { events: migratedEvents, migratedCount };
};

const sanitizeSummaryCheckpointByConversation = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value as Record<string, unknown>).reduce((acc, [conversationId, checkpoint]) => {
    if (!conversationId) return acc;
    if (typeof checkpoint !== 'string' || !checkpoint.trim()) return acc;
    acc[conversationId] = checkpoint;
    return acc;
  }, {} as Record<string, string>);
};

const compactJsonValue = (value: unknown): unknown => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const compacted = value
      .map((entry) => compactJsonValue(entry))
      .filter((entry) => entry !== undefined);
    return compacted.length > 0 ? compacted : undefined;
  }
  if (typeof value === 'object') {
    const compactedEntries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, compactJsonValue(entry)] as const)
      .filter(([, entry]) => entry !== undefined);
    return compactedEntries.length > 0 ? Object.fromEntries(compactedEntries) : undefined;
  }
  return value;
};

const isLowInformationSummaryToken = (token: string): boolean => {
  const normalized = token.toLowerCase();
  if (!normalized) return true;
  if (/^\d+([.,]\d+)*$/.test(normalized)) return false;
  if (/^(https?:\/\/|www\.)/.test(normalized)) return false;
  if (/[._/:#-]/.test(normalized)) return false;
  if (normalized.length <= 1) return true;
  if (SUMMARY_LOW_SIGNAL_STOP_WORDS.has(normalized)) return true;
  if (/^(ha|ja|he|je){2,}$/.test(normalized)) return true;
  if (/^([a-z])\1{2,}$/.test(normalized)) return true;
  return false;
};

const compressSummaryContent = (content: string): string => {
  const tokens = content.match(SUMMARY_TOKEN_PATTERN) || [];
  if (tokens.length === 0) return '';
  const filteredTokens = tokens.filter((token) => !isLowInformationSummaryToken(token));
  const finalTokens = filteredTokens.length > 0 ? filteredTokens : tokens.slice(0, 16);
  return finalTokens.join(' ').trim();
};

const compressSummaryMessages = (messages: SummaryMessage[]): SummaryMessage[] =>
  messages
    .map((message) => ({
      role: message.role,
      content: compressSummaryContent(message.content),
    }))
    .filter((message) => message.content.length > 0);

const buildSummaryPrompt = (messages: SummaryMessage[]): string => {
  const formattedMessages = messages.map((message) => `[${message.role}]: ${message.content}`).join('\n');
  return `${SUMMARY_BASE_PROMPT_PREFIX}\n\n${formattedMessages}`;
};

const buildIncrementalSummaryMessages = (params: {
  language: AppSettings['language'];
  previousSummary: string;
  deltaMessages: SummaryMessage[];
}): SummaryMessage[] => {
  const previousSummaryLabel = params.language === 'es'
    ? `Resumen acumulativo actual:\n${params.previousSummary}`
    : `Current cumulative summary:\n${params.previousSummary}`;
  const deltaInstruction = params.language === 'es'
    ? 'Actualiza el resumen usando solo los mensajes nuevos siguientes. Mantén el contexto clave previo, elimina duplicados y conserva un formato de viñetas breve.'
    : 'Update the summary using only the new messages below. Keep key prior context, remove duplicates, and preserve concise bullet formatting.';
  return [
    { role: 'system', content: previousSummaryLabel },
    { role: 'system', content: deltaInstruction },
    ...params.deltaMessages,
  ];
};

const createWelcomeMessages = (): Message[] =>
  INITIAL_MESSAGES.map((message, index) => ({
    ...message,
    id: `${createUniqueId()}-${index}`,
    timestamp: Date.now() + index,
  }));

const createDefaultSettings = (): AppSettings => ({
  userName: 'User',
  includeLocationInContext: false,
  locationLabel: '',
  personalization: {
    nickname: '',
    occupation: '',
    familyAndFriends: '',
    leisure: '',
    other: '',
  },

  // Interface Defaults
  language: 'en',
  themeMode: 'dark',
  themeColor: 'indigo',

  provider: 'anthropic',
  contextProvider: 'anthropic',
  contextModel: 'claude-haiku-4-5',
  mainModel: 'claude-sonnet-4-5',
  telegramProvider: 'anthropic',
  telegramModel: 'claude-sonnet-4-5',
  rememberedMainModelByProvider: {
    anthropic: 'claude-sonnet-4-5',
  },
  reasoningEffort: 'none',
  temperature: DEFAULT_TEMPERATURE,
  enableModelTools: false,
  tooling: {
    webSearch: false,
    codeExecution: false,
  },
  selectedSystemPromptId: 'default',
  monthlyBudgetUsd: 0,
  sessionBudgetUsd: 0,
  maxContextMessages: 10,
  maxOutputTokens: 2048,
  unlimitedOutputTokens: false,
  enableContext: true,
  enableSummary: false,
  enableInfiniteMemory: true,
  ragEmbeddingProvider: '',
  ragEmbeddingModel: '',

  // Concilium Defaults
  enableConcilium: false,
  conciliumMembers: [
    { provider: 'anthropic', model: 'claude-opus-4-6' },
    { provider: 'openai', model: 'gpt-5.2' },
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  ],
  conciliumLeader: { provider: 'openai', model: 'gpt-5.2' },
  conciliumMode: 'consensus',
  conciliumBlindEval: true,
  conciliumPresets: createDefaultConciliumPresets(),
  rememberedContextModelByProvider: {
    anthropic: 'claude-haiku-4-5',
  },
  rememberedLeaderModelByProvider: {
    openai: 'gpt-5.2',
  },
  enableArena: false,
  arenaMembers: [
    { provider: 'openai', model: 'gpt-5.2' },
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  ],
  arenaTemperatures: [DEFAULT_TEMPERATURE, DEFAULT_TEMPERATURE],
  modelFiltersByProvider: createDefaultModelFiltersByProvider(),
  manualModelPricingByProviderModelKey: {},
});

const sanitizeSettings = (value: unknown): AppSettings => {
  const defaults = createDefaultSettings();
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = { ...defaults, ...(value as Partial<AppSettings>) } as AppSettings;
  candidate.includeLocationInContext = candidate.includeLocationInContext === true;
  candidate.locationLabel = typeof candidate.locationLabel === 'string' ? candidate.locationLabel.trim().slice(0, PERSONALIZATION_FIELD_MAX_CHARS) : '';
  const rawPersonalization = candidate.personalization && typeof candidate.personalization === 'object'
    ? candidate.personalization
    : defaults.personalization;
  candidate.personalization = {
    nickname: typeof rawPersonalization.nickname === 'string' ? rawPersonalization.nickname.trim().slice(0, PERSONALIZATION_FIELD_MAX_CHARS) : '',
    occupation: typeof rawPersonalization.occupation === 'string' ? rawPersonalization.occupation.trim().slice(0, PERSONALIZATION_FIELD_MAX_CHARS) : '',
    familyAndFriends: typeof rawPersonalization.familyAndFriends === 'string' ? rawPersonalization.familyAndFriends.trim().slice(0, PERSONALIZATION_FIELD_MAX_CHARS) : '',
    leisure: typeof rawPersonalization.leisure === 'string' ? rawPersonalization.leisure.trim().slice(0, PERSONALIZATION_FIELD_MAX_CHARS) : '',
    other: typeof rawPersonalization.other === 'string' ? rawPersonalization.other.trim().slice(0, PERSONALIZATION_FIELD_MAX_CHARS) : '',
  };
  candidate.language = candidate.language === 'es' ? 'es' : 'en';
  candidate.themeMode = candidate.themeMode === 'light' ? 'light' : 'dark';
  candidate.reasoningEffort = ['none', 'low', 'medium', 'high', 'xhigh'].includes(candidate.reasoningEffort)
    ? candidate.reasoningEffort
    : 'none';
  candidate.temperature = sanitizeTemperature(candidate.temperature, defaults.temperature);
  candidate.arenaTemperatures = Array.isArray(candidate.arenaTemperatures)
    ? [
      sanitizeTemperature(candidate.arenaTemperatures[0], defaults.arenaTemperatures[0]),
      sanitizeTemperature(candidate.arenaTemperatures[1], defaults.arenaTemperatures[1]),
    ]
    : defaults.arenaTemperatures;
  candidate.enableModelTools = candidate.enableModelTools === true;
  candidate.tooling = {
    webSearch: candidate.tooling?.webSearch === true,
    codeExecution: candidate.tooling?.codeExecution === true,
  };
  candidate.maxContextMessages = Number.isFinite(candidate.maxContextMessages)
    ? Math.max(1, Math.floor(candidate.maxContextMessages))
    : defaults.maxContextMessages;
  candidate.maxOutputTokens = Number.isFinite(candidate.maxOutputTokens)
    ? Math.max(256, Math.floor(candidate.maxOutputTokens))
    : defaults.maxOutputTokens;
  candidate.monthlyBudgetUsd = Number.isFinite(candidate.monthlyBudgetUsd)
    ? Math.max(0, Number(candidate.monthlyBudgetUsd))
    : defaults.monthlyBudgetUsd;
  candidate.sessionBudgetUsd = Number.isFinite(candidate.sessionBudgetUsd)
    ? Math.max(0, Number(candidate.sessionBudgetUsd))
    : defaults.sessionBudgetUsd;
  candidate.unlimitedOutputTokens = candidate.unlimitedOutputTokens === true;
  candidate.enableContext = candidate.enableContext !== false;
  candidate.enableSummary = candidate.enableSummary === true;
  candidate.enableInfiniteMemory = candidate.enableInfiniteMemory !== false;
  candidate.ragEmbeddingProvider =
    typeof candidate.ragEmbeddingProvider === 'string' ? candidate.ragEmbeddingProvider.trim() : '';
  candidate.ragEmbeddingModel =
    typeof candidate.ragEmbeddingModel === 'string' ? candidate.ragEmbeddingModel.trim() : '';
  if (!candidate.ragEmbeddingProvider) {
    candidate.ragEmbeddingModel = '';
  } else if (!providerSupportsRagEmbeddings(candidate.ragEmbeddingProvider)) {
    candidate.ragEmbeddingProvider = '';
    candidate.ragEmbeddingModel = '';
  } else {
    const ragModels = getRagEmbeddingModelsForProvider(candidate.ragEmbeddingProvider);
    if (ragModels.length === 0) {
      candidate.ragEmbeddingProvider = '';
      candidate.ragEmbeddingModel = '';
    } else if (!isRagEmbeddingModelKnownForProvider(candidate.ragEmbeddingProvider, candidate.ragEmbeddingModel)) {
      candidate.ragEmbeddingModel = getDefaultRagEmbeddingModelForProvider(candidate.ragEmbeddingProvider);
    }
  }
  candidate.enableConcilium = candidate.enableConcilium === true;
  candidate.enableArena = candidate.enableArena === true;
  candidate.conciliumMode = sanitizeConciliumMode(candidate.conciliumMode, defaults.conciliumMode);
  candidate.conciliumBlindEval =
    typeof candidate.conciliumBlindEval === 'boolean'
      ? candidate.conciliumBlindEval
      : defaults.conciliumBlindEval;
  candidate.conciliumPresets = sanitizeConciliumPresets(candidate.conciliumPresets, defaults.conciliumPresets);

  if (!isProviderAvailable(candidate.provider)) {
    candidate.provider = defaults.provider;
  }
  if (!isProviderAvailable(candidate.contextProvider)) {
    candidate.contextProvider = defaults.contextProvider;
  }
  if (!isProviderAvailable(candidate.telegramProvider)) {
    candidate.telegramProvider = candidate.provider;
  }
  if (!isProviderAvailable(candidate.conciliumLeader?.provider || '')) {
    candidate.conciliumLeader = defaults.conciliumLeader;
  }

  candidate.rememberedMainModelByProvider = {
    ...defaults.rememberedMainModelByProvider,
    ...(candidate.rememberedMainModelByProvider || {}),
  };
  candidate.rememberedContextModelByProvider = {
    ...defaults.rememberedContextModelByProvider,
    ...(candidate.rememberedContextModelByProvider || {}),
  };
  candidate.rememberedLeaderModelByProvider = {
    ...defaults.rememberedLeaderModelByProvider,
    ...(candidate.rememberedLeaderModelByProvider || {}),
  };
  const rawModelFilters = candidate.modelFiltersByProvider && typeof candidate.modelFiltersByProvider === 'object'
    ? candidate.modelFiltersByProvider
    : {};
  candidate.modelFiltersByProvider = {
    ...createDefaultModelFiltersByProvider(),
  };
  PROVIDERS.forEach((provider) => {
    candidate.modelFiltersByProvider[provider.id] = sanitizeProviderModelFilter(
      (rawModelFilters as Record<string, unknown>)[provider.id]
    );
  });
  candidate.manualModelPricingByProviderModelKey = sanitizeManualModelPricingOverrides(
    candidate.manualModelPricingByProviderModelKey
  );

  // Trust saved model values — they will be validated once runtime models finish loading.
  // Only fall back if the model string is empty/missing.
  if (!candidate.mainModel || typeof candidate.mainModel !== 'string') {
    const rememberedMain = candidate.rememberedMainModelByProvider[candidate.provider];
    candidate.mainModel = rememberedMain || getDefaultModelForProvider(candidate.provider);
  }
  if (!candidate.telegramModel || typeof candidate.telegramModel !== 'string') {
    candidate.telegramModel = candidate.mainModel;
  }

  if (!candidate.contextModel || typeof candidate.contextModel !== 'string') {
    const rememberedContext = candidate.rememberedContextModelByProvider[candidate.contextProvider];
    candidate.contextModel = rememberedContext || getDefaultModelForProvider(candidate.contextProvider);
  }

  candidate.conciliumMembers = normalizeConciliumMembers(candidate.conciliumMembers, defaults.conciliumMembers);

  if (!Array.isArray(candidate.arenaMembers) || candidate.arenaMembers.length !== 2) {
    candidate.arenaMembers = defaults.arenaMembers;
  }

  candidate.arenaMembers = candidate.arenaMembers.map((member, index) => {
    const fallback = defaults.arenaMembers[index];
    const provider = isProviderAvailable(member.provider) ? member.provider : fallback.provider;
    const model = (member.model && typeof member.model === 'string') ? member.model : getDefaultModelForProvider(provider);
    return { provider, model };
  }) as AppSettings['arenaMembers'];

  if (candidate.enableArena && candidate.enableConcilium) {
    candidate.enableConcilium = false;
  }

  if (!candidate.conciliumLeader.model || typeof candidate.conciliumLeader.model !== 'string') {
    const rememberedLeader = candidate.rememberedLeaderModelByProvider[candidate.conciliumLeader.provider];
    candidate.conciliumLeader = {
      provider: candidate.conciliumLeader.provider,
      model: rememberedLeader || getDefaultModelForProvider(candidate.conciliumLeader.provider),
    };
  }

  if (!supportsReasoningEffort(candidate.provider, candidate.mainModel)) {
    candidate.reasoningEffort = 'none';
  }

  if (!isModelAvailableForProvider(candidate.telegramProvider, candidate.telegramModel)) {
    candidate.telegramModel = getDefaultModelForProvider(candidate.telegramProvider);
  }

  candidate.rememberedMainModelByProvider[candidate.provider] = candidate.mainModel;
  candidate.rememberedContextModelByProvider[candidate.contextProvider] = candidate.contextModel;
  candidate.rememberedLeaderModelByProvider[candidate.conciliumLeader.provider] = candidate.conciliumLeader.model;

  return candidate;
};

const sanitizeSystemPrompts = (value: unknown, language: AppSettings['language']): SystemPrompt[] => {
  const defaults = SYSTEM_PROMPTS_DATA[language];
  if (!Array.isArray(value)) return defaults;
  const custom = value.filter((prompt): prompt is SystemPrompt =>
    !!prompt &&
    typeof prompt.id === 'string' &&
    typeof prompt.name === 'string' &&
    typeof prompt.content === 'string' &&
    !prompt.isDefault
  );
  return [...defaults, ...custom];
};

const sanitizeQuickInsertPrompts = (value: unknown): QuickInsertPrompt[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .filter((prompt): prompt is QuickInsertPrompt =>
      !!prompt &&
      typeof prompt.id === 'string' &&
      typeof prompt.title === 'string' &&
      typeof prompt.content === 'string'
    )
    .map((prompt) => ({
      id: prompt.id,
      title: prompt.title.trim().slice(0, 40),
      content: prompt.content.trim(),
    }))
    .filter((prompt) => {
      if (!prompt.id || !prompt.title || !prompt.content) return false;
      if (seen.has(prompt.id)) return false;
      seen.add(prompt.id);
      return true;
    });
};

const sanitizeFolders = (value: unknown): Folder[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((folder): folder is Folder =>
      !!folder &&
      typeof folder.id === 'string' &&
      typeof folder.name === 'string' &&
      typeof folder.createdAt === 'number'
    )
    .map((folder) => ({
      id: folder.id,
      name: folder.name.trim().slice(0, 80) || 'Folder',
      createdAt: folder.createdAt,
    }));
};

const sanitizeConversations = (value: unknown): Conversation[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((conversation): conversation is Conversation =>
      !!conversation &&
      typeof conversation.id === 'string' &&
      typeof conversation.title === 'string' &&
      typeof conversation.updatedAt === 'number'
    )
    .map((conversation) => ({
      ...conversation,
      title: conversation.title.trim().slice(0, 120) || 'Conversation',
      snippet: typeof conversation.snippet === 'string' ? conversation.snippet : '',
      folderId: typeof conversation.folderId === 'string' ? conversation.folderId : null,
      deletedAt: typeof conversation.deletedAt === 'number' ? conversation.deletedAt : null,
      archivedAt: typeof conversation.archivedAt === 'number' ? conversation.archivedAt : null,
    }));
};

const sanitizeMessagesByConversation = (
  value: unknown,
  validConversationIds?: Set<string>,
): Record<string, Message[]> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce((acc, [conversationId, rawMessages]) => {
    if (!conversationId) return acc;
    if (validConversationIds && !validConversationIds.has(conversationId)) return acc;
    if (!Array.isArray(rawMessages)) return acc;

    const messages = rawMessages.filter((message): message is Message =>
      !!message &&
      typeof message.id === 'string' &&
      (message.role === 'user' || message.role === 'assistant' || message.role === 'system') &&
      typeof message.content === 'string' &&
      typeof message.timestamp === 'number'
    );

    acc[conversationId] = messages;
    return acc;
  }, {} as Record<string, Message[]>);
};

interface SettingsBackupPayload {
  appSettings: AppSettings;
  systemPrompts: SystemPrompt[];
  quickInsertPrompts: QuickInsertPrompt[];
  apiKeys?: Record<string, Array<{ name: string; key: string; createdAt?: number; isActive?: boolean }>>;
}

interface HistoryBackupPayload {
  conversations: Conversation[];
  folders: Folder[];
  messagesByConversation: Record<string, Message[]>;
  activeConversationId?: string;
  contextSummary?: string;
  contextSummaryConversationId?: string;
  summaryCheckpointByConversation?: Record<string, string>;
}

interface NotesBackupPayload {
  notesWorkspace: NotesWorkspaceState;
}

interface AgentsBackupPayload {
  agentWorkspace: AgentWorkspaceState;
  includesSecrets: boolean;
}

interface FullBackupPayload {
  settings: SettingsBackupPayload;
  history: HistoryBackupPayload;
  notes: NotesBackupPayload;
  agents: AgentsBackupPayload;
  includesApiKeys: boolean;
  includesAgentSecrets: boolean;
}

interface LegacyFlatFullBackupPayload {
  appSettings: AppSettings;
  systemPrompts: SystemPrompt[];
  quickInsertPrompts: QuickInsertPrompt[];
  apiKeys?: Record<string, Array<{ name: string; key: string; createdAt?: number; isActive?: boolean }>>;
  conversations: Conversation[];
  folders: Folder[];
  messagesByConversation: Record<string, Message[]>;
  activeConversationId?: string;
  contextSummary?: string;
  contextSummaryConversationId?: string;
  summaryCheckpointByConversation?: Record<string, string>;
  notesWorkspace: NotesWorkspaceState;
  agentWorkspace: AgentWorkspaceState;
  includesSecrets?: boolean;
  includesApiKeys?: boolean;
  includesAgentSecrets?: boolean;
}

interface BackupEnvelope<T> {
  app: 'optimAIzer';
  type: 'settings' | 'history' | 'notes' | 'agents' | 'full';
  version: number;
  exportedAt: number;
  payload: T;
}

const createConversationTitle = (language: AppSettings['language']): string =>
  language === 'es' ? 'Nueva conversación' : 'New conversation';

const DEFAULT_CONVERSATION_TITLES = new Set(['Nueva conversación', 'New conversation']);
const AUTO_TITLE_MAX_WORDS = 5;
const AUTO_TITLE_MAX_CHARS = 42;

const createAutoConversationTitleFromText = (text: string, language: AppSettings['language']): string => {
  const cleaned = text
    .replace(/\s+/g, ' ')
    .replace(/[`#>*_~]+/g, '')
    .trim();
  if (!cleaned) return createConversationTitle(language);

  const words = cleaned.split(' ').filter(Boolean);
  const byWords = words.slice(0, AUTO_TITLE_MAX_WORDS).join(' ');
  let candidate = byWords.slice(0, AUTO_TITLE_MAX_CHARS).trim();
  const truncated = candidate.length < cleaned.length || words.length > AUTO_TITLE_MAX_WORDS;
  candidate = candidate.replace(/[.,;:!?-]+$/, '').trim();

  if (!candidate) return createConversationTitle(language);
  if (truncated) {
    const limited = candidate.slice(0, AUTO_TITLE_MAX_CHARS - 3).trim();
    return `${limited}...`;
  }
  return candidate;
};

const trimPersonalizationText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, PERSONALIZATION_FIELD_MAX_CHARS);

const buildPersonalizationSummary = (
  personalization: AppSettings['personalization'],
  language: AppSettings['language']
): Record<string, string> => {
  const source = {
    nickname: trimPersonalizationText(personalization.nickname || ''),
    occupation: trimPersonalizationText(personalization.occupation || ''),
    familyAndFriends: trimPersonalizationText(personalization.familyAndFriends || ''),
    leisure: trimPersonalizationText(personalization.leisure || ''),
    other: trimPersonalizationText(personalization.other || ''),
  };
  const labels = language === 'es'
    ? {
        nickname: 'Apodo',
        occupation: 'Ocupación',
        familyAndFriends: 'Familia y amistades',
        leisure: 'Ocio y tiempo libre',
        other: 'Otros',
      }
    : {
        nickname: 'Nickname',
        occupation: 'Occupation',
        familyAndFriends: 'Family and friends',
        leisure: 'Leisure and free time',
        other: 'Other',
      };

  return Object.entries(source).reduce((acc, [key, value]) => {
    if (!value) return acc;
    acc[labels[key as keyof typeof labels]] = value;
    return acc;
  }, {} as Record<string, string>);
};

const DEFAULT_NOTE_AI_STYLES = [
  'Improve clarity',
  'Make formal',
  'Make casual',
  'Academic',
  'Summarize',
  'Expand',
  'Remove emoji',
];

const LEFT_SIDEBAR_DEFAULT_WIDTH = 288;
const LEFT_SIDEBAR_MIN_WIDTH = 240;
const LEFT_SIDEBAR_MAX_WIDTH = 520;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 320;
const RIGHT_SIDEBAR_MIN_WIDTH = 280;
const RIGHT_SIDEBAR_MAX_WIDTH = 640;

const NOTE_MIN_ZOOM = 70;
const NOTE_MAX_ZOOM = 180;
const NOTE_DEFAULT_TRANSLATION_LANGUAGE = 'English';
const DEFAULT_NOTE_TITLES = new Set(['New note', 'Nueva nota']);
const NOTE_AUTO_TITLE_MAX_WORDS = 6;
const NOTE_AUTO_TITLE_MAX_CHARS = 56;
const BACKUP_SCHEMA_VERSION = 1;
const CONCILIUM_MIN_MEMBERS = 2;
const CONCILIUM_MAX_MEMBERS = 7;

const createNoteTitle = (language: AppSettings['language']): string =>
  language === 'es' ? 'Nueva nota' : 'New note';

const createNoteSnippetFromContent = (content: string): string => {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return `${plain.slice(0, 120)}${plain.length > 120 ? '...' : ''}`;
};

const createAutoNoteTitleFromContent = (content: string, language: AppSettings['language']): string => {
  const cleaned = content
    .replace(/\s+/g, ' ')
    .replace(/[`#>*_~]+/g, '')
    .trim();
  if (!cleaned) return createNoteTitle(language);

  const words = cleaned.split(' ').filter(Boolean);
  const byWords = words.slice(0, NOTE_AUTO_TITLE_MAX_WORDS).join(' ');
  let candidate = byWords.slice(0, NOTE_AUTO_TITLE_MAX_CHARS).trim();
  const truncated = candidate.length < cleaned.length || words.length > NOTE_AUTO_TITLE_MAX_WORDS;
  candidate = candidate.replace(/[.,;:!?-]+$/, '').trim();

  if (!candidate) return createNoteTitle(language);
  if (truncated) {
    const limited = candidate.slice(0, NOTE_AUTO_TITLE_MAX_CHARS - 3).trim();
    return `${limited}...`;
  }
  return candidate;
};

const createFreshNote = (language: AppSettings['language']): NoteDocument => {
  const id = createUniqueId();
  const now = Date.now();
  return {
    id,
    title: createNoteTitle(language),
    content: '',
    snippet: '',
    updatedAt: now,
    folderId: null,
    archivedAt: null,
    deletedAt: null,
  };
};

const createDefaultNotesWorkspaceState = (
  language: AppSettings['language'],
  provider: string,
  model: string
): NotesWorkspaceState => {
  const firstNote = createFreshNote(language);
  return {
    notes: [firstNote],
    noteFolders: [],
    activeNoteId: firstNote.id,
    aiStyles: [...DEFAULT_NOTE_AI_STYLES],
    insertionMode: 'replace',
    translationTargetLanguage: NOTE_DEFAULT_TRANSLATION_LANGUAGE,
    readingZoom: 100,
    conciliumMembers: [{ provider, model }],
  };
};

const sanitizeNotesWorkspaceState = (
  value: unknown,
  language: AppSettings['language'],
  provider: string,
  model: string
): NotesWorkspaceState => {
  const defaults = createDefaultNotesWorkspaceState(language, provider, model);
  if (!value || typeof value !== 'object') return defaults;

  const candidate = value as Partial<NotesWorkspaceState>;
  const rawNoteFolders = Array.isArray(candidate.noteFolders) ? candidate.noteFolders : [];
  const noteFolders = rawNoteFolders
    .filter((folder): folder is Folder =>
      !!folder &&
      typeof folder.id === 'string' &&
      typeof folder.name === 'string' &&
      typeof folder.createdAt === 'number'
    )
    .map((folder) => ({
      id: folder.id,
      name: folder.name.trim().slice(0, 80) || (language === 'es' ? 'Nueva carpeta' : 'New folder'),
      createdAt: folder.createdAt,
    }));
  const noteFolderIds = new Set(noteFolders.map((folder) => folder.id));
  const rawNotes = Array.isArray(candidate.notes) ? candidate.notes : [];
  const notes = rawNotes
    .filter((note): note is NoteDocument =>
      !!note &&
      typeof note.id === 'string' &&
      typeof note.title === 'string' &&
      typeof note.content === 'string' &&
      typeof note.updatedAt === 'number'
    )
    .map((note) => ({
      id: note.id,
      title: note.title.trim().slice(0, 120) || createNoteTitle(language),
      content: note.content,
      snippet: createNoteSnippetFromContent(note.content),
      updatedAt: note.updatedAt,
      folderId:
        typeof note.folderId === 'string' && noteFolderIds.has(note.folderId)
          ? note.folderId
          : null,
      archivedAt: typeof note.archivedAt === 'number' ? note.archivedAt : null,
      deletedAt: typeof note.deletedAt === 'number' ? note.deletedAt : null,
    }));

  const safeNotes = notes.length > 0 ? notes : defaults.notes;
  const firstActive =
    safeNotes.find((note) => !note.deletedAt && !note.archivedAt) ||
    safeNotes[0];
  const activeNoteId =
    typeof candidate.activeNoteId === 'string' &&
    safeNotes.some((note) => note.id === candidate.activeNoteId)
      ? candidate.activeNoteId
      : firstActive.id;

  const candidateAiStyles = Array.isArray(candidate.aiStyles)
    ? candidate.aiStyles
      .filter((style): style is string => typeof style === 'string')
      .map((style) => style.trim())
      .filter(Boolean)
    : [];
  const knownStyleKeys = new Set(defaults.aiStyles.map((style) => style.toLowerCase()));
  const customAiStyles = candidateAiStyles.filter((style) => {
    const key = style.toLowerCase();
    if (knownStyleKeys.has(key)) return false;
    knownStyleKeys.add(key);
    return true;
  });
  const aiStyles = [...defaults.aiStyles, ...customAiStyles];

  const insertionMode: NotesWorkspaceState['insertionMode'] =
    candidate.insertionMode === 'insert_below' || candidate.insertionMode === 'replace'
      ? candidate.insertionMode
      : defaults.insertionMode;

  const translationTargetLanguage =
    typeof candidate.translationTargetLanguage === 'string' && candidate.translationTargetLanguage.trim()
      ? candidate.translationTargetLanguage.trim().slice(0, 40)
      : defaults.translationTargetLanguage;

  const readingZoom = Number.isFinite(candidate.readingZoom)
    ? Math.max(NOTE_MIN_ZOOM, Math.min(NOTE_MAX_ZOOM, Math.floor(candidate.readingZoom as number)))
    : defaults.readingZoom;

  const conciliumMembers = Array.isArray(candidate.conciliumMembers)
    ? candidate.conciliumMembers
      .filter((member): member is NotesWorkspaceState['conciliumMembers'][number] =>
        !!member &&
        typeof member.provider === 'string' &&
        typeof member.model === 'string'
      )
      .slice(0, 3)
      .map((member) => {
        const providerId = isProviderAvailable(member.provider) ? member.provider : provider;
        return {
          provider: providerId,
          model: isModelAvailableForProvider(providerId, member.model)
            ? member.model
            : getDefaultModelForProvider(providerId),
        };
      })
    : defaults.conciliumMembers;

  const safeConciliumMembers = conciliumMembers.length > 0 ? conciliumMembers : defaults.conciliumMembers;

  return {
    notes: safeNotes,
    noteFolders,
    activeNoteId,
    aiStyles,
    insertionMode,
    translationTargetLanguage,
    readingZoom,
    conciliumMembers: safeConciliumMembers,
  };
};

const App: React.FC = () => {
  const initialSettings = useMemo(() => createDefaultSettings(), []);

  // --- State ---
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const skipInitialSave = useRef(true);
  const skipInitialNotesSave = useRef(true);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(LEFT_SIDEBAR_DEFAULT_WIDTH);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(RIGHT_SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizeTarget, setSidebarResizeTarget] = useState<'left' | 'right' | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceView>('chat');

  // Data State
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, Message[]>>({});
  const [quickInsertPrompts, setQuickInsertPrompts] = useState<QuickInsertPrompt[]>([]);
  const [notesWorkspace, setNotesWorkspace] = useState<NotesWorkspaceState>(() =>
    createDefaultNotesWorkspaceState(initialSettings.language, initialSettings.provider, initialSettings.mainModel)
  );
  const [agentWorkspace, setAgentWorkspace] = useState<AgentWorkspaceState>(() =>
    createDefaultAgentWorkspaceState(initialSettings.language)
  );
  
  // AI State
  const [isTyping, setIsTyping] = useState(false);
  const [ragStatus, setRagStatus] = useState<string | null>(null);

  // Context Summary State
  const [contextSummary, setContextSummary] = useState<string>(INITIAL_CONTEXT_SUMMARY);
  const [contextSummaryConversationId, setContextSummaryConversationId] = useState<string>('');
  const [summaryCheckpointByConversation, setSummaryCheckpointByConversation] = useState<Record<string, string>>({});
  const [isSummarizing, setIsSummarizing] = useState<boolean>(false);

  // Provider availability state
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[]>([]);
  const [providerModelSyncStatus, setProviderModelSyncStatus] = useState<Record<string, ProviderModelSyncStatus>>({});
  const [providerModelSyncBusy, setProviderModelSyncBusy] = useState<Record<string, boolean>>({});
  const [modelCatalogVersion, setModelCatalogVersion] = useState(0);
  const [usageEvents, setUsageEvents] = useState<UsageCostEvent[]>([]);

  // Abort controller for cancelling streaming
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamRequestIdsRef = useRef<Set<string>>(new Set());
  const pricingResolutionInFlightRef = useRef<Map<string, Promise<{ found: boolean; inputPerMillionUsd?: number; outputPerMillionUsd?: number }>>>(new Map());
  const pricingResolutionAttemptedRef = useRef<Set<string>>(new Set());
  const sessionStartedAtRef = useRef<number>(Date.now());
  const indexedMemoryMessageIdsRef = useRef<Set<string>>(new Set());
  const hasSeededInfiniteMemoryRef = useRef(false);

  // Settings State
  const [appSettings, setAppSettings] = useState<AppSettings>(initialSettings);
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>(
    sanitizeSystemPrompts(DEFAULT_SYSTEM_PROMPTS, initialSettings.language)
  );

  // Derived state
  const activeConversation: Conversation | null =
    conversations.find((conversation) => conversation.id === activeConversationId && !conversation.deletedAt && !conversation.archivedAt) ||
    conversations.find((conversation) => !conversation.deletedAt && !conversation.archivedAt) ||
    null;
  const messages = activeConversation ? (messagesByConversation[activeConversation.id] || []) : [];
  const activeNote: NoteDocument | null =
    notesWorkspace.notes.find((note) => note.id === notesWorkspace.activeNoteId && !note.deletedAt && !note.archivedAt) ||
    notesWorkspace.notes.find((note) => !note.deletedAt && !note.archivedAt) ||
    notesWorkspace.notes[0] ||
    null;
  const conversationUsage = useMemo(() => {
    if (!activeConversation?.id) return summarizeUsage([]);
    return summarizeUsage(usageEvents.filter((event) => event.conversationId === activeConversation.id));
  }, [usageEvents, activeConversation?.id]);
  const monthlyUsage = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return summarizeUsage(usageEvents.filter((event) => event.timestamp >= monthStart));
  }, [usageEvents]);
  const agentProviderOptions = useMemo<AgentProviderOption[]>(
    () =>
      PROVIDERS
        .map((provider) => ({
          id: provider.id,
          name: provider.name,
          models: getModelsForProvider(provider.id),
        }))
        .filter((provider) => provider.models.length > 0),
    [modelCatalogVersion]
  );
  const preferredAgentProviderId = useMemo(() => {
    if (agentProviderOptions.some((provider) => provider.id === appSettings.telegramProvider)) {
      return appSettings.telegramProvider;
    }
    return agentProviderOptions[0]?.id || '';
  }, [agentProviderOptions, appSettings.telegramProvider]);
  const preferredAgentModelId = useMemo(() => {
    const provider = agentProviderOptions.find((item) => item.id === preferredAgentProviderId);
    if (!provider) return '';
    if (provider.models.some((model) => model.id === appSettings.telegramModel)) {
      return appSettings.telegramModel;
    }
    return provider.models[0]?.id || '';
  }, [agentProviderOptions, preferredAgentProviderId, appSettings.telegramModel]);
  const preferredAgentSystemPromptId = useMemo(() => {
    if (systemPrompts.some((prompt) => prompt.id === appSettings.selectedSystemPromptId)) {
      return appSettings.selectedSystemPromptId;
    }
    return '';
  }, [appSettings.selectedSystemPromptId, systemPrompts]);
  const preferredAgentTemperature = useMemo(
    () => sanitizeTemperature(appSettings.temperature, 0.25),
    [appSettings.temperature]
  );
  const preferredAgentMaxTokens = useMemo(() => {
    const numeric = Number.isFinite(appSettings.maxOutputTokens)
      ? Math.floor(appSettings.maxOutputTokens)
      : 700;
    return Math.max(128, Math.min(4096, numeric));
  }, [appSettings.maxOutputTokens]);

  const pickActiveNoteId = useCallback(
    (notes: NotesWorkspaceState['notes'], preferredId?: string): string => {
      const preferredActive =
        preferredId && notes.find((note) => note.id === preferredId && !note.deletedAt && !note.archivedAt);
      if (preferredActive) return preferredActive.id;

      const firstActive = notes.find((note) => !note.deletedAt && !note.archivedAt);
      if (firstActive) return firstActive.id;

      const firstNonDeleted = notes.find((note) => !note.deletedAt);
      if (firstNonDeleted) return firstNonDeleted.id;

      return notes[0]?.id || '';
    },
    []
  );

  const pickActiveAgentId = useCallback(
    (agents: AgentWorkspaceState['agents'], preferredId?: string): string => {
      const preferredActive =
        preferredId && agents.find((agent) => agent.id === preferredId && !agent.deletedAt && !agent.archivedAt);
      if (preferredActive) return preferredActive.id;

      const firstActive = agents.find((agent) => !agent.deletedAt && !agent.archivedAt);
      if (firstActive) return firstActive.id;

      const firstNonDeleted = agents.find((agent) => !agent.deletedAt);
      if (firstNonDeleted) return firstNonDeleted.id;

      return '';
    },
    []
  );

  const resetClientStateForAuth = useCallback(() => {
    const defaults = createDefaultSettings();
    setConversations([]);
    setFolders([]);
    setActiveConversationId('');
    setMessagesByConversation({});
    setQuickInsertPrompts([]);
    setActiveWorkspace('chat');
    setNotesWorkspace(createDefaultNotesWorkspaceState(defaults.language, defaults.provider, defaults.mainModel));
    setAgentWorkspace(createDefaultAgentWorkspaceState(defaults.language));
    setContextSummary(INITIAL_CONTEXT_SUMMARY);
    setContextSummaryConversationId('');
    setSummaryCheckpointByConversation({});
    setUsageEvents([]);
    setSystemPrompts(sanitizeSystemPrompts(DEFAULT_SYSTEM_PROMPTS, defaults.language));
    setAppSettings(defaults);
    setProviderStatuses([]);
    setProviderModelSyncStatus({});
    setProviderModelSyncBusy({});
    sessionStartedAtRef.current = Date.now();
    skipInitialSave.current = true;
    skipInitialNotesSave.current = true;
    clearAllDocStores();
    resetVectorStore();
    indexedMemoryMessageIdsRef.current.clear();
    hasSeededInfiniteMemoryRef.current = false;
    pricingResolutionInFlightRef.current.clear();
    pricingResolutionAttemptedRef.current.clear();
  }, []);

  // --- Effects ---

  // Resolve existing authenticated session on app boot.
  useEffect(() => {
    let cancelled = false;

    getCurrentUser()
      .then((user) => {
        if (cancelled) return;
        if (!user) {
          resetClientStateForAuth();
          setIsDataLoaded(false);
        }
        setAuthUser(user);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('Could not resolve current session:', error);
          setAuthUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);
  
  // Responsive sidebar
  useEffect(() => {
    if (window.innerWidth < 1024) {
      setLeftSidebarOpen(false);
      setRightSidebarOpen(false);
    }
  }, []);

  const startSidebarResize = useCallback((target: 'left' | 'right') => {
    if (window.innerWidth < 1024) return;
    setSidebarResizeTarget(target);
  }, []);

  useEffect(() => {
    if (!sidebarResizeTarget) return;

    const handleMouseMove = (event: MouseEvent) => {
      if (sidebarResizeTarget === 'left') {
        const nextWidth = Math.max(
          LEFT_SIDEBAR_MIN_WIDTH,
          Math.min(LEFT_SIDEBAR_MAX_WIDTH, event.clientX)
        );
        setLeftSidebarWidth(nextWidth);
        return;
      }

      const distanceFromRight = window.innerWidth - event.clientX;
      const nextWidth = Math.max(
        RIGHT_SIDEBAR_MIN_WIDTH,
        Math.min(RIGHT_SIDEBAR_MAX_WIDTH, distanceFromRight)
      );
      setRightSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setSidebarResizeTarget(null);
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [sidebarResizeTarget]);

  // Load persisted state from server (SQLite)
  useEffect(() => {
    if (!authUser) {
      setIsDataLoaded(false);
      skipInitialNotesSave.current = true;
      return;
    }

    let cancelled = false;
    setIsDataLoaded(false);
    skipInitialNotesSave.current = true;

    fetchServerState()
      .then((state) => {
        if (cancelled || !state || typeof state !== 'object') {
          setIsDataLoaded(true);
          return;
        }

        const loadedSettings = sanitizeSettings(state.appSettings);
        const loadedConversations = (Array.isArray(state.conversations) ? state.conversations : [])
          .filter((c: any) => !LEGACY_PLACEHOLDER_CONVERSATION_IDS.has(c.id))
          .map((c: any) => ({
            ...c,
            folderId: c.folderId ?? null,
            deletedAt: typeof c.deletedAt === 'number' ? c.deletedAt : null,
            archivedAt: typeof c.archivedAt === 'number' ? c.archivedAt : null,
          }));
        const loadedFolders = (Array.isArray(state.folders) ? state.folders : [])
          .filter((f: any) => !LEGACY_PLACEHOLDER_FOLDER_IDS.has(f.id));
        const rawMessages = state.messagesByConversation && typeof state.messagesByConversation === 'object'
          ? state.messagesByConversation as Record<string, Message[]>
          : {};
        const filteredRawMessages = Object.fromEntries(
          Object.entries(rawMessages).filter(([id]) => !LEGACY_PLACEHOLDER_CONVERSATION_IDS.has(id))
        );
        const loadedMessages = sanitizeMessagesByConversation(filteredRawMessages);
        const loadedActiveId = typeof state.activeConversationId === 'string'
          ? (LEGACY_PLACEHOLDER_CONVERSATION_IDS.has(state.activeConversationId) ? '' : state.activeConversationId)
          : '';
        const loadedSystemPrompts = sanitizeSystemPrompts(state.systemPrompts, loadedSettings.language);
        const loadedQuickInsertPrompts = sanitizeQuickInsertPrompts(state.quickInsertPrompts);
        const loadedNotesWorkspace = sanitizeNotesWorkspaceState(
          state.notesWorkspace,
          loadedSettings.language,
          loadedSettings.provider,
          loadedSettings.mainModel
        );
        const loadedAgentWorkspace = sanitizeAgentWorkspaceState(state.agentWorkspace, loadedSettings.language);
        const loadedContextSummary = typeof state.contextSummary === 'string' ? state.contextSummary : INITIAL_CONTEXT_SUMMARY;
        const loadedSummaryCheckpointByConversation = sanitizeSummaryCheckpointByConversation(state.summaryCheckpointByConversation);
        const validConversationIds = new Set(loadedConversations.map((conversation: Conversation) => conversation.id));
        const filteredSummaryCheckpointByConversation = Object.fromEntries(
          Object.entries(loadedSummaryCheckpointByConversation).filter(([conversationId]) => validConversationIds.has(conversationId))
        );
        const fallbackConversationId = loadedActiveId || loadedConversations.find((conversation: Conversation) => !conversation.deletedAt && !conversation.archivedAt)?.id || '';
        const loadedContextSummaryConversationId =
          typeof state.contextSummaryConversationId === 'string' && state.contextSummaryConversationId.trim()
            ? state.contextSummaryConversationId
            : fallbackConversationId;
        const loadedUsageEvents = sanitizeStoredUsageEvents(state.usageEvents);
        const migratedUsage = migrateLegacyUsageEventsByConversation(loadedUsageEvents, loadedMessages);

        setAppSettings(loadedSettings);
        setConversations(loadedConversations);
        setFolders(loadedFolders);
        setMessagesByConversation(loadedMessages);
        setActiveConversationId(loadedActiveId || loadedConversations.find((c: any) => !c.deletedAt && !c.archivedAt)?.id || '');
        setSystemPrompts(loadedSystemPrompts);
        setQuickInsertPrompts(loadedQuickInsertPrompts);
        setActiveWorkspace(resolveStartupWorkspace(state.activeWorkspace));
        setNotesWorkspace(loadedNotesWorkspace);
        setAgentWorkspace(loadedAgentWorkspace);
        setContextSummary(loadedContextSummary);
        setContextSummaryConversationId(loadedContextSummaryConversationId);
        setSummaryCheckpointByConversation(filteredSummaryCheckpointByConversation);
        setUsageEvents(migratedUsage.events);

        if (migratedUsage.migratedCount > 0) {
          saveServerStateKey('usageEvents', migratedUsage.events.slice(-MAX_STORED_USAGE_EVENTS)).catch((error) =>
            console.warn('Could not persist migrated usage events:', error)
          );
        }

        setIsDataLoaded(true);
      })
      .catch((err) => {
        console.warn('Could not load state from server:', err);
        setIsDataLoaded(true);
      });

    return () => { cancelled = true; };
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser) return;
    if (!isDataLoaded) return;
    if (skipInitialNotesSave.current) {
      skipInitialNotesSave.current = false;
      return;
    }
    saveServerStateKey('notesWorkspace', notesWorkspace).catch((err) =>
      console.warn('Failed to persist notes workspace:', err)
    );
  }, [authUser?.id, isDataLoaded, notesWorkspace]);

  // Auto-save notes on browser close / refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (authUser && isDataLoaded && activeWorkspace === 'notes') {
        saveServerStateKey('notesWorkspace', notesWorkspace).catch(() => {});
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [authUser, isDataLoaded, activeWorkspace, notesWorkspace]);

  const refreshProviderModels = useCallback(async (providerId: string, forceRefresh = false): Promise<void> => {
    setProviderModelSyncBusy((prev) => ({ ...prev, [providerId]: true }));
    try {
      const result = await getProviderModels(providerId, { refresh: forceRefresh });
      const models = result.models || [];
      setRuntimeModelsForProvider(providerId, models);
      syncRuntimeModelPricingForProvider(providerId, models);
      setProviderModelSyncStatus((prev) => ({
        ...prev,
        [providerId]: {
          source: result.source,
          fetchedAt: result.fetchedAt,
          error: result.error,
        },
      }));
    } catch (err: any) {
      setProviderModelSyncStatus((prev) => ({
        ...prev,
        [providerId]: {
          source: 'fallback',
          fetchedAt: Date.now(),
          error: err?.message || 'Could not fetch models.',
        },
      }));
    } finally {
      setProviderModelSyncBusy((prev) => ({ ...prev, [providerId]: false }));
      setModelCatalogVersion((prev) => prev + 1);
    }
  }, []);

  const loadAllProviderModels = (forceRefresh = false) => {
    PROVIDERS.forEach((provider) => {
      void refreshProviderModels(provider.id, forceRefresh);
    });
  };

  // Refresh provider statuses (called after key changes)
  const refreshProviders = () => {
    if (!authUser) return;
    getProviders()
      .then(setProviderStatuses)
      .catch(err => console.warn('Could not refresh providers:', err));
    loadAllProviderModels(true);
  };

  // Load provider statuses + models after authentication.
  useEffect(() => {
    if (!authUser) return;
    getProviders()
      .then(setProviderStatuses)
      .catch(err => console.warn('Could not fetch provider statuses:', err));
    loadAllProviderModels(false);
  }, [authUser?.id]);

  // Keep live model pricing updated for providers that expose it via models API.
  useEffect(() => {
    if (!authUser) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      RUNTIME_PRICING_PROVIDER_IDS.forEach((providerId) => {
        void refreshProviderModels(providerId, true);
      });
    }, RUNTIME_PRICING_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [authUser?.id, refreshProviderModels]);

  // Persist application state to server (debounced)
  useEffect(() => {
    if (!authUser) return;
    if (!isDataLoaded) return;
    if (skipInitialSave.current) {
      skipInitialSave.current = false;
      return;
    }

    const timer = setTimeout(() => {
      saveServerState({
        conversations,
        folders,
        activeConversationId,
        messagesByConversation,
        appSettings,
        systemPrompts,
        quickInsertPrompts,
        activeWorkspace,
        agentWorkspace,
        contextSummary,
        contextSummaryConversationId,
        summaryCheckpointByConversation,
        usageEvents: usageEvents.slice(-MAX_STORED_USAGE_EVENTS),
      }).catch((err) => console.warn('Failed to persist state to server:', err));
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    authUser?.id,
    isDataLoaded,
    conversations,
    folders,
    activeConversationId,
    messagesByConversation,
    appSettings,
    systemPrompts,
    quickInsertPrompts,
    activeWorkspace,
    agentWorkspace,
    contextSummary,
    contextSummaryConversationId,
    summaryCheckpointByConversation,
    usageEvents,
  ]);

  const getActiveProviderApiKeyMeta = (provider: string): {
    apiKeyId?: string;
    apiKeyName?: string;
    apiKeyMasked?: string;
  } => {
    const status = providerStatuses.find((candidate) => candidate.id === provider);
    if (!status || !status.activeKeyId) return {};
    return {
      apiKeyId: status.activeKeyId,
      apiKeyName: status.activeKeyName || undefined,
      apiKeyMasked: status.activeKeyMasked || undefined,
    };
  };

  const appendUsageEvent = (event: UsageCostEvent) => {
    setUsageEvents((prev) => [...prev.slice(-(MAX_STORED_USAGE_EVENTS - 1)), event]);
  };

  const getPricingKey = (providerId: string, modelId: string): string => `${providerId}:${modelId}`;

  const resolveMissingPricingForModel = useCallback(async (
    providerId: string,
    modelId: string
  ): Promise<{ found: boolean; inputPerMillionUsd?: number; outputPerMillionUsd?: number }> => {
    if (getModelPricing(providerId, modelId)) {
      return { found: true };
    }

    const key = getPricingKey(providerId, modelId);
    if (pricingResolutionAttemptedRef.current.has(key)) {
      return { found: false };
    }

    const inFlight = pricingResolutionInFlightRef.current.get(key);
    if (inFlight) {
      return inFlight;
    }

    const lookupPromise = (async () => {
      try {
        const pricing = await resolveProviderModelPricing(providerId, modelId);
        const inputPerMillionUsd = Number(pricing.inputPerMillionUsd);
        const outputPerMillionUsd = Number(pricing.outputPerMillionUsd);
        if (!Number.isFinite(inputPerMillionUsd) || inputPerMillionUsd < 0) {
          return { found: false };
        }
        if (!Number.isFinite(outputPerMillionUsd) || outputPerMillionUsd < 0) {
          return { found: false };
        }
        return {
          found: true,
          inputPerMillionUsd,
          outputPerMillionUsd,
        };
      } catch {
        return { found: false };
      } finally {
        pricingResolutionAttemptedRef.current.add(key);
        pricingResolutionInFlightRef.current.delete(key);
      }
    })();

    pricingResolutionInFlightRef.current.set(key, lookupPromise);
    return lookupPromise;
  }, []);

  const startUsageEvent = (params: {
    provider: string;
    model: string;
    conversationId?: string;
    apiKeyId?: string;
    apiKeyName?: string;
    apiKeyMasked?: string;
    inputTokens: number;
    tooling?: AppSettings['tooling'];
    source: UsageCostEvent['source'];
  }): string => {
    const event = buildUsageCostEvent({
      provider: params.provider,
      model: params.model,
      conversationId: params.conversationId,
      apiKeyId: params.apiKeyId,
      apiKeyName: params.apiKeyName,
      apiKeyMasked: params.apiKeyMasked,
      inputTokens: params.inputTokens,
      outputTokens: 0,
      tooling: params.tooling,
      source: params.source,
    });
    appendUsageEvent(event);
    return event.id;
  };

  const updateUsageEventOutput = (eventId: string, outputTokens: number) => {
    setUsageEvents((prev) => {
      const index = prev.findIndex((event) => event.id === eventId);
      if (index === -1) return prev;

      const current = prev[index];
      const nextOutputTokens = Math.max(0, Math.round(outputTokens));
      const cost = estimateCostUsd(
        current.provider,
        current.model,
        current.inputTokens,
        nextOutputTokens,
        {
          webSearch: current.toolWebSearchEnabled,
          codeExecution: current.toolCodeExecutionEnabled,
        }
      );

      const updated: UsageCostEvent = {
        ...current,
        outputTokens: nextOutputTokens,
        inputCostUsd: cost.inputCostUsd,
        outputCostUsd: cost.outputCostUsd,
        totalCostUsd: cost.totalCostUsd,
        toolingCostUsd: cost.toolingCostUsd,
      };

      const next = [...prev];
      next[index] = updated;
      return next;
    });
  };

  const removeUsageEvent = (eventId: string) => {
    setUsageEvents((prev) => prev.filter((event) => event.id !== eventId));
  };

  const updateConversationMessages = (
    conversationId: string,
    updater: (current: Message[]) => Message[]
  ) => {
    setMessagesByConversation((prev) => {
      const current = prev[conversationId] || [];
      return { ...prev, [conversationId]: updater(current) };
    });
  };

  const setConversationMessages = (conversationId: string, nextMessages: Message[]) => {
    setMessagesByConversation((prev) => ({ ...prev, [conversationId]: nextMessages }));
  };

  const removeConversationMessages = (conversationIds: string[]) => {
    if (conversationIds.length === 0) return;
    setMessagesByConversation((prev) => {
      const next = { ...prev };
      conversationIds.forEach((conversationId) => {
        delete next[conversationId];
      });
      return next;
    });
  };

  const updateConversationPreview = (conversationId: string, latestContent?: string) => {
    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversation.id !== conversationId) return conversation;
        const snippet =
          typeof latestContent === 'string'
            ? `${latestContent.slice(0, 80)}${latestContent.length > 80 ? '...' : ''}`
            : conversation.snippet;
        return {
          ...conversation,
          snippet,
          updatedAt: Date.now(),
        };
      })
    );
  };

  const createFreshConversation = (language: AppSettings['language']) => {
    const id = createUniqueId();
    return {
      conversation: {
        id,
        title: createConversationTitle(language),
        updatedAt: Date.now(),
        snippet: '',
        folderId: null,
        archivedAt: null,
      } as Conversation,
      messages: createWelcomeMessages(),
    };
  };

  const cancelOngoingRequest = () => {
    const activeRequestIds = [...streamRequestIdsRef.current];
    streamRequestIdsRef.current.clear();
    activeRequestIds.forEach((requestId) => {
      void cancelStreamingRequest(requestId);
    });
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
    setRagStatus(null);
    setIsSummarizing(false);
  };

  // Handle Theme Mode (Dark/Light)
  useEffect(() => {
    const root = window.document.documentElement;
    if (appSettings.themeMode === 'dark') {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
  }, [appSettings.themeMode]);

  // Handle Theme Color
  useEffect(() => {
    const theme = THEME_COLORS.find(c => c.id === appSettings.themeColor) || THEME_COLORS[0];
    const root = window.document.documentElement;
    root.style.setProperty('--color-primary', theme.rgb);
    root.style.setProperty('--color-primary-hover', theme.hoverRgb);
  }, [appSettings.themeColor]);

  // Handle Language Change
  useEffect(() => {
    const newDefaults = SYSTEM_PROMPTS_DATA[appSettings.language];
    setSystemPrompts(prevPrompts => {
        const customPrompts = prevPrompts.filter(p => !p.isDefault);
        const currentSelectedStillExists = [...newDefaults, ...customPrompts].find(p => p.id === appSettings.selectedSystemPromptId);
        if (!currentSelectedStillExists) {
             setAppSettings(prev => ({ ...prev, selectedSystemPromptId: 'default' }));
        }
        return [...newDefaults, ...customPrompts];
    });
  }, [appSettings.language]);

  useEffect(() => {
    PROVIDERS.forEach((provider) => {
      const providerId = provider.id;
      const allModels = getAllModelsForProvider(providerId);
      const filters = appSettings.modelFiltersByProvider?.[providerId] || createDefaultProviderModelFilter();
      const pinnedSet = new Set(filters.pinnedModelIds);
      const vendorSet = new Set(filters.vendorAllowlist.map((vendor) => vendor.toLowerCase()));
      let visibleIds = allModels.map((model) => model.id);

      if (filters.mode === 'pinned') {
        visibleIds = allModels.filter((model) => pinnedSet.has(model.id)).map((model) => model.id);
      } else if (filters.mode === 'vendor' && providerSupportsVendorFilter(providerId)) {
        visibleIds = allModels
          .filter((model) => {
            const vendorName = inferModelVendor(providerId, model).toLowerCase();
            return vendorSet.has(vendorName) || pinnedSet.has(model.id);
          })
          .map((model) => model.id);
      }

      const userAllowlist = authUser?.modelAllowlistByProvider?.[providerId];
      if (Array.isArray(userAllowlist)) {
        const userAllowedSet = new Set(userAllowlist);
        visibleIds = visibleIds.filter((modelId) => userAllowedSet.has(modelId));
      }

      if (visibleIds.length === allModels.length && !Array.isArray(authUser?.modelAllowlistByProvider?.[providerId])) {
        setVisibleModelFilterForProvider(providerId, null);
      } else {
        setVisibleModelFilterForProvider(providerId, visibleIds);
      }
    });

    setModelCatalogVersion((prev) => prev + 1);
  }, [appSettings.modelFiltersByProvider, authUser, providerModelSyncStatus]);

  useEffect(() => {
    syncManualModelPricingOverrides(appSettings.manualModelPricingByProviderModelKey || {});
  }, [appSettings.manualModelPricingByProviderModelKey]);

  useEffect(() => {
    // Only validate models for providers that have finished syncing their model catalog.
    // This prevents premature fallbacks before runtime models are loaded.
    const isSynced = (providerId: string) => !!providerModelSyncStatus[providerId];

    setAppSettings((prev) => {
      const next = {
        ...prev,
        rememberedMainModelByProvider: { ...(prev.rememberedMainModelByProvider || {}) },
        rememberedContextModelByProvider: { ...(prev.rememberedContextModelByProvider || {}) },
        rememberedLeaderModelByProvider: { ...(prev.rememberedLeaderModelByProvider || {}) },
      };
      let changed = false;

      if (isSynced(next.provider) && !isModelAvailableForProvider(next.provider, next.mainModel)) {
        const remembered = next.rememberedMainModelByProvider[next.provider];
        const fallback = remembered && isModelAvailableForProvider(next.provider, remembered)
          ? remembered
          : getDefaultModelForProvider(next.provider);
        if (fallback !== next.mainModel) {
          next.mainModel = fallback;
          changed = true;
        }
      }

      if (isSynced(next.contextProvider) && !isModelAvailableForProvider(next.contextProvider, next.contextModel)) {
        const remembered = next.rememberedContextModelByProvider[next.contextProvider];
        const fallback = remembered && isModelAvailableForProvider(next.contextProvider, remembered)
          ? remembered
          : getDefaultModelForProvider(next.contextProvider);
        if (fallback !== next.contextModel) {
          next.contextModel = fallback;
          changed = true;
        }
      }

      if (isSynced(next.telegramProvider) && !isModelAvailableForProvider(next.telegramProvider, next.telegramModel)) {
        const fallback = getDefaultModelForProvider(next.telegramProvider);
        if (fallback !== next.telegramModel) {
          next.telegramModel = fallback;
          changed = true;
        }
      }

      if (isSynced(next.conciliumLeader.provider) && !isModelAvailableForProvider(next.conciliumLeader.provider, next.conciliumLeader.model)) {
        const remembered = next.rememberedLeaderModelByProvider[next.conciliumLeader.provider];
        const fallback = remembered && isModelAvailableForProvider(next.conciliumLeader.provider, remembered)
          ? remembered
          : getDefaultModelForProvider(next.conciliumLeader.provider);
        if (fallback !== next.conciliumLeader.model) {
          next.conciliumLeader = { ...next.conciliumLeader, model: fallback };
          changed = true;
        }
      }

      const nextMembers = next.conciliumMembers.map((member) => {
        if (!isSynced(member.provider)) return member;
        if (isModelAvailableForProvider(member.provider, member.model)) return member;
        changed = true;
        return {
          provider: member.provider,
          model: getDefaultModelForProvider(member.provider),
        };
      });
      next.conciliumMembers = nextMembers;

      const nextArenaMembers = next.arenaMembers.map((member) => {
        if (!isSynced(member.provider)) return member;
        if (isModelAvailableForProvider(member.provider, member.model)) return member;
        changed = true;
        return {
          provider: member.provider,
          model: getDefaultModelForProvider(member.provider),
        };
      }) as AppSettings['arenaMembers'];
      next.arenaMembers = nextArenaMembers;

      if (!supportsReasoningEffort(next.provider, next.mainModel) && next.reasoningEffort !== 'none') {
        next.reasoningEffort = 'none';
        changed = true;
      }

      if (next.enableArena && next.enableConcilium) {
        next.enableConcilium = false;
        changed = true;
      }

      if (next.rememberedMainModelByProvider[next.provider] !== next.mainModel) {
        next.rememberedMainModelByProvider[next.provider] = next.mainModel;
        changed = true;
      }
      if (next.rememberedContextModelByProvider[next.contextProvider] !== next.contextModel) {
        next.rememberedContextModelByProvider[next.contextProvider] = next.contextModel;
        changed = true;
      }
      if (next.rememberedLeaderModelByProvider[next.conciliumLeader.provider] !== next.conciliumLeader.model) {
        next.rememberedLeaderModelByProvider[next.conciliumLeader.provider] = next.conciliumLeader.model;
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [providerModelSyncStatus, appSettings.modelFiltersByProvider]);

  useEffect(() => {
    const activeExists = conversations.some(
      (conversation) => conversation.id === activeConversationId && !conversation.deletedAt && !conversation.archivedAt
    );
    if (activeExists) return;

    const firstActive = conversations.find((conversation) => !conversation.deletedAt && !conversation.archivedAt);
    if (firstActive) {
      setActiveConversationId(firstActive.id);
      return;
    }

    if (activeConversationId !== '') {
      setActiveConversationId('');
    }
  }, [conversations, activeConversationId]);

  useEffect(() => {
    const nextActiveId = pickActiveNoteId(notesWorkspace.notes, notesWorkspace.activeNoteId);
    if (nextActiveId === notesWorkspace.activeNoteId) return;
    setNotesWorkspace((prev) => ({ ...prev, activeNoteId: nextActiveId }));
  }, [notesWorkspace.notes, notesWorkspace.activeNoteId, pickActiveNoteId]);

  useEffect(() => {
    const nextActiveId = pickActiveAgentId(agentWorkspace.agents, agentWorkspace.activeAgentId);
    if (nextActiveId === agentWorkspace.activeAgentId) return;
    setAgentWorkspace((prev) => ({ ...prev, activeAgentId: nextActiveId }));
  }, [agentWorkspace.agents, agentWorkspace.activeAgentId, pickActiveAgentId]);


  // --- Logic Handlers ---

  const buildConciliumSynthesisPrompt = (
    results: Array<{ content: string }>,
    mode: ConciliumMode,
    blindEval: boolean
  ) => {
    const responseBlocks = results
      .map((result, index) => `--- ${getConciliumResponseLabel(index, blindEval)} ---\n${result.content}`)
      .join('\n\n');
    const modeLabel = mode.toUpperCase();
    const taskInstruction = getConciliumModeTaskInstructions(mode);

    return `You are the leader of a multi-model council. The responses below are intentionally anonymized.

Mode: ${modeLabel}
Responses received: ${results.length}

${responseBlocks}

--- Your Task ---
${taskInstruction}

Rules:
- Never infer or mention model/provider identity.
- Reference responses only by their response labels.
- Synthesize a clear final answer for the user.`;
  };

  const handleSendMessage = async (text: string, quote?: Quote, attachments?: MessageAttachment[]) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;

    cancelOngoingRequest();
    const abortController = new AbortController();
    const streamRequestId = createStreamingRequestId();
    abortControllerRef.current = abortController;
    streamRequestIdsRef.current.add(streamRequestId);

    let activeConversationForSend = activeConversation?.id;
    let currentMessages: Message[] = [];

    if (!activeConversationForSend) {
      const { conversation, messages: freshMessages } = createFreshConversation(appSettings.language);
      setConversations((prev) => [conversation, ...prev]);
      setConversationMessages(conversation.id, freshMessages);
      setActiveConversationId(conversation.id);
      activeConversationForSend = conversation.id;
      currentMessages = freshMessages;
    } else {
      currentMessages = messagesByConversation[activeConversationForSend] || [];
    }

    const clearStreamingStateIfCurrent = () => {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
      streamRequestIdsRef.current.delete(streamRequestId);
    };

    const newUserMsg: Message = {
      id: createUniqueId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      quote,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    };
    const hadUserMessagesBeforeSend = currentMessages.some((message) => message.role === 'user');

    updateConversationMessages(activeConversationForSend, (prev) => [...prev, newUserMsg]);
    updateConversationPreview(activeConversationForSend, text);
    if (!hadUserMessagesBeforeSend) {
      const autoTitle = createAutoConversationTitleFromText(text, appSettings.language);
      setConversations((prev) =>
        prev.map((conversation) => {
          if (conversation.id !== activeConversationForSend) return conversation;
          if (!DEFAULT_CONVERSATION_TITLES.has(conversation.title)) return conversation;
          return {
            ...conversation,
            title: autoTitle,
          };
        })
      );
    }
    const pricingTargets = appSettings.enableConcilium
      ? [
          ...appSettings.conciliumMembers.map((member) => ({ provider: member.provider, model: member.model })),
          { provider: appSettings.conciliumLeader.provider, model: appSettings.conciliumLeader.model },
        ]
      : appSettings.enableArena
        ? appSettings.arenaMembers.map((member) => ({ provider: member.provider, model: member.model }))
        : [{ provider: appSettings.provider, model: appSettings.mainModel }];

    const missingPricingTargets = Array.from(
      new Map(
        pricingTargets
          .filter((target) => !getModelPricing(target.provider, target.model))
          .map((target) => [getPricingKey(target.provider, target.model), target])
      ).values()
    );

    if (missingPricingTargets.length > 0) {
      setRagStatus('Esperando al precio del modelo según el proveedor');
      try {
        const resolutionResults = await Promise.all(
          missingPricingTargets.map((target) => resolveMissingPricingForModel(target.provider, target.model))
        );

        const resolvedOverrides: AppSettings['manualModelPricingByProviderModelKey'] = {};
        const unresolvedTargets: Array<{ provider: string; model: string }> = [];

        resolutionResults.forEach((result, index) => {
          const target = missingPricingTargets[index];
          if (!target) return;
          if (
            result.found &&
            Number.isFinite(result.inputPerMillionUsd) &&
            Number.isFinite(result.outputPerMillionUsd)
          ) {
            resolvedOverrides[getPricingKey(target.provider, target.model)] = {
              inputPerMillionUsd: Math.max(0, Number(result.inputPerMillionUsd)),
              outputPerMillionUsd: Math.max(0, Number(result.outputPerMillionUsd)),
            };
            return;
          }

          unresolvedTargets.push(target);
        });

        if (Object.keys(resolvedOverrides).length > 0) {
          const mergedOverrides = {
            ...(appSettings.manualModelPricingByProviderModelKey || {}),
            ...resolvedOverrides,
          };
          syncManualModelPricingOverrides(mergedOverrides);
          setAppSettings((prev) => ({
            ...prev,
            manualModelPricingByProviderModelKey: {
              ...(prev.manualModelPricingByProviderModelKey || {}),
              ...resolvedOverrides,
            },
          }));
        }

        if (unresolvedTargets.length > 0) {
          const fallbackNotice = appSettings.language === 'es'
            ? 'No se pudo obtener el precio del modelo automáticamente. Debes introducirlo manualmente desde este modal o desde la sección de Ajustes.'
            : 'The model pricing could not be retrieved automatically. Please enter it manually from this modal or from Settings.';

          updateConversationMessages(activeConversationForSend, (prev) => [
            ...prev,
            {
              id: createUniqueId(),
              role: 'assistant',
              content: fallbackNotice,
              timestamp: Date.now(),
            },
          ]);
        }
      } finally {
        setRagStatus(null);
      }
    }

    setIsTyping(true);

    const allMessages = [...currentMessages, newUserMsg];

    // --- Document RAG: index any new text/pdf attachments ---
    if (attachments && attachments.length > 0) {
      const docStore = getConversationDocStore(activeConversationForSend);
      for (const att of attachments) {
        if ((att.type === 'text' || att.type === 'pdf') && att.textContent) {
          docStore.indexDocument(att.fileName, att.textContent);
        }
      }
    }
    // Ensure any previously-attached documents in this conversation are indexed
    reindexConversationAttachments(activeConversationForSend, allMessages);

    const contextWindowLimit = Math.max(1, Math.floor(appSettings.maxContextMessages || 1));
    const hasSummaryForContext =
      appSettings.enableSummary &&
      appSettings.enableContext &&
      contextSummary.trim() &&
      contextSummary !== INITIAL_CONTEXT_SUMMARY &&
      contextSummaryConversationId === activeConversationForSend;
    const effectiveContextWindow = hasSummaryForContext
      ? Math.max(1, Math.floor(contextWindowLimit / 2))
      : contextWindowLimit;

    const contextWindowMessages = (appSettings.enableContext
      ? allMessages.slice(-effectiveContextWindow)
      : [newUserMsg]
    ).map((message) => ({ role: message.role as 'user' | 'assistant' | 'system', content: message.content }));

    const summarySourceRawMessages = (appSettings.enableContext
      ? allMessages.slice(-contextWindowLimit)
      : [newUserMsg]);

    let infiniteMemoryPrompt: string | null = null;
    if (appSettings.enableInfiniteMemory && text.trim().length >= 3) {
      setRagStatus(appSettings.language === 'es' ? 'Buscando en memoria infinita...' : 'Searching infinite memory...');

      try {
        const store = getVectorStore();

        const conversationsToIndex: Array<{ id: string; title: string; deletedAt?: number | null }> = (
          hasSeededInfiniteMemoryRef.current
            ? conversations.filter((conversation) => conversation.id === activeConversationForSend)
            : conversations.filter((conversation) => !conversation.deletedAt)
        ).map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          deletedAt: conversation.deletedAt,
        }));

        if (!conversationsToIndex.some((conversation) => conversation.id === activeConversationForSend)) {
          const activeConversationMeta = conversations.find((conversation) => conversation.id === activeConversationForSend);
          conversationsToIndex.push(
            activeConversationMeta || {
              id: activeConversationForSend,
              title: appSettings.language === 'es' ? 'Conversación' : 'Conversation',
              deletedAt: null,
            }
          );
        }

        for (const conversation of conversationsToIndex) {
          if (conversation.deletedAt) continue;
          const convMessages = conversation.id === activeConversationForSend
            ? allMessages
            : (messagesByConversation[conversation.id] || []);
          for (const msg of convMessages) {
            if (msg.role === 'system' || !msg.content.trim()) continue;
            const docId = `${conversation.id}::${msg.id}`;
            if (indexedMemoryMessageIdsRef.current.has(docId)) continue;
            indexedMemoryMessageIdsRef.current.add(docId);
            store.addDocument({
              id: docId,
              conversationId: conversation.id,
              conversationTitle: conversation.title,
              content: msg.content,
              timestamp: msg.timestamp,
              role: msg.role,
            });
          }
        }
        hasSeededInfiniteMemoryRef.current = true;

        // Search the store (exclude current conversation)
        const allResults = store.search(text, MAX_INFINITE_MEMORY_HITS * 3, 0.05);
        const filteredResults = allResults
          .filter((r) => r.document.conversationId !== activeConversationForSend)
          .slice(0, MAX_INFINITE_MEMORY_HITS);

        if (filteredResults.length > 0) {
          const header = appSettings.language === 'es'
            ? 'Memoria relevante de conversaciones anteriores (úsala solo si aplica):'
            : 'Relevant memory from previous conversations (use only if applicable):';
          const lines = filteredResults.map((hit) => {
            const snippet = hit.document.content.slice(0, MEMORY_SNIPPET_MAX_CHARS);
            const suffix = hit.document.content.length > MEMORY_SNIPPET_MAX_CHARS ? '...' : '';
            return `- [${hit.document.conversationTitle}] (score: ${hit.score.toFixed(2)}) ${snippet}${suffix}`;
          });
          infiniteMemoryPrompt = `${header}\n${lines.join('\n')}`;
          setRagStatus(
            appSettings.language === 'es'
              ? `Memoria encontrada (${filteredResults.length})`
              : `Memory found (${filteredResults.length})`,
          );
        }
      } catch (err) {
        console.error('[RAG] Vector search error:', err);
      }
      setRagStatus(null);
    }

    const contextMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [];
    const locationLabel = trimPersonalizationText(appSettings.locationLabel || '');
    if (!hadUserMessagesBeforeSend) {
      const now = new Date();
      const locale = appSettings.language === 'es' ? 'es-ES' : 'en-US';
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const profileSummary = buildPersonalizationSummary(appSettings.personalization, appSettings.language);
      const personalizationSummary = Object.keys(profileSummary).length > 0 ? profileSummary : undefined;
      const sessionContextPayload = {
        session: {
          generatedAtIso: now.toISOString(),
          currentDate: now.toLocaleDateString(locale, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          currentTime: now.toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          timezone,
          locale,
        },
        user: {
          displayName: appSettings.userName || 'User',
          personalizationSummary,
        },
      };
      const compactSessionContextPayload =
        (compactJsonValue(sessionContextPayload) as Record<string, unknown> | undefined) || {};
      contextMessages.push({
        role: 'system',
        content: `${
          appSettings.language === 'es'
            ? 'Contexto inicial de sesión (JSON):'
            : 'Initial session context (JSON):'
        }\n${JSON.stringify(compactSessionContextPayload)}`,
      });
    }
    if (hasSummaryForContext) {
    if (appSettings.includeLocationInContext && locationLabel) {
      contextMessages.push({
        role: 'system',
        content:
          appSettings.language === 'es'
            ? `Ubicación actual del usuario (usar si aplica): ${locationLabel}`
            : `Current user location (use if relevant): ${locationLabel}`,
      });
    }
      contextMessages.push({
        role: 'system',
        content:
          appSettings.language === 'es'
            ? `Resumen de contexto previo (prioriza esto para ahorrar tokens):\n${contextSummary}`
            : `Previous context summary (prioritize this to save tokens):\n${contextSummary}`,
      });
    }
    if (infiniteMemoryPrompt) {
      contextMessages.push({ role: 'system', content: infiniteMemoryPrompt });
    }

    // --- Document RAG: retrieve relevant document chunks ---
    const docStore = getConversationDocStore(activeConversationForSend);
    if (docStore.hasDocuments) {
      const userQueryText = newUserMsg.content || '';
      const relevantContext = docStore.getRelevantContext(userQueryText);
      if (relevantContext.trim()) {
        const docHeader = appSettings.language === 'es'
          ? 'Contenido relevante de los documentos adjuntos (úsalo para responder):'
          : 'Relevant content from attached documents (use this to answer):';
        contextMessages.push({
          role: 'system',
          content: `${docHeader}\n\n${relevantContext}`,
        });
      }
    }

    contextMessages.push(...contextWindowMessages);

    const activeSystemPrompt = systemPrompts.find((systemPrompt) => systemPrompt.id === appSettings.selectedSystemPromptId);
    const systemPromptContent = activeSystemPrompt?.content;
    const maxTokens = appSettings.unlimitedOutputTokens ? undefined : appSettings.maxOutputTokens;
    const baseInputTokens = estimateInputTokens(contextMessages, systemPromptContent);
    const resolveTooling = (providerId: string) =>
      getEffectiveToolingForProvider(providerId, appSettings.enableModelTools, appSettings.tooling);
    const resolveTemperature = (providerId: string, candidate: number): number | undefined => {
      if (!providerSupportsTemperature(providerId)) return undefined;
      return sanitizeTemperature(candidate, DEFAULT_TEMPERATURE);
    };

    if (appSettings.enableConcilium) {
      const assistantMsgId = createUniqueId();
      const memberOutputs = appSettings.conciliumMembers.map(() => '');
      const memberUsageEventIds: Array<string | null> = appSettings.conciliumMembers.map(() => null);
      let leaderUsageEventId: string | null = null;
      let leaderOutput = '';

      const initialCouncil: CouncilAnswer[] = appSettings.conciliumMembers.map((member) => ({
        model: member.model,
        content: '',
        completed: false,
      }));

      const initialAiMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        provider: 'Concilium',
        model: appSettings.conciliumLeader.model,
        isConcilium: true,
        councilAnswers: initialCouncil,
        isThinking: true,
      };

      updateConversationMessages(activeConversationForSend, (prev) => [...prev, initialAiMsg]);

      const leaderPrompt = systemPrompts.find((systemPrompt) => systemPrompt.id === 'concilium');
      const leaderSystemPrompt =
        leaderPrompt?.content || 'You are the head of the Concilium. Provide a balanced, well-reasoned final verdict.';
      const leaderTooling = resolveTooling(appSettings.conciliumLeader.provider);
      const conciliumBlindEvalForLeader = appSettings.conciliumBlindEval === true;
      let leaderInputTokensForRun = 0;

      const buildConciliumCostComparison = (): Message['conciliumCostComparison'] | undefined => {
        const successfulMemberCost = memberOutputs.reduce((total, memberContent, index) => {
          const normalized = memberContent.trim();
          if (!normalized || normalized.startsWith('Error:')) return total;
          const member = appSettings.conciliumMembers[index];
          if (!member) return total;
          const memberCost = estimateCostUsd(
            member.provider,
            member.model,
            baseInputTokens,
            estimateTextTokens(memberContent),
            resolveTooling(member.provider)
          );
          return total + memberCost.totalCostUsd;
        }, 0);

        const leaderOutputTokens = estimateTextTokens(leaderOutput);
        const leaderCost = estimateCostUsd(
          appSettings.conciliumLeader.provider,
          appSettings.conciliumLeader.model,
          leaderInputTokensForRun,
          leaderOutputTokens,
          leaderTooling
        );
        const totalConciliumCostUsd = successfulMemberCost + leaderCost.totalCostUsd;
        const soloLeaderCost = estimateCostUsd(
          appSettings.conciliumLeader.provider,
          appSettings.conciliumLeader.model,
          baseInputTokens,
          leaderOutputTokens,
          leaderTooling
        );

        if (totalConciliumCostUsd <= 0 && soloLeaderCost.totalCostUsd <= 0) {
          return undefined;
        }

        return {
          totalConciliumCostUsd,
          soloLeaderCostUsd: soloLeaderCost.totalCostUsd,
          ratio: soloLeaderCost.totalCostUsd > 0 ? totalConciliumCostUsd / soloLeaderCost.totalCostUsd : 0,
        };
      };

      const ensureMemberUsageEvent = (index: number, provider: string, model: string): string => {
        const existing = memberUsageEventIds[index];
        if (existing) return existing;
        const eventId = startUsageEvent({
          provider,
          model,
          conversationId: activeConversationForSend,
          ...getActiveProviderApiKeyMeta(provider),
          inputTokens: baseInputTokens,
          tooling: resolveTooling(provider),
          source: 'concilium_member',
        });
        memberUsageEventIds[index] = eventId;
        return eventId;
      };

      const ensureLeaderUsageEvent = (): string | null => {
        if (leaderUsageEventId) return leaderUsageEventId;

        const successfulMembers = memberOutputs
          .map((content) => ({ content }))
          .filter((item) => item.content.trim().length > 0 && !item.content.trim().startsWith('Error:'));

        if (successfulMembers.length === 0) {
          return null;
        }

        const synthesisPrompt = buildConciliumSynthesisPrompt(
          successfulMembers,
          appSettings.conciliumMode,
          conciliumBlindEvalForLeader
        );
        const leaderInputTokens = estimateInputTokens([{ role: 'user', content: synthesisPrompt }], leaderSystemPrompt);
        leaderInputTokensForRun = leaderInputTokens;
        leaderUsageEventId = startUsageEvent({
          provider: appSettings.conciliumLeader.provider,
          model: appSettings.conciliumLeader.model,
          conversationId: activeConversationForSend,
          ...getActiveProviderApiKeyMeta(appSettings.conciliumLeader.provider),
          inputTokens: leaderInputTokens,
          tooling: leaderTooling,
          source: 'concilium_leader',
        });

        return leaderUsageEventId;
      };

      try {
        await sendConciliumMessage(
          {
            members: appSettings.conciliumMembers.map((member) => ({ provider: member.provider, model: member.model })),
            leader: { provider: appSettings.conciliumLeader.provider, model: appSettings.conciliumLeader.model },
            mode: appSettings.conciliumMode,
            blindEval: appSettings.conciliumBlindEval,
            messages: contextMessages,
            systemPrompt: systemPromptContent,
            leaderSystemPrompt: leaderPrompt?.content,
            maxTokens,
            temperature: sanitizeTemperature(appSettings.temperature, DEFAULT_TEMPERATURE),
            tooling: appSettings.enableModelTools ? appSettings.tooling : { webSearch: false, codeExecution: false },
            requestId: streamRequestId,
          },
          {
            onMemberToken: (index, model, provider, token) => {
              memberOutputs[index] = (memberOutputs[index] || '') + token;
              const eventId = ensureMemberUsageEvent(index, provider, model);
              updateUsageEventOutput(eventId, estimateTextTokens(memberOutputs[index]));

              updateConversationMessages(activeConversationForSend, (prev) =>
                prev.map((message) => {
                  if (message.id === assistantMsgId && message.councilAnswers) {
                    const newAnswers = [...message.councilAnswers];
                    const current = newAnswers[index];
                    if (!current) return message;
                    newAnswers[index] = { ...current, content: current.content + token };
                    return { ...message, councilAnswers: newAnswers };
                  }
                  return message;
                })
              );
            },
            onMemberComplete: (index, model, provider, content) => {
              memberOutputs[index] = content;
              const eventId = ensureMemberUsageEvent(index, provider, model);
              updateUsageEventOutput(eventId, estimateTextTokens(content));
              updateConversationMessages(activeConversationForSend, (prev) =>
                prev.map((message) => {
                  if (message.id === assistantMsgId && message.councilAnswers) {
                    const newAnswers = [...message.councilAnswers];
                    newAnswers[index] = { ...newAnswers[index], content, completed: true };
                    return { ...message, councilAnswers: newAnswers };
                  }
                  return message;
                })
              );
            },
            onMemberError: (index, model, provider, error) => {
              const eventId = ensureMemberUsageEvent(index, provider, model);
              updateUsageEventOutput(eventId, estimateTextTokens(memberOutputs[index]));
              updateConversationMessages(activeConversationForSend, (prev) =>
                prev.map((message) => {
                  if (message.id === assistantMsgId && message.councilAnswers) {
                    const newAnswers = [...message.councilAnswers];
                    newAnswers[index] = { ...newAnswers[index], content: `Error: ${error}`, completed: true };
                    return { ...message, councilAnswers: newAnswers };
                  }
                  return message;
                })
              );
            },
            onLeaderToken: (token) => {
              leaderOutput += token;
              const eventId = ensureLeaderUsageEvent();
              if (eventId) {
                updateUsageEventOutput(eventId, estimateTextTokens(leaderOutput));
              }

              updateConversationMessages(activeConversationForSend, (prev) =>
                prev.map((message) => {
                  if (message.id === assistantMsgId) {
                    return { ...message, content: message.content + token, isThinking: false };
                  }
                  return message;
                })
              );
            },
            onPhase: (phase) => {
              if (phase === 'leader' || phase === 'leader_retry' || phase === 'leader_partial') {
                ensureLeaderUsageEvent();
              }
            },
            onDone: () => {
              if (leaderUsageEventId) {
                updateUsageEventOutput(leaderUsageEventId, estimateTextTokens(leaderOutput));
              }
              const costComparison = buildConciliumCostComparison();
              updateConversationMessages(activeConversationForSend, (prev) =>
                prev.map((message) => {
                  if (message.id !== assistantMsgId) return message;
                  return {
                    ...message,
                    isThinking: false,
                    conciliumCostComparison: costComparison || message.conciliumCostComparison,
                  };
                })
              );
              setIsTyping(false);
              clearStreamingStateIfCurrent();
            },
            onError: (error) => {
              if (leaderUsageEventId) {
                updateUsageEventOutput(leaderUsageEventId, estimateTextTokens(leaderOutput));
              }
              const costComparison = buildConciliumCostComparison();
              updateConversationMessages(activeConversationForSend, (prev) =>
                prev.map((message) => {
                  if (message.id !== assistantMsgId) return message;
                  if (leaderOutput.trim()) {
                    return {
                      ...message,
                      content: `${message.content}\n\n⚠️ ${error}`,
                      isThinking: false,
                      conciliumCostComparison: costComparison || message.conciliumCostComparison,
                    };
                  }
                  return {
                    ...message,
                    content: `⚠️ Error: ${error}`,
                    isThinking: false,
                    conciliumCostComparison: costComparison || message.conciliumCostComparison,
                  };
                })
              );
              setIsTyping(false);
              clearStreamingStateIfCurrent();
            },
          },
          abortController.signal
        );
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          const costComparison = buildConciliumCostComparison();
          updateConversationMessages(activeConversationForSend, (prev) =>
            prev.map((message) => {
              if (message.id === assistantMsgId) {
                return {
                  ...message,
                  content: `⚠️ ${err.message}`,
                  isThinking: false,
                  conciliumCostComparison: costComparison || message.conciliumCostComparison,
                };
              }
              return message;
            })
          );
        }
        setIsTyping(false);
        clearStreamingStateIfCurrent();
      }
    } else if (appSettings.enableArena) {
      streamRequestIdsRef.current.delete(streamRequestId);
      const assistantMsgId = createUniqueId();
      const arenaMembers = appSettings.arenaMembers;
      const arenaOutputs: [string, string] = ['', ''];
      const arenaCompleted: [boolean, boolean] = [false, false];
      const arenaRequestIds: [string, string] = [createStreamingRequestId(), createStreamingRequestId()];
      streamRequestIdsRef.current.add(arenaRequestIds[0]);
      streamRequestIdsRef.current.add(arenaRequestIds[1]);

      const arenaUsageEventIds = arenaMembers.map((member) =>
        startUsageEvent({
          provider: member.provider,
          model: member.model,
          conversationId: activeConversationForSend,
          ...getActiveProviderApiKeyMeta(member.provider),
          inputTokens: baseInputTokens,
          tooling: resolveTooling(member.provider),
          source: 'chat',
        })
      ) as [string, string];

      const initialArenaAnswers = arenaMembers.map((member, index) => ({
        provider: member.provider,
        model: member.model,
        content: '',
        completed: false,
        temperature: resolveTemperature(member.provider, appSettings.arenaTemperatures[index] ?? appSettings.temperature),
      })) as [ArenaAnswer, ArenaAnswer];

      const aiMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        provider: 'Arena',
        model: `${arenaMembers[0].model} vs ${arenaMembers[1].model}`,
        isArena: true,
        arenaAnswers: initialArenaAnswers,
        isThinking: true,
      };

      updateConversationMessages(activeConversationForSend, (prev) => [...prev, aiMsg]);

      const markArenaMemberComplete = (index: 0 | 1, error?: string) => {
        if (arenaCompleted[index]) return;
        arenaCompleted[index] = true;

        if (error) {
          arenaOutputs[index] = arenaOutputs[index].trim()
            ? `${arenaOutputs[index]}\n\n⚠️ ${error}`
            : `⚠️ Error: ${error}`;
        }

        updateUsageEventOutput(arenaUsageEventIds[index], estimateTextTokens(arenaOutputs[index]));

        updateConversationMessages(activeConversationForSend, (prev) =>
          prev.map((message) => {
            if (message.id !== assistantMsgId || !message.arenaAnswers) return message;
            const nextAnswers = [...message.arenaAnswers] as [ArenaAnswer, ArenaAnswer];
            nextAnswers[index] = {
              ...nextAnswers[index],
              content: arenaOutputs[index],
              completed: true,
            };
            return {
              ...message,
              arenaAnswers: nextAnswers,
              isThinking: !(arenaCompleted[0] && arenaCompleted[1]),
            };
          })
        );

        if (arenaCompleted[0] && arenaCompleted[1]) {
          setIsTyping(false);
          clearStreamingStateIfCurrent();
        }
      };

      const runArenaMember = async (index: 0 | 1) => {
        const member = arenaMembers[index];
        const memberRequestId = arenaRequestIds[index];
        const temperature = resolveTemperature(
          member.provider,
          appSettings.arenaTemperatures[index] ?? appSettings.temperature
        );

        try {
          await sendChatMessage(
            {
              provider: member.provider,
              model: member.model,
              messages: contextMessages,
              systemPrompt: systemPromptContent,
              maxTokens,
              temperature,
              reasoningEffort: supportsReasoningEffort(member.provider, member.model)
                ? appSettings.reasoningEffort
                : undefined,
              tooling: resolveTooling(member.provider),
              requestId: memberRequestId,
            },
            {
              onToken: (token) => {
                arenaOutputs[index] += token;
                updateUsageEventOutput(arenaUsageEventIds[index], estimateTextTokens(arenaOutputs[index]));
                updateConversationMessages(activeConversationForSend, (prev) =>
                  prev.map((message) => {
                    if (message.id !== assistantMsgId || !message.arenaAnswers) return message;
                    const nextAnswers = [...message.arenaAnswers] as [ArenaAnswer, ArenaAnswer];
                    nextAnswers[index] = {
                      ...nextAnswers[index],
                      content: nextAnswers[index].content + token,
                    };
                    return { ...message, arenaAnswers: nextAnswers };
                  })
                );
              },
              onDone: () => {
                markArenaMemberComplete(index);
              },
              onError: (error) => {
                markArenaMemberComplete(index, error);
              },
            },
            abortController.signal
          );
        } catch (err: any) {
          if (err?.name !== 'AbortError') {
            markArenaMemberComplete(index, err?.message || 'Request failed');
          } else {
            markArenaMemberComplete(index);
          }
        } finally {
          streamRequestIdsRef.current.delete(memberRequestId);
        }
      };

      await Promise.allSettled([runArenaMember(0), runArenaMember(1)]);
      if (!arenaCompleted[0]) markArenaMemberComplete(0);
      if (!arenaCompleted[1]) markArenaMemberComplete(1);
    } else {
      const assistantMsgId = createUniqueId();
      const assistantInputTokens = baseInputTokens;
      let assistantOutput = '';

      const assistantUsageEventId = startUsageEvent({
        provider: appSettings.provider,
        model: appSettings.mainModel,
        conversationId: activeConversationForSend,
        ...getActiveProviderApiKeyMeta(appSettings.provider),
        inputTokens: assistantInputTokens,
        tooling: resolveTooling(appSettings.provider),
        source: 'chat',
      });

      const aiMsg: Message = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        provider: appSettings.provider,
        model: appSettings.mainModel,
        isConcilium: false,
        isThinking: true,
      };
      updateConversationMessages(activeConversationForSend, (prev) => [...prev, aiMsg]);

      try {
        await sendChatMessage(
          {
            provider: appSettings.provider,
            model: appSettings.mainModel,
            messages: contextMessages,
            systemPrompt: systemPromptContent,
            maxTokens,
            temperature: resolveTemperature(appSettings.provider, appSettings.temperature),
            reasoningEffort: supportsReasoningEffort(appSettings.provider, appSettings.mainModel)
              ? appSettings.reasoningEffort
              : undefined,
            tooling: resolveTooling(appSettings.provider),
            requestId: streamRequestId,
          },
          {
            onToken: (token) => {
              assistantOutput += token;
              updateUsageEventOutput(assistantUsageEventId, estimateTextTokens(assistantOutput));
              updateConversationMessages(activeConversationForSend, (prev) =>
                prev.map((message) => {
                  if (message.id === assistantMsgId) {
                    return { ...message, content: message.content + token, isThinking: false };
                  }
                  return message;
                })
              );
            },
            onDone: () => {
              updateUsageEventOutput(assistantUsageEventId, estimateTextTokens(assistantOutput));
              setIsTyping(false);
              clearStreamingStateIfCurrent();
            },
            onError: (error) => {
              updateUsageEventOutput(assistantUsageEventId, estimateTextTokens(assistantOutput));
              updateConversationMessages(activeConversationForSend, (prev) =>
                prev.map((message) => {
                  if (message.id !== assistantMsgId) return message;
                  if (assistantOutput.trim()) {
                    return { ...message, content: `${message.content}\n\n⚠️ ${error}`, isThinking: false };
                  }
                  return { ...message, content: `⚠️ Error: ${error}`, isThinking: false };
                })
              );
              setIsTyping(false);
              clearStreamingStateIfCurrent();
            },
          },
          abortController.signal
        );
      } catch (err: any) {
        if (!assistantOutput.trim()) {
          removeUsageEvent(assistantUsageEventId);
        }

        if (err.name !== 'AbortError') {
          updateConversationMessages(activeConversationForSend, (prev) =>
            prev.map((message) => {
              if (message.id === assistantMsgId) {
                return { ...message, content: `⚠️ ${err.message}`, isThinking: false };
              }
              return message;
            })
          );
        }
        setIsTyping(false);
        clearStreamingStateIfCurrent();
      }
    }

    if (appSettings.enableSummary && appSettings.enableContext) {
      const previousCheckpointId = summaryCheckpointByConversation[activeConversationForSend];
      const previousCheckpointIndex = previousCheckpointId
        ? summarySourceRawMessages.findIndex((message) => message.id === previousCheckpointId)
        : -1;
      const hasExistingSummaryForConversation =
        contextSummaryConversationId === activeConversationForSend &&
        contextSummary.trim() &&
        contextSummary !== INITIAL_CONTEXT_SUMMARY;
      const canRunIncrementalSummary = hasExistingSummaryForConversation && previousCheckpointIndex >= 0;
      const rawDeltaMessages = canRunIncrementalSummary
        ? summarySourceRawMessages.slice(previousCheckpointIndex + 1)
        : summarySourceRawMessages;
      const normalizedDeltaMessages: SummaryMessage[] = rawDeltaMessages.map((message) => ({
        role: message.role as 'user' | 'assistant' | 'system',
        content: message.content,
      }));
      const compressedDeltaMessages = compressSummaryMessages(normalizedDeltaMessages);
      const lastSourceMessageId = summarySourceRawMessages[summarySourceRawMessages.length - 1]?.id;

      if (compressedDeltaMessages.length === 0) {
        if (lastSourceMessageId) {
          setSummaryCheckpointByConversation((prev) => ({
            ...prev,
            [activeConversationForSend]: lastSourceMessageId,
          }));
        }
      } else {
        setIsSummarizing(true);
        const summaryRequestId = createStreamingRequestId();
        streamRequestIdsRef.current.add(summaryRequestId);

        const summaryMessagesForRequest = canRunIncrementalSummary
          ? buildIncrementalSummaryMessages({
              language: appSettings.language,
              previousSummary: contextSummary,
              deltaMessages: compressedDeltaMessages,
            })
          : compressedDeltaMessages;
        const summaryPrompt = buildSummaryPrompt(summaryMessagesForRequest);
        const summaryInputTokens = estimateInputTokens([{ role: 'user', content: summaryPrompt }], SUMMARY_SYSTEM_PROMPT);
        const summaryUsageEventId = startUsageEvent({
          provider: appSettings.contextProvider,
          model: appSettings.contextModel,
          conversationId: activeConversationForSend,
          ...getActiveProviderApiKeyMeta(appSettings.contextProvider),
          inputTokens: summaryInputTokens,
          source: 'summary',
        });

        try {
          const summary = await summarizeConversation({
            provider: appSettings.contextProvider,
            model: appSettings.contextModel,
            messages: summaryMessagesForRequest,
            requestId: summaryRequestId,
          });
          const normalizedSummary = summary.trim();
          if (!normalizedSummary) {
            removeUsageEvent(summaryUsageEventId);
          } else {
            setContextSummary(normalizedSummary);
            setContextSummaryConversationId(activeConversationForSend);
            if (lastSourceMessageId) {
              setSummaryCheckpointByConversation((prev) => ({
                ...prev,
                [activeConversationForSend]: lastSourceMessageId,
              }));
            }
            updateUsageEventOutput(summaryUsageEventId, estimateTextTokens(normalizedSummary));
          }
        } catch {
          removeUsageEvent(summaryUsageEventId);
        } finally {
          streamRequestIdsRef.current.delete(summaryRequestId);
          setIsSummarizing(false);
        }
      }
    }
  };

  const handleRetryMessage = (text: string) => {
    const activeMessages = messagesByConversation[activeConversation?.id || activeConversationId] || [];
    const lastMsg = activeMessages[activeMessages.length - 1];
    if (lastMsg?.role === 'assistant' && activeConversation) {
      updateConversationMessages(activeConversation.id, (prev) => prev.slice(0, -1));
    }
    handleSendMessage(text);
  };

  // --- Branching Logic ---
  const handleBranchChat = (messageId: string) => {
    if (!activeConversation) return;
    const sourceMessages = messagesByConversation[activeConversation.id] || [];
    const msgIndex = sourceMessages.findIndex((message) => message.id === messageId);
    if (msgIndex === -1) return;

    const branchedMessages = sourceMessages.slice(0, msgIndex + 1).map((message) => ({ ...message }));
    const newChatId = createUniqueId();
    const lastContent = branchedMessages[branchedMessages.length - 1]?.content || '';
    const newChat: Conversation = {
      id: newChatId,
      title: `${activeConversation.title} (Branch)`,
      updatedAt: Date.now(),
      snippet: `${lastContent.slice(0, 50)}${lastContent.length > 50 ? '...' : ''}`,
      folderId: activeConversation.folderId ?? null,
      archivedAt: null,
    };

    setConversations((prev) => [newChat, ...prev]);
    setConversationMessages(newChatId, branchedMessages);
    setActiveConversationId(newChatId);

    if (window.innerWidth < 1024) setLeftSidebarOpen(false);
  };


  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setAppSettings((prev) => {
      const next = { ...prev, [key]: value } as AppSettings;
      if (key === 'temperature') {
        next.temperature = sanitizeTemperature(value as unknown, prev.temperature);
      }
      if (key === 'arenaTemperatures') {
        const incoming = Array.isArray(value) ? (value as unknown[]) : [];
        next.arenaTemperatures = [
          sanitizeTemperature(incoming[0], prev.arenaTemperatures[0]),
          sanitizeTemperature(incoming[1], prev.arenaTemperatures[1]),
        ];
      }

      next.rememberedMainModelByProvider = { ...(prev.rememberedMainModelByProvider || {}) };
      next.rememberedContextModelByProvider = { ...(prev.rememberedContextModelByProvider || {}) };
      next.rememberedLeaderModelByProvider = { ...(prev.rememberedLeaderModelByProvider || {}) };

      if (key === 'provider') {
        next.rememberedMainModelByProvider[prev.provider] = prev.mainModel;
        const remembered = next.rememberedMainModelByProvider[next.provider];
        if (remembered && isModelAvailableForProvider(next.provider, remembered)) {
          next.mainModel = remembered;
        }
      } else if (key === 'mainModel') {
        next.rememberedMainModelByProvider[next.provider] = next.mainModel;
      }

      if (key === 'contextProvider') {
        next.rememberedContextModelByProvider[prev.contextProvider] = prev.contextModel;
        const remembered = next.rememberedContextModelByProvider[next.contextProvider];
        if (remembered && isModelAvailableForProvider(next.contextProvider, remembered)) {
          next.contextModel = remembered;
        }
      } else if (key === 'contextModel') {
        next.rememberedContextModelByProvider[next.contextProvider] = next.contextModel;
      }

      if (key === 'telegramProvider') {
        if (!isModelAvailableForProvider(next.telegramProvider, next.telegramModel)) {
          next.telegramModel = getDefaultModelForProvider(next.telegramProvider);
        }
      }

      if (key === 'conciliumLeader') {
        const requestedLeader = value as AppSettings['conciliumLeader'];
        next.rememberedLeaderModelByProvider[prev.conciliumLeader.provider] = prev.conciliumLeader.model;

        if (requestedLeader.provider !== prev.conciliumLeader.provider) {
          const remembered = next.rememberedLeaderModelByProvider[requestedLeader.provider];
          next.conciliumLeader = {
            provider: requestedLeader.provider,
            model:
              remembered && isModelAvailableForProvider(requestedLeader.provider, remembered)
                ? remembered
                : getDefaultModelForProvider(requestedLeader.provider),
          };
        }
      }

      if (key === 'enableArena' && value === true) {
        next.enableConcilium = false;
      }
      if (key === 'enableConcilium' && value === true) {
        next.enableArena = false;
      }
      if (key === 'conciliumMode') {
        next.conciliumMode = sanitizeConciliumMode(value, prev.conciliumMode);
      }
      if (key === 'conciliumBlindEval') {
        next.conciliumBlindEval = value === true;
      }
      if (key === 'conciliumPresets') {
        next.conciliumPresets = sanitizeConciliumPresets(value, createDefaultConciliumPresets());
      }

      if (!isModelAvailableForProvider(next.provider, next.mainModel)) {
        const remembered = next.rememberedMainModelByProvider[next.provider];
        next.mainModel =
          remembered && isModelAvailableForProvider(next.provider, remembered)
            ? remembered
            : getDefaultModelForProvider(next.provider);
      }

      if (!isModelAvailableForProvider(next.contextProvider, next.contextModel)) {
        const remembered = next.rememberedContextModelByProvider[next.contextProvider];
        next.contextModel =
          remembered && isModelAvailableForProvider(next.contextProvider, remembered)
            ? remembered
            : getDefaultModelForProvider(next.contextProvider);
      }

      if (!isModelAvailableForProvider(next.telegramProvider, next.telegramModel)) {
        next.telegramModel = getDefaultModelForProvider(next.telegramProvider);
      }

      if (!isModelAvailableForProvider(next.conciliumLeader.provider, next.conciliumLeader.model)) {
        const remembered = next.rememberedLeaderModelByProvider[next.conciliumLeader.provider];
        next.conciliumLeader = {
          provider: next.conciliumLeader.provider,
          model:
            remembered && isModelAvailableForProvider(next.conciliumLeader.provider, remembered)
              ? remembered
              : getDefaultModelForProvider(next.conciliumLeader.provider),
        };
      }

      next.conciliumMembers = normalizeConciliumMembers(next.conciliumMembers, prev.conciliumMembers).map((member) => {
        if (!isModelAvailableForProvider(member.provider, member.model)) {
          return {
            provider: member.provider,
            model: getDefaultModelForProvider(member.provider),
          };
        }
        return member;
      });

      next.arenaMembers = next.arenaMembers.map((member) => {
        if (!isModelAvailableForProvider(member.provider, member.model)) {
          return {
            provider: member.provider,
            model: getDefaultModelForProvider(member.provider),
          };
        }
        return member;
      }) as AppSettings['arenaMembers'];

      if (!supportsReasoningEffort(next.provider, next.mainModel)) {
        next.reasoningEffort = 'none';
      }

      next.rememberedMainModelByProvider[next.provider] = next.mainModel;
      next.rememberedContextModelByProvider[next.contextProvider] = next.contextModel;
      next.rememberedLeaderModelByProvider[next.conciliumLeader.provider] = next.conciliumLeader.model;

      return next;
    });
  };

  const handleSaveSystemPrompt = (prompt: SystemPrompt) => {
    setSystemPrompts(prev => {
      const exists = prev.find(p => p.id === prompt.id);
      if (exists) {
        return prev.map(p => p.id === prompt.id ? prompt : p);
      }
      return [...prev, prompt];
    });
  };

  const handleDeleteSystemPrompt = (id: string) => {
    setSystemPrompts(prev => prev.filter(p => p.id !== id));
    if (appSettings.selectedSystemPromptId === id) {
        updateSetting('selectedSystemPromptId', 'default');
    }
  };

  const handleSaveQuickInsertPrompt = (prompt: QuickInsertPrompt) => {
    setQuickInsertPrompts((prev) => {
      const exists = prev.some((item) => item.id === prompt.id);
      if (exists) {
        return prev.map((item) => (item.id === prompt.id ? prompt : item));
      }
      return [...prev, prompt];
    });
  };

  const handleDeleteQuickInsertPrompt = (id: string) => {
    setQuickInsertPrompts((prev) => prev.filter((item) => item.id !== id));
  };

  const handleConversationSelect = (id: string) => {
    const target = conversations.find((conversation) => conversation.id === id && !conversation.deletedAt && !conversation.archivedAt);
    if (!target) return;
    setActiveWorkspace('chat');
    setActiveConversationId(id);
    if (window.innerWidth < 1024) {
        setLeftSidebarOpen(false);
    }
  };

  const handleCreateConversation = () => {
    cancelOngoingRequest();
    const { conversation, messages: freshMessages } = createFreshConversation(appSettings.language);
    setConversations((prev) => [conversation, ...prev]);
    setConversationMessages(conversation.id, freshMessages);
    setActiveWorkspace('chat');
    setActiveConversationId(conversation.id);

    if (window.innerWidth < 1024) {
      setLeftSidebarOpen(false);
    }
  };

  const handleCreateNote = () => {
    const freshNote = createFreshNote(appSettings.language);
    setNotesWorkspace((prev) => ({
      ...prev,
      notes: [freshNote, ...prev.notes],
      activeNoteId: freshNote.id,
    }));
    setActiveWorkspace('notes');
    if (window.innerWidth < 1024) {
      setLeftSidebarOpen(false);
    }
  };

  const handleCreateNoteFolder = (name: string) => {
    const normalizedName = name.trim().slice(0, 80);
    if (!normalizedName) return;
    setNotesWorkspace((prev) => ({
      ...prev,
      noteFolders: [...prev.noteFolders, { id: createUniqueId(), name: normalizedName, createdAt: Date.now() }],
    }));
  };

  const handleRenameNoteFolder = (id: string, newName: string) => {
    const normalizedName = newName.trim().slice(0, 80);
    if (!normalizedName) return;
    setNotesWorkspace((prev) => ({
      ...prev,
      noteFolders: prev.noteFolders.map((folder) => (
        folder.id === id ? { ...folder, name: normalizedName } : folder
      )),
    }));
  };

  const handleDeleteNoteFolder = (id: string) => {
    setNotesWorkspace((prev) => ({
      ...prev,
      noteFolders: prev.noteFolders.filter((folder) => folder.id !== id),
      notes: prev.notes.map((note) => (
        note.folderId === id ? { ...note, folderId: null } : note
      )),
    }));
  };

  const handleMoveNote = (noteId: string, folderId: string | null) => {
    setNotesWorkspace((prev) => ({
      ...prev,
      notes: prev.notes.map((note) => (
        note.id === noteId ? { ...note, folderId } : note
      )),
    }));
  };

  const handleSelectNote = (id: string) => {
    setNotesWorkspace((prev) => {
      const target = prev.notes.find((note) => note.id === id && !note.deletedAt && !note.archivedAt);
      if (!target) return prev;
      return { ...prev, activeNoteId: target.id };
    });
    setActiveWorkspace('notes');
    if (window.innerWidth < 1024) {
      setLeftSidebarOpen(false);
    }
  };

  const handleRenameNote = (id: string, newName: string) => {
    const normalizedName = newName.trim().slice(0, 120);
    if (!normalizedName) return;
    const now = Date.now();
    setNotesWorkspace((prev) => ({
      ...prev,
      notes: prev.notes.map((note) =>
        note.id === id ? { ...note, title: normalizedName, updatedAt: now } : note
      ),
    }));
  };

  const handleArchiveNote = (id: string) => {
    const now = Date.now();
    setNotesWorkspace((prev) => {
      const nextNotes = prev.notes.map((note) =>
        note.id === id ? { ...note, archivedAt: now, deletedAt: null, folderId: null, updatedAt: now } : note
      );
      return {
        ...prev,
        notes: nextNotes,
        activeNoteId: pickActiveNoteId(nextNotes, prev.activeNoteId === id ? undefined : prev.activeNoteId),
      };
    });
  };

  const handleUnarchiveNote = (id: string) => {
    const now = Date.now();
    setNotesWorkspace((prev) => {
      const nextNotes = prev.notes.map((note) =>
        note.id === id ? { ...note, archivedAt: null, updatedAt: now } : note
      );
      return {
        ...prev,
        notes: nextNotes,
        activeNoteId: pickActiveNoteId(nextNotes, prev.activeNoteId || id),
      };
    });
  };

  const handleDeleteNote = (id: string) => {
    const now = Date.now();
    setNotesWorkspace((prev) => {
      const nextNotes = prev.notes.map((note) =>
        note.id === id ? { ...note, deletedAt: now, archivedAt: null, folderId: null, updatedAt: now } : note
      );
      return {
        ...prev,
        notes: nextNotes,
        activeNoteId: pickActiveNoteId(nextNotes, prev.activeNoteId === id ? undefined : prev.activeNoteId),
      };
    });
  };

  const handleRestoreNote = (id: string) => {
    const now = Date.now();
    setNotesWorkspace((prev) => {
      const nextNotes = prev.notes.map((note) =>
        note.id === id ? { ...note, deletedAt: null, archivedAt: null, folderId: note.folderId || null, updatedAt: now } : note
      );
      return {
        ...prev,
        notes: nextNotes,
        activeNoteId: pickActiveNoteId(nextNotes, prev.activeNoteId || id),
      };
    });
  };

  const handlePermanentDeleteNote = (ids: string[]) => {
    if (ids.length === 0) return;
    setNotesWorkspace((prev) => {
      const removed = new Set(ids);
      const nextNotes = prev.notes.filter((note) => !removed.has(note.id));
      if (nextNotes.length === 0) {
        const fallback = createFreshNote(appSettings.language);
        return {
          ...prev,
          notes: [fallback],
          activeNoteId: fallback.id,
        };
      }
      return {
        ...prev,
        notes: nextNotes,
        activeNoteId: pickActiveNoteId(nextNotes, prev.activeNoteId),
      };
    });
  };

  const handleUpdateNoteContent = (noteId: string, content: string) => {
    const now = Date.now();
    const normalizedContent = content || '';
    setNotesWorkspace((prev) => ({
      ...prev,
      notes: prev.notes.map((note) => {
        if (note.id !== noteId) return note;
        const nextTitle = DEFAULT_NOTE_TITLES.has(note.title)
          ? createAutoNoteTitleFromContent(normalizedContent, appSettings.language)
          : note.title;
        return {
          ...note,
          title: nextTitle,
          content: normalizedContent,
          snippet: createNoteSnippetFromContent(normalizedContent),
          updatedAt: now,
        };
      }),
    }));
  };

  const handleManualSaveNotes = useCallback(async (): Promise<boolean> => {
    return saveServerStateKey('notesWorkspace', notesWorkspace);
  }, [notesWorkspace]);

  const handleWorkspaceChange = (workspace: WorkspaceView) => {
    if (workspace !== 'chat') {
      cancelOngoingRequest();
    }
    // Auto-save notes when switching away from notes section
    if (activeWorkspace === 'notes' && workspace !== 'notes') {
      saveServerStateKey('notesWorkspace', notesWorkspace).catch((err) =>
        console.warn('Auto-save notes on section change failed:', err)
      );
    }
    setActiveWorkspace(workspace);
    if (window.innerWidth < 1024) {
      setLeftSidebarOpen(false);
    }
  };

  const handleAgentSelect = (id: string) => {
    // Auto-save notes when switching away from notes
    if (activeWorkspace === 'notes') {
      saveServerStateKey('notesWorkspace', notesWorkspace).catch((err) =>
        console.warn('Auto-save notes on section change failed:', err)
      );
    }
    setAgentWorkspace((prev) => {
      const target = prev.agents.find((agent) => agent.id === id && !agent.deletedAt && !agent.archivedAt);
      if (!target) return prev;
      return { ...prev, activeAgentId: target.id };
    });
    setActiveWorkspace('agents');
    if (window.innerWidth < 1024) {
      setLeftSidebarOpen(false);
    }
  };

  const handleCreateAgent = () => {
    // Auto-save notes when switching away from notes
    if (activeWorkspace === 'notes') {
      saveServerStateKey('notesWorkspace', notesWorkspace).catch((err) =>
        console.warn('Auto-save notes on section change failed:', err)
      );
    }
    setAgentWorkspace((prev) => {
      const newAgent = createAutonomousAgent(appSettings.language, prev.agents.length + 1, {
        providerId: preferredAgentProviderId,
        modelId: preferredAgentModelId,
        systemPromptId: preferredAgentSystemPromptId,
        temperature: preferredAgentTemperature,
        maxTokens: preferredAgentMaxTokens,
      });
      return {
        agents: [newAgent, ...prev.agents],
        activeAgentId: newAgent.id,
      };
    });
    setActiveWorkspace('agents');
    if (window.innerWidth < 1024) {
      setLeftSidebarOpen(false);
    }
  };

  const handleRenameAgent = (id: string, newName: string) => {
    const normalizedName = newName.trim().slice(0, 60);
    if (!normalizedName) return;
    const now = Date.now();
    setAgentWorkspace((prev) => ({
      ...prev,
      agents: prev.agents.map((agent) =>
        agent.id === id ? { ...agent, name: normalizedName, updatedAt: now } : agent
      ),
    }));
  };

  const handleArchiveAgent = (id: string) => {
    const now = Date.now();
    setAgentWorkspace((prev) => {
      const agents = prev.agents.map((agent) =>
        agent.id === id ? { ...agent, archivedAt: now, deletedAt: null, updatedAt: now } : agent
      );
      return {
        agents,
        activeAgentId: pickActiveAgentId(agents, prev.activeAgentId === id ? undefined : prev.activeAgentId),
      };
    });
  };

  const handleUnarchiveAgent = (id: string) => {
    const now = Date.now();
    setAgentWorkspace((prev) => {
      const agents = prev.agents.map((agent) =>
        agent.id === id ? { ...agent, archivedAt: null, updatedAt: now } : agent
      );
      return {
        agents,
        activeAgentId: pickActiveAgentId(agents, prev.activeAgentId || id),
      };
    });
  };

  const handleDeleteAgent = (id: string) => {
    const now = Date.now();
    setAgentWorkspace((prev) => {
      const agents = prev.agents.map((agent) =>
        agent.id === id
          ? { ...agent, deletedAt: now, archivedAt: null, updatedAt: now }
          : agent
      );
      return {
        agents,
        activeAgentId: pickActiveAgentId(agents, prev.activeAgentId === id ? undefined : prev.activeAgentId),
      };
    });
  };

  const handleRestoreAgent = (id: string) => {
    const now = Date.now();
    setAgentWorkspace((prev) => {
      const agents = prev.agents.map((agent) =>
        agent.id === id
          ? { ...agent, deletedAt: null, archivedAt: null, updatedAt: now }
          : agent
      );
      return {
        agents,
        activeAgentId: pickActiveAgentId(agents, prev.activeAgentId || id),
      };
    });
  };

  const handlePermanentDeleteAgent = (ids: string[]) => {
    if (ids.length === 0) return;
    setAgentWorkspace((prev) => {
      const removed = new Set(ids);
      const agents = prev.agents.filter((agent) => !removed.has(agent.id));
      return {
        agents,
        activeAgentId: pickActiveAgentId(agents, prev.activeAgentId),
      };
    });
  };

  // --- Folder & Chat Management Handlers ---

  const handleCreateFolder = (name: string) => {
    const newFolder: Folder = { id: createUniqueId(), name, createdAt: Date.now() };
    setFolders(prev => [...prev, newFolder]);
  };

  const handleRenameFolder = (id: string, newName: string) => {
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name: newName } : f));
  };

  const handleDeleteFolder = (id: string) => {
    const now = Date.now();
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.folderId === id ? { ...conversation, folderId: null, deletedAt: now, archivedAt: null } : conversation
      )
    );
    setFolders(prev => prev.filter(f => f.id !== id));
  };

  const handleRenameChat = (id: string, newName: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title: newName } : c));
  };

  const handleMoveChat = (chatId: string, folderId: string | null) => {
    setConversations(prev => prev.map(c => c.id === chatId ? { ...c, folderId } : c));
  };

  const handleArchiveChat = (id: string) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === id
          ? { ...conversation, archivedAt: Date.now(), folderId: null }
          : conversation
      )
    );
  };

  const handleUnarchiveChat = (id: string) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === id ? { ...conversation, archivedAt: null } : conversation
      )
    );
  };

  const handleDeleteChat = (id: string) => {
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === id ? { ...conversation, deletedAt: Date.now(), archivedAt: null, folderId: null } : conversation
      )
    );
  };

  const handleRestoreChat = (id: string) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, deletedAt: null, archivedAt: null } : c));
  };

  const handlePermanentDeleteChat = (ids: string[]) => {
    setConversations((prev) => prev.filter((conversation) => !ids.includes(conversation.id)));
    removeConversationMessages(ids);
    // Clean up document RAG stores
    ids.forEach((conversationId) => clearConversationDocStore(conversationId));
    ids.forEach((conversationId) => {
      const prefix = `${conversationId}::`;
      for (const docId of indexedMemoryMessageIdsRef.current) {
        if (docId.startsWith(prefix)) {
          indexedMemoryMessageIdsRef.current.delete(docId);
        }
      }
    });
    setSummaryCheckpointByConversation((prev) => {
      const next = { ...prev };
      ids.forEach((conversationId) => {
        delete next[conversationId];
      });
      return next;
    });
    if (ids.includes(contextSummaryConversationId)) {
      setContextSummary(INITIAL_CONTEXT_SUMMARY);
      setContextSummaryConversationId('');
    }
  };

  const handleMoveAllHistoryToTrash = () => {
    cancelOngoingRequest();
    const now = Date.now();
    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.deletedAt ? conversation : { ...conversation, deletedAt: now, archivedAt: null, folderId: null }
      )
    );
  };

  const handleDeleteAllHistoryAndTrash = () => {
    cancelOngoingRequest();
    setConversations([]);
    setMessagesByConversation({});
    setActiveConversationId('');
    setSummaryCheckpointByConversation({});
    setContextSummaryConversationId('');
    clearAllDocStores();
    resetVectorStore();
    indexedMemoryMessageIdsRef.current.clear();
    hasSeededInfiniteMemoryRef.current = false;
  };

  const handleEmptyTrash = () => {
    const deletedIds = conversations.filter((conversation) => conversation.deletedAt).map((conversation) => conversation.id);
    handlePermanentDeleteChat(deletedIds);
  };

  const clearAllProviderKeys = async () => {
    await Promise.allSettled(
      PROVIDERS
        .filter((provider) => providerRequiresApiKey(provider.id))
        .map((provider) => deleteProviderApiKey(provider.id))
    );
    refreshProviders();
  };

  const handleResetSettingsAndApiKeys = async () => {
    cancelOngoingRequest();
    await clearAllProviderKeys();
    const defaults = createDefaultSettings();
    setAppSettings(defaults);
    setSystemPrompts(SYSTEM_PROMPTS_DATA[defaults.language]);
    setQuickInsertPrompts([]);
    setActiveWorkspace('chat');
    setNotesWorkspace(createDefaultNotesWorkspaceState(defaults.language, defaults.provider, defaults.mainModel));
    setAgentWorkspace(createDefaultAgentWorkspaceState(defaults.language));
    setContextSummary(INITIAL_CONTEXT_SUMMARY);
    setContextSummaryConversationId('');
    setSummaryCheckpointByConversation({});
    clearAllDocStores();
  };

  const handleDeleteAllUserData = async () => {
    cancelOngoingRequest();
    await clearAllProviderKeys();

    const defaults = createDefaultSettings();

    setAppSettings(defaults);
    setSystemPrompts(SYSTEM_PROMPTS_DATA[defaults.language]);
    setQuickInsertPrompts([]);
    setConversations([]);
    setMessagesByConversation({});
    setActiveConversationId('');
    setFolders([]);
    setActiveWorkspace('chat');
    setNotesWorkspace(createDefaultNotesWorkspaceState(defaults.language, defaults.provider, defaults.mainModel));
    setAgentWorkspace(createDefaultAgentWorkspaceState(defaults.language));
    setUsageEvents([]);
    setContextSummary(INITIAL_CONTEXT_SUMMARY);
    setContextSummaryConversationId('');
    setSummaryCheckpointByConversation({});
    sessionStartedAtRef.current = Date.now();
    clearAllDocStores();
    resetVectorStore();
    indexedMemoryMessageIdsRef.current.clear();
    hasSeededInfiniteMemoryRef.current = false;

    // Clear server-side database
    await clearServerState().catch((err) => {
      console.warn('Failed to clear server state:', err);
    });

    const desktopBridge = (window as any)?.desktop;
    if (desktopBridge?.isDesktop && typeof desktopBridge.resetLocalData === 'function') {
      const result = await desktopBridge.resetLocalData();
      if (result && result.success === false) {
        throw new Error(result.error || 'No se pudieron eliminar los datos locales.');
      }
    }
  };

  const handleResetUsageCost = async () => {
    setUsageEvents([]);
    await saveServerStateKey('usageEvents', []);
  };

  const handleLogin = async (username: string, password: string) => {
    setLoginBusy(true);
    setLoginError('');
    try {
      const user = await loginUser(username, password);
      resetClientStateForAuth();
      setAuthUser(user);
      setIsDataLoaded(false);
      skipInitialSave.current = true;
    } catch (error: any) {
      setLoginError(error?.message || 'No se pudo iniciar sesión.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    cancelOngoingRequest();
    await logoutUser().catch(() => {});
    setAuthUser(null);
    setIsSettingsModalOpen(false);
    setIsDataLoaded(false);
    resetClientStateForAuth();
  };

  const getBackupPayload = <T,>(raw: unknown, expectedType: BackupEnvelope<T>['type']): T => {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Invalid backup file.');
    }

    const candidate = raw as Partial<BackupEnvelope<T>> & Record<string, unknown>;
    if ('payload' in candidate) {
      if (candidate.type && candidate.type !== expectedType) {
        throw new Error('Backup type does not match this restore action.');
      }
      if (!candidate.payload) {
        throw new Error('Backup payload is empty.');
      }
      return candidate.payload as T;
    }

    return raw as T;
  };

  const handleCreateSettingsBackup = useCallback(async (options: { includeApiKeys: boolean }) => {
    const payload: SettingsBackupPayload = {
      appSettings,
      systemPrompts,
      quickInsertPrompts,
    };

    if (options.includeApiKeys) {
      payload.apiKeys = await exportProviderApiKeysBackup();
    }

    const backup: BackupEnvelope<SettingsBackupPayload> = {
      app: 'optimAIzer',
      type: 'settings',
      version: BACKUP_SCHEMA_VERSION,
      exportedAt: Date.now(),
      payload,
    };

    return backup;
  }, [appSettings, quickInsertPrompts, systemPrompts]);

  const handleRestoreSettingsBackup = useCallback(async (raw: unknown) => {
    const payload = getBackupPayload<SettingsBackupPayload>(raw, 'settings');
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid settings backup payload.');
    }
    if (!('appSettings' in payload)) {
      throw new Error('Invalid settings backup payload.');
    }

    const nextSettings = sanitizeSettings(payload.appSettings);
    const nextSystemPrompts = sanitizeSystemPrompts(payload.systemPrompts, nextSettings.language);
    const nextQuickInsertPrompts = sanitizeQuickInsertPrompts(payload.quickInsertPrompts);

    setAppSettings(nextSettings);
    setSystemPrompts(nextSystemPrompts);
    setQuickInsertPrompts(nextQuickInsertPrompts);

    if (payload.apiKeys && Object.keys(payload.apiKeys).length > 0) {
      if (authUser?.role !== 'admin') {
        throw new Error(
          appSettings.language === 'es'
            ? 'Solo los usuarios admin pueden restaurar API keys.'
            : 'Only admin users can restore API keys.'
        );
      }
      await importProviderApiKeysBackup(payload.apiKeys);
      refreshProviders();
    }
  }, [appSettings.language, authUser?.role, refreshProviders]);

  const handleCreateHistoryBackup = useCallback(async () => {
    const payload: HistoryBackupPayload = {
      conversations,
      folders,
      messagesByConversation,
      activeConversationId,
      contextSummary,
      contextSummaryConversationId,
      summaryCheckpointByConversation,
    };

    const backup: BackupEnvelope<HistoryBackupPayload> = {
      app: 'optimAIzer',
      type: 'history',
      version: BACKUP_SCHEMA_VERSION,
      exportedAt: Date.now(),
      payload,
    };

    return backup;
  }, [
    activeConversationId,
    contextSummary,
    contextSummaryConversationId,
    conversations,
    folders,
    messagesByConversation,
    summaryCheckpointByConversation,
  ]);

  const handleRestoreHistoryBackup = useCallback(async (raw: unknown) => {
    const payload = getBackupPayload<HistoryBackupPayload>(raw, 'history');
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid history backup payload.');
    }
    if (!('conversations' in payload) || !('messagesByConversation' in payload) || !('folders' in payload)) {
      throw new Error('Invalid history backup payload.');
    }

    const loadedFolders = sanitizeFolders(payload.folders);
    const folderIds = new Set(loadedFolders.map((folder) => folder.id));
    const loadedConversations = sanitizeConversations(payload.conversations).map((conversation) => ({
      ...conversation,
      folderId: conversation.folderId && folderIds.has(conversation.folderId) ? conversation.folderId : null,
    }));
    const validConversationIds = new Set(loadedConversations.map((conversation) => conversation.id));
    const loadedMessages = sanitizeMessagesByConversation(payload.messagesByConversation, validConversationIds);
    const summaryCheckpoints = sanitizeSummaryCheckpointByConversation(payload.summaryCheckpointByConversation);
    const filteredSummaryCheckpoints = Object.fromEntries(
      Object.entries(summaryCheckpoints).filter(([conversationId]) => validConversationIds.has(conversationId))
    );
    const fallbackConversationId =
      loadedConversations.find((conversation) => !conversation.deletedAt && !conversation.archivedAt)?.id ||
      loadedConversations[0]?.id ||
      '';
    const nextActiveConversationId =
      typeof payload.activeConversationId === 'string' && validConversationIds.has(payload.activeConversationId)
        ? payload.activeConversationId
        : fallbackConversationId;
    const nextContextSummaryConversationId =
      typeof payload.contextSummaryConversationId === 'string' && validConversationIds.has(payload.contextSummaryConversationId)
        ? payload.contextSummaryConversationId
        : nextActiveConversationId;

    cancelOngoingRequest();
    clearAllDocStores();
    resetVectorStore();
    indexedMemoryMessageIdsRef.current.clear();
    hasSeededInfiniteMemoryRef.current = false;
    setFolders(loadedFolders);
    setConversations(loadedConversations);
    setMessagesByConversation(loadedMessages);
    setActiveConversationId(nextActiveConversationId);
    setContextSummary(typeof payload.contextSummary === 'string' ? payload.contextSummary : INITIAL_CONTEXT_SUMMARY);
    setContextSummaryConversationId(nextContextSummaryConversationId);
    setSummaryCheckpointByConversation(filteredSummaryCheckpoints);
    setActiveWorkspace('chat');
  }, []);

  const handleCreateNotesBackup = useCallback(async () => {
    const payload: NotesBackupPayload = { notesWorkspace };
    const backup: BackupEnvelope<NotesBackupPayload> = {
      app: 'optimAIzer',
      type: 'notes',
      version: BACKUP_SCHEMA_VERSION,
      exportedAt: Date.now(),
      payload,
    };
    return backup;
  }, [notesWorkspace]);

  const handleRestoreNotesBackup = useCallback(async (raw: unknown) => {
    const payload = getBackupPayload<NotesBackupPayload>(raw, 'notes');
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid notes backup payload.');
    }
    if (!('notesWorkspace' in payload)) {
      throw new Error('Invalid notes backup payload.');
    }

    const restoredNotesWorkspace = sanitizeNotesWorkspaceState(
      payload.notesWorkspace,
      appSettings.language,
      appSettings.provider,
      appSettings.mainModel
    );

    setNotesWorkspace(restoredNotesWorkspace);
    setActiveWorkspace('notes');
  }, [appSettings.language, appSettings.mainModel, appSettings.provider]);

  const handleCreateAgentsBackup = useCallback(async (options: { includeIntegrationSecrets: boolean }) => {
    const stripSecrets = !options.includeIntegrationSecrets;

    const sanitizedAgents = agentWorkspace.agents.map((agent) => {
      if (!stripSecrets) return agent;

      const cleanIntegrations = {
        ...agent.integrations,
        telegram: {
          ...agent.integrations.telegram,
          botToken: '',
          chatId: '',
        },
        mcpServers: agent.integrations.mcpServers.map((server) => ({
          ...server,
          config: Object.fromEntries(Object.keys(server.config).map((k) => [k, ''])),
        })),
        calendar: agent.integrations.calendar
          ? {
              google: agent.integrations.calendar.google
                ? { clientId: '', clientSecret: '', refreshToken: '', calendarId: agent.integrations.calendar.google.calendarId ?? '' }
                : undefined,
              icloud: agent.integrations.calendar.icloud
                ? { email: '', appSpecificPassword: '', calendarName: agent.integrations.calendar.icloud.calendarName ?? '' }
                : undefined,
            }
          : undefined,
        media: agent.integrations.media
          ? {
              radarr: agent.integrations.media.radarr ? { url: '', apiKey: '' } : undefined,
              sonarr: agent.integrations.media.sonarr ? { url: '', apiKey: '' } : undefined,
            }
          : undefined,
      };

      return { ...agent, integrations: cleanIntegrations };
    });

    const sanitizedWorkspace: AgentWorkspaceState = {
      agents: sanitizedAgents,
      activeAgentId: agentWorkspace.activeAgentId,
    };

    const payload: AgentsBackupPayload = {
      agentWorkspace: sanitizedWorkspace,
      includesSecrets: options.includeIntegrationSecrets,
    };

    const backup: BackupEnvelope<AgentsBackupPayload> = {
      app: 'optimAIzer',
      type: 'agents',
      version: BACKUP_SCHEMA_VERSION,
      exportedAt: Date.now(),
      payload,
    };

    return backup;
  }, [agentWorkspace]);

  const handleRestoreAgentsBackup = useCallback(async (raw: unknown) => {
    const payload = getBackupPayload<AgentsBackupPayload>(raw, 'agents');
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid agents backup payload.');
    }
    if (!('agentWorkspace' in payload)) {
      throw new Error('Invalid agents backup payload.');
    }

    const restoredAgentWorkspace = sanitizeAgentWorkspaceState(
      payload.agentWorkspace,
      appSettings.language
    );

    setAgentWorkspace(restoredAgentWorkspace);
    setActiveWorkspace('agents');
  }, [appSettings.language]);

  const handleCreateFullBackup = useCallback(async (options: { includeApiKeys: boolean; includeIntegrationSecrets: boolean }) => {
    const settingsBackup = await handleCreateSettingsBackup({ includeApiKeys: options.includeApiKeys });
    const historyBackup = await handleCreateHistoryBackup();
    const notesBackup = await handleCreateNotesBackup();
    const agentsBackup = await handleCreateAgentsBackup({ includeIntegrationSecrets: options.includeIntegrationSecrets });

    const payload: FullBackupPayload = {
      settings: getBackupPayload<SettingsBackupPayload>(settingsBackup, 'settings'),
      history: getBackupPayload<HistoryBackupPayload>(historyBackup, 'history'),
      notes: getBackupPayload<NotesBackupPayload>(notesBackup, 'notes'),
      agents: getBackupPayload<AgentsBackupPayload>(agentsBackup, 'agents'),
      includesApiKeys: options.includeApiKeys,
      includesAgentSecrets: options.includeIntegrationSecrets,
    };

    const backup: BackupEnvelope<FullBackupPayload> = {
      app: 'optimAIzer',
      type: 'full',
      version: BACKUP_SCHEMA_VERSION,
      exportedAt: Date.now(),
      payload,
    };

    return backup;
  }, [handleCreateAgentsBackup, handleCreateHistoryBackup, handleCreateNotesBackup, handleCreateSettingsBackup]);

  const handleRestoreFullBackup = useCallback(async (raw: unknown) => {
    const candidate = getBackupPayload<FullBackupPayload | LegacyFlatFullBackupPayload>(raw, 'full');
    if (!candidate || typeof candidate !== 'object') {
      throw new Error('Invalid full backup payload.');
    }

    const payload: FullBackupPayload =
      'settings' in candidate && 'history' in candidate && 'notes' in candidate && 'agents' in candidate
        ? candidate
        : {
            settings: {
              appSettings: (candidate as LegacyFlatFullBackupPayload).appSettings,
              systemPrompts: (candidate as LegacyFlatFullBackupPayload).systemPrompts,
              quickInsertPrompts: (candidate as LegacyFlatFullBackupPayload).quickInsertPrompts,
              apiKeys: (candidate as LegacyFlatFullBackupPayload).apiKeys,
            },
            history: {
              conversations: (candidate as LegacyFlatFullBackupPayload).conversations,
              folders: (candidate as LegacyFlatFullBackupPayload).folders,
              messagesByConversation: (candidate as LegacyFlatFullBackupPayload).messagesByConversation,
              activeConversationId: (candidate as LegacyFlatFullBackupPayload).activeConversationId,
              contextSummary: (candidate as LegacyFlatFullBackupPayload).contextSummary,
              contextSummaryConversationId: (candidate as LegacyFlatFullBackupPayload).contextSummaryConversationId,
              summaryCheckpointByConversation: (candidate as LegacyFlatFullBackupPayload).summaryCheckpointByConversation,
            },
            notes: {
              notesWorkspace: (candidate as LegacyFlatFullBackupPayload).notesWorkspace,
            },
            agents: {
              agentWorkspace: (candidate as LegacyFlatFullBackupPayload).agentWorkspace,
              includesSecrets: Boolean((candidate as LegacyFlatFullBackupPayload).includesSecrets),
            },
            includesApiKeys: Boolean((candidate as LegacyFlatFullBackupPayload).includesApiKeys),
            includesAgentSecrets: Boolean(
              (candidate as LegacyFlatFullBackupPayload).includesAgentSecrets ??
              (candidate as LegacyFlatFullBackupPayload).includesSecrets
            ),
          };

    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid full backup payload.');
    }
    if (!('settings' in payload) || !('history' in payload) || !('notes' in payload) || !('agents' in payload)) {
      throw new Error('Invalid full backup payload.');
    }

    const settingsPayload = payload.settings;
    if (!settingsPayload || typeof settingsPayload !== 'object' || !('appSettings' in settingsPayload)) {
      throw new Error('Invalid settings backup payload.');
    }

    const nextSettings = sanitizeSettings(settingsPayload.appSettings);
    const nextSystemPrompts = sanitizeSystemPrompts(settingsPayload.systemPrompts, nextSettings.language);
    const nextQuickInsertPrompts = sanitizeQuickInsertPrompts(settingsPayload.quickInsertPrompts);

    const historyPayload = payload.history;
    if (!historyPayload || typeof historyPayload !== 'object') {
      throw new Error('Invalid history backup payload.');
    }
    if (!('conversations' in historyPayload) || !('messagesByConversation' in historyPayload) || !('folders' in historyPayload)) {
      throw new Error('Invalid history backup payload.');
    }

    const loadedFolders = sanitizeFolders(historyPayload.folders);
    const folderIds = new Set(loadedFolders.map((folder) => folder.id));
    const loadedConversations = sanitizeConversations(historyPayload.conversations).map((conversation) => ({
      ...conversation,
      folderId: conversation.folderId && folderIds.has(conversation.folderId) ? conversation.folderId : null,
    }));
    const validConversationIds = new Set(loadedConversations.map((conversation) => conversation.id));
    const loadedMessages = sanitizeMessagesByConversation(historyPayload.messagesByConversation, validConversationIds);
    const summaryCheckpoints = sanitizeSummaryCheckpointByConversation(historyPayload.summaryCheckpointByConversation);
    const filteredSummaryCheckpoints = Object.fromEntries(
      Object.entries(summaryCheckpoints).filter(([conversationId]) => validConversationIds.has(conversationId))
    );
    const fallbackConversationId =
      loadedConversations.find((conversation) => !conversation.deletedAt && !conversation.archivedAt)?.id ||
      loadedConversations[0]?.id ||
      '';
    const nextActiveConversationId =
      typeof historyPayload.activeConversationId === 'string' && validConversationIds.has(historyPayload.activeConversationId)
        ? historyPayload.activeConversationId
        : fallbackConversationId;
    const nextContextSummaryConversationId =
      typeof historyPayload.contextSummaryConversationId === 'string' && validConversationIds.has(historyPayload.contextSummaryConversationId)
        ? historyPayload.contextSummaryConversationId
        : nextActiveConversationId;

    const notesPayload = payload.notes;
    if (!notesPayload || typeof notesPayload !== 'object' || !('notesWorkspace' in notesPayload)) {
      throw new Error('Invalid notes backup payload.');
    }

    const restoredNotesWorkspace = sanitizeNotesWorkspaceState(
      notesPayload.notesWorkspace,
      nextSettings.language,
      nextSettings.provider,
      nextSettings.mainModel
    );

    const agentsPayload = payload.agents;
    if (!agentsPayload || typeof agentsPayload !== 'object' || !('agentWorkspace' in agentsPayload)) {
      throw new Error('Invalid agents backup payload.');
    }

    const restoredAgentWorkspace = sanitizeAgentWorkspaceState(
      agentsPayload.agentWorkspace,
      nextSettings.language
    );

    cancelOngoingRequest();
    clearAllDocStores();
    resetVectorStore();
    indexedMemoryMessageIdsRef.current.clear();
    hasSeededInfiniteMemoryRef.current = false;

    setAppSettings(nextSettings);
    setSystemPrompts(nextSystemPrompts);
    setQuickInsertPrompts(nextQuickInsertPrompts);
    setFolders(loadedFolders);
    setConversations(loadedConversations);
    setMessagesByConversation(loadedMessages);
    setActiveConversationId(nextActiveConversationId);
    setContextSummary(typeof historyPayload.contextSummary === 'string' ? historyPayload.contextSummary : INITIAL_CONTEXT_SUMMARY);
    setContextSummaryConversationId(nextContextSummaryConversationId);
    setSummaryCheckpointByConversation(filteredSummaryCheckpoints);
    setNotesWorkspace(restoredNotesWorkspace);
    setAgentWorkspace(restoredAgentWorkspace);
    setActiveWorkspace('chat');

    if (settingsPayload.apiKeys && Object.keys(settingsPayload.apiKeys).length > 0) {
      if (authUser?.role !== 'admin') {
        throw new Error(
          nextSettings.language === 'es'
            ? 'Solo los usuarios admin pueden restaurar API keys.'
            : 'Only admin users can restore API keys.'
        );
      }
      await importProviderApiKeysBackup(settingsPayload.apiKeys);
      refreshProviders();
    }
  }, [authUser?.role, refreshProviders]);

  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-zinc-500 dark:text-zinc-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading session...</span>
        </div>
      </div>
    );
  }

  if (!authUser) {
    return <LoginScreen loading={loginBusy} error={loginError} onLogin={handleLogin} />;
  }

  if (!isDataLoaded) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-zinc-500 dark:text-zinc-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-current border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  const sanitizedSettingsForModal = sanitizeSettings(appSettings);

  return (
    <div className="flex h-screen w-full bg-background text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans relative transition-colors duration-300">
      <div className="fixed top-2 left-2 z-50 pointer-events-none select-none">
        <img
          src="/logo.png"
          alt="optimAIzer"
          className="w-8 h-8 md:w-9 md:h-9 rounded-lg border border-zinc-200/70 dark:border-zinc-700/70 bg-white/90 dark:bg-zinc-900/90 shadow-lg object-contain"
        />
      </div>
      
      {/* Mobile Menu Overlay */}
      {leftSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setLeftSidebarOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <div className={`
        fixed inset-y-0 left-0 z-40 bg-surface border-r border-border transform transition-transform duration-300 ease-in-out shadow-2xl lg:shadow-none
        ${leftSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:relative lg:translate-x-0 lg:z-auto
        ${!leftSidebarOpen && 'lg:hidden'} 
      `}
      style={{ width: `${leftSidebarWidth}px` }}>
        <SidebarLeft 
          conversations={conversations}
          notes={notesWorkspace.notes}
          noteFolders={notesWorkspace.noteFolders}
          agents={agentWorkspace.agents.map((agent) => ({
            id: agent.id,
            name: agent.name,
            objective: agent.objective,
            archivedAt: agent.archivedAt ?? null,
            deletedAt: agent.deletedAt ?? null,
          }))}
          folders={folders}
          activeId={activeConversation?.id || activeConversationId}
          activeNoteId={notesWorkspace.activeNoteId}
          activeAgentId={agentWorkspace.activeAgentId}
          onSelectConversation={handleConversationSelect}
          onSelectNote={handleSelectNote}
          onSelectAgent={handleAgentSelect}
          onNewChat={handleCreateConversation}
          onNewNote={handleCreateNote}
          onNewAgent={handleCreateAgent}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onLogout={() => void handleLogout()}
          userName={appSettings.userName}
          onClose={() => setLeftSidebarOpen(false)}
          language={appSettings.language}
          activeWorkspace={activeWorkspace}
          onChangeWorkspace={handleWorkspaceChange}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onRenameChat={handleRenameChat}
          onMoveChat={handleMoveChat}
          onArchiveChat={handleArchiveChat}
          onUnarchiveChat={handleUnarchiveChat}
          onDeleteChat={handleDeleteChat}
          onRestoreChat={handleRestoreChat}
          onPermanentDeleteChat={handlePermanentDeleteChat}
          onRenameNote={handleRenameNote}
          onArchiveNote={handleArchiveNote}
          onUnarchiveNote={handleUnarchiveNote}
          onDeleteNote={handleDeleteNote}
          onRestoreNote={handleRestoreNote}
          onPermanentDeleteNote={handlePermanentDeleteNote}
          onCreateNoteFolder={handleCreateNoteFolder}
          onRenameNoteFolder={handleRenameNoteFolder}
          onDeleteNoteFolder={handleDeleteNoteFolder}
          onMoveNote={handleMoveNote}
          onRenameAgent={handleRenameAgent}
          onArchiveAgent={handleArchiveAgent}
          onUnarchiveAgent={handleUnarchiveAgent}
          onDeleteAgent={handleDeleteAgent}
          onRestoreAgent={handleRestoreAgent}
          onPermanentDeleteAgent={handlePermanentDeleteAgent}
        />
        <button
          type="button"
          onMouseDown={(event) => {
            event.preventDefault();
            startSidebarResize('left');
          }}
          className="absolute right-0 top-0 hidden h-full w-2 translate-x-1/2 cursor-col-resize lg:block"
          aria-label={appSettings.language === 'es' ? 'Redimensionar panel izquierdo' : 'Resize left sidebar'}
          title={appSettings.language === 'es' ? 'Redimensionar panel izquierdo' : 'Resize left sidebar'}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-background relative h-full transition-all duration-300">
        {activeWorkspace === 'chat' ? (
          <>
            {/* Header */}
            <header className="border-b border-border px-3 md:px-4 py-2 bg-background/80 backdrop-blur-sm sticky top-0 z-20">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="flex items-start md:items-center gap-2 md:gap-3 flex-1 min-w-0">
                  {!leftSidebarOpen && (
                    <button
                      onClick={() => setLeftSidebarOpen(true)}
                      className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-primary transition-colors flex-shrink-0"
                    >
                      <Menu size={20} />
                    </button>
                  )}

                  <div className="flex-1 min-w-0">
                    <TopBar
                      settings={appSettings}
                      systemPrompts={systemPrompts}
                      onUpdateSetting={updateSetting}
                      sessionCostUsd={conversationUsage.totalCostUsd}
                      sessionInputTokens={conversationUsage.inputTokens}
                      sessionOutputTokens={conversationUsage.outputTokens}
                      monthlyCostUsd={monthlyUsage.totalCostUsd}
                      monthlyBudgetUsd={appSettings.monthlyBudgetUsd}
                      sessionBudgetUsd={appSettings.sessionBudgetUsd}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 md:ml-2 flex-shrink-0">
                  {activeConversation && (
                    <ExportButton
                      conversation={activeConversation}
                      messages={messages}
                      userName={appSettings.userName}
                      language={appSettings.language}
                    />
                  )}

                  {!rightSidebarOpen && (
                    <>
                      <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1"></div>
                      <button
                        onClick={() => setRightSidebarOpen(true)}
                        className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-primary transition-colors"
                      >
                        <PanelRightOpen size={20} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </header>

            {/* Chat Area */}
            <main className="flex-1 overflow-hidden relative flex flex-col">
              <ChatArea
                conversationId={activeConversation?.id || activeConversationId}
                messages={messages}
                onSendMessage={handleSendMessage}
                onCancelStreaming={cancelOngoingRequest}
                onRetry={handleRetryMessage}
                onBranch={handleBranchChat}
                language={appSettings.language}
                isTyping={isTyping}
                ragStatus={ragStatus}
                quickPrompts={quickInsertPrompts}
              />
            </main>
          </>
        ) : activeWorkspace === 'notes' ? (
          <>
            <header className="border-b border-border px-3 md:px-4 py-2 bg-background/80 backdrop-blur-sm sticky top-0 z-20">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                <div className="flex items-start md:items-center gap-2 md:gap-3 flex-1 min-w-0">
                  {!leftSidebarOpen && (
                    <button
                      onClick={() => setLeftSidebarOpen(true)}
                      className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-primary transition-colors flex-shrink-0"
                    >
                      <Menu size={20} />
                    </button>
                  )}

                  <div className="flex-1 min-w-0">
                    <TopBar
                      settings={appSettings}
                      systemPrompts={systemPrompts}
                      onUpdateSetting={updateSetting}
                      sessionCostUsd={conversationUsage.totalCostUsd}
                      sessionInputTokens={conversationUsage.inputTokens}
                      sessionOutputTokens={conversationUsage.outputTokens}
                      monthlyCostUsd={monthlyUsage.totalCostUsd}
                      monthlyBudgetUsd={appSettings.monthlyBudgetUsd}
                      sessionBudgetUsd={appSettings.sessionBudgetUsd}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 md:ml-2 flex-shrink-0">
                  {!rightSidebarOpen && (
                    <>
                      <div className="w-px h-6 bg-zinc-200 dark:bg-zinc-800 mx-1" />
                      <button
                        onClick={() => setRightSidebarOpen(true)}
                        className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-primary transition-colors"
                      >
                        <PanelRightOpen size={20} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </header>

            <main className="flex-1 overflow-hidden relative flex flex-col">
              <NotesWorkspace
                language={appSettings.language}
                settings={appSettings}
                workspace={notesWorkspace}
                activeNote={activeNote}
                availableProviders={agentProviderOptions}
                onCreateNote={handleCreateNote}
                onUpdateNoteContent={handleUpdateNoteContent}
                onUpdateWorkspace={setNotesWorkspace}
                onManualSave={handleManualSaveNotes}
                defaultAiStyles={DEFAULT_NOTE_AI_STYLES}
                rightSidebarOpen={rightSidebarOpen}
                onCloseRightSidebar={() => setRightSidebarOpen(false)}
                rightSidebarWidth={rightSidebarWidth}
                onStartRightSidebarResize={() => startSidebarResize('right')}
              />
            </main>
          </>
        ) : (
          <>
            <header className="border-b border-border px-3 md:px-4 py-3 bg-background/80 backdrop-blur-sm sticky top-0 z-20">
              <div className="flex items-center gap-2">
                {!leftSidebarOpen && (
                  <button
                    onClick={() => setLeftSidebarOpen(true)}
                    className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-md text-zinc-500 dark:text-zinc-400 hover:text-primary transition-colors"
                  >
                    <Menu size={20} />
                  </button>
                )}
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {appSettings.language === 'es' ? 'Agentes' : 'Agents'}
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {appSettings.language === 'es'
                      ? 'Configuración segura y granular de agentes autónomos.'
                      : 'Secure and granular autonomous agent configuration.'}
                  </p>
                </div>
              </div>
            </header>

            <main className="flex-1 overflow-hidden relative flex flex-col">
              <AgentsWorkspace
                language={appSettings.language}
                workspace={agentWorkspace}
                preferredProviderId={preferredAgentProviderId}
                preferredModelId={preferredAgentModelId}
                preferredSystemPromptId={preferredAgentSystemPromptId}
                preferredTemperature={preferredAgentTemperature}
                preferredMaxTokens={preferredAgentMaxTokens}
                systemPrompts={systemPrompts}
                availableProviders={agentProviderOptions}
                onWorkspaceChange={setAgentWorkspace}
              />
            </main>
          </>
        )}
      </div>

      {/* Mobile Menu Overlay Right */}
      {activeWorkspace === 'chat' && rightSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setRightSidebarOpen(false)}
        />
      )}

      {/* Right Sidebar */}
      {activeWorkspace === 'chat' && (
        <div className={`
          fixed inset-y-0 right-0 z-40 bg-surface border-l border-border transform transition-transform duration-300 ease-in-out shadow-2xl lg:shadow-none
          ${rightSidebarOpen ? 'translate-x-0' : 'translate-x-full'}
          lg:relative lg:translate-x-0 lg:z-auto
          ${!rightSidebarOpen && 'lg:hidden'}
        `}
        style={{ width: `${rightSidebarWidth}px` }}>
          <SidebarRight 
              settings={appSettings}
              onUpdateSetting={updateSetting}
              contextSummary={contextSummary}
              isSummarizing={isSummarizing}
              onClose={() => setRightSidebarOpen(false)}
          />
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              startSidebarResize('right');
            }}
            className="absolute left-0 top-0 hidden h-full w-2 -translate-x-1/2 cursor-col-resize lg:block"
            aria-label={appSettings.language === 'es' ? 'Redimensionar panel derecho' : 'Resize right sidebar'}
            title={appSettings.language === 'es' ? 'Redimensionar panel derecho' : 'Resize right sidebar'}
          />
        </div>
      )}

      {/* Modals */}
      {isSettingsModalOpen && (
        <SettingsErrorBoundary
          language={appSettings.language}
          onClose={() => setIsSettingsModalOpen(false)}
        >
          <SettingsModal 
            isOpen={isSettingsModalOpen}
            onClose={() => setIsSettingsModalOpen(false)}
            settings={sanitizedSettingsForModal}
            onUpdateSetting={updateSetting}
            systemPrompts={systemPrompts}
            onSaveSystemPrompt={handleSaveSystemPrompt}
            onDeleteSystemPrompt={handleDeleteSystemPrompt}
            quickInsertPrompts={quickInsertPrompts}
            onSaveQuickInsertPrompt={handleSaveQuickInsertPrompt}
            onDeleteQuickInsertPrompt={handleDeleteQuickInsertPrompt}
            providerStatuses={providerStatuses}
            onProvidersChanged={refreshProviders}
            providerModelSyncStatus={providerModelSyncStatus}
            providerModelSyncBusy={providerModelSyncBusy}
            onRefreshProviderModels={refreshProviderModels}
            usageEvents={usageEvents}
            onMoveAllHistoryToTrash={handleMoveAllHistoryToTrash}
            onDeleteAllHistoryAndTrash={handleDeleteAllHistoryAndTrash}
            onEmptyTrash={handleEmptyTrash}
            onResetSettingsAndApiKeys={handleResetSettingsAndApiKeys}
            onDeleteAllUserData={handleDeleteAllUserData}
            onResetUsageCost={handleResetUsageCost}
            currentUser={authUser}
            onUserUpdated={setAuthUser}
            onLogout={handleLogout}
            onCreateSettingsBackup={handleCreateSettingsBackup}
            onRestoreSettingsBackup={handleRestoreSettingsBackup}
            onCreateHistoryBackup={handleCreateHistoryBackup}
            onRestoreHistoryBackup={handleRestoreHistoryBackup}
            onCreateNotesBackup={handleCreateNotesBackup}
            onRestoreNotesBackup={handleRestoreNotesBackup}
            onCreateAgentsBackup={handleCreateAgentsBackup}
            onRestoreAgentsBackup={handleRestoreAgentsBackup}
            onCreateFullBackup={handleCreateFullBackup}
            onRestoreFullBackup={handleRestoreFullBackup}
          />
        </SettingsErrorBoundary>
      )}

    </div>
  );
};

export default App;
