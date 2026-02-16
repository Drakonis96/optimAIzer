
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Save, Trash2, PlusCircle, BrainCircuit, ChevronDown, Scale, Gavel, Palette, Monitor, Globe, Moon, Sun, Check, Key, Eye, EyeOff, ShieldCheck, Loader2, BarChart3, CalendarRange, AlertTriangle, Filter, Pin, PinOff, RefreshCw, FileText, UserRound, MapPin, LogOut, Download, Upload } from 'lucide-react';
import { AppSettings, ProviderModelFilterSettings, ProviderModelSyncStatus, SystemPrompt, UsageAggregationPeriod, UsageCostEvent, QuickInsertPrompt } from '../types';
import { getAllModelsForProvider, getModelsForProvider, getRagEmbeddingModelsForProvider, getRagEmbeddingProviders, inferModelVendor, providerRequiresApiKey, providerSupportsVendorFilter, PROVIDERS, THEME_COLORS, TRANSLATIONS } from '../constants';
import {
  addProviderApiKey,
  changeCurrentUserPassword,
  createUserAccount,
  deleteUserAccount,
  deleteProviderApiKey,
  getProviderStatus,
  listUsers,
  setActiveProviderApiKey,
  updateUserAccount,
  type AuthUser,
  type ProviderStatus,
  type ProviderStatusDetail,
} from '../services/api';
import { MODEL_PRICING, PRICING_LAST_UPDATED, aggregateUsageByModel, aggregateUsageByPeriod, getModelPricing, summarizeUsage } from '../utils/costs';
import { ConfirmationModal } from './ConfirmationModal';

type DangerActionId =
  | 'moveHistoryToTrash'
  | 'deleteAllHistoryAndTrash'
  | 'emptyTrash'
  | 'resetSettingsAndApiKeys'
  | 'deleteAllUserData';

interface DangerConfirmState {
  id: DangerActionId;
  title: string;
  message: string;
  confirmText: string;
}

interface ApiKeyDeleteConfirmState {
  providerId: string;
  providerName: string;
  keyId?: string;
  keyName?: string;
}

interface ManualCostEditorState {
  providerId: string;
  modelId: string;
  inputPerMillionUsd: string;
  outputPerMillionUsd: string;
  error: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onUpdateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  systemPrompts: SystemPrompt[];
  onSaveSystemPrompt: (prompt: SystemPrompt) => void;
  onDeleteSystemPrompt: (id: string) => void;
  quickInsertPrompts: QuickInsertPrompt[];
  onSaveQuickInsertPrompt: (prompt: QuickInsertPrompt) => void;
  onDeleteQuickInsertPrompt: (id: string) => void;
  providerStatuses: ProviderStatus[];
  onProvidersChanged: () => void;
  providerModelSyncStatus: Record<string, ProviderModelSyncStatus>;
  providerModelSyncBusy: Record<string, boolean>;
  onRefreshProviderModels: (providerId: string, forceRefresh?: boolean) => Promise<void>;
  usageEvents: UsageCostEvent[];
  onMoveAllHistoryToTrash: () => void | Promise<void>;
  onDeleteAllHistoryAndTrash: () => void | Promise<void>;
  onEmptyTrash: () => void | Promise<void>;
  onResetSettingsAndApiKeys: () => void | Promise<void>;
  onDeleteAllUserData: () => void | Promise<void>;
  onResetUsageCost: () => void | Promise<void>;
  currentUser: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onLogout: () => void | Promise<void>;
  onCreateSettingsBackup: (options: { includeApiKeys: boolean }) => Promise<unknown>;
  onRestoreSettingsBackup: (payload: unknown) => Promise<void>;
  onCreateHistoryBackup: () => Promise<unknown>;
  onRestoreHistoryBackup: (payload: unknown) => Promise<void>;
  onCreateNotesBackup: () => Promise<unknown>;
  onRestoreNotesBackup: (payload: unknown) => Promise<void>;
  onCreateAgentsBackup: (options: { includeIntegrationSecrets: boolean }) => Promise<unknown>;
  onRestoreAgentsBackup: (payload: unknown) => Promise<void>;
  onCreateFullBackup: (options: { includeApiKeys: boolean; includeIntegrationSecrets: boolean }) => Promise<unknown>;
  onRestoreFullBackup: (payload: unknown) => Promise<void>;
}

type SettingsTab = 'general' | 'personalization' | 'prompts' | 'interface' | 'apikeys' | 'models' | 'analytics' | 'usage' | 'backup' | 'users' | 'danger';

const getTodayStartTimestamp = (): number => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const getWeekStartTimestamp = (): number => {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // Monday as first day
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).getTime();
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSetting,
  systemPrompts,
  onSaveSystemPrompt,
  onDeleteSystemPrompt,
  quickInsertPrompts,
  onSaveQuickInsertPrompt,
  onDeleteQuickInsertPrompt,
  providerStatuses,
  onProvidersChanged,
  providerModelSyncStatus,
  providerModelSyncBusy,
  onRefreshProviderModels,
  usageEvents,
  onMoveAllHistoryToTrash,
  onDeleteAllHistoryAndTrash,
  onEmptyTrash,
  onResetSettingsAndApiKeys,
  onDeleteAllUserData,
  onResetUsageCost,
  currentUser,
  onUserUpdated,
  onLogout,
  onCreateSettingsBackup,
  onRestoreSettingsBackup,
  onCreateHistoryBackup,
  onRestoreHistoryBackup,
  onCreateNotesBackup,
  onRestoreNotesBackup,
  onCreateAgentsBackup,
  onRestoreAgentsBackup,
  onCreateFullBackup,
  onRestoreFullBackup,
}) => {
  const t = TRANSLATIONS[settings.language] ?? TRANSLATIONS.en;
  const ragEmbeddingProviders = getRagEmbeddingProviders();
  const locale = settings.language === 'es' ? 'es-ES' : 'en-US';
  const isAdmin = currentUser?.role === 'admin';
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [modelTabProvider, setModelTabProvider] = useState(settings.provider);
  const [modelSearch, setModelSearch] = useState('');
  const [modelSortOrder, setModelSortOrder] = useState<'name' | 'cost-asc' | 'cost-desc'>('name');
  const [modelVendorFilter, setModelVendorFilter] = useState<string>('all');
  const [manualCostEditor, setManualCostEditor] = useState<ManualCostEditorState | null>(null);
  const [usagePeriod, setUsagePeriod] = useState<UsageAggregationPeriod>('day');
  const [editingPrompt, setEditingPrompt] = useState<SystemPrompt>({ id: '', name: '', content: '' });
  const [editingQuickPrompt, setEditingQuickPrompt] = useState<QuickInsertPrompt>(() =>
    quickInsertPrompts[0] ? { ...quickInsertPrompts[0] } : { id: '', title: '', content: '' }
  );
  const [dangerConfirm, setDangerConfirm] = useState<DangerConfirmState | null>(null);
  const [apiKeyDeleteConfirm, setApiKeyDeleteConfirm] = useState<ApiKeyDeleteConfirmState | null>(null);
  const [dangerBusyAction, setDangerBusyAction] = useState<DangerActionId | null>(null);
  const [dangerError, setDangerError] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [saveFeedback, setSaveFeedback] = useState<Record<string, boolean>>({});
  const [generalDraft, setGeneralDraft] = useState(() => ({
    userName: settings.userName,
    telegramProvider: settings.telegramProvider,
    telegramModel: settings.telegramModel,
    contextProvider: settings.contextProvider,
    contextModel: settings.contextModel,
    ragEmbeddingProvider: settings.ragEmbeddingProvider,
    ragEmbeddingModel: settings.ragEmbeddingModel,
    conciliumLeader: { ...settings.conciliumLeader },
  }));
  const [interfaceDraft, setInterfaceDraft] = useState(() => ({
    language: settings.language,
    themeMode: settings.themeMode,
    themeColor: settings.themeColor,
  }));
  const [personalizationDraft, setPersonalizationDraft] = useState(() => ({
    personalization: { ...settings.personalization },
    includeLocationInContext: settings.includeLocationInContext,
    locationLabel: settings.locationLabel,
  }));
  const [pendingTabTarget, setPendingTabTarget] = useState<SettingsTab | null>(null);
  const [pendingClose, setPendingClose] = useState(false);
  const [unsavedWarningOpen, setUnsavedWarningOpen] = useState(false);
  
  // API key management state
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyNameInputs, setKeyNameInputs] = useState<Record<string, string>>({});
  const [keyVisibility, setKeyVisibility] = useState<Record<string, boolean>>({});
  const [providerKeyDetails, setProviderKeyDetails] = useState<Record<string, ProviderStatusDetail>>({});
  const [keySaving, setKeySaving] = useState<Record<string, boolean>>({});
  const [keyErrors, setKeyErrors] = useState<Record<string, string>>({});
  const [keySuccess, setKeySuccess] = useState<Record<string, string>>({});
  const [managedUsers, setManagedUsers] = useState<AuthUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [userDeleteConfirm, setUserDeleteConfirm] = useState<AuthUser | null>(null);
  const [userBusyId, setUserBusyId] = useState<string | null>(null);
  const [createUserName, setCreateUserName] = useState('');
  const [createUserPassword, setCreateUserPassword] = useState('');
  const [createUserError, setCreateUserError] = useState('');
  const [createUserBusy, setCreateUserBusy] = useState(false);
  const [passwordCurrent, setPasswordCurrent] = useState('');
  const [passwordNew, setPasswordNew] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [unpinAllConfirmOpen, setUnpinAllConfirmOpen] = useState(false);
  const [userDraftLimits, setUserDraftLimits] = useState<Record<string, string>>({});
  const [userDraftAllowlists, setUserDraftAllowlists] = useState<Record<string, Record<string, string[]>>>({});
  const [userSaveFeedback, setUserSaveFeedback] = useState<Record<string, string>>({});
  const [usageProviderFilter, setUsageProviderFilter] = useState('all');
  const [usageApiKeyFilter, setUsageApiKeyFilter] = useState('all');
  const [usageModelFilter, setUsageModelFilter] = useState('all');
  const [usageSourceFilter, setUsageSourceFilter] = useState('all');
  const [usageHoverBucketKey, setUsageHoverBucketKey] = useState<string | null>(null);
  const [usageResetConfirmOpen, setUsageResetConfirmOpen] = useState(false);
  const [usageResetBusy, setUsageResetBusy] = useState(false);
  const [includeApiKeysInSettingsBackup, setIncludeApiKeysInSettingsBackup] = useState(false);
  const [includeAgentSecretsInBackup, setIncludeAgentSecretsInBackup] = useState(false);
  const [includeApiKeysInFullBackup, setIncludeApiKeysInFullBackup] = useState(false);
  const [includeAgentSecretsInFullBackup, setIncludeAgentSecretsInFullBackup] = useState(false);
  const [backupBusy, setBackupBusy] = useState<Record<string, boolean>>({});
  const [backupSuccess, setBackupSuccess] = useState<Record<string, string>>({});
  const [backupErrors, setBackupErrors] = useState<Record<string, string>>({});
  const fullBackupInputRef = useRef<HTMLInputElement | null>(null);
  const settingsBackupInputRef = useRef<HTMLInputElement | null>(null);
  const historyBackupInputRef = useRef<HTMLInputElement | null>(null);
  const notesBackupInputRef = useRef<HTMLInputElement | null>(null);
  const agentsBackupInputRef = useRef<HTMLInputElement | null>(null);
  const providerNameById = useMemo(
    () => Object.fromEntries(PROVIDERS.map((provider) => [provider.id, provider.name])),
    []
  );
  const telegramModels = useMemo(
    () => getModelsForProvider(generalDraft.telegramProvider),
    [generalDraft.telegramProvider]
  );
  const contextModels = useMemo(
    () => getModelsForProvider(generalDraft.contextProvider),
    [generalDraft.contextProvider]
  );
  const leaderModels = useMemo(
    () => getModelsForProvider(generalDraft.conciliumLeader.provider),
    [generalDraft.conciliumLeader.provider]
  );
  const ragEmbeddingModels = useMemo(
    () => (generalDraft.ragEmbeddingProvider ? getRagEmbeddingModelsForProvider(generalDraft.ragEmbeddingProvider) : []),
    [generalDraft.ragEmbeddingProvider]
  );

  const filteredUsageEvents = useMemo(() => {
    return usageEvents.filter((event) => {
      if (usageProviderFilter !== 'all' && event.provider !== usageProviderFilter) return false;
      if (usageApiKeyFilter !== 'all') {
        const eventKeyId = event.apiKeyId || '__unknown__';
        if (eventKeyId !== usageApiKeyFilter) return false;
      }
      if (usageModelFilter !== 'all' && event.model !== usageModelFilter) return false;
      if (usageSourceFilter !== 'all' && event.source !== usageSourceFilter) return false;
      return true;
    });
  }, [usageEvents, usageProviderFilter, usageApiKeyFilter, usageModelFilter, usageSourceFilter]);

  const totalUsage = useMemo(() => summarizeUsage(filteredUsageEvents), [filteredUsageEvents]);
  const totalToolingCostUsd = useMemo(
    () => filteredUsageEvents.reduce((sum, event) => sum + (event.toolingCostUsd || 0), 0),
    [filteredUsageEvents]
  );
  const usageBuckets = useMemo(
    () => aggregateUsageByPeriod(filteredUsageEvents, usagePeriod, locale),
    [filteredUsageEvents, usagePeriod, locale]
  );
  const usageByModel = useMemo(() => aggregateUsageByModel(filteredUsageEvents).slice(0, 8), [filteredUsageEvents]);
  const activeUsageHoverBucket = useMemo(
    () => usageBuckets.find((bucket) => bucket.key === usageHoverBucketKey) || null,
    [usageBuckets, usageHoverBucketKey]
  );
  const maxBucketCost = useMemo(
    () => usageBuckets.reduce((max, bucket) => Math.max(max, bucket.totalCostUsd), 0),
    [usageBuckets]
  );
  const usageProviderOptions = useMemo(() => {
    const ids = new Set(usageEvents.map((event) => event.provider));
    return Array.from(ids).sort((a, b) =>
      (providerNameById[a] || a).localeCompare(providerNameById[b] || b)
    );
  }, [usageEvents, providerNameById]);
  const usageApiKeyOptions = useMemo(() => {
    const relevantByProvider =
      usageProviderFilter === 'all'
        ? usageEvents
        : usageEvents.filter((event) => event.provider === usageProviderFilter);
    const byKey = new Map<string, { label: string; provider: string }>();
    relevantByProvider.forEach((event) => {
      const keyId = event.apiKeyId || '__unknown__';
      const label =
        event.apiKeyName?.trim() ||
        event.apiKeyMasked?.trim() ||
        (settings.language === 'es' ? 'Sin clave identificada' : 'Unidentified key');
      if (!byKey.has(keyId)) {
        byKey.set(keyId, { label, provider: event.provider });
      }
    });
    return Array.from(byKey.entries())
      .map(([id, meta]) => ({
        id,
        label: usageProviderFilter === 'all' ? `${providerNameById[meta.provider] || meta.provider} · ${meta.label}` : meta.label,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [usageEvents, usageProviderFilter, providerNameById, settings.language]);
  const usageModelOptions = useMemo(() => {
    const modelSource = usageEvents.filter((event) => {
      if (usageProviderFilter !== 'all' && event.provider !== usageProviderFilter) return false;
      if (usageApiKeyFilter !== 'all') {
        const eventKeyId = event.apiKeyId || '__unknown__';
        if (eventKeyId !== usageApiKeyFilter) return false;
      }
      return true;
    });
    return Array.from(new Set(modelSource.map((event) => event.model))).sort((a, b) => a.localeCompare(b));
  }, [usageEvents, usageProviderFilter, usageApiKeyFilter]);
  const usageSourceOptions = useMemo(
    () => Array.from(new Set(usageEvents.map((event) => event.source))).sort(),
    [usageEvents]
  );
  const todayUsage = useMemo(() => {
    const start = getTodayStartTimestamp();
    return summarizeUsage(usageEvents.filter((event) => event.timestamp >= start));
  }, [usageEvents]);
  const weekUsage = useMemo(() => {
    const start = getWeekStartTimestamp();
    return summarizeUsage(usageEvents.filter((event) => event.timestamp >= start));
  }, [usageEvents]);
  const historicalUsageByModel = useMemo(() => aggregateUsageByModel(usageEvents), [usageEvents]);
  const topSpenderModel = historicalUsageByModel[0];
  const totalHistoricalCostUsd = useMemo(
    () => historicalUsageByModel.reduce((sum, row) => sum + row.totalCostUsd, 0),
    [historicalUsageByModel]
  );
  const topSpenderShare = topSpenderModel && totalHistoricalCostUsd > 0
    ? (topSpenderModel.totalCostUsd / totalHistoricalCostUsd) * 100
    : 0;
  const analyticsRecommendation = useMemo(() => {
    if (!topSpenderModel) {
      return settings.language === 'es'
        ? 'Todavía no hay suficiente histórico para recomendar cambios.'
        : 'There is not enough historical data yet to recommend changes.';
    }
    if (topSpenderShare >= 60) {
      return settings.language === 'es'
        ? 'Este modelo domina tu coste total. Úsalo para tareas críticas y considera uno más barato para consultas simples.'
        : 'This model dominates your total spend. Keep it for critical tasks and use a cheaper model for simple prompts.';
    }
    if (topSpenderShare >= 35) {
      return settings.language === 'es'
        ? 'Este modelo tiene un impacto alto en tu factura. Puedes reducir gasto alternándolo con modelos rápidos en peticiones no complejas.'
        : 'This model has a high impact on your bill. You can lower costs by alternating with faster models for non-complex requests.';
    }
    return settings.language === 'es'
      ? 'Tu gasto está relativamente distribuido. Mantén esta mezcla y revisa semanalmente los cambios.'
      : 'Your spend is relatively distributed. Keep this mix and review changes weekly.';
  }, [settings.language, topSpenderModel, topSpenderShare]);
  const pricingRows = useMemo(
    () =>
      [...MODEL_PRICING]
        .map((entry) => {
          const livePricing = getModelPricing(entry.provider, entry.model);
          if (!livePricing) return entry;
          return {
            ...entry,
            inputPerMillionUsd: livePricing.inputPerMillionUsd,
            outputPerMillionUsd: livePricing.outputPerMillionUsd,
            sourceUrl: livePricing.sourceUrl || entry.sourceUrl,
            sourceLabel: livePricing.sourceLabel || entry.sourceLabel,
          };
        })
        .sort(
        (a, b) => a.provider.localeCompare(b.provider) || a.modelName.localeCompare(b.modelName)
      ),
    [providerModelSyncStatus]
  );

  const hydrateUserDrafts = (users: AuthUser[]) => {
    const nextLimits: Record<string, string> = {};
    const nextAllowlists: Record<string, Record<string, string[]>> = {};

    users.forEach((user) => {
      nextLimits[user.id] = user.monthlyCostLimitUsd > 0 ? String(user.monthlyCostLimitUsd) : '';
      nextAllowlists[user.id] = {};
      PROVIDERS.forEach((provider) => {
        const allowlist = user.modelAllowlistByProvider?.[provider.id];
        nextAllowlists[user.id][provider.id] = Array.isArray(allowlist) ? [...allowlist] : [];
      });
    });

    setUserDraftLimits(nextLimits);
    setUserDraftAllowlists(nextAllowlists);
  };

  const refreshManagedUsers = async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    setUsersError('');
    try {
      const users = await listUsers();
      setManagedUsers(users);
      hydrateUserDrafts(users);
    } catch (error: any) {
      setUsersError(error?.message || (settings.language === 'es' ? 'No se pudieron cargar los usuarios.' : 'Could not load users.'));
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setGeneralDraft({
      userName: settings.userName,
      telegramProvider: settings.telegramProvider,
      telegramModel: settings.telegramModel,
      contextProvider: settings.contextProvider,
      contextModel: settings.contextModel,
      ragEmbeddingProvider: settings.ragEmbeddingProvider,
      ragEmbeddingModel: settings.ragEmbeddingModel,
      conciliumLeader: { ...settings.conciliumLeader },
    });
    setInterfaceDraft({
      language: settings.language,
      themeMode: settings.themeMode,
      themeColor: settings.themeColor,
    });
    setPersonalizationDraft({
      personalization: { ...settings.personalization },
      includeLocationInContext: settings.includeLocationInContext,
      locationLabel: settings.locationLabel,
    });
    setPendingTabTarget(null);
    setPendingClose(false);
    setUnsavedWarningOpen(false);
  }, [
    isOpen,
    settings.userName,
    settings.telegramProvider,
    settings.telegramModel,
    settings.contextProvider,
    settings.contextModel,
    settings.ragEmbeddingProvider,
    settings.ragEmbeddingModel,
    settings.conciliumLeader,
    settings.language,
    settings.themeMode,
    settings.themeColor,
    settings.personalization,
    settings.includeLocationInContext,
    settings.locationLabel,
  ]);

  useEffect(() => {
    if (!generalDraft.telegramProvider) return;
    if (telegramModels.length === 0) {
      if (generalDraft.telegramModel !== '') {
        setGeneralDraft((prev) => ({ ...prev, telegramModel: '' }));
      }
      return;
    }
    if (!telegramModels.some((model) => model.id === generalDraft.telegramModel)) {
      setGeneralDraft((prev) => ({ ...prev, telegramModel: telegramModels[0]?.id || '' }));
    }
  }, [generalDraft.telegramProvider, generalDraft.telegramModel, telegramModels]);

  useEffect(() => {
    if (quickInsertPrompts.length === 0) {
      setEditingQuickPrompt({ id: '', title: '', content: '' });
      return;
    }
    if (!editingQuickPrompt.id || !quickInsertPrompts.some((prompt) => prompt.id === editingQuickPrompt.id)) {
      setEditingQuickPrompt({ ...quickInsertPrompts[0] });
    }
  }, [quickInsertPrompts, editingQuickPrompt.id]);

  useEffect(() => {
    if (!PROVIDERS.some((provider) => provider.id === modelTabProvider)) {
      setModelTabProvider(settings.provider);
    }
    setModelVendorFilter('all');
    setManualCostEditor(null);
  }, [modelTabProvider, settings.provider]);

  useEffect(() => {
    if (!isAdmin && activeTab === 'apikeys') {
      setActiveTab('users');
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    setUsageApiKeyFilter('all');
    setUsageModelFilter('all');
  }, [usageProviderFilter]);

  useEffect(() => {
    setUsageModelFilter('all');
  }, [usageApiKeyFilter]);

  // Load keys for each provider when API Keys tab is opened
  useEffect(() => {
    if (activeTab === 'apikeys' && isAdmin) {
      PROVIDERS.filter((provider) => providerRequiresApiKey(provider.id)).forEach((provider) => {
        getProviderStatus(provider.id)
          .then((status) => {
            setProviderKeyDetails((prev) => ({ ...prev, [provider.id]: status }));
          })
          .catch(() => {});
      });
    }
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (activeTab !== 'users' || !isAdmin) return;
    void refreshManagedUsers();
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (activeTab !== 'models') return;
    if (providerModelSyncStatus[modelTabProvider]) return;
    if (providerModelSyncBusy[modelTabProvider]) return;
    void onRefreshProviderModels(modelTabProvider, false);
  }, [activeTab, modelTabProvider, onRefreshProviderModels, providerModelSyncBusy, providerModelSyncStatus]);

  if (!isOpen) return null;

  const apiKeyProviders = PROVIDERS.filter((provider) => providerRequiresApiKey(provider.id));
  const selectedModelFilter: ProviderModelFilterSettings =
    settings.modelFiltersByProvider?.[modelTabProvider] || {
      mode: 'all',
      vendorAllowlist: [],
      pinnedModelIds: [],
    };
  const allModelsForSelectedProvider = getAllModelsForProvider(modelTabProvider);
  const visibleModelsForSelectedProvider = getModelsForProvider(modelTabProvider);
  const supportsVendorFiltering = providerSupportsVendorFilter(modelTabProvider);
  const pinnedSetForSelectedProvider = new Set(selectedModelFilter.pinnedModelIds);
  const modelSyncStatus = providerModelSyncStatus[modelTabProvider];
  const modelSyncBusy = providerModelSyncBusy[modelTabProvider] === true;
  const modelVendorCounts = new Map<string, number>();
  allModelsForSelectedProvider.forEach((model) => {
    const vendor = inferModelVendor(modelTabProvider, model);
    const key = vendor.trim();
    if (!key) return;
    modelVendorCounts.set(key, (modelVendorCounts.get(key) || 0) + 1);
  });
  const modelVendors = Array.from(modelVendorCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const formatModelPricePerMillion = (value: number): string => {
    if (value >= 10) return value.toFixed(2);
    if (value >= 1) return value.toFixed(3);
    return value.toFixed(4);
  };
  const getTotalModelCost = (providerId: string, modelId: string): number | null => {
    const pricing = getModelPricing(providerId, modelId);
    if (!pricing) return null;
    return pricing.inputPerMillionUsd + pricing.outputPerMillionUsd;
  };
  const compareModelsByName = (a: { id: string; name: string }, b: { id: string; name: string }) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const filteredModelsForTab = (() => {
    const query = modelSearch.trim().toLowerCase();
    const filtered = allModelsForSelectedProvider.filter((model) => {
      const vendor = inferModelVendor(modelTabProvider, model);
      // Vendor dropdown filter
      if (modelVendorFilter !== 'all' && vendor !== modelVendorFilter) return false;
      // Text search filter
      if (!query) return true;
      return (
        model.id.toLowerCase().includes(query) ||
        model.name.toLowerCase().includes(query) ||
        vendor.toLowerCase().includes(query)
      );
    });
    const sorted = [...filtered];
    if (modelSortOrder === 'name') {
      return sorted.sort(compareModelsByName);
    }
    return sorted.sort((a, b) => {
      const costA = getTotalModelCost(modelTabProvider, a.id);
      const costB = getTotalModelCost(modelTabProvider, b.id);
      if (costA === null && costB === null) return compareModelsByName(a, b);
      if (costA === null) return 1;
      if (costB === null) return -1;
      if (costA !== costB) {
        return modelSortOrder === 'cost-asc' ? costA - costB : costB - costA;
      }
      return compareModelsByName(a, b);
    });
  })();
  const pinnedModelsForSelectedProvider = (() => {
    if (selectedModelFilter.pinnedModelIds.length === 0) return [];
    const modelsById = new Map(allModelsForSelectedProvider.map((model) => [model.id, model]));
    return selectedModelFilter.pinnedModelIds
      .map((modelId) => {
        const model = modelsById.get(modelId);
        if (!model) {
          return {
            id: modelId,
            name: modelId,
            vendor: '',
            missing: true,
          };
        }
        return {
          id: model.id,
          name: model.name,
          vendor: inferModelVendor(modelTabProvider, model),
          missing: false,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  })();

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: value < 1 ? 4 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);

  const formatNumber = (value: number) => new Intl.NumberFormat(locale).format(value);
  const formatUsageSource = (source: string): string => {
    if (source === 'chat') return settings.language === 'es' ? 'Chat principal' : 'Main chat';
    if (source === 'concilium_member') return settings.language === 'es' ? 'Miembro Concilium' : 'Concilium member';
    if (source === 'concilium_leader') return settings.language === 'es' ? 'Líder Concilium' : 'Concilium leader';
    if (source === 'summary') return settings.language === 'es' ? 'Resumen contexto' : 'Context summary';
    return source;
  };

  const usagePeriodTabs: Array<{ id: UsageAggregationPeriod; label: string }> = [
    { id: 'day', label: t.settingsModal.usagePeriodDay },
    { id: 'week', label: t.settingsModal.usagePeriodWeek },
    { id: 'month', label: t.settingsModal.usagePeriodMonth },
    { id: 'year', label: t.settingsModal.usagePeriodYear },
  ];

  const flashSaved = (key: string) => {
    setSaveFeedback((prev) => ({ ...prev, [key]: true }));
    window.setTimeout(() => {
      setSaveFeedback((prev) => ({ ...prev, [key]: false }));
    }, 1600);
  };

  const handlePersonalizationChange = (key: keyof AppSettings['personalization'], value: string) => {
    setPersonalizationDraft((prev) => ({
      ...prev,
      personalization: {
        ...prev.personalization,
        [key]: value,
      },
    }));
  };

  const handleUseCurrentLocation = () => {
    setLocationError('');
    if (!navigator.geolocation) {
      setLocationError(t.settingsModal.locationErrorUnavailable);
      return;
    }

    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude.toFixed(4);
        const longitude = position.coords.longitude.toFixed(4);
        const formatted = `${latitude}, ${longitude}`;
        setPersonalizationDraft((prev) => ({
          ...prev,
          includeLocationInContext: true,
          locationLabel: formatted,
        }));
        setLocationBusy(false);
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationError(t.settingsModal.locationErrorPermission);
        } else {
          setLocationError(error.message || t.settingsModal.locationErrorUnavailable);
        }
        setLocationBusy(false);
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  };

  const isGeneralDirty =
    generalDraft.userName !== settings.userName ||
    generalDraft.telegramProvider !== settings.telegramProvider ||
    generalDraft.telegramModel !== settings.telegramModel ||
    generalDraft.contextProvider !== settings.contextProvider ||
    generalDraft.contextModel !== settings.contextModel ||
    generalDraft.ragEmbeddingProvider !== settings.ragEmbeddingProvider ||
    generalDraft.ragEmbeddingModel !== settings.ragEmbeddingModel ||
    generalDraft.conciliumLeader.provider !== settings.conciliumLeader.provider ||
    generalDraft.conciliumLeader.model !== settings.conciliumLeader.model;

  const isInterfaceDirty =
    interfaceDraft.language !== settings.language ||
    interfaceDraft.themeMode !== settings.themeMode ||
    interfaceDraft.themeColor !== settings.themeColor;

  const isPersonalizationDirty =
    personalizationDraft.includeLocationInContext !== settings.includeLocationInContext ||
    personalizationDraft.locationLabel !== settings.locationLabel ||
    personalizationDraft.personalization.nickname !== settings.personalization.nickname ||
    personalizationDraft.personalization.occupation !== settings.personalization.occupation ||
    personalizationDraft.personalization.familyAndFriends !== settings.personalization.familyAndFriends ||
    personalizationDraft.personalization.leisure !== settings.personalization.leisure ||
    personalizationDraft.personalization.other !== settings.personalization.other;

  const hasAnyUnsavedChanges = isGeneralDirty || isInterfaceDirty || isPersonalizationDirty;

  const saveGeneralTab = () => {
    onUpdateSetting('userName', generalDraft.userName);
    onUpdateSetting('telegramProvider', generalDraft.telegramProvider);
    onUpdateSetting('telegramModel', generalDraft.telegramModel);
    onUpdateSetting('contextProvider', generalDraft.contextProvider);
    onUpdateSetting('contextModel', generalDraft.contextModel);
    onUpdateSetting('ragEmbeddingProvider', generalDraft.ragEmbeddingProvider);
    onUpdateSetting('ragEmbeddingModel', generalDraft.ragEmbeddingModel);
    onUpdateSetting('conciliumLeader', generalDraft.conciliumLeader);
    flashSaved('tab-general');
  };

  const saveInterfaceTab = () => {
    onUpdateSetting('language', interfaceDraft.language);
    onUpdateSetting('themeMode', interfaceDraft.themeMode);
    onUpdateSetting('themeColor', interfaceDraft.themeColor);
    flashSaved('tab-interface');
  };

  const savePersonalizationTab = () => {
    onUpdateSetting('personalization', { ...personalizationDraft.personalization });
    onUpdateSetting('includeLocationInContext', personalizationDraft.includeLocationInContext);
    onUpdateSetting('locationLabel', personalizationDraft.locationLabel);
    flashSaved('tab-personalization');
  };

  const activeTabSaveConfig =
    activeTab === 'general'
      ? { onSave: saveGeneralTab, dirty: isGeneralDirty, feedbackKey: 'tab-general' }
      : activeTab === 'interface'
        ? { onSave: saveInterfaceTab, dirty: isInterfaceDirty, feedbackKey: 'tab-interface' }
        : activeTab === 'personalization'
          ? { onSave: savePersonalizationTab, dirty: isPersonalizationDirty, feedbackKey: 'tab-personalization' }
          : null;

  const requestTabChange = (nextTab: SettingsTab) => {
    if (nextTab === activeTab) return;
    if (!hasAnyUnsavedChanges) {
      setActiveTab(nextTab);
      return;
    }
    setPendingTabTarget(nextTab);
    setPendingClose(false);
    setUnsavedWarningOpen(true);
  };

  const requestCloseModal = () => {
    if (!hasAnyUnsavedChanges) {
      onClose();
      return;
    }
    setPendingTabTarget(null);
    setPendingClose(true);
    setUnsavedWarningOpen(true);
  };

  const discardUnsavedChangesAndContinue = () => {
    setGeneralDraft({
      userName: settings.userName,
      telegramProvider: settings.telegramProvider,
      telegramModel: settings.telegramModel,
      contextProvider: settings.contextProvider,
      contextModel: settings.contextModel,
      ragEmbeddingProvider: settings.ragEmbeddingProvider,
      ragEmbeddingModel: settings.ragEmbeddingModel,
      conciliumLeader: { ...settings.conciliumLeader },
    });
    setInterfaceDraft({
      language: settings.language,
      themeMode: settings.themeMode,
      themeColor: settings.themeColor,
    });
    setPersonalizationDraft({
      personalization: { ...settings.personalization },
      includeLocationInContext: settings.includeLocationInContext,
      locationLabel: settings.locationLabel,
    });

    const tabTarget = pendingTabTarget;
    const shouldClose = pendingClose;
    setPendingTabTarget(null);
    setPendingClose(false);
    setUnsavedWarningOpen(false);

    if (tabTarget) {
      setActiveTab(tabTarget);
      return;
    }
    if (shouldClose) onClose();
  };

  const continueAfterUnsavedWarning = () => {
    const tabTarget = pendingTabTarget;
    const shouldClose = pendingClose;
    setPendingTabTarget(null);
    setPendingClose(false);
    setUnsavedWarningOpen(false);
    if (tabTarget) {
      setActiveTab(tabTarget);
      return;
    }
    if (shouldClose) onClose();
  };

  const saveUnsavedChangesAndContinue = () => {
    if (isGeneralDirty) {
      onUpdateSetting('userName', generalDraft.userName);
      onUpdateSetting('telegramProvider', generalDraft.telegramProvider);
      onUpdateSetting('telegramModel', generalDraft.telegramModel);
      onUpdateSetting('contextProvider', generalDraft.contextProvider);
      onUpdateSetting('contextModel', generalDraft.contextModel);
      onUpdateSetting('ragEmbeddingProvider', generalDraft.ragEmbeddingProvider);
      onUpdateSetting('ragEmbeddingModel', generalDraft.ragEmbeddingModel);
      onUpdateSetting('conciliumLeader', generalDraft.conciliumLeader);
      flashSaved('tab-general');
    }
    if (isInterfaceDirty) {
      onUpdateSetting('language', interfaceDraft.language);
      onUpdateSetting('themeMode', interfaceDraft.themeMode);
      onUpdateSetting('themeColor', interfaceDraft.themeColor);
      flashSaved('tab-interface');
    }
    if (isPersonalizationDirty) {
      onUpdateSetting('personalization', { ...personalizationDraft.personalization });
      onUpdateSetting('includeLocationInContext', personalizationDraft.includeLocationInContext);
      onUpdateSetting('locationLabel', personalizationDraft.locationLabel);
      flashSaved('tab-personalization');
    }
    continueAfterUnsavedWarning();
  };

  const handleSelectPromptToEdit = (prompt: SystemPrompt) => {
    setEditingPrompt({ ...prompt });
  };

  const handleNewPrompt = () => {
    setEditingPrompt({ id: Date.now().toString(), name: t.common.new + ' Prompt', content: '' });
  };

  const handleSavePrompt = () => {
    if (!editingPrompt.name || !editingPrompt.content) return;
    onSaveSystemPrompt(editingPrompt);
    flashSaved('system-prompt');
  };

  const handleDeletePrompt = () => {
    if (!editingPrompt.id) return;
    onDeleteSystemPrompt(editingPrompt.id);
    if (systemPrompts.length > 0) {
      handleNewPrompt();
    }
  };
  const parseBudgetInput = (raw: string): number => {
    if (!raw.trim()) return 0;
    const normalized = Number(raw.replace(',', '.'));
    if (!Number.isFinite(normalized)) return 0;
    return Math.max(0, Math.round(normalized * 100) / 100);
  };

  const handleChangeOwnPassword = async () => {
    setPasswordError('');
    setPasswordSuccess('');
    if (!passwordCurrent || !passwordNew) {
      setPasswordError(settings.language === 'es' ? 'Completa ambos campos de contraseña.' : 'Fill in both password fields.');
      return;
    }
    if (passwordNew !== passwordConfirm) {
      setPasswordError(settings.language === 'es' ? 'La confirmación no coincide.' : 'Password confirmation does not match.');
      return;
    }
    setPasswordBusy(true);
    try {
      const updatedUser = await changeCurrentUserPassword(passwordCurrent, passwordNew);
      onUserUpdated(updatedUser);
      setPasswordCurrent('');
      setPasswordNew('');
      setPasswordConfirm('');
      setPasswordSuccess(settings.language === 'es' ? 'Contraseña actualizada.' : 'Password updated.');
    } catch (error: any) {
      setPasswordError(error?.message || (settings.language === 'es' ? 'No se pudo actualizar la contraseña.' : 'Could not update password.'));
    } finally {
      setPasswordBusy(false);
    }
  };

  const handleCreateUser = async () => {
    setCreateUserError('');
    const username = createUserName.trim();
    if (!username || !createUserPassword) {
      setCreateUserError(settings.language === 'es' ? 'Usuario y contraseña son obligatorios.' : 'Username and password are required.');
      return;
    }
    setCreateUserBusy(true);
    try {
      await createUserAccount({
        username,
        password: createUserPassword,
        role: 'user',
      });
      setCreateUserName('');
      setCreateUserPassword('');
      await refreshManagedUsers();
    } catch (error: any) {
      setCreateUserError(error?.message || (settings.language === 'es' ? 'No se pudo crear el usuario.' : 'Could not create user.'));
    } finally {
      setCreateUserBusy(false);
    }
  };

  const toggleUserModel = (userId: string, providerId: string, modelId: string) => {
    setUserDraftAllowlists((prev) => {
      const current = prev[userId]?.[providerId] || [];
      const nextSet = new Set(current);
      if (nextSet.has(modelId)) {
        nextSet.delete(modelId);
      } else {
        nextSet.add(modelId);
      }
      return {
        ...prev,
        [userId]: {
          ...(prev[userId] || {}),
          [providerId]: Array.from(nextSet).sort((a, b) => a.localeCompare(b)),
        },
      };
    });
  };

  const setUserProviderToAllModels = (userId: string, providerId: string) => {
    setUserDraftAllowlists((prev) => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || {}),
        [providerId]: [],
      },
    }));
  };

  const handleSaveUserAccess = async (userId: string) => {
    const allowlists = userDraftAllowlists[userId] || {};
    const normalizedAllowlists = Object.fromEntries(
      Object.entries(allowlists)
        .map(([providerId, modelIds]) => [providerId, Array.from(new Set(modelIds)).filter(Boolean)])
        .filter(([, modelIds]) => modelIds.length > 0)
    );

    setUserBusyId(userId);
    setUsersError('');
    try {
      const updated = await updateUserAccount(userId, {
        monthlyCostLimitUsd: parseBudgetInput(userDraftLimits[userId] || ''),
        modelAllowlistByProvider: normalizedAllowlists,
      });
      setManagedUsers((prev) => prev.map((user) => (user.id === userId ? updated : user)));
      setUserSaveFeedback((prev) => ({
        ...prev,
        [userId]: settings.language === 'es' ? 'Guardado' : 'Saved',
      }));
      if (updated.id === currentUser.id) {
        onUserUpdated(updated);
      }
      window.setTimeout(() => {
        setUserSaveFeedback((prev) => ({ ...prev, [userId]: '' }));
      }, 1600);
    } catch (error: any) {
      setUsersError(error?.message || (settings.language === 'es' ? 'No se pudo guardar la configuración del usuario.' : 'Could not save user settings.'));
    } finally {
      setUserBusyId(null);
    }
  };

  const confirmDeleteUser = async () => {
    if (!userDeleteConfirm) return;
    setUserBusyId(userDeleteConfirm.id);
    setUsersError('');
    try {
      await deleteUserAccount(userDeleteConfirm.id);
      setManagedUsers((prev) => prev.filter((user) => user.id !== userDeleteConfirm.id));
      setUserDeleteConfirm(null);
    } catch (error: any) {
      setUsersError(error?.message || (settings.language === 'es' ? 'No se pudo eliminar el usuario.' : 'Could not delete user.'));
    } finally {
      setUserBusyId(null);
    }
  };

  const handleSelectQuickPromptToEdit = (prompt: QuickInsertPrompt) => {
    setEditingQuickPrompt({ ...prompt });
  };

  const handleNewQuickPrompt = () => {
    setEditingQuickPrompt({
      id: Date.now().toString(),
      title: '',
      content: '',
    });
  };

  const handleSaveQuickPrompt = () => {
    const title = editingQuickPrompt.title.trim().slice(0, 40);
    const content = editingQuickPrompt.content.trim();
    if (!title || !content) return;
    onSaveQuickInsertPrompt({
      ...editingQuickPrompt,
      title,
      content,
    });
    flashSaved('quick-prompt');
  };

  const handleDeleteQuickPrompt = () => {
    if (!editingQuickPrompt.id) return;
    onDeleteQuickInsertPrompt(editingQuickPrompt.id);
    const remaining = quickInsertPrompts.filter((item) => item.id !== editingQuickPrompt.id);
    if (remaining.length > 0) {
      setEditingQuickPrompt({ ...remaining[0] });
      return;
    }
    setEditingQuickPrompt({ id: '', title: '', content: '' });
  };

  const handleConciliumLeaderChange = (field: 'provider' | 'model', value: string) => {
    onUpdateSetting('conciliumLeader', { ...settings.conciliumLeader, [field]: value });
  };

  const updateModelFilterForProvider = (providerId: string, patch: Partial<ProviderModelFilterSettings>) => {
    const current = settings.modelFiltersByProvider?.[providerId] || {
      mode: 'all',
      vendorAllowlist: [],
      pinnedModelIds: [],
    };
    onUpdateSetting('modelFiltersByProvider', {
      ...settings.modelFiltersByProvider,
      [providerId]: {
        ...current,
        ...patch,
      },
    });
  };

  const toggleVendorFilter = (providerId: string, vendor: string) => {
    const current = settings.modelFiltersByProvider?.[providerId] || {
      mode: 'all',
      vendorAllowlist: [],
      pinnedModelIds: [],
    };
    const currentSet = new Set(current.vendorAllowlist);
    if (currentSet.has(vendor)) currentSet.delete(vendor);
    else currentSet.add(vendor);
    updateModelFilterForProvider(providerId, { vendorAllowlist: Array.from(currentSet).sort((a, b) => a.localeCompare(b)) });
  };

  const togglePinnedModel = (providerId: string, modelId: string) => {
    const current = settings.modelFiltersByProvider?.[providerId] || {
      mode: 'all',
      vendorAllowlist: [],
      pinnedModelIds: [],
    };
    const currentSet = new Set(current.pinnedModelIds);
    if (currentSet.has(modelId)) currentSet.delete(modelId);
    else currentSet.add(modelId);
    updateModelFilterForProvider(providerId, { pinnedModelIds: Array.from(currentSet).sort((a, b) => a.localeCompare(b)) });
  };

  const confirmUnpinAllModels = () => {
    updateModelFilterForProvider(modelTabProvider, { pinnedModelIds: [] });
    setUnpinAllConfirmOpen(false);
  };

  const getManualCostKey = (providerId: string, modelId: string): string => `${providerId}:${modelId}`;

  const parseManualCostInput = (rawValue: string): number | null => {
    const normalized = rawValue.trim().replace(',', '.');
    if (!normalized) return null;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return numeric;
  };

  const openManualCostEditor = (providerId: string, modelId: string): void => {
    const existing = settings.manualModelPricingByProviderModelKey?.[getManualCostKey(providerId, modelId)];
    setManualCostEditor({
      providerId,
      modelId,
      inputPerMillionUsd: existing ? String(existing.inputPerMillionUsd) : '',
      outputPerMillionUsd: existing ? String(existing.outputPerMillionUsd) : '',
      error: '',
    });
  };

  const saveManualCostEditor = (): void => {
    if (!manualCostEditor) return;
    const inputPerMillionUsd = parseManualCostInput(manualCostEditor.inputPerMillionUsd);
    const outputPerMillionUsd = parseManualCostInput(manualCostEditor.outputPerMillionUsd);
    if (inputPerMillionUsd === null || outputPerMillionUsd === null) {
      setManualCostEditor((prev) =>
        prev
          ? {
              ...prev,
              error:
                settings.language === 'es'
                  ? 'Introduce valores numéricos válidos (>= 0).'
                  : 'Enter valid numeric values (>= 0).',
            }
          : prev
      );
      return;
    }

    const key = getManualCostKey(manualCostEditor.providerId, manualCostEditor.modelId);
    onUpdateSetting('manualModelPricingByProviderModelKey', {
      ...(settings.manualModelPricingByProviderModelKey || {}),
      [key]: {
        inputPerMillionUsd,
        outputPerMillionUsd,
      },
    });
    setManualCostEditor(null);
  };

  const handleRefreshSelectedProviderModels = async () => {
    await onRefreshProviderModels(modelTabProvider, true);
  };

  // API Key handlers
  const refreshProviderDetails = async (providerId: string) => {
    const status = await getProviderStatus(providerId);
    setProviderKeyDetails((prev) => ({ ...prev, [providerId]: status }));
  };

  const handleAddApiKey = async (providerId: string) => {
    const key = keyInputs[providerId];
    if (!key || !key.trim()) return;

    setKeySaving((prev) => ({ ...prev, [providerId]: true }));
    setKeyErrors((prev) => ({ ...prev, [providerId]: '' }));

    try {
      await addProviderApiKey(providerId, key.trim(), {
        name: keyNameInputs[providerId],
        makeActive: true,
      });
      setKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      setKeyNameInputs((prev) => ({ ...prev, [providerId]: '' }));
      setKeySuccess((prev) => ({
        ...prev,
        [providerId]: settings.language === 'es' ? 'Clave añadida correctamente.' : 'Key added successfully.',
      }));
      flashSaved(`api-key-add-${providerId}`);
      await refreshProviderDetails(providerId);
      onProvidersChanged();
    } catch (err: any) {
      setKeyErrors((prev) => ({ ...prev, [providerId]: err.message }));
      setKeySuccess((prev) => ({ ...prev, [providerId]: '' }));
    }

    setKeySaving((prev) => ({ ...prev, [providerId]: false }));
  };

  const handleSetActiveApiKey = async (providerId: string, keyId: string) => {
    setKeySaving((prev) => ({ ...prev, [providerId]: true }));
    setKeyErrors((prev) => ({ ...prev, [providerId]: '' }));
    try {
      await setActiveProviderApiKey(providerId, keyId);
      setKeySuccess((prev) => ({
        ...prev,
        [providerId]: settings.language === 'es' ? 'Clave activa actualizada.' : 'Active key updated.',
      }));
      flashSaved(`api-key-active-${providerId}`);
      await refreshProviderDetails(providerId);
      onProvidersChanged();
    } catch (err: any) {
      setKeyErrors((prev) => ({ ...prev, [providerId]: err.message }));
      setKeySuccess((prev) => ({ ...prev, [providerId]: '' }));
    }
    setKeySaving((prev) => ({ ...prev, [providerId]: false }));
  };

  const handleDeleteApiKey = async (providerId: string, keyId?: string) => {
    setKeySaving((prev) => ({ ...prev, [providerId]: true }));
    setKeyErrors((prev) => ({ ...prev, [providerId]: '' }));
    try {
      await deleteProviderApiKey(providerId, keyId);
      setKeySuccess((prev) => ({
        ...prev,
        [providerId]:
          keyId
            ? settings.language === 'es'
              ? 'Clave eliminada correctamente.'
              : 'Key deleted successfully.'
            : settings.language === 'es'
              ? 'Claves eliminadas correctamente.'
              : 'Keys deleted successfully.',
      }));
      flashSaved(`api-key-delete-${providerId}`);
      await refreshProviderDetails(providerId);
      onProvidersChanged();
    } catch (err: any) {
      setKeyErrors((prev) => ({ ...prev, [providerId]: err.message }));
      setKeySuccess((prev) => ({ ...prev, [providerId]: '' }));
    }
    setKeySaving((prev) => ({ ...prev, [providerId]: false }));
  };

  const requestDeleteApiKey = (providerId: string, providerName: string, keyId?: string, keyName?: string) => {
    setApiKeyDeleteConfirm({ providerId, providerName, keyId, keyName });
  };

  const confirmDeleteApiKey = async () => {
    if (!apiKeyDeleteConfirm) return;
    await handleDeleteApiKey(apiKeyDeleteConfirm.providerId, apiKeyDeleteConfirm.keyId);
  };

  const confirmResetUsageCost = async () => {
    setUsageResetBusy(true);
    try {
      await onResetUsageCost();
      setUsageResetConfirmOpen(false);
      setUsageHoverBucketKey(null);
    } finally {
      setUsageResetBusy(false);
    }
  };

  const openDangerConfirm = (id: DangerActionId, title: string, message: string, confirmText: string) => {
    setDangerError('');
    setDangerConfirm({ id, title, message, confirmText });
  };

  const handleConfirmDangerAction = async () => {
    if (!dangerConfirm) return;

    setDangerBusyAction(dangerConfirm.id);
    setDangerError('');

    try {
      switch (dangerConfirm.id) {
        case 'moveHistoryToTrash':
          await onMoveAllHistoryToTrash();
          break;
        case 'deleteAllHistoryAndTrash':
          await onDeleteAllHistoryAndTrash();
          break;
        case 'emptyTrash':
          await onEmptyTrash();
          break;
        case 'resetSettingsAndApiKeys':
          await onResetSettingsAndApiKeys();
          break;
        case 'deleteAllUserData':
          await onDeleteAllUserData();
          break;
      }
    } catch (err: any) {
      setDangerError(err?.message || (settings.language === 'es' ? 'No se pudo completar la acción.' : 'Could not complete action.'));
    } finally {
      setDangerBusyAction(null);
      setDangerConfirm(null);
    }
  };

  const runBackupAction = async (key: string, action: () => Promise<void>) => {
    setBackupBusy((prev) => ({ ...prev, [key]: true }));
    setBackupSuccess((prev) => ({ ...prev, [key]: '' }));
    setBackupErrors((prev) => ({ ...prev, [key]: '' }));
    try {
      await action();
      setBackupSuccess((prev) => ({
        ...prev,
        [key]: settings.language === 'es' ? 'Acción completada correctamente.' : 'Action completed successfully.',
      }));
    } catch (err: any) {
      setBackupErrors((prev) => ({
        ...prev,
        [key]: err?.message || (settings.language === 'es' ? 'No se pudo completar la acción.' : 'Could not complete action.'),
      }));
    } finally {
      setBackupBusy((prev) => ({ ...prev, [key]: false }));
    }
  };

  const downloadJsonBackup = (data: unknown, prefix: string) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${prefix}-${timestamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const parseBackupFile = async (file: File): Promise<unknown> => {
    const rawText = await file.text();
    if (!rawText.trim()) throw new Error(settings.language === 'es' ? 'El archivo está vacío.' : 'The file is empty.');
    try {
      return JSON.parse(rawText);
    } catch {
      throw new Error(settings.language === 'es' ? 'El archivo no es un JSON válido.' : 'The file is not valid JSON.');
    }
  };

  const handleDownloadSettingsBackup = () => {
    void runBackupAction('settings', async () => {
      if (includeApiKeysInSettingsBackup && !isAdmin) {
        throw new Error(
          settings.language === 'es'
            ? 'Solo administradores pueden exportar API keys en el backup.'
            : 'Only admin users can export API keys in backup.'
        );
      }
      const backup = await onCreateSettingsBackup({ includeApiKeys: includeApiKeysInSettingsBackup });
      downloadJsonBackup(backup, 'optimaizer-settings-backup');
    });
  };

  const handleDownloadFullBackup = () => {
    void runBackupAction('full', async () => {
      if (includeApiKeysInFullBackup && !isAdmin) {
        throw new Error(
          settings.language === 'es'
            ? 'Solo administradores pueden exportar API keys en el backup.'
            : 'Only admin users can export API keys in backup.'
        );
      }
      const backup = await onCreateFullBackup({
        includeApiKeys: includeApiKeysInFullBackup,
        includeIntegrationSecrets: includeAgentSecretsInFullBackup,
      });
      downloadJsonBackup(backup, 'optimaizer-full-backup');
    });
  };

  const handleDownloadHistoryBackup = () => {
    void runBackupAction('history', async () => {
      const backup = await onCreateHistoryBackup();
      downloadJsonBackup(backup, 'optimaizer-history-backup');
    });
  };

  const handleDownloadNotesBackup = () => {
    void runBackupAction('notes', async () => {
      const backup = await onCreateNotesBackup();
      downloadJsonBackup(backup, 'optimaizer-notes-backup');
    });
  };

  const handleRestoreSettingsBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await runBackupAction('settings', async () => {
      const payload = await parseBackupFile(file);
      await onRestoreSettingsBackup(payload);
    });
  };

  const handleRestoreHistoryBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await runBackupAction('history', async () => {
      const payload = await parseBackupFile(file);
      await onRestoreHistoryBackup(payload);
    });
  };

  const handleRestoreNotesBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await runBackupAction('notes', async () => {
      const payload = await parseBackupFile(file);
      await onRestoreNotesBackup(payload);
    });
  };

  const handleDownloadAgentsBackup = () => {
    void runBackupAction('agents', async () => {
      const backup = await onCreateAgentsBackup({ includeIntegrationSecrets: includeAgentSecretsInBackup });
      downloadJsonBackup(backup, 'optimaizer-agents-backup');
    });
  };

  const handleRestoreAgentsBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await runBackupAction('agents', async () => {
      const payload = await parseBackupFile(file);
      await onRestoreAgentsBackup(payload);
    });
  };

  const handleRestoreFullBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await runBackupAction('full', async () => {
      const payload = await parseBackupFile(file);
      await onRestoreFullBackup(payload);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border w-full max-w-6xl rounded-2xl shadow-2xl flex flex-col h-[min(92dvh,52rem)] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{t.settingsModal.title}</h2>
          <button onClick={requestCloseModal} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 min-h-0 min-w-0 flex flex-col md:flex-row overflow-hidden">
          {/* Tabs */}
          <div className="md:w-56 md:flex-shrink-0 border-b border-border md:border-b-0 md:border-r md:border-border p-3 md:p-4 overflow-x-auto md:overflow-x-visible md:overflow-y-auto">
            <div className="flex md:flex-col gap-2 min-w-max md:min-w-0">
              <button
                onClick={() => requestTabChange('general')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'general'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><BrainCircuit size={14} /> {t.settingsModal.tabGeneral}</span>
              </button>
              <button
                onClick={() => requestTabChange('interface')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'interface'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><Monitor size={14} /> {t.settingsModal.tabInterface}</span>
              </button>
              <button
                onClick={() => requestTabChange('personalization')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'personalization'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><UserRound size={14} /> {t.settingsModal.tabPersonalization}</span>
              </button>
              {isAdmin && (
                <button
                  onClick={() => requestTabChange('apikeys')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                    activeTab === 'apikeys'
                      ? 'bg-primary/10 text-primary border border-primary/30'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                  }`}
                >
                  <span className="flex items-center gap-1.5"><Key size={14} /> {settings.language === 'es' ? 'Claves API' : 'API Keys'}</span>
                </button>
              )}
              <button
                onClick={() => requestTabChange('analytics')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'analytics'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><BarChart3 size={14} /> {t.settingsModal.tabAnalytics}</span>
              </button>
              <button
                onClick={() => requestTabChange('usage')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'usage'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><BarChart3 size={14} /> {t.settingsModal.tabUsage}</span>
              </button>
              <button
                onClick={() => requestTabChange('backup')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'backup'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><Save size={14} /> {settings.language === 'es' ? 'Backups' : 'Backups'}</span>
              </button>
              <button
                onClick={() => requestTabChange('models')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'models'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <Pin size={14} /> {settings.language === 'es' ? 'Modelos' : 'Models'}
                </span>
              </button>
              <button
                onClick={() => requestTabChange('prompts')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'prompts'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><FileText size={14} /> {t.settingsModal.tabPrompts}</span>
              </button>
              <button
                onClick={() => requestTabChange('users')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'users'
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><UserRound size={14} /> {settings.language === 'es' ? 'Usuarios' : 'Users'}</span>
              </button>
              <button
                onClick={() => requestTabChange('danger')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left ${
                  activeTab === 'danger'
                    ? 'bg-red-500/10 text-red-500 border border-red-500/40'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-red-500 border border-transparent hover:border-red-200 dark:hover:border-red-800/60'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <AlertTriangle size={14} /> {t.settingsModal.tabDanger}
                </span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          
          {activeTab === 'general' && (
            <div className="space-y-8">
              {/* User Profile Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 pb-2">{t.settingsModal.profileInfo}</h3>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.displayName}</label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={generalDraft.userName}
                      onChange={(e) => setGeneralDraft((prev) => ({ ...prev, userName: e.target.value }))}
                      className="flex-1 bg-background border border-border rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    />
                  </div>
                  <p className="text-xs text-zinc-500 mt-2">{t.settingsModal.displayNameDesc}</p>
                </div>
              </div>

              {/* AI Configuration Section */}
              <div className="space-y-4">
                 <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-2">
                    <BrainCircuit size={16} /> {t.settingsModal.aiConfig}
                 </h3>

                 <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.telegramAgentModel}</label>
                    <div className="flex gap-2">
                        <div className="relative w-1/3">
                            <select
                              value={generalDraft.telegramProvider}
                              onChange={(e) => setGeneralDraft((prev) => ({ ...prev, telegramProvider: e.target.value }))}
                                className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2.5 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-primary cursor-pointer text-sm"
                            >
                                {PROVIDERS.map((provider) => (
                                    <option key={provider.id} value={provider.id}>{provider.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                        <div className="relative flex-1">
                            <select
                              value={generalDraft.telegramModel}
                              onChange={(e) => setGeneralDraft((prev) => ({ ...prev, telegramModel: e.target.value }))}
                                disabled={telegramModels.length === 0}
                                className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2.5 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-primary cursor-pointer text-sm disabled:opacity-60"
                            >
                                {telegramModels.length === 0 && <option value="">Select Model</option>}
                                {telegramModels.map((model) => (
                                    <option key={model.id} value={model.id}>{model.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                      {t.settingsModal.telegramAgentModelDesc}
                    </p>
                 </div>
                 
                 <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.contextModel}</label>
                    <div className="flex gap-2">
                         {/* Context Provider */}
                        <div className="relative w-1/3">
                            <select 
                                value={generalDraft.contextProvider}
                                onChange={(e) => {
                                  const nextProvider = e.target.value;
                                  const nextContextModels = getModelsForProvider(nextProvider);
                                  setGeneralDraft((prev) => ({
                                    ...prev,
                                    contextProvider: nextProvider,
                                    contextModel: nextContextModels[0]?.id || '',
                                  }));
                                }}
                                className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2.5 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-primary cursor-pointer text-sm"
                            >
                                {PROVIDERS.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>

                        {/* Context Model */}
                        <div className="relative flex-1">
                            <select 
                              value={generalDraft.contextModel}
                              onChange={(e) => setGeneralDraft((prev) => ({ ...prev, contextModel: e.target.value }))}
                                disabled={contextModels.length === 0}
                                className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2.5 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-primary cursor-pointer text-sm"
                            >
                                {contextModels.length === 0 && <option value="">Select Model</option>}
                                {contextModels.map(model => (
                                <option key={model.id} value={model.id}>{model.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                        {t.settingsModal.contextModelDesc}
                    </p>
                 </div>

                 {/* RAG Embedding Model (Optional) */}
                 <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.ragEmbeddingModel}</label>
                    <div className="flex gap-2">
                        {/* Embedding Provider */}
                        <div className="relative w-1/3">
                            <select
                                value={generalDraft.ragEmbeddingProvider}
                                onChange={(e) => {
                                  const nextProvider = e.target.value;
                                  if (e.target.value) {
                                    const models = getRagEmbeddingModelsForProvider(nextProvider);
                                    setGeneralDraft((prev) => ({ ...prev, ragEmbeddingProvider: nextProvider, ragEmbeddingModel: models[0]?.id || '' }));
                                  } else {
                                    setGeneralDraft((prev) => ({ ...prev, ragEmbeddingProvider: '', ragEmbeddingModel: '' }));
                                  }
                                }}
                                className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2.5 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-primary cursor-pointer text-sm"
                            >
                                <option value="">— TF-IDF (built-in) —</option>
                                {ragEmbeddingProviders.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>

                        {/* Embedding Model */}
                        <div className="relative flex-1">
                            <select
                              value={generalDraft.ragEmbeddingModel}
                              onChange={(e) => setGeneralDraft((prev) => ({ ...prev, ragEmbeddingModel: e.target.value }))}
                              disabled={!generalDraft.ragEmbeddingProvider || ragEmbeddingModels.length === 0}
                                className="w-full appearance-none bg-background border border-border rounded-lg px-3 py-2.5 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-primary cursor-pointer text-sm disabled:opacity-50"
                            >
                              {!generalDraft.ragEmbeddingProvider && <option value="">— TF-IDF —</option>}
                              {generalDraft.ragEmbeddingProvider && ragEmbeddingModels.length === 0 && <option value="">Select Model</option>}
                                {ragEmbeddingModels.map(model => (
                                    <option key={model.id} value={model.id}>{model.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {!generalDraft.ragEmbeddingProvider ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                          <Check size={12} />
                          {t.settingsModal.ragUsingTfidf}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                          <AlertTriangle size={12} />
                          {t.settingsModal.ragUsingApi}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1">
                        {t.settingsModal.ragEmbeddingModelDesc}
                    </p>
                    <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-2.5 space-y-1">
                      <p className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">{t.settingsModal.ragEmbeddingExplainTitle}</p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">{t.settingsModal.ragEmbeddingExplainWhat}</p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">- {t.settingsModal.ragEmbeddingExplainBuiltIn}</p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">- {t.settingsModal.ragEmbeddingExplainApi}</p>
                    </div>
                 </div>
              </div>

               {/* Concilium Config Section */}
               <div className="space-y-4">
                 <h3 className="text-sm font-medium text-amber-600 dark:text-amber-500 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-2">
                    <Scale size={16} /> {t.settingsModal.conciliumConfig}
                 </h3>
                 
                 <div className="bg-amber-50 dark:bg-zinc-900/40 p-4 rounded-lg border border-amber-200 dark:border-amber-900/30">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-200 mb-2 flex items-center gap-2">
                        <Gavel size={16} className="text-amber-500" />
                        {t.settingsModal.conciliumLeader}
                    </label>
                    <div className="flex gap-2">
                        {/* Leader Provider */}
                        <div className="relative w-1/3">
                            <select 
                                value={generalDraft.conciliumLeader.provider}
                                onChange={(e) => setGeneralDraft((prev) => ({ ...prev, conciliumLeader: { ...prev.conciliumLeader, provider: e.target.value, model: getModelsForProvider(e.target.value)[0]?.id || '' } }))}
                                className="w-full appearance-none bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-amber-500 cursor-pointer text-sm"
                            >
                                {PROVIDERS.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                        
                        {/* Leader Model */}
                        <div className="relative flex-1">
                             <select 
                                value={generalDraft.conciliumLeader.model}
                                onChange={(e) => setGeneralDraft((prev) => ({ ...prev, conciliumLeader: { ...prev.conciliumLeader, model: e.target.value } }))}
                                disabled={leaderModels.length === 0}
                                className="w-full appearance-none bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2.5 text-zinc-900 dark:text-zinc-200 focus:outline-none focus:border-amber-500 cursor-pointer text-sm"
                            >
                                {leaderModels.length === 0 && <option value="">Select Model</option>}
                                {leaderModels.map(model => (
                                <option key={model.id} value={model.id}>{model.name}</option>
                                ))}
                            </select>
                             <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        </div>
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                        {t.settingsModal.conciliumLeaderDesc} <strong className="text-amber-600 dark:text-amber-500/80">{t.settingsModal.mustBeSmart}</strong>
                    </p>
                 </div>
              </div>
            </div>
          )}

          {activeTab === 'interface' && (
            <div className="space-y-8">
               
               {/* Language */}
               <div className="space-y-4">
                  <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-2">
                     <Globe size={16} /> {t.settingsModal.language}
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => setInterfaceDraft((prev) => ({ ...prev, language: 'en' }))}
                        className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${interfaceDraft.language === 'en' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                      >
                         <span className="text-2xl">🇺🇸</span>
                         <span className="font-medium">English</span>
                      </button>
                      <button
                        onClick={() => setInterfaceDraft((prev) => ({ ...prev, language: 'es' }))}
                        className={`flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${interfaceDraft.language === 'es' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                      >
                         <span className="text-2xl">🇪🇸</span>
                         <span className="font-medium">Español</span>
                      </button>
                  </div>
                  <p className="text-xs text-zinc-500">{t.settingsModal.languageDesc}</p>
               </div>

               {/* Theme Mode */}
               <div className="space-y-4">
                  <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-2">
                     <Monitor size={16} /> {t.settingsModal.appearance}
                  </h3>
                  <div className="bg-background border border-border p-1 rounded-lg flex">
                      <button
                        onClick={() => setInterfaceDraft((prev) => ({ ...prev, themeMode: 'light' }))}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${interfaceDraft.themeMode === 'light' ? 'bg-surface shadow text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                      >
                         <Sun size={16} /> {t.settingsModal.light}
                      </button>
                      <button
                        onClick={() => setInterfaceDraft((prev) => ({ ...prev, themeMode: 'dark' }))}
                        className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-all ${interfaceDraft.themeMode === 'dark' ? 'bg-zinc-700 shadow text-white' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                      >
                         <Moon size={16} /> {t.settingsModal.dark}
                      </button>
                  </div>
               </div>

               {/* Accent Color */}
               <div className="space-y-4">
                  <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-2">
                     <Palette size={16} /> {t.settingsModal.accentColor}
                  </h3>
                  <div className="flex flex-wrap gap-4">
                     {THEME_COLORS.map(color => (
                        <button
                            key={color.id}
                            onClick={() => setInterfaceDraft((prev) => ({ ...prev, themeColor: color.id }))}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-110 ${interfaceDraft.themeColor === color.id ? 'ring-2 ring-offset-2 ring-offset-background ring-zinc-400' : ''}`}
                            style={{ backgroundColor: color.hex }}
                            title={color.name}
                        >
                            {interfaceDraft.themeColor === color.id && <Check size={16} className="text-white mix-blend-difference" />}
                        </button>
                     ))}
                  </div>
               </div>
            </div>
          )}

          {activeTab === 'personalization' && (
            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-2">
                  <UserRound size={16} /> {t.settingsModal.personalizationTitle}
                </h3>
                <p className="text-xs text-zinc-500">{t.settingsModal.personalizationDesc}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.nickname}</label>
                    <input
                      type="text"
                      value={personalizationDraft.personalization.nickname}
                      onChange={(e) => handlePersonalizationChange('nickname', e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.occupation}</label>
                    <input
                      type="text"
                      value={personalizationDraft.personalization.occupation}
                      onChange={(e) => handlePersonalizationChange('occupation', e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.familyAndFriends}</label>
                    <textarea
                      value={personalizationDraft.personalization.familyAndFriends}
                      onChange={(e) => handlePersonalizationChange('familyAndFriends', e.target.value)}
                      rows={2}
                      className="w-full bg-background border border-border rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary resize-y"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.leisure}</label>
                    <textarea
                      value={personalizationDraft.personalization.leisure}
                      onChange={(e) => handlePersonalizationChange('leisure', e.target.value)}
                      rows={2}
                      className="w-full bg-background border border-border rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary resize-y"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.otherPersonalization}</label>
                    <textarea
                      value={personalizationDraft.personalization.other}
                      onChange={(e) => handlePersonalizationChange('other', e.target.value)}
                      rows={2}
                      className="w-full bg-background border border-border rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary resize-y"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide border-b border-zinc-200 dark:border-zinc-800 pb-2 flex items-center gap-2">
                  <MapPin size={16} /> {t.settingsModal.locationContextTitle}
                </h3>
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={personalizationDraft.includeLocationInContext}
                    onChange={(e) => setPersonalizationDraft((prev) => ({ ...prev, includeLocationInContext: e.target.checked }))}
                    className="rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                  />
                  {t.settingsModal.includeLocationInContext}
                </label>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">{t.settingsModal.locationLabel}</label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={personalizationDraft.locationLabel}
                      onChange={(e) => setPersonalizationDraft((prev) => ({ ...prev, locationLabel: e.target.value }))}
                      placeholder={t.settingsModal.locationPlaceholder}
                      className="flex-1 min-w-[220px] bg-background border border-border rounded-lg px-4 py-2 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    />
                    <button
                      onClick={handleUseCurrentLocation}
                      disabled={locationBusy}
                      className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 inline-flex items-center gap-2"
                    >
                      {locationBusy ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
                      {t.settingsModal.detectLocation}
                    </button>
                    <button
                      onClick={() => setPersonalizationDraft((prev) => ({ ...prev, locationLabel: '' }))}
                      className="px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {t.settingsModal.clearLocation}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2">{t.settingsModal.locationContextDesc}</p>
                  {locationError && <p className="text-xs text-red-500 mt-2">{locationError}</p>}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'apikeys' && isAdmin && (
            <div className="space-y-6">
              {/* Security notice */}
              <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl p-4 flex items-start gap-3">
                <ShieldCheck size={20} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    {settings.language === 'es' ? 'Almacenamiento seguro' : 'Secure Storage'}
                  </p>
                  <p className="text-xs text-emerald-600/80 dark:text-emerald-500/70 mt-1">
                    {settings.language === 'es' 
                      ? 'Las claves API se almacenan exclusivamente en el servidor. Nunca se envían al navegador ni se exponen en el código cliente.'
                      : 'API keys are stored exclusively on the server. They are never sent to the browser or exposed in client code.'}
                  </p>
                </div>
              </div>

              {/* Provider API Key Cards */}
              {apiKeyProviders.map((provider) => {
                const status = providerStatuses.find((s) => s.id === provider.id);
                const detail = providerKeyDetails[provider.id];
                const keys = detail?.keys || [];
                const isConfigured = detail?.configured ?? status?.configured ?? false;
                const inputValue = keyInputs[provider.id] || '';
                const keyNameValue = keyNameInputs[provider.id] || '';
                const isVisible = keyVisibility[provider.id] || false;
                const isSaving = keySaving[provider.id] || false;
                const error = keyErrors[provider.id] || '';
                const success = keySuccess[provider.id] || '';
                const activeKeyId = detail?.activeKeyId || status?.activeKeyId || '';
                const keyCount = detail?.keyCount ?? status?.keyCount ?? keys.length;
                const addSaved = saveFeedback[`api-key-add-${provider.id}`];

                return (
                  <div key={provider.id} className={`rounded-xl border p-4 transition-colors ${isConfigured ? 'border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-950/10' : 'border-border bg-background'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${isConfigured ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'}`} />
                        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{provider.name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                          {keyCount} {settings.language === 'es' ? 'claves' : 'keys'}
                        </span>
                      </div>
                      {!!activeKeyId && (
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">
                          {settings.language === 'es' ? 'Activa' : 'Active'}: {detail?.activeKeyName || status?.activeKeyName}
                        </span>
                      )}
                    </div>

                    {keys.length > 0 ? (
                      <div className="space-y-2 mb-4">
                        {keys.map((savedKey) => (
                          <div
                            key={savedKey.id}
                            className={`flex items-center justify-between gap-3 p-2 rounded-lg border ${
                              savedKey.isActive
                                ? 'border-emerald-300 dark:border-emerald-800/60 bg-emerald-50/70 dark:bg-emerald-950/20'
                                : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50'
                            }`}
                          >
                            <button
                              onClick={() => handleSetActiveApiKey(provider.id, savedKey.id)}
                              disabled={isSaving}
                              className="flex items-center gap-3 flex-1 text-left"
                            >
                              <span
                                className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                  savedKey.isActive
                                    ? 'border-emerald-500 bg-emerald-500'
                                    : 'border-zinc-400 dark:border-zinc-500'
                                }`}
                              >
                                {savedKey.isActive && <Check size={11} className="text-white" />}
                              </span>
                              <span className="min-w-0">
                                <span className="block text-sm text-zinc-800 dark:text-zinc-200 truncate">{savedKey.name}</span>
                                <span className="block text-xs font-mono text-zinc-500 truncate">{savedKey.masked}</span>
                              </span>
                            </button>
                            <button
                              onClick={() => requestDeleteApiKey(provider.id, provider.name, savedKey.id, savedKey.name)}
                              disabled={isSaving}
                              className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-md transition-colors disabled:opacity-50"
                              title={settings.language === 'es' ? 'Eliminar clave' : 'Delete key'}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500 mb-3">
                        {settings.language === 'es' ? 'No hay claves configuradas para este proveedor.' : 'No API keys configured for this provider yet.'}
                      </p>
                    )}

                    <div className="space-y-2">
                      <input
                        type="text"
                        value={keyNameValue}
                        onChange={(e) => setKeyNameInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                        placeholder={settings.language === 'es' ? 'Nombre (opcional): p.ej. Personal' : 'Name (optional): e.g. Personal'}
                        className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                      />
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={isVisible ? 'text' : 'password'}
                            value={inputValue}
                            onChange={(e) => setKeyInputs((prev) => ({ ...prev, [provider.id]: e.target.value }))}
                            placeholder={settings.language === 'es' ? 'Introduce una nueva API key...' : 'Enter a new API key...'}
                            className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 pr-10 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary font-mono"
                          />
                          <button
                            onClick={() => setKeyVisibility((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                          >
                            {isVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>

                        <button
                          onClick={() => handleAddApiKey(provider.id)}
                          disabled={!inputValue.trim() || isSaving}
                          className="px-3 py-2 bg-primary hover:bg-primaryHover text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                          {isSaving ? <Loader2 size={14} className="animate-spin" /> : addSaved ? <Check size={14} /> : <Save size={14} />}
                          {addSaved ? (settings.language === 'es' ? 'Añadida' : 'Added') : settings.language === 'es' ? 'Añadir' : 'Add'}
                        </button>

                        {keys.length > 0 && (
                          <button
                            onClick={() => requestDeleteApiKey(provider.id, provider.name)}
                            disabled={isSaving}
                            className="px-3 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-lg text-sm transition-colors disabled:opacity-50"
                          >
                            {settings.language === 'es' ? 'Vaciar' : 'Clear'}
                          </button>
                        )}
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs text-red-500 mt-2">{error}</p>
                    )}
                    {!error && success && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">{success}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'models' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {settings.language === 'es' ? 'Proveedor' : 'Provider'}
                    </label>
                    <div className="relative min-w-[200px]">
                      <select
                        value={modelTabProvider}
                        onChange={(e) => setModelTabProvider(e.target.value)}
                        className="w-full appearance-none bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                      >
                        {PROVIDERS.map((provider) => (
                          <option key={provider.id} value={provider.id}>
                            {provider.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                    </div>
                  </div>
                  <button
                    onClick={handleRefreshSelectedProviderModels}
                    disabled={modelSyncBusy}
                    className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={modelSyncBusy ? 'animate-spin' : ''} />
                    {settings.language === 'es' ? 'Actualizar modelos' : 'Refresh models'}
                  </button>
                </div>

                <div className="text-xs text-zinc-500 space-y-1">
                  <p>
                    {settings.language === 'es'
                      ? `Visibles en UI principal: ${visibleModelsForSelectedProvider.length} de ${allModelsForSelectedProvider.length}.`
                      : `Visible in main UI: ${visibleModelsForSelectedProvider.length} of ${allModelsForSelectedProvider.length}.`}
                  </p>
                  <p>
                    {settings.language === 'es'
                      ? 'Los costes se sincronizan desde APIs de proveedor cuando están disponibles.'
                      : 'Model costs are synced from provider APIs when available.'}
                  </p>
                  {modelSyncStatus?.fetchedAt && (
                    <p>
                      {settings.language === 'es' ? 'Última sincronización:' : 'Last sync:'}{' '}
                      {new Date(modelSyncStatus.fetchedAt).toLocaleString(locale)} ·{' '}
                      {modelSyncStatus.source === 'live'
                        ? settings.language === 'es'
                          ? 'catálogo en vivo'
                          : 'live catalog'
                        : settings.language === 'es'
                          ? 'fallback local'
                          : 'local fallback'}
                    </p>
                  )}
                  {modelSyncStatus?.error && (
                    <p className="text-amber-600 dark:text-amber-400">{modelSyncStatus.error}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'all', labelEs: 'Todos', labelEn: 'All models' },
                    { id: 'vendor', labelEs: 'Por marca', labelEn: 'By vendor' },
                    { id: 'pinned', labelEs: 'Solo fijados', labelEn: 'Pinned only' },
                  ].map((modeOption) => (
                    <button
                      key={modeOption.id}
                      onClick={() => updateModelFilterForProvider(modelTabProvider, { mode: modeOption.id as ProviderModelFilterSettings['mode'] })}
                      disabled={modeOption.id === 'vendor' && !supportsVendorFiltering}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors disabled:opacity-50 ${
                        selectedModelFilter.mode === modeOption.id
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      {settings.language === 'es' ? modeOption.labelEs : modeOption.labelEn}
                    </button>
                  ))}
                </div>

                {supportsVendorFiltering && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {settings.language === 'es' ? 'Marcas permitidas' : 'Allowed vendors'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {modelVendors.map((vendor) => {
                        const isSelected = selectedModelFilter.vendorAllowlist.includes(vendor.name);
                        return (
                          <button
                            key={vendor.name}
                            onClick={() => toggleVendorFilter(modelTabProvider, vendor.name)}
                            className={`px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                              isSelected
                                ? 'border-primary/40 bg-primary/10 text-primary'
                                : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                            }`}
                          >
                            {vendor.name} ({vendor.count})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      {settings.language === 'es' ? 'Modelos fijados' : 'Pinned models'} ({pinnedModelsForSelectedProvider.length})
                    </p>
                    {pinnedModelsForSelectedProvider.length > 0 && (
                      <button
                        onClick={() => setUnpinAllConfirmOpen(true)}
                        className="text-[11px] px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                      >
                        {settings.language === 'es' ? 'Quitar todos' : 'Unpin all'}
                      </button>
                    )}
                  </div>
                  {pinnedModelsForSelectedProvider.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      {settings.language === 'es'
                        ? 'No tienes modelos fijados para este proveedor.'
                        : 'You have no pinned models for this provider.'}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {pinnedModelsForSelectedProvider.map((model) => (
                        <div
                          key={model.id}
                          className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${
                            model.missing
                              ? 'border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-300'
                              : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200'
                          }`}
                        >
                          <span className="max-w-[180px] truncate">{model.name}</span>
                          {model.missing ? (
                            <span className="text-[10px] uppercase tracking-wide">
                              {settings.language === 'es' ? 'No disponible' : 'Unavailable'}
                            </span>
                          ) : (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
                              {model.vendor}
                            </span>
                          )}
                          <button
                            onClick={() => togglePinnedModel(modelTabProvider, model.id)}
                            className="p-1 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                            title={settings.language === 'es' ? 'Quitar fijado' : 'Unpin model'}
                          >
                            <PinOff size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background overflow-hidden">
                <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 grid grid-cols-1 md:grid-cols-[1fr,180px,180px] gap-2">
                  <input
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder={settings.language === 'es' ? 'Buscar modelo o marca...' : 'Search model or vendor...'}
                    className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                  />
                  <div className="relative">
                    <select
                      value={modelVendorFilter}
                      onChange={(e) => setModelVendorFilter(e.target.value)}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    >
                      <option value="all">{settings.language === 'es' ? 'Vendor: todos' : 'Vendor: all'}</option>
                      {modelVendors.map((vendor) => (
                        <option key={vendor.name} value={vendor.name}>
                          {vendor.name} ({vendor.count})
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  </div>
                  <div className="relative">
                    <select
                      value={modelSortOrder}
                      onChange={(e) => setModelSortOrder(e.target.value as 'name' | 'cost-asc' | 'cost-desc')}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 pr-8 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    >
                      <option value="name">{settings.language === 'es' ? 'Ordenar: nombre' : 'Sort: name'}</option>
                      <option value="cost-asc">{settings.language === 'es' ? 'Coste: menor a mayor' : 'Cost: low to high'}</option>
                      <option value="cost-desc">{settings.language === 'es' ? 'Coste: mayor a menor' : 'Cost: high to low'}</option>
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  </div>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  {filteredModelsForTab.length === 0 ? (
                    <p className="px-4 py-8 text-sm text-zinc-500 text-center">
                      {settings.language === 'es' ? 'No hay modelos que coincidan con la búsqueda.' : 'No models match your search.'}
                    </p>
                  ) : (
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {filteredModelsForTab.map((model) => {
                        const vendor = inferModelVendor(modelTabProvider, model);
                        const pinned = pinnedSetForSelectedProvider.has(model.id);
                        const pricing = getModelPricing(modelTabProvider, model.id);
                        const totalCostPerMillion = pricing
                          ? pricing.inputPerMillionUsd + pricing.outputPerMillionUsd
                          : null;
                        const isEditingManualCost =
                          manualCostEditor?.providerId === modelTabProvider &&
                          manualCostEditor?.modelId === model.id;
                        return (
                          <div key={model.id} className="px-4 py-2.5 space-y-2">
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => togglePinnedModel(modelTabProvider, model.id)}
                                className={`p-1.5 rounded-md border transition-colors ${
                                  pinned
                                    ? 'border-primary/40 bg-primary/10 text-primary'
                                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100'
                                }`}
                                title={settings.language === 'es' ? 'Fijar modelo' : 'Pin model'}
                              >
                                {pinned ? <Pin size={13} /> : <PinOff size={13} />}
                              </button>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-zinc-800 dark:text-zinc-100 truncate">{model.name}</p>
                                <p className="text-xs font-mono text-zinc-500 truncate">{model.id}</p>
                                <p className="text-[11px] text-zinc-500 truncate">
                                  {pricing
                                    ? `${settings.language === 'es' ? 'Entrada' : 'Input'} $${formatModelPricePerMillion(pricing.inputPerMillionUsd)} · ${settings.language === 'es' ? 'Salida' : 'Output'} $${formatModelPricePerMillion(pricing.outputPerMillionUsd)} / 1M`
                                    : settings.language === 'es'
                                      ? 'Coste no disponible'
                                      : 'Cost unavailable'}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {!pricing && (
                                  <button
                                    onClick={() => openManualCostEditor(modelTabProvider, model.id)}
                                    className={`p-1 rounded-md border transition-colors ${
                                      isEditingManualCost
                                        ? 'border-primary/40 bg-primary/10 text-primary'
                                        : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-100'
                                    }`}
                                    title={settings.language === 'es' ? 'Añadir coste manual' : 'Set manual cost'}
                                  >
                                    <PlusCircle size={12} />
                                  </button>
                                )}
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                                  {vendor}
                                </span>
                                <span className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300">
                                  {totalCostPerMillion === null
                                    ? settings.language === 'es'
                                      ? 'N/D'
                                      : 'N/A'
                                    : `$${formatModelPricePerMillion(totalCostPerMillion)}/1M`}
                                </span>
                              </div>
                            </div>
                            {isEditingManualCost && !pricing && manualCostEditor && (
                              <div className="ml-9 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40 p-2.5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                  <label className="text-xs text-zinc-600 dark:text-zinc-300">
                                    {settings.language === 'es' ? 'Entrada ($/1M)' : 'Input ($/1M)'}
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.0001"
                                      value={manualCostEditor.inputPerMillionUsd}
                                      onChange={(e) =>
                                        setManualCostEditor((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                inputPerMillionUsd: e.target.value,
                                                error: '',
                                              }
                                            : prev
                                        )
                                      }
                                      className="mt-1 w-full bg-white dark:bg-zinc-900 border border-border rounded-md px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                                    />
                                  </label>
                                  <label className="text-xs text-zinc-600 dark:text-zinc-300">
                                    {settings.language === 'es' ? 'Salida ($/1M)' : 'Output ($/1M)'}
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.0001"
                                      value={manualCostEditor.outputPerMillionUsd}
                                      onChange={(e) =>
                                        setManualCostEditor((prev) =>
                                          prev
                                            ? {
                                                ...prev,
                                                outputPerMillionUsd: e.target.value,
                                                error: '',
                                              }
                                            : prev
                                        )
                                      }
                                      className="mt-1 w-full bg-white dark:bg-zinc-900 border border-border rounded-md px-2 py-1.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                                    />
                                  </label>
                                </div>
                                {manualCostEditor.error && (
                                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">{manualCostEditor.error}</p>
                                )}
                                <div className="mt-2 flex items-center justify-end gap-2">
                                  <button
                                    onClick={() => setManualCostEditor(null)}
                                    className="px-2.5 py-1 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                                  >
                                    {settings.language === 'es' ? 'Cancelar' : 'Cancel'}
                                  </button>
                                  <button
                                    onClick={saveManualCostEditor}
                                    className="px-2.5 py-1 text-xs rounded-md border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                                  >
                                    {settings.language === 'es' ? 'Guardar coste' : 'Save cost'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'analytics' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-cyan-200/60 dark:border-cyan-900/40 bg-gradient-to-br from-cyan-50 to-sky-50 dark:from-cyan-950/20 dark:to-sky-950/10 p-4">
                <div className="flex items-center gap-2 text-cyan-700 dark:text-cyan-300">
                  <BarChart3 size={18} />
                  <h3 className="font-semibold">{t.settingsModal.analyticsTitle}</h3>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">{t.settingsModal.analyticsDescription}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t.settingsModal.analyticsSpentToday}</p>
                  <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mt-2">{formatCurrency(todayUsage.totalCostUsd)}*</p>
                  <p className="text-xs text-zinc-500 mt-1">{formatNumber(todayUsage.calls)} {t.settingsModal.analyticsCalls.toLowerCase()}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t.settingsModal.analyticsSpentWeek}</p>
                  <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mt-2">{formatCurrency(weekUsage.totalCostUsd)}*</p>
                  <p className="text-xs text-zinc-500 mt-1">{formatNumber(weekUsage.calls)} {t.settingsModal.analyticsCalls.toLowerCase()}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-4">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t.settingsModal.analyticsHistorical}</p>
                  <p className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100 mt-2">{formatCurrency(totalHistoricalCostUsd)}*</p>
                  <p className="text-xs text-zinc-500 mt-1">{formatNumber(usageEvents.length)} {settings.language === 'es' ? 'eventos' : 'events'}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-4">
                <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t.settingsModal.analyticsTopSpender}</h4>
                {!topSpenderModel ? (
                  <p className="text-sm text-zinc-500">{t.settingsModal.analyticsNoData}</p>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                      <div>
                        <p className="text-sm text-zinc-500">{providerNameById[topSpenderModel.provider] || topSpenderModel.provider}</p>
                        <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{topSpenderModel.model}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{formatCurrency(topSpenderModel.totalCostUsd)}*</p>
                        <p className="text-xs text-zinc-500">{t.settingsModal.analyticsCostShare}: {topSpenderShare.toFixed(1)}%</p>
                      </div>
                    </div>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {t.settingsModal.analyticsRecommendation}: {analyticsRecommendation}
                    </p>
                  </>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-background overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                  <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t.settingsModal.analyticsHistorical}</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900/40">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500">{settings.language === 'es' ? 'Proveedor' : 'Provider'}</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500">{settings.language === 'es' ? 'Modelo' : 'Model'}</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.usageCost}</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.analyticsCostShare}</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.analyticsCalls}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalUsageByModel.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-5 text-center text-zinc-500">{t.settingsModal.analyticsNoData}</td>
                        </tr>
                      ) : (
                        historicalUsageByModel.slice(0, 8).map((row) => {
                          const rowShare = totalHistoricalCostUsd > 0 ? (row.totalCostUsd / totalHistoricalCostUsd) * 100 : 0;
                          return (
                            <tr key={`${row.provider}:${row.model}`} className="border-t border-zinc-100 dark:border-zinc-800">
                              <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{providerNameById[row.provider] || row.provider}</td>
                              <td className="px-4 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">{row.model}</td>
                              <td className="px-4 py-2 text-right font-medium text-zinc-800 dark:text-zinc-200">{formatCurrency(row.totalCostUsd)}*</td>
                              <td className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-400">{rowShare.toFixed(1)}%</td>
                              <td className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-400">{formatNumber(row.calls)}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'usage' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-indigo-200/60 dark:border-indigo-900/40 bg-gradient-to-br from-indigo-50 to-cyan-50 dark:from-indigo-950/20 dark:to-cyan-950/10 p-4">
                <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
                  <BarChart3 size={18} />
                  <h3 className="font-semibold">{t.settingsModal.usageTitle}</h3>
                </div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">{t.settingsModal.usageDescription}</p>
                <p className="text-xs text-zinc-500 mt-2">{t.settingsModal.usageApproxNote}</p>
              </div>

              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/50 dark:bg-emerald-950/10 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t.settingsModal.budgetControls}</h4>
                  <button
                    onClick={() => setUsageResetConfirmOpen(true)}
                    disabled={usageResetBusy || usageEvents.length === 0}
                    className="px-3 py-2 rounded-lg text-xs font-semibold bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                  >
                    {usageResetBusy
                      ? settings.language === 'es'
                        ? 'Restableciendo...'
                        : 'Resetting...'
                      : settings.language === 'es'
                        ? 'Restablecer usage cost'
                        : 'Reset usage cost'}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t.settingsModal.monthlyBudgetUsd}</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={settings.monthlyBudgetUsd > 0 ? settings.monthlyBudgetUsd : ''}
                      onChange={(e) => onUpdateSetting('monthlyBudgetUsd', parseBudgetInput(e.target.value))}
                      placeholder="0.00"
                      className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    />
                    <p className="text-[11px] text-zinc-500">{t.settingsModal.monthlyBudgetDesc}</p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t.settingsModal.sessionBudgetUsd}</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={settings.sessionBudgetUsd > 0 ? settings.sessionBudgetUsd : ''}
                      onChange={(e) => onUpdateSetting('sessionBudgetUsd', parseBudgetInput(e.target.value))}
                      placeholder="0.00"
                      className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    />
                    <p className="text-[11px] text-zinc-500">{t.settingsModal.sessionBudgetDesc}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-3">
                <div className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  <Filter size={15} />
                  <h4 className="text-sm font-semibold">{settings.language === 'es' ? 'Filtros de consumo' : 'Usage filters'}</h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  <div className="relative">
                    <select
                      value={usageProviderFilter}
                      onChange={(e) => setUsageProviderFilter(e.target.value)}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    >
                      <option value="all">{settings.language === 'es' ? 'Todos los proveedores' : 'All providers'}</option>
                      {usageProviderOptions.map((providerId) => (
                        <option key={providerId} value={providerId}>
                          {providerNameById[providerId] || providerId}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  </div>
                  <div className="relative">
                    <select
                      value={usageApiKeyFilter}
                      onChange={(e) => setUsageApiKeyFilter(e.target.value)}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    >
                      <option value="all">{settings.language === 'es' ? 'Todas las API keys' : 'All API keys'}</option>
                      {usageApiKeyOptions.map((keyOption) => (
                        <option key={keyOption.id} value={keyOption.id}>
                          {keyOption.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  </div>
                  <div className="relative">
                    <select
                      value={usageModelFilter}
                      onChange={(e) => setUsageModelFilter(e.target.value)}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    >
                      <option value="all">{settings.language === 'es' ? 'Todos los modelos' : 'All models'}</option>
                      {usageModelOptions.map((modelId) => (
                        <option key={modelId} value={modelId}>
                          {modelId}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  </div>
                  <div className="relative">
                    <select
                      value={usageSourceFilter}
                      onChange={(e) => setUsageSourceFilter(e.target.value)}
                      className="w-full appearance-none bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2.5 text-xs text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                    >
                      <option value="all">{settings.language === 'es' ? 'Todas las fuentes' : 'All sources'}</option>
                      {usageSourceOptions.map((source) => (
                        <option key={source} value={source}>
                          {formatUsageSource(source)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t.settingsModal.usageTotalCost}</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-1">{formatCurrency(totalUsage.totalCostUsd)}*</p>
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t.settingsModal.usageToolingCost}</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-1">{formatCurrency(totalToolingCostUsd)}*</p>
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t.settingsModal.usageInputTokens}</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-1">{formatNumber(totalUsage.inputTokens)}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t.settingsModal.usageOutputTokens}</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-1">{formatNumber(totalUsage.outputTokens)}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 p-3">
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{t.settingsModal.usageCalls}</p>
                  <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mt-1">{formatNumber(totalUsage.calls)}</p>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-2">
                    <CalendarRange size={15} className="text-primary" />
                    {t.settingsModal.usageChartTitle}
                  </h4>
                  <div className="inline-flex p-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                    {usagePeriodTabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setUsagePeriod(tab.id)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          usagePeriod === tab.id
                            ? 'bg-primary text-white'
                            : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {usageBuckets.length === 0 ? (
                  <p className="text-sm text-zinc-500 py-8 text-center">{t.settingsModal.usageNoData}</p>
                ) : (
                  <div className="h-56 flex items-end gap-2">
                    {usageBuckets.map((bucket) => {
                      const height = maxBucketCost > 0 ? Math.max(12, (bucket.totalCostUsd / maxBucketCost) * 170) : 12;
                      const isHovered = activeUsageHoverBucket?.key === bucket.key;
                      return (
                        <div key={bucket.key} className="relative flex-1 min-w-0 flex flex-col items-center gap-2">
                          <div className="h-[180px] w-full flex items-end">
                            <button
                              type="button"
                              onMouseEnter={() => setUsageHoverBucketKey(bucket.key)}
                              onMouseLeave={() => setUsageHoverBucketKey((prev) => (prev === bucket.key ? null : prev))}
                              onFocus={() => setUsageHoverBucketKey(bucket.key)}
                              onBlur={() => setUsageHoverBucketKey((prev) => (prev === bucket.key ? null : prev))}
                              className={`w-full rounded-t-md bg-gradient-to-t from-indigo-600 via-cyan-500 to-emerald-300 shadow-[0_8px_24px_-12px_rgba(99,102,241,0.7)] transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/70 ${
                                isHovered ? 'brightness-110' : ''
                              }`}
                              style={{ height }}
                              title={`${bucket.label} · ${formatCurrency(bucket.totalCostUsd)}*`}
                              aria-label={`${bucket.label}: ${formatCurrency(bucket.totalCostUsd)}`}
                            />
                          </div>
                          {isHovered && (
                            <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full z-10 pointer-events-none">
                              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white/95 dark:bg-zinc-900/95 shadow-lg px-3 py-2 text-[11px] whitespace-nowrap">
                                <p className="font-semibold text-zinc-900 dark:text-zinc-100">{bucket.label}</p>
                                <p className="text-zinc-700 dark:text-zinc-300">
                                  {settings.language === 'es' ? 'Coste' : 'Cost'}: {formatCurrency(bucket.totalCostUsd)}*
                                </p>
                                <p className="text-zinc-600 dark:text-zinc-400">
                                  {settings.language === 'es' ? 'Llamadas' : 'Calls'}: {formatNumber(bucket.calls)} · {settings.language === 'es' ? 'Tokens' : 'Tokens'}: {formatNumber(bucket.totalTokens)}
                                </p>
                              </div>
                            </div>
                          )}
                          <span className="text-[10px] text-zinc-500 truncate max-w-full">{bucket.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-background overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
                  <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t.settingsModal.usageByModel}</h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900/40">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500">{settings.language === 'es' ? 'Proveedor' : 'Provider'}</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500">{settings.language === 'es' ? 'Modelo' : 'Model'}</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.usageCost}</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.usageTokens}</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.usageCalls}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usageByModel.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-5 text-center text-zinc-500">{t.settingsModal.usageNoData}</td>
                        </tr>
                      ) : (
                        usageByModel.map((row) => (
                          <tr key={`${row.provider}:${row.model}`} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{providerNameById[row.provider] || row.provider}</td>
                            <td className="px-4 py-2 font-mono text-xs text-zinc-700 dark:text-zinc-300">{row.model}</td>
                            <td className="px-4 py-2 text-right font-medium text-zinc-800 dark:text-zinc-200">{formatCurrency(row.totalCostUsd)}*</td>
                            <td className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-400">{formatNumber(row.totalTokens)}</td>
                            <td className="px-4 py-2 text-right text-zinc-600 dark:text-zinc-400">{formatNumber(row.calls)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-background overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{t.settingsModal.pricingByModel}</h4>
                  <span className="text-xs text-zinc-500">{t.settingsModal.pricingLastUpdated}: {PRICING_LAST_UPDATED}</span>
                </div>
                <div className="max-h-72 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-zinc-50 dark:bg-zinc-900/40 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500">{settings.language === 'es' ? 'Proveedor' : 'Provider'}</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500">{settings.language === 'es' ? 'Modelo' : 'Model'}</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.pricingInput}</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.pricingOutput}</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-zinc-500">{t.settingsModal.pricingSource}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricingRows.map((row) => (
                        <tr key={`${row.provider}:${row.model}`} className="border-t border-zinc-100 dark:border-zinc-800">
                          <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{providerNameById[row.provider] || row.provider}</td>
                          <td className="px-4 py-2 text-zinc-800 dark:text-zinc-200">{row.modelName}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">{row.inputPerMillionUsd.toFixed(4)}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">{row.outputPerMillionUsd.toFixed(4)}</td>
                          <td className="px-4 py-2">
                            <a
                              href={row.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              {row.sourceLabel}
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'backup' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {settings.language === 'es' ? 'Full backup' : 'Full backup'}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    {settings.language === 'es'
                      ? 'Incluye configuraciones, historial, notas y agentes en un solo archivo JSON para restauración completa.'
                      : 'Includes settings, history, notes, and agents in a single JSON file for full restore.'}
                  </p>
                </div>

                <label className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={includeApiKeysInFullBackup}
                    onChange={(event) => setIncludeApiKeysInFullBackup(event.target.checked)}
                    disabled={!isAdmin}
                    className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                  />
                  <span>
                    {settings.language === 'es'
                      ? 'Incluir API keys en el full backup (no recomendado).'
                      : 'Include API keys in full backup (not recommended).'}
                  </span>
                </label>

                <label className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={includeAgentSecretsInFullBackup}
                    onChange={(event) => setIncludeAgentSecretsInFullBackup(event.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                  />
                  <span>
                    {settings.language === 'es'
                      ? 'Incluir credenciales de integraciones de agentes (Telegram, MCP, Calendario, Radarr/Sonarr).'
                      : 'Include agent integration credentials (Telegram, MCP, Calendar, Radarr/Sonarr).'}
                  </span>
                </label>

                {!isAdmin && (
                  <p className="text-xs text-zinc-500">
                    {settings.language === 'es'
                      ? 'Solo usuarios admin pueden incluir/restaurar API keys.'
                      : 'Only admin users can include/restore API keys.'}
                  </p>
                )}

                {(includeApiKeysInFullBackup || includeAgentSecretsInFullBackup) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {settings.language === 'es'
                      ? 'Advertencia: el archivo puede contener API keys, tokens y contraseñas en texto plano.'
                      : 'Warning: the file may contain API keys, tokens, and passwords in plain text.'}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleDownloadFullBackup}
                    disabled={backupBusy.full}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primaryHover text-white text-sm font-medium disabled:opacity-60"
                  >
                    {backupBusy.full ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {settings.language === 'es' ? 'Descargar full backup' : 'Download full backup'}
                  </button>
                  <button
                    onClick={() => fullBackupInputRef.current?.click()}
                    disabled={backupBusy.full}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
                  >
                    <Upload size={14} />
                    {settings.language === 'es' ? 'Subir y restaurar full backup' : 'Upload and restore full backup'}
                  </button>
                  <input
                    ref={fullBackupInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => { void handleRestoreFullBackup(event); }}
                  />
                </div>
                {backupSuccess.full && <p className="text-xs text-emerald-600 dark:text-emerald-400">{backupSuccess.full}</p>}
                {backupErrors.full && <p className="text-xs text-red-500">{backupErrors.full}</p>}
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {settings.language === 'es' ? 'Backup de configuraciones' : 'Settings backup'}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    {settings.language === 'es'
                      ? 'Incluye ajustes de aplicación, prompts del sistema y prompts rápidos. Puedes restaurarlo desde un archivo JSON.'
                      : 'Includes app settings, system prompts, and quick prompts. You can restore it from a JSON file.'}
                  </p>
                </div>

                <label className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={includeApiKeysInSettingsBackup}
                    onChange={(event) => setIncludeApiKeysInSettingsBackup(event.target.checked)}
                    disabled={!isAdmin}
                    className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                  />
                  <span>
                    {settings.language === 'es'
                      ? 'Incluir API keys en el backup (no recomendado).'
                      : 'Include API keys in backup (not recommended).'}
                  </span>
                </label>
                {!isAdmin && (
                  <p className="text-xs text-zinc-500">
                    {settings.language === 'es'
                      ? 'Solo usuarios admin pueden incluir/restaurar API keys.'
                      : 'Only admin users can include/restore API keys.'}
                  </p>
                )}
                {includeApiKeysInSettingsBackup && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {settings.language === 'es'
                      ? 'Advertencia: el archivo contendrá claves en texto plano.'
                      : 'Warning: the file will contain API keys in plain text.'}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleDownloadSettingsBackup}
                    disabled={backupBusy.settings}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primaryHover text-white text-sm font-medium disabled:opacity-60"
                  >
                    {backupBusy.settings ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {settings.language === 'es' ? 'Descargar backup' : 'Download backup'}
                  </button>
                  <button
                    onClick={() => settingsBackupInputRef.current?.click()}
                    disabled={backupBusy.settings}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
                  >
                    <Upload size={14} />
                    {settings.language === 'es' ? 'Subir y restaurar' : 'Upload and restore'}
                  </button>
                  <input
                    ref={settingsBackupInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => { void handleRestoreSettingsBackup(event); }}
                  />
                </div>
                {backupSuccess.settings && <p className="text-xs text-emerald-600 dark:text-emerald-400">{backupSuccess.settings}</p>}
                {backupErrors.settings && <p className="text-xs text-red-500">{backupErrors.settings}</p>}
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {settings.language === 'es' ? 'Backup de historial' : 'History backup'}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    {settings.language === 'es'
                      ? 'Guarda carpetas, chats y estados (activos, archivados, eliminados), junto con los mensajes.'
                      : 'Stores folders, chats and states (active, archived, deleted), along with messages.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleDownloadHistoryBackup}
                    disabled={backupBusy.history}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primaryHover text-white text-sm font-medium disabled:opacity-60"
                  >
                    {backupBusy.history ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {settings.language === 'es' ? 'Descargar backup' : 'Download backup'}
                  </button>
                  <button
                    onClick={() => historyBackupInputRef.current?.click()}
                    disabled={backupBusy.history}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
                  >
                    <Upload size={14} />
                    {settings.language === 'es' ? 'Subir y restaurar' : 'Upload and restore'}
                  </button>
                  <input
                    ref={historyBackupInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => { void handleRestoreHistoryBackup(event); }}
                  />
                </div>
                {backupSuccess.history && <p className="text-xs text-emerald-600 dark:text-emerald-400">{backupSuccess.history}</p>}
                {backupErrors.history && <p className="text-xs text-red-500">{backupErrors.history}</p>}
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {settings.language === 'es' ? 'Backup de carpetas y notas' : 'Notes and folders backup'}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    {settings.language === 'es'
                      ? 'Guarda todas las carpetas y notas del modo notas para restaurarlas cuando quieras.'
                      : 'Stores all folders and notes from notes mode so you can restore them later.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleDownloadNotesBackup}
                    disabled={backupBusy.notes}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primaryHover text-white text-sm font-medium disabled:opacity-60"
                  >
                    {backupBusy.notes ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {settings.language === 'es' ? 'Descargar backup' : 'Download backup'}
                  </button>
                  <button
                    onClick={() => notesBackupInputRef.current?.click()}
                    disabled={backupBusy.notes}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
                  >
                    <Upload size={14} />
                    {settings.language === 'es' ? 'Subir y restaurar' : 'Upload and restore'}
                  </button>
                  <input
                    ref={notesBackupInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => { void handleRestoreNotesBackup(event); }}
                  />
                </div>
                {backupSuccess.notes && <p className="text-xs text-emerald-600 dark:text-emerald-400">{backupSuccess.notes}</p>}
                {backupErrors.notes && <p className="text-xs text-red-500">{backupErrors.notes}</p>}
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {settings.language === 'es' ? 'Backup de agentes' : 'Agents backup'}
                  </h3>
                  <p className="text-xs text-zinc-500 mt-1">
                    {settings.language === 'es'
                      ? 'Guarda todos los agentes autónomos con sus configuraciones, instrucciones, permisos, horarios y memoria de entrenamiento.'
                      : 'Stores all autonomous agents with their configurations, instructions, permissions, schedules, and training memory.'}
                  </p>
                </div>

                <label className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={includeAgentSecretsInBackup}
                    onChange={(event) => setIncludeAgentSecretsInBackup(event.target.checked)}
                    className="mt-0.5 rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                  />
                  <span>
                    {settings.language === 'es'
                      ? 'Incluir credenciales de integraciones (Telegram, MCP, Calendario, Radarr/Sonarr).'
                      : 'Include integration credentials (Telegram, MCP, Calendar, Radarr/Sonarr).'}
                  </span>
                </label>
                {includeAgentSecretsInBackup && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {settings.language === 'es'
                      ? 'Advertencia: el archivo contendrá tokens, API keys y contraseñas en texto plano.'
                      : 'Warning: the file will contain tokens, API keys and passwords in plain text.'}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleDownloadAgentsBackup}
                    disabled={backupBusy.agents}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primaryHover text-white text-sm font-medium disabled:opacity-60"
                  >
                    {backupBusy.agents ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {settings.language === 'es' ? 'Descargar backup' : 'Download backup'}
                  </button>
                  <button
                    onClick={() => agentsBackupInputRef.current?.click()}
                    disabled={backupBusy.agents}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-60"
                  >
                    <Upload size={14} />
                    {settings.language === 'es' ? 'Subir y restaurar' : 'Upload and restore'}
                  </button>
                  <input
                    ref={agentsBackupInputRef}
                    type="file"
                    accept=".json,application/json"
                    className="hidden"
                    onChange={(event) => { void handleRestoreAgentsBackup(event); }}
                  />
                </div>
                {backupSuccess.agents && <p className="text-xs text-emerald-600 dark:text-emerald-400">{backupSuccess.agents}</p>}
                {backupErrors.agents && <p className="text-xs text-red-500">{backupErrors.agents}</p>}
              </div>
            </div>
          )}

          {activeTab === 'users' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-zinc-500">{settings.language === 'es' ? 'Sesión actual' : 'Current session'}</p>
                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mt-1">{currentUser.username}</p>
                  <p className="text-xs text-zinc-500 mt-1">{currentUser.role === 'admin' ? 'Admin' : 'User'}</p>
                </div>
                <button
                  onClick={() => setLogoutConfirmOpen(true)}
                  className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <LogOut size={14} />
                  {settings.language === 'es' ? 'Cerrar sesión' : 'Sign out'}
                </button>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-3">
                <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{settings.language === 'es' ? 'Cambiar mi contraseña' : 'Change my password'}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    type="password"
                    value={passwordCurrent}
                    onChange={(event) => setPasswordCurrent(event.target.value)}
                    placeholder={settings.language === 'es' ? 'Contraseña actual' : 'Current password'}
                    className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                  />
                  <input
                    type="password"
                    value={passwordNew}
                    onChange={(event) => setPasswordNew(event.target.value)}
                    placeholder={settings.language === 'es' ? 'Nueva contraseña' : 'New password'}
                    className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                  />
                  <input
                    type="password"
                    value={passwordConfirm}
                    onChange={(event) => setPasswordConfirm(event.target.value)}
                    placeholder={settings.language === 'es' ? 'Confirmar contraseña' : 'Confirm password'}
                    className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleChangeOwnPassword()}
                    disabled={passwordBusy}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primaryHover text-white text-sm font-medium disabled:opacity-60"
                  >
                    {passwordBusy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {settings.language === 'es' ? 'Actualizar contraseña' : 'Update password'}
                  </button>
                  {passwordSuccess && <p className="text-sm text-emerald-600 dark:text-emerald-400">{passwordSuccess}</p>}
                </div>
                {passwordError && <p className="text-sm text-red-500">{passwordError}</p>}
              </div>

              {isAdmin && (
                <>
                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{settings.language === 'es' ? 'Crear usuario' : 'Create user'}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={createUserName}
                        onChange={(event) => setCreateUserName(event.target.value)}
                        placeholder={settings.language === 'es' ? 'Nombre de usuario' : 'Username'}
                        className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                      />
                      <input
                        type="password"
                        value={createUserPassword}
                        onChange={(event) => setCreateUserPassword(event.target.value)}
                        placeholder={settings.language === 'es' ? 'Contraseña inicial' : 'Initial password'}
                        className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => void handleCreateUser()}
                        disabled={createUserBusy}
                        className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary hover:bg-primaryHover text-white text-sm font-medium disabled:opacity-60"
                      >
                        {createUserBusy ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                        {settings.language === 'es' ? 'Crear' : 'Create'}
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {settings.language === 'es'
                        ? 'El usuario podrá cambiar su contraseña desde esta misma pestaña.'
                        : 'The user will be able to change their password from this tab.'}
                    </p>
                    {createUserError && <p className="text-sm text-red-500">{createUserError}</p>}
                  </div>

                  <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background p-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{settings.language === 'es' ? 'Gestión de usuarios' : 'User management'}</h3>
                      <button
                        onClick={() => void refreshManagedUsers()}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        <RefreshCw size={12} />
                        {settings.language === 'es' ? 'Refrescar' : 'Refresh'}
                      </button>
                    </div>

                    {usersLoading && (
                      <div className="flex items-center gap-2 text-sm text-zinc-500">
                        <Loader2 size={14} className="animate-spin" />
                        {settings.language === 'es' ? 'Cargando usuarios...' : 'Loading users...'}
                      </div>
                    )}
                    {usersError && <p className="text-sm text-red-500">{usersError}</p>}

                    {!usersLoading && managedUsers.length === 0 && (
                      <p className="text-sm text-zinc-500">{settings.language === 'es' ? 'No hay usuarios registrados.' : 'No users found.'}</p>
                    )}

                    <div className="space-y-4">
                      {managedUsers.map((user) => (
                        <div key={user.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/30 p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{user.username}</p>
                              <p className="text-xs text-zinc-500">{user.role === 'admin' ? 'Admin' : 'User'}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              {user.id !== currentUser.id && (
                                <button
                                  onClick={() => setUserDeleteConfirm(user)}
                                  disabled={userBusyId === user.id}
                                  className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-md border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
                                >
                                  <Trash2 size={12} />
                                  {settings.language === 'es' ? 'Eliminar' : 'Delete'}
                                </button>
                              )}
                              <button
                                onClick={() => void handleSaveUserAccess(user.id)}
                                disabled={userBusyId === user.id}
                                className="inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-md bg-primary hover:bg-primaryHover text-white disabled:opacity-60"
                              >
                                {userBusyId === user.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                                {userSaveFeedback[user.id] || (settings.language === 'es' ? 'Guardar' : 'Save')}
                              </button>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                              {settings.language === 'es' ? 'Límite mensual API (USD)' : 'Monthly API limit (USD)'}
                            </label>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={userDraftLimits[user.id] || ''}
                              onChange={(event) =>
                                setUserDraftLimits((prev) => ({ ...prev, [user.id]: event.target.value }))
                              }
                              placeholder="0.00"
                              className="w-full max-w-xs bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                            />
                            <p className="text-[11px] text-zinc-500">
                              {settings.language === 'es' ? '0 significa sin límite.' : '0 means no monthly cap.'}
                            </p>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                              {settings.language === 'es' ? 'Modelos permitidos por proveedor' : 'Allowed models by provider'}
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              {settings.language === 'es'
                                ? 'Si no seleccionas modelos en un proveedor, ese usuario verá todos.'
                                : 'If you leave a provider without selected models, that user will see all models.'}
                            </p>
                            <div className="space-y-2">
                              {PROVIDERS.map((provider) => {
                                const providerModels = getAllModelsForProvider(provider.id);
                                const selected = userDraftAllowlists[user.id]?.[provider.id] || [];
                                const allMode = selected.length === 0;
                                return (
                                  <div key={`${user.id}:${provider.id}`} className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/40 p-2.5 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{provider.name}</p>
                                      <button
                                        onClick={() => setUserProviderToAllModels(user.id, provider.id)}
                                        className={`text-[11px] px-2 py-1 rounded-md border ${
                                          allMode
                                            ? 'border-primary/40 bg-primary/10 text-primary'
                                            : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                                        }`}
                                      >
                                        {settings.language === 'es' ? 'Todos' : 'All'}
                                      </button>
                                    </div>
                                    {providerModels.length === 0 ? (
                                      <p className="text-[11px] text-zinc-500">
                                        {settings.language === 'es' ? 'Sin modelos detectados.' : 'No models detected.'}
                                      </p>
                                    ) : (
                                      <div className="max-h-28 overflow-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                        {providerModels.map((model) => {
                                          const checked = selected.includes(model.id);
                                          return (
                                            <label key={`${user.id}:${provider.id}:${model.id}`} className="flex items-center gap-2 text-[11px] text-zinc-700 dark:text-zinc-300">
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleUserModel(user.id, provider.id, model.id)}
                                                className="rounded border-zinc-300 dark:border-zinc-700 text-primary focus:ring-primary"
                                              />
                                              <span className="truncate" title={model.id}>{model.name}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'prompts' && (
            <div className="space-y-8">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{t.settingsModal.tabPrompts}</h3>
                <div className="flex flex-col md:flex-row gap-6 h-full min-h-[320px]">
                  <div className="w-full md:w-1/3 border-r border-border pr-4 space-y-2">
                    <button 
                      onClick={handleNewPrompt}
                      className="w-full flex items-center gap-2 p-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-primary hover:border-primary transition-colors mb-4 justify-center text-sm"
                    >
                      <PlusCircle size={16} /> {t.settingsModal.createNew}
                    </button>
                    <div className="space-y-1 overflow-y-auto max-h-[320px]">
                      {systemPrompts.map(p => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectPromptToEdit(p)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors ${
                            editingPrompt.id === p.id 
                              ? 'bg-primary/10 text-primary border border-primary/30' 
                              : 'text-zinc-600 dark:text-zinc-400 hover:bg-background'
                          }`}
                        >
                          {p.name}
                          {p.isDefault && <span className="ml-2 text-[10px] bg-zinc-200 dark:bg-zinc-800 text-zinc-500 px-1 rounded">{t.common.default}</span>}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex-1 flex flex-col space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 mr-4">
                        <label className="block text-xs font-medium text-zinc-500 mb-1">{t.settingsModal.promptName}</label>
                        <input
                          type="text"
                          value={editingPrompt.name}
                          onChange={(e) => setEditingPrompt({ ...editingPrompt, name: e.target.value })}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-primary"
                          placeholder="e.g. Coding Assistant"
                        />
                      </div>
                    </div>
                    
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-zinc-500 mb-1">{t.settingsModal.systemInstructions}</label>
                      <textarea
                        value={editingPrompt.content}
                        onChange={(e) => setEditingPrompt({ ...editingPrompt, content: e.target.value })}
                        className="w-full h-[200px] bg-background border border-border rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-300 focus:outline-none focus:border-primary resize-none font-mono"
                        placeholder="Enter system instructions here..."
                      />
                    </div>
                    
                    <div className="flex justify-between pt-2 border-t border-border">
                      <button 
                        onClick={handleDeletePrompt}
                        className="flex items-center gap-2 text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/20 px-3 py-2 rounded-lg text-sm transition-colors"
                        title={t.settingsModal.deletePrompt}
                      >
                        <Trash2 size={16} /> <span className="hidden sm:inline">{t.settingsModal.deletePrompt}</span>
                      </button>
                      <button 
                        onClick={handleSavePrompt}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          saveFeedback['system-prompt']
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-primary hover:bg-primaryHover text-white'
                        }`}
                      >
                        {saveFeedback['system-prompt'] ? <Check size={16} /> : <Save size={16} />}
                        {saveFeedback['system-prompt']
                          ? settings.language === 'es'
                            ? 'Guardado'
                            : 'Saved'
                          : t.settingsModal.savePrompt}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-cyan-200/60 dark:border-cyan-900/40 bg-cyan-50/40 dark:bg-cyan-950/10 p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">{t.settingsModal.quickPromptsTitle}</h3>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{t.settingsModal.quickPromptsDesc}</p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[240px,1fr] gap-4">
                  <div className="space-y-2">
                    <button
                      onClick={handleNewQuickPrompt}
                      className="w-full flex items-center gap-2 p-2 rounded-lg border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:text-cyan-700 hover:border-cyan-500 transition-colors justify-center text-sm"
                    >
                      <PlusCircle size={15} /> {t.settingsModal.quickPromptCreate}
                    </button>
                    <div className="space-y-1 max-h-[220px] overflow-y-auto">
                      {quickInsertPrompts.length === 0 && (
                        <p className="text-xs text-zinc-500 px-2 py-3 text-center">{t.settingsModal.quickPromptEmpty}</p>
                      )}
                      {quickInsertPrompts.map((prompt) => (
                        <button
                          key={prompt.id}
                          onClick={() => handleSelectQuickPromptToEdit(prompt)}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors ${
                            editingQuickPrompt.id === prompt.id
                              ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30'
                              : 'text-zinc-600 dark:text-zinc-400 hover:bg-background'
                          }`}
                        >
                          {prompt.title}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-zinc-500 mb-1">{t.settingsModal.quickPromptShortTitle}</label>
                      <input
                        type="text"
                        maxLength={40}
                        value={editingQuickPrompt.title}
                        onChange={(e) => setEditingQuickPrompt({ ...editingQuickPrompt, title: e.target.value })}
                        className="w-full bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-cyan-500"
                        placeholder={settings.language === 'es' ? 'Ej. SQL rápido' : 'e.g. Quick SQL'}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-zinc-500 mb-1">{t.settingsModal.quickPromptContent}</label>
                      <textarea
                        value={editingQuickPrompt.content}
                        onChange={(e) => setEditingQuickPrompt({ ...editingQuickPrompt, content: e.target.value })}
                        className="w-full h-[140px] bg-white dark:bg-zinc-900 border border-border rounded-lg px-3 py-2 text-sm text-zinc-800 dark:text-zinc-300 focus:outline-none focus:border-cyan-500 resize-none font-mono"
                        placeholder={settings.language === 'es' ? 'Contenido que se insertará en el chat...' : 'Content inserted into the chat...'}
                      />
                    </div>
                    <div className="flex justify-between pt-2 border-t border-border">
                      <button
                        onClick={handleDeleteQuickPrompt}
                        className="flex items-center gap-2 text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/20 px-3 py-2 rounded-lg text-sm transition-colors"
                      >
                        <Trash2 size={16} /> <span className="hidden sm:inline">{t.settingsModal.deletePrompt}</span>
                      </button>
                      <button
                        onClick={handleSaveQuickPrompt}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                          saveFeedback['quick-prompt']
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                            : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                        }`}
                      >
                        {saveFeedback['quick-prompt'] ? <Check size={16} /> : <Save size={16} />}
                        {saveFeedback['quick-prompt']
                          ? settings.language === 'es'
                            ? 'Guardado'
                            : 'Saved'
                          : t.settingsModal.quickPromptSave}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'danger' && (
            <div className="space-y-6">
              <div className="rounded-2xl border border-red-300/70 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 p-4">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                  <AlertTriangle size={18} />
                  <h3 className="font-semibold">{t.settingsModal.dangerTitle}</h3>
                </div>
                <p className="text-sm text-red-600/80 dark:text-red-300/80 mt-2">{t.settingsModal.dangerDescription}</p>
              </div>

              <div className="space-y-3">
                <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-background p-4">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.settingsModal.dangerMoveHistoryTitle}</h4>
                  <p className="text-xs text-zinc-500 mt-1">{t.settingsModal.dangerMoveHistoryDesc}</p>
                  <button
                    onClick={() =>
                      openDangerConfirm(
                        'moveHistoryToTrash',
                        t.settingsModal.dangerMoveHistoryConfirmTitle,
                        t.settingsModal.dangerMoveHistoryConfirmMsg,
                        t.settingsModal.dangerMoveHistoryButton
                      )
                    }
                    disabled={dangerBusyAction !== null}
                    className="mt-3 px-3 py-2 rounded-lg text-sm font-medium bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/50 transition-colors disabled:opacity-50"
                  >
                    {t.settingsModal.dangerMoveHistoryButton}
                  </button>
                </div>

                <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-background p-4">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.settingsModal.dangerDeleteHistoryTitle}</h4>
                  <p className="text-xs text-zinc-500 mt-1">{t.settingsModal.dangerDeleteHistoryDesc}</p>
                  <button
                    onClick={() =>
                      openDangerConfirm(
                        'deleteAllHistoryAndTrash',
                        t.settingsModal.dangerDeleteHistoryConfirmTitle,
                        t.settingsModal.dangerDeleteHistoryConfirmMsg,
                        t.settingsModal.dangerDeleteHistoryButton
                      )
                    }
                    disabled={dangerBusyAction !== null}
                    className="mt-3 px-3 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                  >
                    {t.settingsModal.dangerDeleteHistoryButton}
                  </button>
                </div>

                <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-background p-4">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.settingsModal.dangerEmptyTrashTitle}</h4>
                  <p className="text-xs text-zinc-500 mt-1">{t.settingsModal.dangerEmptyTrashDesc}</p>
                  <button
                    onClick={() =>
                      openDangerConfirm(
                        'emptyTrash',
                        t.settingsModal.dangerEmptyTrashConfirmTitle,
                        t.settingsModal.dangerEmptyTrashConfirmMsg,
                        t.settingsModal.dangerEmptyTrashButton
                      )
                    }
                    disabled={dangerBusyAction !== null}
                    className="mt-3 px-3 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                  >
                    {t.settingsModal.dangerEmptyTrashButton}
                  </button>
                </div>

                <div className="rounded-xl border border-red-200 dark:border-red-900/50 bg-background p-4">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t.settingsModal.dangerResetSettingsTitle}</h4>
                  <p className="text-xs text-zinc-500 mt-1">{t.settingsModal.dangerResetSettingsDesc}</p>
                  <button
                    onClick={() =>
                      openDangerConfirm(
                        'resetSettingsAndApiKeys',
                        t.settingsModal.dangerResetSettingsConfirmTitle,
                        t.settingsModal.dangerResetSettingsConfirmMsg,
                        t.settingsModal.dangerResetSettingsButton
                      )
                    }
                    disabled={dangerBusyAction !== null}
                    className="mt-3 px-3 py-2 rounded-lg text-sm font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
                  >
                    {dangerBusyAction === 'resetSettingsAndApiKeys' ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        {settings.language === 'es' ? 'Procesando...' : 'Processing...'}
                      </span>
                    ) : (
                      t.settingsModal.dangerResetSettingsButton
                    )}
                  </button>
                </div>

                <div className="rounded-xl border border-red-300 dark:border-red-900/70 bg-red-50/60 dark:bg-red-950/20 p-4">
                  <h4 className="text-sm font-semibold text-red-700 dark:text-red-300">{t.settingsModal.dangerDeleteAllDataTitle}</h4>
                  <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-1">{t.settingsModal.dangerDeleteAllDataDesc}</p>
                  <button
                    onClick={() =>
                      openDangerConfirm(
                        'deleteAllUserData',
                        t.settingsModal.dangerDeleteAllDataConfirmTitle,
                        t.settingsModal.dangerDeleteAllDataConfirmMsg,
                        t.settingsModal.dangerDeleteAllDataButton
                      )
                    }
                    disabled={dangerBusyAction !== null}
                    className="mt-3 px-3 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {dangerBusyAction === 'deleteAllUserData' ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" />
                        {settings.language === 'es' ? 'Eliminando...' : 'Deleting...'}
                      </span>
                    ) : (
                      t.settingsModal.dangerDeleteAllDataButton
                    )}
                  </button>
                </div>
              </div>

              {dangerError && (
                <p className="text-sm text-red-500">{dangerError}</p>
              )}
            </div>
          )}

          {activeTabSaveConfig && (
            <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 mt-4 border-t border-border bg-surface/95 backdrop-blur px-4 sm:px-6 py-3 flex justify-end">
              <button
                onClick={activeTabSaveConfig.onSave}
                disabled={!activeTabSaveConfig.dirty}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  saveFeedback[activeTabSaveConfig.feedbackKey]
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-primary hover:bg-primaryHover text-white'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {saveFeedback[activeTabSaveConfig.feedbackKey] ? <Check size={16} /> : <Save size={16} />}
                {saveFeedback[activeTabSaveConfig.feedbackKey]
                  ? settings.language === 'es' ? 'Guardado' : 'Saved'
                  : settings.language === 'es' ? 'Guardar pestaña' : 'Save tab'}
              </button>
            </div>
          )}

          </div>
        </div>
      </div>

      {unsavedWarningOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface border border-border w-full max-w-md rounded-xl shadow-2xl p-6">
            <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-2">
              {settings.language === 'es' ? 'Cambios sin guardar' : 'Unsaved changes'}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">
              {settings.language === 'es'
                ? 'Tienes cambios sin guardar. ¿Qué quieres hacer antes de continuar?'
                : 'You have unsaved changes. What would you like to do before continuing?'}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => {
                  setUnsavedWarningOpen(false);
                  setPendingTabTarget(null);
                  setPendingClose(false);
                }}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-border text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                {settings.language === 'es' ? 'Cancelar' : 'Cancel'}
              </button>
              <button
                onClick={discardUnsavedChangesAndContinue}
                className="px-3 py-2 rounded-lg text-sm font-medium border border-red-200 dark:border-red-800/50 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
              >
                {settings.language === 'es' ? 'Descartar cambios' : 'Discard changes'}
              </button>
              <button
                onClick={saveUnsavedChangesAndContinue}
                className="px-3 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primaryHover text-white transition-colors"
              >
                {settings.language === 'es' ? 'Guardar y continuar' : 'Save and continue'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={unpinAllConfirmOpen}
        onClose={() => setUnpinAllConfirmOpen(false)}
        onConfirm={confirmUnpinAllModels}
        title={settings.language === 'es' ? '¿Quitar todos los fijados?' : 'Unpin all models?'}
        message={
          settings.language === 'es'
            ? 'Se quitarán todos los modelos fijados del proveedor seleccionado.'
            : 'All pinned models for the selected provider will be removed.'
        }
        confirmText={settings.language === 'es' ? 'Sí, quitar todos' : 'Yes, unpin all'}
        cancelText={t.common.cancel}
        isDestructive={true}
      />

      <ConfirmationModal
        isOpen={!!dangerConfirm}
        onClose={() => setDangerConfirm(null)}
        onConfirm={handleConfirmDangerAction}
        title={dangerConfirm?.title || ''}
        message={dangerConfirm?.message || ''}
        confirmText={dangerConfirm?.confirmText || t.common.confirm}
        cancelText={t.common.cancel}
        isDestructive={true}
        requireCode={dangerConfirm?.id === 'deleteAllUserData'}
        yesText={settings.language === 'es' ? 'Sí' : 'Yes'}
        noText={settings.language === 'es' ? 'No' : 'No'}
        codePromptText={
          settings.language === 'es'
            ? 'Introduce el código aleatorio de 4 dígitos para confirmar la eliminación total:'
            : 'Enter the random 4-digit code to confirm full data deletion:'
        }
        codeErrorText={
          settings.language === 'es'
            ? 'Código incorrecto, inténtalo de nuevo.'
            : 'Incorrect code, please try again.'
        }
      />

      <ConfirmationModal
        isOpen={!!apiKeyDeleteConfirm}
        onClose={() => setApiKeyDeleteConfirm(null)}
        onConfirm={confirmDeleteApiKey}
        title={
          settings.language === 'es'
            ? '¿Eliminar API key?'
            : 'Delete API key?'
        }
        message={
          apiKeyDeleteConfirm
            ? apiKeyDeleteConfirm.keyId
              ? settings.language === 'es'
                ? `Se eliminará la clave "${apiKeyDeleteConfirm.keyName || apiKeyDeleteConfirm.keyId}" de ${apiKeyDeleteConfirm.providerName}. Esta acción no se puede deshacer.`
                : `The key "${apiKeyDeleteConfirm.keyName || apiKeyDeleteConfirm.keyId}" will be removed from ${apiKeyDeleteConfirm.providerName}. This action cannot be undone.`
              : settings.language === 'es'
                ? `Se eliminarán todas las claves guardadas para ${apiKeyDeleteConfirm.providerName}. Esta acción no se puede deshacer.`
                : `All saved keys for ${apiKeyDeleteConfirm.providerName} will be removed. This action cannot be undone.`
            : ''
        }
        confirmText={settings.language === 'es' ? 'Sí, eliminar' : 'Yes, delete'}
        cancelText={t.common.cancel}
        isDestructive={true}
      />

      <ConfirmationModal
        isOpen={!!userDeleteConfirm}
        onClose={() => setUserDeleteConfirm(null)}
        onConfirm={confirmDeleteUser}
        title={settings.language === 'es' ? '¿Eliminar usuario?' : 'Delete user?'}
        message={
          userDeleteConfirm
            ? settings.language === 'es'
              ? `Se eliminará el usuario "${userDeleteConfirm.username}". Esta acción no se puede deshacer.`
              : `The user "${userDeleteConfirm.username}" will be deleted. This action cannot be undone.`
            : ''
        }
        confirmText={settings.language === 'es' ? 'Sí, eliminar' : 'Yes, delete'}
        cancelText={t.common.cancel}
        isDestructive={true}
      />

      <ConfirmationModal
        isOpen={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
        onConfirm={() => {
          setLogoutConfirmOpen(false);
          void onLogout();
        }}
        title={settings.language === 'es' ? '¿Cerrar sesión?' : 'Sign out?'}
        message={
          settings.language === 'es'
            ? 'Se cerrará la sesión actual en este dispositivo.'
            : 'Your current session will be closed on this device.'
        }
        confirmText={settings.language === 'es' ? 'Sí, cerrar sesión' : 'Yes, sign out'}
        cancelText={t.common.cancel}
        isDestructive={true}
      />

      <ConfirmationModal
        isOpen={usageResetConfirmOpen}
        onClose={() => {
          if (!usageResetBusy) setUsageResetConfirmOpen(false);
        }}
        onConfirm={() => {
          void confirmResetUsageCost();
        }}
        title={settings.language === 'es' ? '¿Restablecer usage cost?' : 'Reset usage cost?'}
        message={
          settings.language === 'es'
            ? 'Se eliminará el historial de costes de uso y los indicadores volverán a cero. Esta acción no se puede deshacer.'
            : 'Usage cost history will be deleted and all usage indicators will go back to zero. This action cannot be undone.'
        }
        confirmText={settings.language === 'es' ? 'Sí, restablecer' : 'Yes, reset'}
        cancelText={t.common.cancel}
        isDestructive={true}
        requireCode={true}
        yesText={settings.language === 'es' ? 'Sí' : 'Yes'}
        noText={settings.language === 'es' ? 'No' : 'No'}
        codePromptText={
          settings.language === 'es'
            ? 'Introduce el código aleatorio de 4 dígitos para confirmar:'
            : 'Enter the random 4-digit code to confirm:'
        }
        codeErrorText={
          settings.language === 'es'
            ? 'Código incorrecto, inténtalo de nuevo.'
            : 'Incorrect code, please try again.'
        }
      />
    </div>
  );
};
