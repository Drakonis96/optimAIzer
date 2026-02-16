
export type Role = 'user' | 'assistant' | 'system';

export interface Quote {
  originalMessageId: string;
  content: string;
  role: Role;
}

export interface CouncilAnswer {
    model: string;
    content: string;
    completed: boolean;
}

export interface ConciliumCostComparison {
  totalConciliumCostUsd: number;
  soloLeaderCostUsd: number;
  ratio: number;
}

export interface ArenaAnswer {
  provider: string;
  model: string;
  content: string;
  completed: boolean;
  temperature?: number;
}

export interface MessageAttachment {
  type: 'text' | 'image' | 'pdf' | 'unknown';
  fileName: string;
  textContent?: string;
  dataUrl?: string; // base64 for images
  mimeType: string;
  sizeBytes: number;
  truncated?: boolean;
  error?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  quote?: Quote; // Optional referenced content
  provider?: string; // Optional: specific provider for this message
  model?: string; // Optional: specific model for this message
  
  // Attachments
  attachments?: MessageAttachment[];

  // Concilium specific
  isConcilium?: boolean; 
  councilAnswers?: CouncilAnswer[];
  conciliumCostComparison?: ConciliumCostComparison;
  isArena?: boolean;
  arenaAnswers?: [ArenaAnswer, ArenaAnswer];
  
  // State
  isThinking?: boolean; // Show loading dots
}

export interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  snippet: string;
  folderId?: string | null; // null means root
  deletedAt?: number | null; // null means active
  archivedAt?: number | null; // null means visible in main list
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
}

export interface NoteDocument {
  id: string;
  title: string;
  content: string;
  snippet: string;
  updatedAt: number;
  folderId?: string | null;
  deletedAt?: number | null;
  archivedAt?: number | null;
}

export type NoteInsertionMode = 'replace' | 'insert_below';

export interface NotesWorkspaceState {
  notes: NoteDocument[];
  noteFolders: Folder[];
  activeNoteId: string;
  aiStyles: string[];
  insertionMode: NoteInsertionMode;
  translationTargetLanguage: string;
  readingZoom: number;
  conciliumMembers: ModelSelector[];
}

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  isDefault?: boolean; // If true, it changes translation when language changes
}

export interface QuickInsertPrompt {
  id: string;
  title: string;
  content: string;
}

export interface ModelSelector {
    provider: string;
    model: string;
}

export type ConciliumMode = 'consensus' | 'factcheck' | 'codereview' | 'brainstorm' | 'debate';

export interface ConciliumPreset {
  id: string;
  name: string;
  members: ModelSelector[];
  leader: ModelSelector;
  mode: ConciliumMode;
}

export type ThemeMode = 'light' | 'dark';
export type Language = 'en' | 'es';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type ModelVisibilityMode = 'all' | 'vendor' | 'pinned';
export type WorkspaceView = 'chat' | 'notes' | 'agents';

export interface ToolingOptions {
  webSearch: boolean;
  codeExecution: boolean;
}

export interface ProviderModelFilterSettings {
  mode: ModelVisibilityMode;
  vendorAllowlist: string[];
  pinnedModelIds: string[];
}

export interface ManualModelPricingOverride {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface PersonalizationProfile {
  nickname: string;
  occupation: string;
  familyAndFriends: string;
  leisure: string;
  other: string;
}

export interface AppSettings {
  userName: string;
  includeLocationInContext: boolean;
  locationLabel: string;
  personalization: PersonalizationProfile;
  
  // Interface
  language: Language;
  themeMode: ThemeMode;
  themeColor: string; // RGB value or Identifier

  // AI Main
  provider: string; 
  mainModel: string;
  rememberedMainModelByProvider: Record<string, string>;
  telegramProvider: string;
  telegramModel: string;
  reasoningEffort: ReasoningEffort;
  temperature: number;
  enableModelTools: boolean;
  tooling: ToolingOptions;
  
  // Context Config
  contextProvider: string; 
  contextModel: string;
  rememberedContextModelByProvider: Record<string, string>;
  enableContext: boolean;
  enableSummary: boolean;
  maxContextMessages: number;
  
  // RAG / Memory
  enableInfiniteMemory: boolean;
  ragEmbeddingProvider: string; // provider for embeddings ('' = use built-in TF-IDF)
  ragEmbeddingModel: string;   // model for embeddings ('' = use built-in TF-IDF)

  // Output Config
  maxOutputTokens: number;
  unlimitedOutputTokens: boolean;

  // System Prompt
  selectedSystemPromptId: string;

  // Budget Controls
  monthlyBudgetUsd: number; // 0 disables monthly budget alert
  sessionBudgetUsd: number; // 0 disables session budget progress

  // Concilium Mode
  enableConcilium: boolean;
  conciliumMembers: ModelSelector[];
  conciliumLeader: ModelSelector;
  conciliumMode: ConciliumMode;
  conciliumBlindEval: boolean;
  conciliumPresets: ConciliumPreset[];
  rememberedLeaderModelByProvider: Record<string, string>;

  // Arena Mode
  enableArena: boolean;
  arenaMembers: [ModelSelector, ModelSelector];
  arenaTemperatures: [number, number];

  modelFiltersByProvider: Record<string, ProviderModelFilterSettings>;
  manualModelPricingByProviderModelKey: Record<string, ManualModelPricingOverride>;
}

export interface ModelOption {
    id: string;
    name: string;
    description?: string;
    vendor?: string;
    contextLength?: number;
    inputPerMillionUsd?: number;
    outputPerMillionUsd?: number;
    pricingSourceUrl?: string;
    pricingSourceLabel?: string;
    pricingUpdatedAt?: number;
}

export interface ProviderModelSyncStatus {
  source: 'live' | 'fallback';
  fetchedAt: number;
  error?: string;
}

export interface ThemeColorOption {
    id: string;
    name: string;
    rgb: string; // 'r g b' format for Tailwind var
    hoverRgb: string;
    hex: string; // For UI display
}

export type UsageEventSource = 'chat' | 'concilium_member' | 'concilium_leader' | 'summary';
export type UsageAggregationPeriod = 'day' | 'week' | 'month' | 'year';

export interface UsageCostEvent {
  id: string;
  timestamp: number;
  conversationId?: string;
  provider: string;
  model: string;
  apiKeyId?: string;
  apiKeyName?: string;
  apiKeyMasked?: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  toolingCostUsd: number;
  toolWebSearchEnabled: boolean;
  toolCodeExecutionEnabled: boolean;
  source: UsageEventSource;
  estimated: boolean;
}

export interface UsageAggregate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  calls: number;
}

export interface UsageBucket extends UsageAggregate {
  key: string;
  label: string;
}
