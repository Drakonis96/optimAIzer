import { Conversation, Message, ModelOption, SystemPrompt, Folder, ThemeColorOption, ReasoningEffort, ToolingOptions } from './types';

// Sorted Alphabetically
export const PROVIDERS: ModelOption[] = [
    { id: 'anthropic', name: 'Claude' },
    { id: 'google', name: 'Gemini' },
    { id: 'groq', name: 'Groq' },
    { id: 'lmstudio', name: 'LM Studio' },
    { id: 'ollama', name: 'Ollama' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'openrouter', name: 'OpenRouter' },
];

export const PROVIDERS_WITH_API_KEYS = ['anthropic', 'google', 'groq', 'openai', 'openrouter'];
export const PROVIDERS_WITH_VENDOR_FILTER = ['groq', 'openrouter'];
export const PROVIDERS_WITH_TEMPERATURE = ['anthropic', 'google', 'groq', 'lmstudio', 'ollama', 'openai', 'openrouter'];

export const providerRequiresApiKey = (providerId: string): boolean =>
    PROVIDERS_WITH_API_KEYS.includes(providerId);

export const providerSupportsVendorFilter = (providerId: string): boolean =>
    PROVIDERS_WITH_VENDOR_FILTER.includes(providerId);

export const providerSupportsTemperature = (providerId: string): boolean =>
    PROVIDERS_WITH_TEMPERATURE.includes(providerId);

export const MODELS_BY_PROVIDER: Record<string, ModelOption[]> = {
    anthropic: [
        { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
        { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
        { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    ],
    google: [
        { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
        { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    ],
    groq: [
        { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B 128E Instruct' },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B 16E Instruct' },
        { id: 'moonshotai/kimi-k2-instruct-0905', name: 'Kimi K2 Instruct 0905' },
        { id: 'qwen/qwen3-32b', name: 'Qwen3 32B' },
    ],
    lmstudio: [],
    ollama: [],
    openai: [
        { id: 'gpt-5.2', name: 'GPT-5.2' },
    ],
    openrouter: [
        { id: 'z-ai/glm-5', name: 'GLM-5' },
        { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
        { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5' },
        { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
        { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2' },
        { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5' },
        { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast' },
        { id: 'minimax/minimax-m2.1', name: 'MiniMax M2.1' },
        { id: 'google/gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
        { id: 'openai/gpt-5-nano', name: 'GPT-5 Nano' },
        { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
        { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
        { id: 'openai/gpt-5-mini', name: 'GPT-5 Mini' },
        { id: 'mistralai/mistral-nemo', name: 'Mistral Nemo' },
        { id: 'openai/gpt-4o', name: 'GPT-4o' },
        { id: 'google/gemma-3-27b-it', name: 'Gemma 3 27B IT' },
        { id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5' },
        { id: 'qwen/qwen3-235b-a22b-2507', name: 'Qwen3 235B A22B 2507' },
    ],
};

export const MODELS: ModelOption[] = Object.values(MODELS_BY_PROVIDER).flat();
export const CONTEXT_MODELS: ModelOption[] = MODELS;

// Dedicated RAG embedding catalogs (independent from chat/completion models)
export const RAG_EMBEDDING_MODELS_BY_PROVIDER: Record<string, ModelOption[]> = {
    openai: [
        { id: 'text-embedding-3-small', name: 'text-embedding-3-small' },
        { id: 'text-embedding-3-large', name: 'text-embedding-3-large' },
        { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002 (legacy)' },
    ],
    google: [
        { id: 'gemini-embedding-001', name: 'gemini-embedding-001' },
        { id: 'text-embedding-004', name: 'text-embedding-004 (legacy)' },
    ],
    ollama: [
        { id: 'embeddinggemma', name: 'embeddinggemma' },
        { id: 'qwen3-embedding', name: 'qwen3-embedding' },
        { id: 'mxbai-embed-large', name: 'mxbai-embed-large' },
        { id: 'nomic-embed-text', name: 'nomic-embed-text' },
        { id: 'all-minilm', name: 'all-minilm' },
    ],
    openrouter: [
        { id: 'openai/text-embedding-3-small', name: 'openai/text-embedding-3-small' },
        { id: 'openai/text-embedding-3-large', name: 'openai/text-embedding-3-large' },
        { id: 'google/gemini-embedding-001', name: 'google/gemini-embedding-001' },
    ],
};
export const RAG_EMBEDDING_PROVIDERS: ModelOption[] = PROVIDERS.filter((provider) =>
    Array.isArray(RAG_EMBEDDING_MODELS_BY_PROVIDER[provider.id]) &&
    RAG_EMBEDDING_MODELS_BY_PROVIDER[provider.id].length > 0
);

export const providerSupportsRagEmbeddings = (providerId: string): boolean =>
    RAG_EMBEDDING_PROVIDERS.some((provider) => provider.id === providerId);

export const getRagEmbeddingProviders = (): ModelOption[] =>
    RAG_EMBEDDING_PROVIDERS;

export const getRagEmbeddingModelsForProvider = (providerId: string): ModelOption[] =>
    RAG_EMBEDDING_MODELS_BY_PROVIDER[providerId] || [];

export const getDefaultRagEmbeddingModelForProvider = (providerId: string): string =>
    getRagEmbeddingModelsForProvider(providerId)[0]?.id || '';

export const isRagEmbeddingModelKnownForProvider = (providerId: string, modelId: string): boolean =>
    getRagEmbeddingModelsForProvider(providerId).some((model) => model.id === modelId);

export const OPENAI_REASONING_MODEL_ID = 'gpt-5.2';
export const REASONING_EFFORT_LEVELS: ReasoningEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];

const runtimeModelsByProvider: Record<string, ModelOption[] | undefined> = {};
const visibleModelIdsByProvider: Record<string, Set<string> | undefined> = {};

const normalizeModels = (models: ModelOption[]): ModelOption[] => {
    const deduped = new Map<string, ModelOption>();
    models.forEach((model) => {
        if (!model?.id || typeof model.id !== 'string') return;
        if (deduped.has(model.id)) return;
        deduped.set(model.id, {
            id: model.id,
            name: model.name?.trim() || model.id,
            description: model.description,
            vendor: model.vendor,
            contextLength: Number.isFinite(model.contextLength) ? model.contextLength : undefined,
            inputPerMillionUsd: Number.isFinite(model.inputPerMillionUsd) ? model.inputPerMillionUsd : undefined,
            outputPerMillionUsd: Number.isFinite(model.outputPerMillionUsd) ? model.outputPerMillionUsd : undefined,
            pricingSourceUrl: typeof model.pricingSourceUrl === 'string' ? model.pricingSourceUrl : undefined,
            pricingSourceLabel: typeof model.pricingSourceLabel === 'string' ? model.pricingSourceLabel : undefined,
            pricingUpdatedAt: Number.isFinite(model.pricingUpdatedAt) ? model.pricingUpdatedAt : undefined,
        });
    });
    return Array.from(deduped.values());
};

export const inferModelVendor = (providerId: string, model: Pick<ModelOption, 'id' | 'vendor'>): string => {
    if (typeof model.vendor === 'string' && model.vendor.trim()) return model.vendor.trim();
    if (providerId === 'openrouter' || providerId === 'groq') {
        const slashIndex = model.id.indexOf('/');
        if (slashIndex > 0) return model.id.slice(0, slashIndex);
    }
    if (providerId === 'openai' || providerId === 'anthropic' || providerId === 'google') return providerId;
    if (providerId === 'ollama' || providerId === 'lmstudio') return 'local';
    return providerId;
};

export const setRuntimeModelsForProvider = (providerId: string, models: ModelOption[]): void => {
    runtimeModelsByProvider[providerId] = normalizeModels(models);
};

export const clearRuntimeModelsForProvider = (providerId: string): void => {
    delete runtimeModelsByProvider[providerId];
};

export const setVisibleModelFilterForProvider = (providerId: string, modelIds?: string[] | null): void => {
    if (!Array.isArray(modelIds)) {
        delete visibleModelIdsByProvider[providerId];
        return;
    }
    visibleModelIdsByProvider[providerId] = new Set(modelIds);
};

export const getAllModelsForProvider = (providerId: string): ModelOption[] =>
    runtimeModelsByProvider[providerId] || MODELS_BY_PROVIDER[providerId] || [];

export const getModelsForProvider = (providerId: string): ModelOption[] => {
    const allModels = getAllModelsForProvider(providerId);
    const visible = visibleModelIdsByProvider[providerId];
    if (!visible) return allModels;
    return allModels.filter((model) => visible.has(model.id));
};

export const getDefaultModelForProvider = (providerId: string): string =>
    getModelsForProvider(providerId)[0]?.id || '';

export const isModelKnownForProvider = (providerId: string, modelId: string): boolean =>
    getAllModelsForProvider(providerId).some(model => model.id === modelId);

export const isModelAvailableForProvider = (providerId: string, modelId: string): boolean =>
    getModelsForProvider(providerId).some(model => model.id === modelId);
export const supportsReasoningEffort = (providerId: string, modelId: string): boolean =>
    providerId === 'openai' && modelId === OPENAI_REASONING_MODEL_ID;

export interface ProviderToolSupport {
    webSearch: boolean;
    codeExecution: boolean;
}

export const PROVIDER_TOOL_SUPPORT: Record<string, ProviderToolSupport> = {
    anthropic: { webSearch: true, codeExecution: true },
    google: { webSearch: true, codeExecution: true },
    groq: { webSearch: false, codeExecution: false },
    lmstudio: { webSearch: false, codeExecution: false },
    ollama: { webSearch: false, codeExecution: false },
    openai: { webSearch: true, codeExecution: true },
    openrouter: { webSearch: true, codeExecution: false },
};

export const getProviderToolSupport = (providerId: string): ProviderToolSupport =>
    PROVIDER_TOOL_SUPPORT[providerId] || { webSearch: false, codeExecution: false };

export const getEffectiveToolingForProvider = (
    providerId: string,
    enableModelTools: boolean,
    tooling: ToolingOptions
): ToolingOptions => {
    const support = getProviderToolSupport(providerId);
    if (!enableModelTools) {
        return { webSearch: false, codeExecution: false };
    }
    return {
        webSearch: Boolean(tooling.webSearch && support.webSearch),
        codeExecution: Boolean(tooling.codeExecution && support.codeExecution),
    };
};

// Themes
export const THEME_COLORS: ThemeColorOption[] = [
    { id: 'indigo', name: 'Indigo', rgb: '99 102 241', hoverRgb: '79 70 229', hex: '#6366f1' },
    { id: 'blue', name: 'Blue', rgb: '59 130 246', hoverRgb: '37 99 235', hex: '#3b82f6' },
    { id: 'violet', name: 'Violet', rgb: '139 92 246', hoverRgb: '124 58 237', hex: '#8b5cf6' },
    { id: 'rose', name: 'Rose', rgb: '244 63 94', hoverRgb: '225 29 72', hex: '#f43f5e' },
    { id: 'amber', name: 'Amber', rgb: '245 158 11', hoverRgb: '217 119 6', hex: '#f59e0b' },
    { id: 'emerald', name: 'Emerald', rgb: '16 185 129', hoverRgb: '5 150 105', hex: '#10b981' },
    { id: 'zinc', name: 'Monochrome', rgb: '113 113 122', hoverRgb: '82 82 91', hex: '#71717a' },
];

export const INITIAL_FOLDERS: Folder[] = [];

export const INITIAL_CONVERSATIONS: Conversation[] = [];

export const INITIAL_MESSAGES: Message[] = [
  { id: '1', role: 'assistant', content: 'Hola. Soy optimAIzer. ¿En qué puedo ayudarte hoy?', timestamp: Date.now() - 10000 },
];

// Localized Default System Prompts
export const SYSTEM_PROMPTS_DATA = {
    en: [
        { id: 'default', name: 'Default Assistant', content: 'You are a helpful, respectful, and honest assistant.', isDefault: true },
        { id: 'coder', name: 'Senior Developer', content: 'You are an expert Senior Software Engineer. You write clean, efficient, and well-documented code.', isDefault: true },
        { id: 'creative', name: 'Creative Writer', content: 'You are a creative writer. Use vivid imagery and engaging storytelling.', isDefault: true },
        { id: 'concilium', name: 'Concilium Leader', content: 'You are the head of the Concilium. You must aggregate the opinions of other models and provide a final, balanced verdict.', isDefault: true },
    ],
    es: [
        { id: 'default', name: 'Asistente Predeterminado', content: 'Eres un asistente útil, respetuoso y honesto.', isDefault: true },
        { id: 'coder', name: 'Desarrollador Senior', content: 'Eres un experto Ingeniero de Software Senior. Escribes código limpio, eficiente y bien documentado.', isDefault: true },
        { id: 'creative', name: 'Escritor Creativo', content: 'Eres un escritor creativo. Utiliza imágenes vívidas y una narrativa envolvente.', isDefault: true },
        { id: 'concilium', name: 'Líder del Concilio', content: 'Eres el líder del Concilium. Debes agregar las opiniones de otros modelos y ofrecer un veredicto final y equilibrado.', isDefault: true },
    ]
};

export const DEFAULT_SYSTEM_PROMPTS: SystemPrompt[] = SYSTEM_PROMPTS_DATA.en;

export const TRANSLATIONS = {
    en: {
        common: {
            cancel: "Cancel",
            confirm: "Confirm",
            delete: "Delete",
            save: "Save",
            edit: "Edit",
            restore: "Restore",
            you: "You",
            assistant: "optimAIzer",
            new: "New",
            default: "Default"
        },
        sidebarLeft: {
            newConversation: "New Conversation",
            library: "Library",
            newFolder: "New Folder",
            uncategorized: "Uncategorized",
            archived: "Archived",
            archiveBin: "Archived Chats",
            archiveEmpty: "No archived chats",
            archiveChat: "Archive chat",
            unarchive: "Unarchive",
            archivedAtLabel: "Archived",
            trashDeleted: "Trash / Deleted",
            trashBin: "Trash Bin",
            selectAll: "Select All",
            trashEmpty: "Trash is empty",
            itemsDeletedForever: "Items are permanently deleted after 30 days.",
            freePlan: "Free Plan",
            moveTo: "Move to...",
            emptyFolder: "Empty folder",
            dragDropRoot: "Drag chats here to remove from folders",
            deleteForeverTitle: "Delete Forever?",
            deleteForeverMsg: "These conversations will be permanently removed. This action cannot be undone.",
            deleteForeverBtn: "Delete Forever",
            deleteFolderTitle: "Delete Folder",
            deleteFolderMsg: "Are you sure? This will delete the folder and move all its conversations to the trash.",
            deleteFolderBtn: "Delete Folder"
        },
        sidebarRight: {
            configuration: "Configuration",
            modelTools: "Tool Capabilities",
            modelToolsDesc: "Enable hosted tools when the selected provider supports them.",
            webSearchTool: "Web browsing/search",
            codeExecutionTool: "Code execution",
            providerNoTools: "The selected provider does not support these tools.",
            providerLimitedTools: "The selected provider only supports part of your current tool selection.",
            conciliumMode: "Concilium Mode",
            conciliumDesc: "Enables multi-model deliberation. Between 2 and 7 models respond, then the leader synthesizes.",
            conciliumDeliberationMode: "Deliberation mode",
            conciliumBlindEval: "Blind leader evaluation",
            conciliumBlindEvalDesc: "When enabled, responses are labeled as Response A/B/C so the leader judges without identity cues.",
            conciliumPresets: "Presets",
            conciliumPresetApply: "Apply preset",
            conciliumSavePreset: "Save as preset",
            conciliumPresetNamePrompt: "Preset name",
            conciliumMembersCount: "Members: {count}",
            conciliumAddMember: "Add member",
            conciliumRemoveMember: "Remove member",
            conciliumMinMembersReached: "Minimum 2 members",
            conciliumMaxMembersReached: "Maximum 7 members",
            conciliumModeConsensus: "Consensus",
            conciliumModeFactcheck: "Fact-check",
            conciliumModeCodeReview: "Code Review",
            conciliumModeBrainstorm: "Brainstorm",
            conciliumModeDebate: "Debate",
            theCouncil: "The Council",
            arenaMode: "Arena Mode",
            arenaDesc: "Compare 2 model responses side by side using the same prompt.",
            arenaLeft: "Left model",
            arenaRight: "Right model",
            temperature: "Temperature",
            temperatureDesc: "Controls randomness in the answer. Lower is more stable, higher is more creative.",
            temperatureUnsupported: "Temperature control is not available for the current provider.",
            temperatureHelpGood: "Good for: precision, facts, and consistent output.",
            temperatureHelpRisk: "Risk: very high values can increase hallucinations.",
            temperatureHelpTip: "Tip: for general use, keep it between 0.4 and 1.0.",
            includeHistory: "Include History",
            includeHistoryDesc: "When enabled, previous messages will be included in the context window sent to the model.",
            smartSummary: "Smart Summary",
            smartSummaryDesc: "The Context Model will generate a concise schematic summary of the history to save tokens.",
            livePreview: "Live Preview",
            generating: "Generating...",
            cached: "Cached",
            contextWindow: "Context Window",
            contextWindowDesc: "Limit the number of past messages sent to the AI.",
            maxOutput: "Max Output",
            maxOutputDesc: "Max length of response",
            unlimited: "Unlimited",
            noLimitActive: "No token limit active",
            disableTokenLimitTitle: "Disable Token Limit?",
            disableTokenLimitMsg: "Generating unlimited tokens can lead to very long responses and higher API usage/costs. Are you sure you want to disable the safety limit?",
            disableTokenLimitBtn: "Yes, Disable Limit",
            reasoningEffort: "Reasoning Effort",
            reasoningEffortDesc: "Controls how much reasoning depth GPT-5.2 applies before responding.",
            reasoningEffortLevels: {
                none: "None",
                low: "Low",
                medium: "Medium",
                high: "High",
                xhigh: "XHigh"
            },
            usageLabels: {
                minimal: "Minimal",
                optimal: "Optimal",
                moderate: "Moderate",
                high: "High",
                heavy: "Heavy",
                concise: "Concise",
                standard: "Standard",
                detailed: "Detailed",
                extensive: "Extensive",
                maximum: "Maximum",
                tempPrecise: "Precise",
                tempBalanced: "Balanced",
                tempCreative: "Creative",
                tempWild: "Experimental"
            },
            infiniteMemory: "Infinite Memory (RAG)",
            infiniteMemoryDesc: "Searches across previous conversations with TF-IDF similarity to inject relevant context without spending model tokens.",
            ragNoEmbeddingModel: "RAG is using the built-in TF-IDF engine (no embedding model required). To use API embeddings, configure it in Settings > General & AI.",
            ragIndexed: "Indexed: {count} chunks"
        },
        topBar: {
            provider: "Provider",
            model: "Model",
            system: "System",
            sessionCost: "Session Cost",
            sessionInput: "IN",
            sessionOutput: "OUT",
            costApproxHint: "* Approximate cost based on estimated sent/received tokens, public model pricing, and estimated tool surcharges when enabled. Final billing may differ.",
            monthlyBudget: "Monthly budget",
            sessionBudget: "Session budget",
            budgetDisabled: "Disabled"
        },
        chatArea: {
            replyingTo: "Replying to",
            said: "said",
            quote: "Quote",
            writeReply: "Write a reply...",
            askAnything: "Ask anything...",
            disclaimer: "optimAIzer can make mistakes. Verify important information.",
            attach: "Attach file (PDF, TXT, MD, images)",
            voiceInput: "Voice input",
            voiceListening: "Listening...",
            voiceUnsupported: "Voice input is not supported in this browser.",
            voiceError: "Could not capture voice input.",
            fileTooLarge: "File is too large. Limit: 10MB.",
            fileAttached: "Attached: {name}",
            fileAttachError: "Could not read the selected file.",
            attachedFileLabel: "Attached file",
            insertPrompt: "Insert saved prompt",
            savedPrompts: "Saved prompts",
            noSavedPrompts: "No saved prompts yet.",
            promptInserted: "Inserted: {title}",
            stopGenerating: "Stop generation",
            dragDropHint: "Drop files here",
            parsingFile: "Parsing file...",
            imageAttached: "Image attached: {name}",
            pdfParsed: "PDF parsed: {name} ({pages} pages)",
            removeAttachment: "Remove attachment",
            previewArtifact: "Preview artifact",
            previewModalTitle: "Artifact Preview",
            previewUnavailable: "Preview is no longer available for this code block.",
            previewKindHtml: "HTML",
            previewKindSvg: "SVG",
            previewKindReact: "React",
            closePreview: "Close preview",
            conciliumCost: "Concilium",
            soloLeaderCost: "Solo leader"
        },
        settingsModal: {
            title: "Settings",
            tabGeneral: "General & AI",
            tabPersonalization: "Personalization",
            tabInterface: "Interface",
            tabAnalytics: "Analytics",
            tabUsage: "Usage & Cost",
            tabPrompts: "System Prompts",
            tabDanger: "Danger Zone",
            profileInfo: "Profile Info",
            displayName: "Display Name",
            displayNameDesc: "This name will be displayed in your chats.",
            personalizationTitle: "Personal details for AI context",
            personalizationDesc: "These fields are summarized and sent at the start of each conversation.",
            nickname: "Nickname",
            occupation: "Occupation",
            familyAndFriends: "Family & Friends",
            leisure: "Leisure & Free Time",
            otherPersonalization: "Other",
            locationContextTitle: "Location in context",
            locationContextDesc: "Location is only sent if you explicitly allow it.",
            includeLocationInContext: "Include location in AI context",
            locationLabel: "Location (city or notes)",
            locationPlaceholder: "e.g. Madrid, Spain",
            detectLocation: "Use current location",
            clearLocation: "Clear location",
            locationErrorUnavailable: "Geolocation is not available in this browser.",
            locationErrorPermission: "Location permission denied.",
            aiConfig: "AI Configuration",
            telegramAgentModel: "Telegram Agent Model",
            telegramAgentModelDesc: "This provider/model is always used by deployed Telegram agents and in agent-mode API calls.",
            contextModel: "Context Model (Router)",
            contextModelDesc: "Used for routing, summarizing history, and saving tokens. Should be lightweight.",
            ragEmbeddingModel: "RAG Embedding Model (Optional)",
            ragEmbeddingModelDesc: "Leave empty to use the built-in TF-IDF engine (no tokens consumed). Select a model for API-based embeddings.",
            ragUsingTfidf: "Using built-in TF-IDF (free, no tokens)",
            ragUsingApi: "API embedding model selected",
            ragEmbeddingExplainTitle: "What is a RAG embedding?",
            ragEmbeddingExplainWhat: "It converts text into numeric vectors so RAG can find meaning-based matches, not only exact keywords.",
            ragEmbeddingExplainBuiltIn: "Built-in TF-IDF: faster and free. Best when your memory relies on clear terms/keywords.",
            ragEmbeddingExplainApi: "API embeddings: better semantic recall and paraphrase matching, but they consume tokens and may increase cost.",
            conciliumConfig: "Concilium Configuration",
            conciliumLeader: "Concilium Leader (Judge)",
            conciliumLeaderDesc: "This model analyzes the opinions of the council and provides the final conclusion.",
            mustBeSmart: "Must be the smartest model available.",
            language: "Language",
            languageDesc: "Changing language will translate default system prompts.",
            appearance: "Appearance",
            light: "Light",
            dark: "Dark",
            accentColor: "Accent Color",
            createNew: "Create New",
            promptName: "Prompt Name",
            systemInstructions: "System Instructions",
            savePrompt: "Save Prompt",
            deletePrompt: "Delete",
            quickPromptsTitle: "Quick Insert Prompts",
            quickPromptsDesc: "Save reusable prompts with a short title and insert them directly from the chat composer.",
            quickPromptCreate: "Create quick prompt",
            quickPromptEmpty: "No quick prompts yet.",
            quickPromptShortTitle: "Short Title",
            quickPromptContent: "Prompt Content",
            quickPromptSave: "Save quick prompt",
            usageTitle: "Approximate Consumption",
            usageDescription: "Estimated from sent/received tokens, public provider pricing, and enabled tool surcharges.",
            usageApproxNote: "* Approximate calculation. Tool surcharges are estimated and can differ from provider-side metering and session rules.",
            budgetControls: "Budget Controls",
            monthlyBudgetUsd: "Monthly budget (USD)",
            monthlyBudgetDesc: "At 50% usage, the cost card starts showing monthly budget alerts (yellow/orange/red).",
            sessionBudgetUsd: "Session budget (USD)",
            sessionBudgetDesc: "Shows a separate dashed progress border around session cost while this session is active.",
            usageTotalCost: "Total Cost",
            usageToolingCost: "Tool Surcharge",
            usageInputTokens: "Input Tokens",
            usageOutputTokens: "Output Tokens",
            usageCalls: "Calls",
            usagePeriodDay: "Days",
            usagePeriodWeek: "Weeks",
            usagePeriodMonth: "Months",
            usagePeriodYear: "Years",
            usageChartTitle: "Cost Evolution",
            usageNoData: "No usage data yet.",
            usageByModel: "Breakdown by Model",
            usageCost: "Cost",
            usageTokens: "Tokens",
            pricingByModel: "Pricing by Provider/Model",
            pricingInput: "Input ($/1M)",
            pricingOutput: "Output ($/1M)",
            pricingSource: "Source",
            pricingLastUpdated: "Last checked",
            analyticsTitle: "Spending Analytics",
            analyticsDescription: "Track your current spend and identify which model contributes most to your historical cost.",
            analyticsSpentToday: "Spent Today",
            analyticsSpentWeek: "Spent This Week",
            analyticsTopSpender: "Model driving highest spend",
            analyticsNoData: "Not enough historical data yet.",
            analyticsHistorical: "Historical impact",
            analyticsCostShare: "Cost share",
            analyticsCalls: "Calls",
            analyticsRecommendation: "Recommendation",
            dangerTitle: "Danger Zone",
            dangerDescription: "These actions are destructive and may permanently remove data.",
            dangerMoveHistoryTitle: "Move all history to trash",
            dangerMoveHistoryDesc: "Moves every active conversation to the trash. You can still restore them later.",
            dangerMoveHistoryButton: "Move to trash",
            dangerMoveHistoryConfirmTitle: "Move all history to trash?",
            dangerMoveHistoryConfirmMsg: "All active conversations will be moved to the trash.",
            dangerDeleteHistoryTitle: "Delete all history and trash",
            dangerDeleteHistoryDesc: "Permanently removes every conversation, including items currently in trash.",
            dangerDeleteHistoryButton: "Delete history and trash",
            dangerDeleteHistoryConfirmTitle: "Delete all history and trash?",
            dangerDeleteHistoryConfirmMsg: "This action permanently deletes all conversations and cannot be undone.",
            dangerEmptyTrashTitle: "Empty trash",
            dangerEmptyTrashDesc: "Permanently deletes only conversations currently in trash.",
            dangerEmptyTrashButton: "Empty trash",
            dangerEmptyTrashConfirmTitle: "Empty trash now?",
            dangerEmptyTrashConfirmMsg: "All items in trash will be permanently deleted.",
            dangerResetSettingsTitle: "Reset all settings and API keys",
            dangerResetSettingsDesc: "Resets preferences and prompts to defaults and removes all saved API keys.",
            dangerResetSettingsButton: "Reset settings",
            dangerResetSettingsConfirmTitle: "Reset settings and API keys?",
            dangerResetSettingsConfirmMsg: "This resets all settings and removes all stored API keys.",
            dangerDeleteAllDataTitle: "Delete all user data",
            dangerDeleteAllDataDesc: "Removes all conversations, trash, costs, API keys, folders, prompts, and settings.",
            dangerDeleteAllDataButton: "Delete all data",
            dangerDeleteAllDataConfirmTitle: "Delete all user data?",
            dangerDeleteAllDataConfirmMsg: "This will wipe absolutely all user data and cannot be undone."
        },
        export: {
            download: "Download",
            markdown: "Markdown (.md)",
            html: "HTML (.html)",
            pdf: "PDF (Print)"
        }
    },
    es: {
        common: {
            cancel: "Cancelar",
            confirm: "Confirmar",
            delete: "Eliminar",
            save: "Guardar",
            edit: "Editar",
            restore: "Restaurar",
            you: "Tú",
            assistant: "optimAIzer",
            new: "Nuevo",
            default: "Predeterminado"
        },
        sidebarLeft: {
            newConversation: "Nueva Conversación",
            library: "Biblioteca",
            newFolder: "Nueva Carpeta",
            uncategorized: "Sin Categoría",
            archived: "Archivados",
            archiveBin: "Chats archivados",
            archiveEmpty: "No hay chats archivados",
            archiveChat: "Archivar chat",
            unarchive: "Desarchivar",
            archivedAtLabel: "Archivado",
            trashDeleted: "Papelera",
            trashBin: "Papelera de Reciclaje",
            selectAll: "Seleccionar Todo",
            trashEmpty: "La papelera está vacía",
            itemsDeletedForever: "Los elementos se eliminan permanentemente tras 30 días.",
            freePlan: "Plan Gratuito",
            moveTo: "Mover a...",
            emptyFolder: "Carpeta vacía",
            dragDropRoot: "Arrastra chats aquí para sacarlos de carpetas",
            deleteForeverTitle: "¿Eliminar para siempre?",
            deleteForeverMsg: "Estas conversaciones se eliminarán permanentemente. Esta acción no se puede deshacer.",
            deleteForeverBtn: "Eliminar para siempre",
            deleteFolderTitle: "Eliminar Carpeta",
            deleteFolderMsg: "¿Estás seguro? Esto eliminará la carpeta y moverá todas sus conversaciones a la papelera.",
            deleteFolderBtn: "Eliminar Carpeta"
        },
        sidebarRight: {
            configuration: "Configuración",
            modelTools: "Capacidades de Herramientas",
            modelToolsDesc: "Activa herramientas alojadas cuando el proveedor seleccionado las soporta.",
            webSearchTool: "Navegación/búsqueda web",
            codeExecutionTool: "Ejecución de código",
            providerNoTools: "El proveedor seleccionado no soporta estas herramientas.",
            providerLimitedTools: "El proveedor seleccionado solo soporta parte de tu selección actual.",
            conciliumMode: "Modo Concilium",
            conciliumDesc: "Habilita la deliberación multi-modelo. Entre 2 y 7 modelos responden y luego el líder sintetiza.",
            conciliumDeliberationMode: "Modo de deliberación",
            conciliumBlindEval: "Evaluación ciega del líder",
            conciliumBlindEvalDesc: "Si se activa, las respuestas se etiquetan como Respuesta A/B/C para evitar sesgos por identidad.",
            conciliumPresets: "Presets",
            conciliumPresetApply: "Aplicar preset",
            conciliumSavePreset: "Guardar como preset",
            conciliumPresetNamePrompt: "Nombre del preset",
            conciliumMembersCount: "Miembros: {count}",
            conciliumAddMember: "Añadir miembro",
            conciliumRemoveMember: "Quitar miembro",
            conciliumMinMembersReached: "Mínimo 2 miembros",
            conciliumMaxMembersReached: "Máximo 7 miembros",
            conciliumModeConsensus: "Consensus",
            conciliumModeFactcheck: "Fact-check",
            conciliumModeCodeReview: "Code Review",
            conciliumModeBrainstorm: "Brainstorm",
            conciliumModeDebate: "Debate",
            theCouncil: "El Concilio",
            arenaMode: "Modo Arena",
            arenaDesc: "Compara 2 respuestas de modelos lado a lado con el mismo prompt.",
            arenaLeft: "Modelo izquierdo",
            arenaRight: "Modelo derecho",
            temperature: "Temperatura",
            temperatureDesc: "Controla la aleatoriedad de la respuesta. Más baja = más estable, más alta = más creativa.",
            temperatureUnsupported: "El proveedor actual no permite controlar la temperatura.",
            temperatureHelpGood: "Bien para: precisión, hechos y respuestas consistentes.",
            temperatureHelpRisk: "Riesgo: valores muy altos pueden aumentar alucinaciones.",
            temperatureHelpTip: "Consejo: para uso general, mantenla entre 0.4 y 1.0.",
            includeHistory: "Incluir Historial",
            includeHistoryDesc: "Si se activa, los mensajes anteriores se incluirán en el contexto enviado al modelo.",
            smartSummary: "Resumen Inteligente",
            smartSummaryDesc: "El Modelo de Contexto generará un resumen esquemático del historial para ahorrar tokens.",
            livePreview: "Vista Previa",
            generating: "Generando...",
            cached: "En caché",
            contextWindow: "Ventana de Contexto",
            contextWindowDesc: "Limita el número de mensajes pasados enviados a la IA.",
            maxOutput: "Salida Máx.",
            maxOutputDesc: "Longitud máxima de la respuesta",
            unlimited: "Ilimitado",
            noLimitActive: "Sin límite de tokens",
            disableTokenLimitTitle: "¿Desactivar Límite?",
            disableTokenLimitMsg: "Generar tokens ilimitados puede llevar a respuestas muy largas y mayor uso/coste de API. ¿Seguro que quieres desactivar el límite de seguridad?",
            disableTokenLimitBtn: "Sí, Desactivar",
            reasoningEffort: "Nivel de Razonamiento",
            reasoningEffortDesc: "Controla la profundidad de razonamiento que aplica GPT-5.2 antes de responder.",
            reasoningEffortLevels: {
                none: "None",
                low: "Low",
                medium: "Medium",
                high: "High",
                xhigh: "XHigh"
            },
            usageLabels: {
                minimal: "Mínimo",
                optimal: "Óptimo",
                moderate: "Moderado",
                high: "Alto",
                heavy: "Pesado",
                concise: "Conciso",
                standard: "Estándar",
                detailed: "Detallado",
                extensive: "Extenso",
                maximum: "Máximo",
                tempPrecise: "Precisa",
                tempBalanced: "Equilibrada",
                tempCreative: "Creativa",
                tempWild: "Experimental"
            },
            infiniteMemory: "Memoria Infinita (RAG)",
            infiniteMemoryDesc: "Busca en todas las conversaciones anteriores usando similitud TF-IDF para obtener contexto sin consumir tokens.",
            ragNoEmbeddingModel: "El RAG usa el motor TF-IDF integrado (no requiere modelo de embeddings). Para embeddings por API, configúralo en Ajustes > General e IA.",
            ragIndexed: "Indexados: {count} fragmentos"
        },
        topBar: {
            provider: "Proveedor",
            model: "Modelo",
            system: "Sistema",
            sessionCost: "Coste Sesión",
            sessionInput: "IN",
            sessionOutput: "OUT",
            costApproxHint: "* Coste aproximado basado en tokens estimados enviados/recibidos, tarifas públicas por modelo y recargos estimados por herramientas activadas. La facturación final puede variar.",
            monthlyBudget: "Presupuesto mensual",
            sessionBudget: "Presupuesto por sesión",
            budgetDisabled: "Desactivado"
        },
        chatArea: {
            replyingTo: "Respondiendo a",
            said: "dijo",
            quote: "Citar",
            writeReply: "Escribe una respuesta...",
            askAnything: "Pregunta lo que sea...",
            disclaimer: "optimAIzer puede cometer errores. Verifica la información importante.",
            attach: "Adjuntar archivo (PDF, TXT, MD, imágenes)",
            voiceInput: "Entrada por voz",
            voiceListening: "Escuchando...",
            voiceUnsupported: "La entrada por voz no es compatible con este navegador.",
            voiceError: "No se pudo capturar la entrada de voz.",
            fileTooLarge: "El archivo es demasiado grande. Límite: 10MB.",
            fileAttached: "Adjunto: {name}",
            fileAttachError: "No se pudo leer el archivo seleccionado.",
            attachedFileLabel: "Archivo adjunto",
            insertPrompt: "Insertar prompt guardado",
            savedPrompts: "Prompts guardados",
            noSavedPrompts: "Todavía no hay prompts guardados.",
            promptInserted: "Insertado: {title}",
            stopGenerating: "Detener generación",
            dragDropHint: "Suelta archivos aquí",
            parsingFile: "Procesando archivo...",
            imageAttached: "Imagen adjuntada: {name}",
            pdfParsed: "PDF procesado: {name} ({pages} páginas)",
            removeAttachment: "Eliminar adjunto",
            previewArtifact: "Previsualizar artefacto",
            previewModalTitle: "Vista previa del artefacto",
            previewUnavailable: "La vista previa ya no está disponible para este bloque de código.",
            previewKindHtml: "HTML",
            previewKindSvg: "SVG",
            previewKindReact: "React",
            closePreview: "Cerrar vista previa",
            conciliumCost: "Concilium",
            soloLeaderCost: "Solo líder"
        },
        settingsModal: {
            title: "Ajustes",
            tabGeneral: "General e IA",
            tabPersonalization: "Personalización",
            tabInterface: "Interfaz",
            tabAnalytics: "Analítica",
            tabUsage: "Consumo y Coste",
            tabPrompts: "Prompts de Sistema",
            tabDanger: "Zona de Peligro",
            profileInfo: "Información de Perfil",
            displayName: "Nombre Visible",
            displayNameDesc: "Este nombre se mostrará en tus chats.",
            personalizationTitle: "Datos personales para contexto de IA",
            personalizationDesc: "Estos campos se resumen y se envían al inicio de cada conversación.",
            nickname: "Apodo",
            occupation: "Ocupación",
            familyAndFriends: "Familia y amistades",
            leisure: "Ocio y tiempo libre",
            otherPersonalization: "Otros",
            locationContextTitle: "Ubicación en contexto",
            locationContextDesc: "La ubicación solo se envía si la autorizas explícitamente.",
            includeLocationInContext: "Incluir ubicación en el contexto de IA",
            locationLabel: "Ubicación (ciudad o nota)",
            locationPlaceholder: "Ej. Madrid, España",
            detectLocation: "Usar ubicación actual",
            clearLocation: "Borrar ubicación",
            locationErrorUnavailable: "La geolocalización no está disponible en este navegador.",
            locationErrorPermission: "Permiso de ubicación denegado.",
            aiConfig: "Configuración de IA",
            telegramAgentModel: "Modelo del Agente de Telegram",
            telegramAgentModelDesc: "Este proveedor/modelo se usa siempre en agentes desplegados por Telegram y en llamadas API del modo agente.",
            contextModel: "Modelo de Contexto (Router)",
            contextModelDesc: "Usado para enrutamiento, resúmenes y ahorro de tokens. Debería ser ligero.",
            ragEmbeddingModel: "Modelo de Embeddings RAG (Opcional)",
            ragEmbeddingModelDesc: "Déjalo vacío para usar el motor TF-IDF integrado (sin consumo de tokens). Selecciona un modelo para embeddings por API.",
            ragUsingTfidf: "Usando TF-IDF integrado (gratis, sin tokens)",
            ragUsingApi: "Modelo de embedding API seleccionado",
            ragEmbeddingExplainTitle: "¿Qué es un embedding en RAG?",
            ragEmbeddingExplainWhat: "Convierte texto en vectores numéricos para que RAG encuentre similitud por significado, no solo por palabras exactas.",
            ragEmbeddingExplainBuiltIn: "TF-IDF integrado: más rápido y gratis. Ideal cuando tu memoria depende de términos/palabras clave.",
            ragEmbeddingExplainApi: "Embeddings por API: mejoran la recuperación semántica y paráfrasis, pero consumen tokens y pueden aumentar el coste.",
            conciliumConfig: "Configuración de Concilium",
            conciliumLeader: "Líder de Concilium (Juez)",
            conciliumLeaderDesc: "Este modelo analiza las opiniones del concilio y proporciona la conclusión final.",
            mustBeSmart: "Debe ser el modelo más inteligente disponible.",
            language: "Idioma",
            languageDesc: "Cambiar el idioma traducirá los prompts del sistema por defecto.",
            appearance: "Apariencia",
            light: "Claro",
            dark: "Oscuro",
            accentColor: "Color de Acento",
            createNew: "Crear Nuevo",
            promptName: "Nombre del Prompt",
            systemInstructions: "Instrucciones del Sistema",
            savePrompt: "Guardar Prompt",
            deletePrompt: "Eliminar",
            quickPromptsTitle: "Prompts de inserción rápida",
            quickPromptsDesc: "Guarda prompts reutilizables con título corto e insértalos directamente desde el cuadro de chat.",
            quickPromptCreate: "Crear prompt rápido",
            quickPromptEmpty: "Aún no hay prompts rápidos.",
            quickPromptShortTitle: "Título corto",
            quickPromptContent: "Contenido del prompt",
            quickPromptSave: "Guardar prompt rápido",
            usageTitle: "Consumo Aproximado",
            usageDescription: "Estimado a partir de tokens enviados/recibidos, precios públicos y recargos de herramientas activadas.",
            usageApproxNote: "* Cálculo aproximado. Los recargos de herramientas son estimados y pueden variar según medición y reglas de sesión del proveedor.",
            budgetControls: "Control de presupuesto",
            monthlyBudgetUsd: "Presupuesto mensual (USD)",
            monthlyBudgetDesc: "Al llegar al 50%, el coste mostrará alertas de presupuesto mensual (amarillo/naranja/rojo).",
            sessionBudgetUsd: "Presupuesto por sesión (USD)",
            sessionBudgetDesc: "Muestra un reborde discontinuo separado con progreso de la sesión activa.",
            usageTotalCost: "Coste Total",
            usageToolingCost: "Recargo Herramientas",
            usageInputTokens: "Tokens de Entrada",
            usageOutputTokens: "Tokens de Salida",
            usageCalls: "Llamadas",
            usagePeriodDay: "Días",
            usagePeriodWeek: "Semanas",
            usagePeriodMonth: "Meses",
            usagePeriodYear: "Años",
            usageChartTitle: "Evolución de Coste",
            usageNoData: "Aún no hay datos de consumo.",
            usageByModel: "Desglose por Modelo",
            usageCost: "Coste",
            usageTokens: "Tokens",
            pricingByModel: "Tarifas por Proveedor/Modelo",
            pricingInput: "Entrada ($/1M)",
            pricingOutput: "Salida ($/1M)",
            pricingSource: "Fuente",
            pricingLastUpdated: "Última revisión",
            analyticsTitle: "Analítica de gasto",
            analyticsDescription: "Controla tu gasto actual e identifica qué modelo está aportando más coste histórico.",
            analyticsSpentToday: "Gastado hoy",
            analyticsSpentWeek: "Gastado esta semana",
            analyticsTopSpender: "Modelo que más te hace gastar",
            analyticsNoData: "Aún no hay datos históricos suficientes.",
            analyticsHistorical: "Impacto histórico",
            analyticsCostShare: "Porcentaje de coste",
            analyticsCalls: "Llamadas",
            analyticsRecommendation: "Recomendación",
            dangerTitle: "Zona de Peligro",
            dangerDescription: "Estas acciones son destructivas y pueden eliminar datos de forma permanente.",
            dangerMoveHistoryTitle: "Enviar todo el historial a la papelera",
            dangerMoveHistoryDesc: "Mueve todas las conversaciones activas a la papelera. Podrás restaurarlas después.",
            dangerMoveHistoryButton: "Mover a papelera",
            dangerMoveHistoryConfirmTitle: "¿Mover todo el historial a la papelera?",
            dangerMoveHistoryConfirmMsg: "Todas las conversaciones activas se moverán a la papelera.",
            dangerDeleteHistoryTitle: "Eliminar todo el historial y papelera",
            dangerDeleteHistoryDesc: "Elimina permanentemente todas las conversaciones, incluyendo las que ya están en papelera.",
            dangerDeleteHistoryButton: "Eliminar historial y papelera",
            dangerDeleteHistoryConfirmTitle: "¿Eliminar todo el historial y papelera?",
            dangerDeleteHistoryConfirmMsg: "Esta acción elimina permanentemente todas las conversaciones y no se puede deshacer.",
            dangerEmptyTrashTitle: "Vaciar papelera",
            dangerEmptyTrashDesc: "Elimina permanentemente solo las conversaciones que están en la papelera.",
            dangerEmptyTrashButton: "Vaciar papelera",
            dangerEmptyTrashConfirmTitle: "¿Vaciar papelera ahora?",
            dangerEmptyTrashConfirmMsg: "Todos los elementos de la papelera se eliminarán de forma permanente.",
            dangerResetSettingsTitle: "Eliminar ajustes y restablecer (incluye API keys)",
            dangerResetSettingsDesc: "Restablece preferencias y prompts a valores por defecto y elimina todas las API keys guardadas.",
            dangerResetSettingsButton: "Restablecer ajustes",
            dangerResetSettingsConfirmTitle: "¿Restablecer ajustes y API keys?",
            dangerResetSettingsConfirmMsg: "Se restablecerán todos los ajustes y se eliminarán todas las API keys guardadas.",
            dangerDeleteAllDataTitle: "Eliminar todos los datos del usuario",
            dangerDeleteAllDataDesc: "Elimina conversaciones, papelera, costes, API keys, carpetas, prompts y ajustes.",
            dangerDeleteAllDataButton: "Eliminar todos los datos",
            dangerDeleteAllDataConfirmTitle: "¿Eliminar todos los datos del usuario?",
            dangerDeleteAllDataConfirmMsg: "Se eliminarán absolutamente todos los datos y no se podrá deshacer."
        },
        export: {
            download: "Descargar",
            markdown: "Markdown (.md)",
            html: "HTML (.html)",
            pdf: "PDF (Imprimir)"
        }
    }
};
