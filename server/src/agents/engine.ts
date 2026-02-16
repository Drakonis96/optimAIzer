// ---------------------------------------------------------------------------
// Agent Execution Engine — Processes messages using LLM + Tools
// ---------------------------------------------------------------------------

import { createProvider } from '../providers';
import { AgentConfig, AgentMessage, ToolCallResult } from './types';
import { buildNativeToolDefinitions, buildToolsPrompt, executeTool, parseToolCalls, ToolExecutionContext } from './tools';
import { MCPToolDefinition } from './mcpClient';
import * as storage from './storage';
import { estimateInputTokens, estimateTextTokens } from '../auth/costs';
import { MemoryCandidate, scoreAndFilterMemories } from './smartMemory';
import { buildSkillsPromptSection } from './skills';

// ---------------------------------------------------------------------------
// Strip tool-call artifacts from text content
// Models sometimes emit XML-like tool call fragments in their text content.
// This cleaner removes ALL known patterns to prevent leaking to the user.
// ---------------------------------------------------------------------------
function stripToolArtifacts(text: string): string {
  if (!text) return text;
  let cleaned = text;

  // Remove <tool_call>...</tool_call> blocks
  cleaned = cleaned.replace(/<tool_call>\s*[\s\S]*?<\/tool_call>/gi, '');
  // Remove <tool_result>...</tool_result> blocks
  cleaned = cleaned.replace(/<tool_result[\s\S]*?<\/tool_result>/gi, '');
  // Remove <function_call>...</function_call> blocks
  cleaned = cleaned.replace(/<function_call>\s*[\s\S]*?<\/function_call>/gi, '');
  // Remove <invoke ...>...</invoke> blocks
  cleaned = cleaned.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/gi, '');
  // Remove standalone <parameter ...>...</parameter> tags
  cleaned = cleaned.replace(/<parameter\s+[^>]*>[\s\S]*?<\/parameter>/gi, '');
  // Remove </invoke>, </minimax:tool_call>, </...>, etc. orphaned closing tags
  cleaned = cleaned.replace(/<\/(?:invoke|minimax:tool_call|antml:[^>]+|function_call|tool_use)>/gi, '');
  // Remove standalone opening tags for tool-related elements
  cleaned = cleaned.replace(/<(?:invoke|minimax:tool_call|antml:[^>]+|function_call|tool_use)[^>]*>/gi, '');
  // Remove [tool_calls: ...] markers the engine previously stored in history
  cleaned = cleaned.replace(/\[tool_calls?:\s*[^\]]*\]/gi, '');
  // Remove bare JSON tool call blocks that look like {"name": "...", "parameters": {...}}
  // Only remove if they're on their own lines and clearly a tool call object
  cleaned = cleaned.replace(/^\s*\{\s*"name"\s*:\s*"[a-z_]+"\s*,\s*"(?:parameters|params|arguments)"\s*:\s*\{[\s\S]*?\}\s*\}\s*$/gmi, '');

  // Collapse multiple newlines left behind
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

/**
 * Detects if text contains tool-call-like patterns (used by safety net).
 */
function textContainsToolCallPatterns(text: string): boolean {
  if (!text) return false;
  // Check for <tool_call>, <function_call>, <invoke>, <parameter>, etc.
  if (/<(?:tool_call|function_call|invoke|tool_use)\b/i.test(text)) return true;
  if (/<parameter\s+name=/i.test(text)) return true;
  if (/<\/(?:invoke|minimax:tool_call|antml:[^>]+)>/i.test(text)) return true;
  // Check for bare JSON tool call objects
  if (/\{\s*"name"\s*:\s*"[a-z_]+"\s*,\s*"(?:parameters|params|arguments)"\s*:/.test(text)) return true;
  return false;
}

function isExplicitConfirmationMessage(text: string): boolean {
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized) return false;
  return /^(?:si|sí|sip|sipi|ok|vale|de acuerdo|confirmo|confirmado|hazlo|adelante|tal cual|exacto|correcto|yes|go|proceed|do it|confirm)$/i.test(normalized)
    || /\b(?:si|sí|sip|confirmo|confirmado|hazlo|adelante|tal\s+cual|exacto|correcto)\b/i.test(normalized);
}

function assistantAskedForConfirmation(history: AgentMessage[]): boolean {
  const recentAssistant = [...history]
    .reverse()
    .filter((m) => m.role === 'assistant' && m.content.trim())
    .slice(0, 3)
    .map((m) => m.content.toLowerCase())
    .join('\n');

  if (!recentAssistant) return false;
  return /(confirmas\?|¿confirmas\?|necesito\s+confirmaci[oó]n|esperando\s+confirmaci[oó]n|do\s+you\s+confirm|please\s+confirm|confirm\?)/i.test(recentAssistant);
}

function isLikelyActionCommand(text: string): boolean {
  const normalized = (text || '').trim().toLowerCase();
  if (!normalized) return false;
  return /\b(?:añade|agrega|crea|actualiza|borra|elimina|apaga|enciende|pon|ajusta|marca|desmarca|consulta|revisa|mira|mu[eé]strame|lee|lista|programa|recu[eé]rdame|env[ií]a)\b/i.test(normalized);
}

function responseAsksConfirmation(text: string): boolean {
  return /(confirmas\?|¿confirmas\?|confirmaci[oó]n|do\s+you\s+confirm|please\s+confirm|confirm\?)/i.test(String(text || ''));
}

function trimFollowUpQuestions(text: string): string {
  const value = String(text || '').trim();
  if (!value) return value;
  const blocks = value.split(/\n\n+/).filter(Boolean);
  while (blocks.length > 1) {
    const tail = blocks[blocks.length - 1].trim();
    const looksLikeFollowUpQuestion =
      /\?$/.test(tail) ||
      /^¿/.test(tail) ||
      /\b(?:quieres\s+que|te\s+gustar[ií]a|want\s+me\s+to|would\s+you\s+like)\b/i.test(tail);
    if (!looksLikeFollowUpQuestion) break;
    blocks.pop();
  }
  return blocks.join('\n\n').trim();
}

const DEFAULT_MAX_TOOL_ITERATIONS = 6;
const DEFAULT_FAST_CONFIRMATION_MAX_TOOL_ITERATIONS = 3;
const DEFAULT_HISTORY_MESSAGES = 30;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MEMORY_RECALL_LIMIT = 8;
const MEMORY_SNIPPET_MAX_CHARS = 260;
const AGENT_MIN_MODEL_MAX_TOKENS = Math.max(512, Number(process.env.AGENT_MIN_MODEL_MAX_TOKENS || 1200));
const AGENT_MEMORY_MAX_ITEMS = Math.max(8, Number(process.env.AGENT_MEMORY_MAX_ITEMS || 24));
const AGENT_MEMORY_ITEM_MAX_CHARS = Math.max(80, Number(process.env.AGENT_MEMORY_ITEM_MAX_CHARS || 140));
const DEFAULT_TOOL_RESULT_MAX_CHARS = 900;
const DEFAULT_TOOL_RESULTS_TOTAL_MAX_CHARS = 3600;
const DEFAULT_AGENT_LLM_TIMEOUT_MS = 70_000;
const DEFAULT_AGENT_TOOL_TIMEOUT_MS = 45_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function isOutputLimitError(error: unknown): boolean {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return (
    message.includes('max_tokens') ||
    message.includes('max_completion_tokens') ||
    message.includes('model output limit') ||
    message.includes('output limit was reached') ||
    message.includes('higher max_tokens')
  );
}

function getBumpedMaxTokens(currentMaxTokens: number): number {
  return Math.min(8192, Math.max(currentMaxTokens * 2, 4096));
}

// ---------------------------------------------------------------------------
// Parallel-safe tools: read-only / side-effect-free operations that can
// be executed concurrently via Promise.all when the LLM requests multiple
// tool calls in the same iteration.
// ---------------------------------------------------------------------------
export const PARALLEL_SAFE_TOOLS = new Set([
  // Web / network reads
  'web_search',
  'fetch_webpage',
  'browse_website',
  // Time
  'get_current_time',
  // Notes (read)
  'get_notes',
  'search_notes',
  // Lists (read)
  'get_lists',
  'get_list',
  // Schedules (read)
  'list_scheduled_tasks',
  'list_reminders',
  // Calendar (read)
  'list_calendar_events',
  'search_calendar_events',
  // Gmail (read)
  'list_emails',
  'read_email',
  'search_emails',
  'get_unread_email_count',
  // Working memory (read)
  'get_working_memory',
  // Radarr (read)
  'radarr_search_movie',
  'radarr_library',
  'radarr_movie_status',
  'radarr_queue',
  'radarr_get_releases',
  // Sonarr (read)
  'sonarr_search_series',
  'sonarr_library',
  'sonarr_series_status',
  'sonarr_season_episodes',
  'sonarr_queue',
  'sonarr_get_releases',
  // Media processing (stateless)
  'transcribe_telegram_audio',
  'analyze_telegram_image',
  // Read-only skill/event tools
  'list_skills',
  'get_skill',
  'list_event_subscriptions',
]);

/**
 * Determines whether a tool call can be executed in parallel with others.
 * Only read-only, side-effect-free tools qualify.
 */
export function isToolParallelSafe(toolName: string): boolean {
  return PARALLEL_SAFE_TOOLS.has(toolName);
}

export interface EngineCallbacks {
  onResponse: (text: string) => void;
  onToolCall: (toolName: string, params: Record<string, any>) => void;
  onToolResult: (result: ToolCallResult) => void;
  onError: (error: string) => void;
}

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, numeric));
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
};

const truncateMemorySnippet = (value: string, maxChars = MEMORY_SNIPPET_MAX_CHARS): string => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1)}…`;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(',')}}`;
};

const compactToolResultForLlm = (value: string, maxChars = DEFAULT_TOOL_RESULT_MAX_CHARS): string => {
  const normalized = String(value || '').replace(/\s+\n/g, '\n').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}\n... [resultado truncado para ahorrar contexto]`;
};

type AgentLanguage = 'es' | 'en';

const inferAgentLanguage = (config: AgentConfig): AgentLanguage => {
  const sample = `${config.systemPrompt || ''}\n${config.objective || ''}\n${config.name || ''}`.toLowerCase();
  if (!sample.trim()) return 'es';

  const spanishSignals = [
    ' eres ', ' asistente ', ' objetivo ', ' usuario ', ' herramientas ', ' calendario ',
    ' recordatorio ', ' nota ', ' lista ', ' gasto ', ' por favor ', ' gracias ', '¿', '¡', 'ción'
  ];
  const englishSignals = [
    ' you are ', ' assistant ', ' objective ', ' user ', ' tools ', ' calendar ',
    ' reminder ', ' note ', ' list ', ' expense ', ' please ', ' thanks ', ' the ', ' and '
  ];

  const esScore = spanishSignals.reduce((score, token) => score + (sample.includes(token) ? 1 : 0), 0);
  const enScore = englishSignals.reduce((score, token) => score + (sample.includes(token) ? 1 : 0), 0);

  return enScore > esScore ? 'en' : 'es';
};

const resolveAgentRuntimeTuning = (config: AgentConfig) => {
  const tuning = config.runtimeTuning || {};
  const maxToolIterations = clampInteger(
    tuning.maxToolIterations,
    DEFAULT_MAX_TOOL_ITERATIONS,
    2,
    12
  );
  const fastConfirmationMaxToolIterations = clampInteger(
    tuning.fastConfirmationMaxToolIterations,
    DEFAULT_FAST_CONFIRMATION_MAX_TOOL_ITERATIONS,
    1,
    8
  );
  const toolResultMaxChars = clampInteger(
    tuning.toolResultMaxChars,
    DEFAULT_TOOL_RESULT_MAX_CHARS,
    200,
    6000
  );
  const toolResultsTotalMaxChars = clampInteger(
    tuning.toolResultsTotalMaxChars,
    DEFAULT_TOOL_RESULTS_TOTAL_MAX_CHARS,
    600,
    24000
  );
  const llmTimeoutMs = clampInteger(
    tuning.llmTimeoutMs,
    DEFAULT_AGENT_LLM_TIMEOUT_MS,
    10_000,
    240_000
  );
  const toolTimeoutMs = clampInteger(
    tuning.toolTimeoutMs,
    DEFAULT_AGENT_TOOL_TIMEOUT_MS,
    10_000,
    180_000
  );

  return {
    fastToolsPrompt: tuning.fastToolsPrompt === true,
    compactToolsPrompt: tuning.compactToolsPrompt !== false,
    maxMcpToolsInPrompt: clampInteger(tuning.maxMcpToolsInPrompt, 40, 0, 200),
    maxToolIterations,
    fastConfirmationMaxToolIterations,
    toolResultMaxChars,
    toolResultsTotalMaxChars,
    llmTimeoutMs,
    toolTimeoutMs,
  };
};

// ---------------------------------------------------------------------------
// Build the full system prompt for an agent
// ---------------------------------------------------------------------------

function buildAgentSystemPrompt(
  config: AgentConfig,
  userId: string,
  agentId: string,
  recalledConversationSnippets: string[],
  mcpTools?: MCPToolDefinition[],
  workingMemoryEntries?: storage.WorkingMemoryEntry[],
  runtimeTuning?: ReturnType<typeof resolveAgentRuntimeTuning>
): string {
  const language = inferAgentLanguage(config);
  const locale = language === 'es' ? 'es-ES' : 'en-US';
  const toolsPrompt = buildToolsPrompt(language, mcpTools, {
    fastToolsPrompt: runtimeTuning?.fastToolsPrompt,
    compactToolsPrompt: runtimeTuning?.compactToolsPrompt,
    maxMcpToolsInPrompt: runtimeTuning?.maxMcpToolsInPrompt,
  });
  const persistedMemory = (config.memory || []).slice(-AGENT_MEMORY_MAX_ITEMS);
  const memoryParts: string[] = [];
  if (persistedMemory.length > 0) {
    memoryParts.push(
      language === 'es'
        ? `Recuerdos guardados del agente:\n${persistedMemory.map((m, i) => `${i + 1}. ${truncateMemorySnippet(m, AGENT_MEMORY_ITEM_MAX_CHARS)}`).join('\n')}`
        : `Saved agent memories:\n${persistedMemory.map((m, i) => `${i + 1}. ${truncateMemorySnippet(m, AGENT_MEMORY_ITEM_MAX_CHARS)}`).join('\n')}`
    );
  }
  if (recalledConversationSnippets.length > 0) {
    memoryParts.push(
      language === 'es'
        ? `Recuerdos relevantes de conversaciones previas (filtrados por relevancia inteligente):\n${recalledConversationSnippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n')}`
        : `Relevant memories from previous conversations (smart-filtered by relevance):\n${recalledConversationSnippets.map((snippet, index) => `${index + 1}. ${snippet}`).join('\n')}`
    );
  }
  const memorySection = memoryParts.length > 0
    ? `\n<memory>\n${memoryParts.join('\n\n')}\n</memory>`
    : '';

  // ── Working Memory section ────────────────────────────────────────────
  const wmEntries = workingMemoryEntries ?? [];
  const workingMemorySection = wmEntries.length > 0
    ? language === 'es'
      ? `\n<working_memory>\nMemoria de Trabajo — Notas y pasos intermedios de tareas en curso:\n${wmEntries.map((e) => `• [${e.label}] ${truncateMemorySnippet(e.content, 400)}`).join('\n')}\nPuedes actualizar, consultar o limpiar la memoria de trabajo usando las herramientas update_working_memory, get_working_memory y clear_working_memory.\n</working_memory>`
      : `\n<working_memory>\nWorking Memory — Notes and intermediate steps for ongoing tasks:\n${wmEntries.map((e) => `• [${e.label}] ${truncateMemorySnippet(e.content, 400)}`).join('\n')}\nYou can update, query, or clear working memory using update_working_memory, get_working_memory, and clear_working_memory tools.\n</working_memory>`
    : '';

  const schedulesSection = config.schedules.length > 0
    ? `\n<scheduled_tasks>\n${language === 'es' ? 'Tareas programadas activas' : 'Active scheduled tasks'}:\n${config.schedules.filter(s => s.enabled).map(s => `- "${s.name}": ${s.schedule}`).join('\n')}\n</scheduled_tasks>`
    : '';

  const credentialsSection = config.permissions.webCredentials.length > 0
    ? `\n<web_credentials>\n${language === 'es'
      ? `Hay ${config.permissions.webCredentials.length} credenciales web configuradas. Solicita confirmación explícita del usuario antes de usarlas.`
      : `${config.permissions.webCredentials.length} web credentials are configured. Ask for explicit user confirmation before using them.`}\n</web_credentials>`
    : '';

  // Build calendar integration section (NEVER expose credentials)
  const calendarParts: string[] = [];
  if (config.calendar?.google) {
    calendarParts.push(language === 'es' ? 'Google Calendar (OAuth2 configurado)' : 'Google Calendar (OAuth2 configured)');
  }
  if (config.calendar?.icloud) {
    // Mask the email to avoid credential leakage — show only domain hint
    const emailParts = config.calendar.icloud.email.split('@');
    const maskedEmail = emailParts.length === 2
      ? `${emailParts[0][0]}***@${emailParts[1]}`
      : '***';
    calendarParts.push(
      language === 'es'
        ? `iCloud Calendar (${maskedEmail}${config.calendar.icloud.calendarName ? `, calendario: "${config.calendar.icloud.calendarName}"` : ''})`
        : `iCloud Calendar (${maskedEmail}${config.calendar.icloud.calendarName ? `, calendar: "${config.calendar.icloud.calendarName}"` : ''})`
    );
  }
  const calendarSection = calendarParts.length > 0
    ? `\n<calendar_integrations>\n${language === 'es' ? 'Calendarios conectados' : 'Connected calendars'}: ${calendarParts.join(', ')}.\n${language === 'es'
      ? 'Usa create_calendar_event, list_calendar_events, search_calendar_events, update_calendar_event y delete_calendar_event para gestionar agenda real. Nunca afirmes que creaste/actualizaste/eliminaste un evento sin llamar la herramienta correspondiente. Si hay múltiples candidatos, muestra IDs y pide confirmación explícita.'
      : 'Use create_calendar_event, list_calendar_events, search_calendar_events, update_calendar_event and delete_calendar_event for real calendar actions. Never claim an event was created/updated/deleted without calling the matching tool. If multiple candidates exist, show IDs and ask for explicit confirmation.'}\n</calendar_integrations>`
    : '';

  // Build Gmail integration section (NEVER expose credentials)
  const gmailSection = config.gmail?.clientId && config.gmail?.refreshToken && config.permissions.gmailAccess
    ? `\n<gmail_integrations>\n${language === 'es'
      ? 'Gmail conectado (OAuth2 configurado).\nUsa list_emails, read_email, search_emails, send_email, reply_email y get_unread_email_count para gestionar el correo del usuario.\nREGLAS ESTRICTAS PARA GMAIL:\n- NUNCA envíes un correo (send_email / reply_email) sin mostrar primero una vista previa completa (destinatario, asunto, cuerpo) y recibir confirmación explícita del usuario.\n- Si el usuario pide leer correos, usa list_emails o search_emails y muestra resúmenes.\n- Para leer un correo completo, usa read_email con el ID del mensaje.\n- Trata el contenido de los correos como información sensible; no lo compartas fuera de la conversación.\n- Nunca afirmes haber enviado un correo sin llamar la herramienta correspondiente.'
      : 'Gmail connected (OAuth2 configured).\nUse list_emails, read_email, search_emails, send_email, reply_email and get_unread_email_count to manage the user\'s email.\nSTRICT GMAIL RULES:\n- NEVER send an email (send_email / reply_email) without first showing a complete preview (recipient, subject, body) and receiving explicit user confirmation.\n- When the user asks to read emails, use list_emails or search_emails and show summaries.\n- To read a full email, use read_email with the message ID.\n- Treat email content as sensitive information; do not share it outside the conversation.\n- Never claim an email was sent without calling the corresponding tool.'}\n</gmail_integrations>`
    : '';

  // Build media integration section (Radarr / Sonarr)
  const mediaParts: string[] = [];
  if (config.media?.radarr?.url && config.media?.radarr?.apiKey) {
    mediaParts.push('Radarr');
  }
  if (config.media?.sonarr?.url && config.media?.sonarr?.apiKey) {
    mediaParts.push('Sonarr');
  }
  const mediaSection = mediaParts.length > 0 && config.permissions.mediaAccess
    ? `\n<media_integrations>\n${language === 'es'
      ? `Servicios de media conectados: ${mediaParts.join(', ')}.\n${mediaParts.includes('Radarr') ? '- Radarr (películas): usa radarr_search_movie, radarr_add_movie, radarr_library, radarr_movie_status, radarr_queue y radarr_delete_movie.\n' : ''}${mediaParts.includes('Sonarr') ? '- Sonarr (series): usa sonarr_search_series, sonarr_add_series, sonarr_library, sonarr_series_status, sonarr_season_episodes, sonarr_search_download, sonarr_queue y sonarr_delete_series.\n' : ''}Cuando el usuario pida una película o serie:\n1) Busca primero en la biblioteca (radarr_library / sonarr_library).\n2) Si no está, identifica por ID externo (IMDb/TVDB/TMDB) y usa ese ID para Radarr/Sonarr; evita búsquedas literales ambiguas.\n3) Si pide límite de tamaño (GB), usa min_size_gb/max_size_gb en radarr_get_releases/sonarr_get_releases y vuelve a consultar hasta encontrar opciones válidas.\n4) Pide confirmación antes de añadir/descargar.\n5) Para series, pregunta si quiere toda la serie, una temporada concreta o episodios específicos.\nNunca afirmes que descargaste algo sin llamar la herramienta correspondiente.`
      : `Connected media services: ${mediaParts.join(', ')}.\n${mediaParts.includes('Radarr') ? '- Radarr (movies): use radarr_search_movie, radarr_add_movie, radarr_library, radarr_movie_status, radarr_queue and radarr_delete_movie.\n' : ''}${mediaParts.includes('Sonarr') ? '- Sonarr (TV series): use sonarr_search_series, sonarr_add_series, sonarr_library, sonarr_series_status, sonarr_season_episodes, sonarr_search_download, sonarr_queue and sonarr_delete_series.\n' : ''}When the user requests a movie or series:\n1) Search the library first (radarr_library / sonarr_library).\n2) If not found, search online (radarr_search_movie / sonarr_search_series) and present options.\n3) Ask for confirmation before adding/downloading.\n4) For series, ask whether they want the entire show, a specific season, or individual episodes.\nNever claim something was downloaded without calling the corresponding tool.`}\n</media_integrations>`
    : '';

  // Build stored data summary (compact mode to reduce prompt/token footprint)
  const notes = storage.getAllNotes(userId, agentId);
  const lists = storage.getAllLists(userId, agentId);
  const persistedSchedules = storage.getAllSchedules(userId, agentId);
  const expenses = storage.getAllExpenses(userId, agentId);

  let dataSection = '';
  if (notes.length > 0 || lists.length > 0 || persistedSchedules.length > 0 || expenses.length > 0) {
    const compactLimit = 3;
    const parts: string[] = [];
    if (notes.length > 0) {
      const sample = notes.slice(0, compactLimit).map((n) => `"${n.title}"`).join(', ');
      parts.push(language === 'es'
        ? `Notas: ${notes.length}${sample ? ` (ejemplos: ${sample})` : ''}`
        : `Notes: ${notes.length}${sample ? ` (examples: ${sample})` : ''}`);
    }
    if (lists.length > 0) {
      const sample = lists.slice(0, compactLimit).map((l) => `"${l.title}"`).join(', ');
      parts.push(language === 'es'
        ? `Listas: ${lists.length}${sample ? ` (ejemplos: ${sample})` : ''}`
        : `Lists: ${lists.length}${sample ? ` (examples: ${sample})` : ''}`);
    }
    if (persistedSchedules.length > 0) {
      const reminders = persistedSchedules.filter((s) => s.oneShot && s.enabled).length;
      const recurring = persistedSchedules.filter((s) => !s.oneShot && s.enabled).length;
      parts.push(language === 'es'
        ? `Programaciones: ${persistedSchedules.length} (${recurring} recurrentes activas, ${reminders} recordatorios pendientes)`
        : `Schedules: ${persistedSchedules.length} (${recurring} active recurring, ${reminders} pending reminders)`);
    }
    if (expenses.length > 0) {
      const total = expenses.reduce((sum, e) => sum + e.amount, 0);
      parts.push(language === 'es'
        ? `Gastos: ${expenses.length} (total aproximado: ${total.toFixed(2)}€)`
        : `Expenses: ${expenses.length} (approx total: ${total.toFixed(2)}€)`);
    }

    dataSection = `\n<stored_data>\n${language === 'es'
      ? 'Resumen compacto de datos guardados. Para detalles o cambios, usa SIEMPRE las herramientas correspondientes.'
      : 'Compact summary of stored data. For details or modifications, ALWAYS use the corresponding tools.'}\n${parts.join('\n')}\n</stored_data>`;
  }

  const now = new Date();
  const dateTimeOptions: Intl.DateTimeFormatOptions = {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    ...(config.timezone ? { timeZone: config.timezone } : {}),
  };
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit', minute: '2-digit',
    ...(config.timezone ? { timeZone: config.timezone } : {}),
  };
  const dateStr = now.toLocaleDateString(locale, dateTimeOptions);
  const timeStr = now.toLocaleTimeString(locale, timeOptions);
  const timezoneLabel = config.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const disciplineBlock = language === 'es'
    ? `

IDENTIDAD Y TONO:
- Eres optimAIzer, un agente de IA que usa el provider ${config.provider} con el modelo ${config.model}.
- Habla en español claro con tono cercano pero profesional.
- Usa expresiones naturales y emojis cuando aporten claridad (sin exceso).
- Sé proactivo: sugiere próximos pasos útiles cuando tenga sentido.
- Si no estás seguro o falta contexto crítico, pregunta al usuario de forma concreta antes de ejecutar.

CAPACIDADES DISPONIBLES (RESUMEN):
- Investigación web (búsqueda, lectura de páginas y navegación dinámica cuando aplique).
- Ejecución de acciones reales con herramientas (nunca simular acciones completadas).
- Memoria persistente del agente para recordar datos clave entre conversaciones.
- Gestión de notas y listas (crear, buscar, actualizar y eliminar).
- Recordatorios puntuales y tareas programadas recurrentes.
- Gestión de calendario (crear/listar/buscar/actualizar/eliminar eventos) cuando esté integrado.
- Gestión de media (Radarr/Sonarr): buscar, añadir, descargar y consultar películas y series cuando esté integrado.
- Registro y análisis básico de gastos.
- Procesamiento de archivos de Telegram (leer, resumir y guardar como nota).
- Transcripción automática de notas de voz y audios (Whisper). Los audios se transcriben automáticamente al recibirlos. También puedes usar transcribe_telegram_audio si necesitas re-procesar un audio.
- Análisis inteligente de imágenes con IA (visión). Usa analyze_telegram_image para describir fotos, extraer texto (OCR), analizar gráficos, etc.
- Acciones encadenadas: puedes combinar múltiples herramientas en secuencia (ej: transcribir audio → crear nota → programar recordatorio).
- Integración con herramientas externas por MCP cuando estén conectadas.${config.permissions.terminalAccess ? `
- 🖥️ ACCESO AL TERMINAL DEL SISTEMA: Puedes ejecutar comandos en el terminal/shell del dispositivo (${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'}) usando run_terminal_command. IMPORTANTE: cada comando REQUIERE aprobación del usuario por Telegram antes de ejecutarse. Explica siempre claramente qué vas a hacer y por qué. Ejemplos: crear carpetas, mover archivos, cambiar configuraciones del sistema, instalar paquetes, gestionar servicios, etc.` : ''}${config.permissions.codeExecution ? `
- 💻 EJECUCIÓN DE CÓDIGO: Puedes crear y ejecutar código (Python, Node.js, Bash, etc.) en el dispositivo usando execute_code. IMPORTANTE: cada ejecución REQUIERE aprobación del usuario por Telegram. Explica siempre el objetivo del código y qué resultado esperas. Útil para análisis de datos, scripts de automatización, procesamiento de archivos, web scraping avanzado, cálculos complejos, etc.` : ''}
- Si el usuario pregunta "qué puedes hacer", explica estas capacidades con ejemplos breves y accionables.${config.permissions.terminalAccess || config.permissions.codeExecution ? `

PROTOCOLO OBLIGATORIO PARA TERMINAL/CÓDIGO:
- SIEMPRE explica al usuario QUÉ comando/código quieres ejecutar y POR QUÉ antes de llamar a la herramienta.
- El sistema enviará una solicitud de aprobación al usuario por Telegram con botones ✅/❌.
- Si el usuario deniega la acción, NO insistas. Ofrece alternativas o pregunta cómo proceder.
- Nunca ejecutes comandos destructivos (rm -rf /, format, etc.) sin contexto claro y aprobación.
- Para tareas complejas, divide en pasos pequeños y pide aprobación para cada uno.
- Si no estás seguro del sistema operativo o configuración, consulta primero con get_current_time o un comando exploratorio (ej: uname -a, whoami).` : ''}

COMPORTAMIENTO OBLIGATORIO (METÓDICO, PROACTIVO Y SEGURO):
- DEBES ABSOLUTAMENTE responder en el MISMO IDIOMA en el que el usuario te habla. Si te hablan en español, respondes en español. Si te hablan en inglés, respondes en inglés. Si te hablan en francés, respondes en francés. Así con cualquier idioma. Esto es innegociable.
- Responder por chat o por Telegram es exactamente lo mismo para ti. No preguntes nunca al usuario por qué canal quiere la respuesta ni hagas distinciones entre ambos.
- Sé proactivo: si puedes resolverlo con herramientas, ejecútalo; si falta contexto crítico, pregunta primero.
- Haz preguntas concretas cuando falten datos. Ejemplo email: destinatario, asunto y contenido.
- Evita muletillas de validación como "tienes razón" o "exactamente" salvo cuando el usuario haya corregido un error real.
- Antes de acciones con terceros (correo, Telegram, web externa, compras, reservas, publicaciones, edición/borrado) pide confirmación explícita.
- Antes de ejecutar una acción sensible, muestra un borrador/resumen final y pregunta: "¿Confirmas?".
- No contactes con terceros ni lances acciones irreversibles sin confirmación explícita del usuario.
- Nunca inventes resultados: cada acción reportada debe venir de una tool call real (nativa o MCP).
- Si una herramienta falla, explica el error breve, propone alternativa y pide el dato que falte.

FLUJO DE TRABAJO ESTRICTO:
1) Entender objetivo y restricciones.
2) Detectar faltantes y preguntar lo mínimo necesario.
3) Ejecutar tools/MCP cuando toque.
4) Verificar resultado.
5) Confirmar con recibo claro (qué, cuándo, dónde, ID si aplica).
6) Proponer siguiente paso útil (opcional).

IDENTIDAD:
- Tu nombre operativo es optimAIzer.
- Si preguntan por el modelo: "Estoy usando el provider ${config.provider} con el modelo ${config.model}."
- No digas "como modelo de lenguaje" ni te atribuyas otra identidad.`
    : `

IDENTITY AND TONE:
- You are optimAIzer, an AI agent using provider ${config.provider} with model ${config.model}.
- Communicate in clear English with a close but professional tone.
- Use natural wording and emojis when they add clarity (without overusing them).
- Be proactive: suggest useful next steps when appropriate.
- If you are unsure or critical context is missing, ask focused questions before executing.

AVAILABLE CAPABILITIES (SUMMARY):
- Web research (search, page reading, and dynamic browsing when needed).
- Real tool execution (never simulate completed actions).
- Persistent agent memory for key facts across conversations.
- Notes and lists management (create, search, update, delete).
- One-time reminders and recurring scheduled tasks.
- Calendar management (create/list/search/update/delete events) when integrated.
- Media management (Radarr/Sonarr): search, add, download, and check movies and TV series when integrated.
- Expense logging and basic spending analysis.
- Telegram file processing (read, summarize, save as note).
- Automatic voice note and audio transcription (Whisper). Audio messages are auto-transcribed upon receipt. You can also use transcribe_telegram_audio to re-process audio.
- Intelligent image analysis with AI vision. Use analyze_telegram_image to describe photos, extract text (OCR), analyze charts, etc.
- Chained actions: you can combine multiple tools in sequence (e.g. transcribe audio → create note → set reminder).
- External integrations through MCP when connected.${config.permissions.terminalAccess ? `
- 🖥️ SYSTEM TERMINAL ACCESS: You can execute commands on the device's terminal/shell (${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'}) using run_terminal_command. IMPORTANT: each command REQUIRES user approval via Telegram before execution. Always clearly explain what you will do and why. Examples: create folders, move files, change system settings, install packages, manage services, etc.` : ''}${config.permissions.codeExecution ? `
- 💻 CODE EXECUTION: You can create and execute code (Python, Node.js, Bash, etc.) on the device using execute_code. IMPORTANT: each execution REQUIRES user approval via Telegram. Always explain the code's purpose and expected outcome. Useful for data analysis, automation scripts, file processing, advanced web scraping, complex calculations, etc.` : ''}
- If the user asks "what can you do", explain these capabilities with short actionable examples.${config.permissions.terminalAccess || config.permissions.codeExecution ? `

MANDATORY PROTOCOL FOR TERMINAL/CODE:
- ALWAYS explain to the user WHAT command/code you want to execute and WHY before calling the tool.
- The system will send an approval request to the user via Telegram with ✅/❌ buttons.
- If the user denies the action, DO NOT insist. Offer alternatives or ask how to proceed.
- Never execute destructive commands (rm -rf /, format, etc.) without clear context and approval.
- For complex tasks, break into small steps and request approval for each one.
- If unsure about the operating system or configuration, check first with get_current_time or an exploratory command (e.g., uname -a, whoami).` : ''}

MANDATORY BEHAVIOR (METHODICAL, PROACTIVE, SAFE):
- You MUST ABSOLUTELY respond in the SAME LANGUAGE the user is speaking to you. If they speak Spanish, reply in Spanish. If they speak English, reply in English. If they speak French, reply in French. This applies to any language. This is non-negotiable.
- Responding via chat or Telegram is exactly the same for you. Never ask the user which channel they want the response on, and never make distinctions between the two.
- Be proactive: if tools can solve it, execute; if critical context is missing, ask first.
- Ask targeted questions when data is missing. Email example: recipient, subject, and body.
- Avoid filler validation phrases such as "you're right" or "exactly" unless the user explicitly corrected a real prior mistake.
- Require explicit confirmation before third-party actions (email, Telegram, external web, purchases, bookings, publishing, edits/deletions).
- Before sensitive execution, present a final draft/summary and ask: "Do you confirm?".
- Do not contact third parties or run irreversible actions without explicit user confirmation.
- Never fabricate outcomes: every completed action must come from a real tool call (native or MCP).
- If a tool fails, explain briefly, propose an alternative, and ask for the missing input.

STRICT WORKFLOW:
1) Understand goal and constraints.
2) Detect missing inputs and ask only what is necessary.
3) Execute tools/MCP when needed.
4) Verify results.
5) Confirm with a clear receipt (what, when, where, ID when applicable).
6) Propose a useful next step (optional).

IDENTITY:
- Your operating name is optimAIzer.
- If asked about the model: "I am using provider ${config.provider} with model ${config.model}."
- Do not say "as a language model" and do not assume any other identity.`;

  const compactSystemPrompt = process.env.AGENT_COMPACT_SYSTEM_PROMPT !== 'false';
  const compactDisciplineBlock = language === 'es'
    ? `
IDENTIDAD:
- Eres optimAIzer (${config.provider}/${config.model}).
- Responde SIEMPRE en el idioma del usuario.

REGLAS CLAVE:
- Usa herramientas reales para acciones reales; no inventes resultados.
- Si falta un dato crítico, haz una pregunta concreta.
- Para acciones sensibles o con terceros, muestra borrador breve y pide: "¿Confirmas?".
- Si una herramienta falla, explica breve, propone alternativa y pide el mínimo dato faltante.

FLUJO:
1) Entender objetivo. 2) Ejecutar tools/MCP cuando toque. 3) Verificar resultado. 4) Entregar recibo claro.`
    : `
IDENTITY:
- You are optimAIzer (${config.provider}/${config.model}).
- ALWAYS reply in the user's language.

KEY RULES:
- Use real tools for real actions; never fabricate outcomes.
- If critical data is missing, ask one focused question.
- For sensitive or third-party actions, show a brief draft and ask: "Do you confirm?".
- If a tool fails, explain briefly, propose an alternative, and ask only for missing data.

WORKFLOW:
1) Understand goal. 2) Execute tools/MCP when needed. 3) Verify result. 4) Deliver a clear receipt.`;

  const effectiveDisciplineBlock = compactSystemPrompt ? compactDisciplineBlock : disciplineBlock;

  return `${config.systemPrompt}

${language === 'es' ? 'Fecha actual' : 'Current date'}: ${dateStr}, ${timeStr}
${language === 'es' ? 'Zona horaria' : 'Timezone'}: ${timezoneLabel}
${language === 'es' ? 'Nombre del agente' : 'Agent name'}: ${config.name}
${language === 'es' ? 'Objetivo' : 'Objective'}: ${config.objective}
${language === 'es' ? 'Provider configurado' : 'Configured provider'}: ${config.provider}
${language === 'es' ? 'Modelo configurado' : 'Configured model'}: ${config.model}
${effectiveDisciplineBlock}

${toolsPrompt}
${memorySection}
${workingMemorySection}
${schedulesSection}
${credentialsSection}
${calendarSection}
${gmailSection}
${mediaSection}
${dataSection}
${buildSkillsPromptSection(userId, agentId, language)}`;
}

// ---------------------------------------------------------------------------
// Process a message through the LLM with tool-use loop
// ---------------------------------------------------------------------------

export async function processAgentMessage(
  config: AgentConfig,
  userMessage: string,
  conversationHistory: AgentMessage[],
  context: ToolExecutionContext,
  callbacks: EngineCallbacks,
  source: 'user' | 'scheduler' | 'webhook' = 'user'
): Promise<{ response: string; updatedHistory: AgentMessage[] }> {
  const runtimeTuning = resolveAgentRuntimeTuning(config);
  const language = inferAgentLanguage(config);
  const locale = language === 'es' ? 'es-ES' : 'en-US';
  const maxTokens = clampInteger(config.maxTokens, DEFAULT_MAX_TOKENS, 128, 8192);
  const temperature = clampNumber(config.temperature, DEFAULT_TEMPERATURE, 0, 2);
  const memoryRecallLimit = clampInteger(config.memoryRecallLimit, DEFAULT_MEMORY_RECALL_LIMIT, 0, 20);
  const enableSmartRAG = config.enableSmartRAG !== false; // enabled by default
  const isFastConfirmationTurn =
    source === 'user' &&
    isExplicitConfirmationMessage(userMessage) &&
    assistantAskedForConfirmation(conversationHistory);
  const isActionFastPath = source === 'user' && isLikelyActionCommand(userMessage);
  const useFastPath = isFastConfirmationTurn || isActionFastPath;
  const maxHistoryMessages = isFastConfirmationTurn
    ? Math.min(12, clampInteger(config.memoryRecentWindow, DEFAULT_HISTORY_MESSAGES, 8, 120))
    : clampInteger(config.memoryRecentWindow, DEFAULT_HISTORY_MESSAGES, 8, 120);
  const effectiveMemoryRecallLimit = useFastPath ? 0 : memoryRecallLimit;
  const effectiveEnableSmartRAG = useFastPath ? false : enableSmartRAG;

  // ── Step 1: Retrieve candidate memories (keyword-based pre-filter) ──
  const recalledConversation = effectiveMemoryRecallLimit > 0
    ? storage
        .searchConversationMessages(context.userId, context.agentId, userMessage, {
          // When Smart RAG is on, fetch MORE candidates for the LLM to score
          limit: effectiveEnableSmartRAG ? Math.min(effectiveMemoryRecallLimit * 3, 30) : effectiveMemoryRecallLimit,
          maxScan: 700,
        })
        .filter((item) => item.content.trim() && item.content.trim() !== userMessage.trim())
    : [];

  // ── Step 2: Build candidate objects for Smart RAG scoring ──
  const memoryCandidates: MemoryCandidate[] = recalledConversation.map((item, idx) => {
    const roleLabel = item.role === 'user' ? 'user' : item.role === 'assistant' ? 'assistant' : 'system';
    const date = new Date(item.timestamp).toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    return {
      index: idx,
      role: roleLabel,
      date,
      content: truncateMemorySnippet(item.content),
    };
  });

  // ── Step 3: Smart RAG — let the LLM score & filter memories ──
  let recalledConversationSnippets: string[];
  if (effectiveEnableSmartRAG && memoryCandidates.length > 0) {
    try {
      const scored = await scoreAndFilterMemories(userMessage, memoryCandidates, {
        provider: config.provider,
        model: config.model,
        minRelevance: 5,
        maxReturn: effectiveMemoryRecallLimit,
        language,
      });
      recalledConversationSnippets = scored.map(
        (m) => `[${m.role} @ ${m.date}] (relevancia: ${m.relevance}/10) ${m.content}`
      );
      if (scored.length < memoryCandidates.length) {
        console.log(
          `[Agent:${config.name}] Smart RAG: ${memoryCandidates.length} candidates → ${scored.length} relevant memories`
        );
      }
    } catch (smartRagError: any) {
      console.warn(
        `[Agent:${config.name}] Smart RAG failed, falling back to keyword scoring: ${smartRagError?.message || smartRagError}`
      );
      // Fallback to original keyword-scored snippets (take top N)
      recalledConversationSnippets = memoryCandidates
        .slice(0, effectiveMemoryRecallLimit)
        .map((c) => `[${c.role} @ ${c.date}] ${c.content}`);
    }
  } else {
    // Smart RAG disabled — use original snippets as-is
    recalledConversationSnippets = memoryCandidates.map(
      (c) => `[${c.role} @ ${c.date}] ${c.content}`
    );
  }

  // ── Step 4: Fetch Working Memory ──
  const workingMemoryEntries = storage.getAllWorkingMemory(context.userId, context.agentId);

  const systemPrompt = buildAgentSystemPrompt(
    config, context.userId, context.agentId,
    recalledConversationSnippets, context.mcpManager?.allTools,
    workingMemoryEntries,
    runtimeTuning
  );
  const fastPathInstruction = isFastConfirmationTurn
    ? `[PRIORIDAD MÁXIMA - CONFIRMACIÓN YA RECIBIDA]\nEl usuario YA confirmó la acción pendiente en este turno.\nNo vuelvas a pedir confirmación ni repitas el borrador.\nEjecuta inmediatamente la herramienta necesaria y responde con resultado final.\nTras ejecutar, cierra con un recibo breve y NO añadas preguntas de seguimiento ni propuestas extra en este turno.`
    : isActionFastPath
      ? `[FAST PATH - ACCIÓN DIRECTA]\nPrioriza ejecución inmediata para órdenes operativas.\nEvita repreguntas innecesarias: si hay ambigüedad menor, usa una suposición razonable por defecto y ejecútala (explicando brevemente la suposición en el recibo).\nPide aclaración solo si la acción podría ser incorrecta o insegura sin ese dato.\nDespués de ejecutar, entrega recibo corto sin preguntas de seguimiento.`
      : '';
  const effectiveSystemPrompt = fastPathInstruction
    ? `${systemPrompt}\n\n${fastPathInstruction}`
    : systemPrompt;

  // Build conversation for LLM
  const history = [...conversationHistory].slice(-maxHistoryMessages);
  
  // Add the new user message
  const newUserMsg: AgentMessage = {
    role: (source === 'scheduler' || source === 'webhook') ? 'system' : 'user',
    content: userMessage,
    timestamp: Date.now(),
  };
  history.push(newUserMsg);

  // Convert to LLM message format — also clean tool artifacts from history
  // to prevent the LLM from learning to output [tool_calls: ...] patterns
  const buildLlmMessages = (hist: AgentMessage[]) =>
    hist
      .filter(m => m.role !== 'system' || m.content !== systemPrompt)
      .map(m => {
        let content = m.content;
        // Clean tool artifacts from assistant messages in history
        if (m.role === 'assistant') {
          content = stripToolArtifacts(content);
        }
        return {
          role: (m.role === 'tool_result' ? 'user' : m.role) as 'user' | 'assistant' | 'system',
          content,
        };
      })
      .filter(m => m.content.trim() !== '');

  let fullResponse = '';
  let iterations = 0;
  const maxToolIterations = isFastConfirmationTurn
    ? runtimeTuning.fastConfirmationMaxToolIterations
    : runtimeTuning.maxToolIterations;
  let adaptiveMaxTokens = Math.max(maxTokens, AGENT_MIN_MODEL_MAX_TOKENS);
  let anyToolCalledInSession = false;
  const failedToolAttemptCounts = new Map<string, number>();
const nativeTools = buildNativeToolDefinitions(context.mcpManager?.allTools);

  try {
    const provider = createProvider(config.provider);

    while (iterations < maxToolIterations) {
      iterations++;

      // ── Budget guard ────────────────────────────────────────────────────
      // Before each LLM call, verify the agent's daily budget (if set).
      // On the very first iteration the manager already checked, so we
      // only enforce mid-conversation (iterations > 1) to catch runaway
      // tool loops. On iteration 1 we still check in case the budget
      // was consumed between the manager's check and now.
      if (context.checkBudget) {
        const budget = context.checkBudget();
        if (budget.exceeded) {
          const lang = inferAgentLanguage(config);
          const budgetMsg = lang === 'es'
            ? `⚠️ Presupuesto diario agotado ($${budget.currentCostUsd.toFixed(4)} / $${budget.limitUsd.toFixed(2)}). He detenido la ejecución. Autoriza más gasto desde Telegram para continuar.`
            : `⚠️ Daily budget exhausted ($${budget.currentCostUsd.toFixed(4)} / $${budget.limitUsd.toFixed(2)}). Execution halted. Approve additional spending from Telegram to continue.`;
          console.log(`[Agent:${config.name}] Budget exceeded mid-conversation (iteration ${iterations}). Stopping.`);
          fullResponse = fullResponse ? `${fullResponse}\n${budgetMsg}` : budgetMsg;
          history.push({ role: 'assistant', content: budgetMsg, timestamp: Date.now() });
          break;
        }
      }

      const llmMessages = buildLlmMessages(history);
      let response = '';
      let toolCalls: Array<{ name: string; params: Record<string, any> }> = [];
      let cleanText = '';
      let usedNativeToolCalling = false;

      if (provider.chatWithTools && nativeTools.length > 0) {
        try {
          const nativeResult = await withTimeout(
            provider.chatWithTools({
              model: config.model,
              messages: llmMessages,
              systemPrompt: effectiveSystemPrompt,
              maxTokens: adaptiveMaxTokens,
              temperature,
              tools: nativeTools,
              signal: AbortSignal.timeout(runtimeTuning.llmTimeoutMs),
            }),
            runtimeTuning.llmTimeoutMs + 2_000,
            'Native tool call'
          );

          usedNativeToolCalling = true;
          response = nativeResult.content || '';
          cleanText = response.trim();
          toolCalls = nativeResult.toolCalls.map((call) => ({
            name: call.name,
            params: (call.arguments || {}) as Record<string, any>,
          }));

          // Safety net: if native tool calling returned no tool calls but the
          // response text contains tool-call-like patterns, fall back to text
          // parsing.  This catches cases where a provider silently stripped
          // tools or the model confused formats.
          if (toolCalls.length === 0 && textContainsToolCallPatterns(response)) {
            const parsed = parseToolCalls(response);
            toolCalls = parsed.toolCalls;
            cleanText = parsed.cleanText;
            if (toolCalls.length > 0) {
              usedNativeToolCalling = false;
              console.log(
                `[Agent:${config.name}] Recovered ${toolCalls.length} tool call(s) from text after native returned none`
              );
            } else {
              // Couldn't parse structured tool calls — strip artifacts from cleanText
              cleanText = stripToolArtifacts(response);
              console.warn(
                `[Agent:${config.name}] Text contains tool-call-like artifacts but couldn't parse. Stripped artifacts.`
              );
            }
          }

          // Even when native tool calls were found, clean any leftover
          // artifacts from the text content (some models duplicate tool info in text)
          if (toolCalls.length > 0) {
            cleanText = stripToolArtifacts(cleanText);
          }
        } catch (nativeError: any) {
          if (isOutputLimitError(nativeError) && adaptiveMaxTokens < 8192) {
            const bumped = getBumpedMaxTokens(adaptiveMaxTokens);
            if (bumped > adaptiveMaxTokens) {
              console.warn(
                `[Agent:${config.name}] Output limit reached during native tool call. Retrying with maxTokens=${bumped} (was ${adaptiveMaxTokens}).`
              );
              adaptiveMaxTokens = bumped;
              continue;
            }
          }
          console.warn(
            `[Agent:${config.name}] Native tool calling unavailable for ${config.provider}/${config.model}: ${nativeError?.message || nativeError}`
          );
        }
      }

      if (!usedNativeToolCalling) {
        try {
          response = await withTimeout(
            provider.chat({
              model: config.model,
              messages: llmMessages,
              systemPrompt: effectiveSystemPrompt,
              maxTokens: adaptiveMaxTokens,
              temperature,
              signal: AbortSignal.timeout(runtimeTuning.llmTimeoutMs),
            }),
            runtimeTuning.llmTimeoutMs + 2_000,
            'Chat call'
          );
        } catch (error: any) {
          if (isOutputLimitError(error) && adaptiveMaxTokens < 8192) {
            const bumped = getBumpedMaxTokens(adaptiveMaxTokens);
            if (bumped > adaptiveMaxTokens) {
              console.warn(
                `[Agent:${config.name}] Output limit reached in chat call. Retrying with maxTokens=${bumped} (was ${adaptiveMaxTokens}).`
              );
              adaptiveMaxTokens = bumped;
              continue;
            }
          }

          try {
            await withTimeout(
              (async () => {
                const stream = provider.chatStream({
                  model: config.model,
                  messages: llmMessages,
                  systemPrompt: effectiveSystemPrompt,
                  maxTokens: adaptiveMaxTokens,
                  temperature,
                  signal: AbortSignal.timeout(runtimeTuning.llmTimeoutMs),
                });

                for await (const chunk of stream) {
                  if (chunk.type === 'token' && chunk.content) {
                    response += chunk.content;
                  } else if (chunk.type === 'error') {
                    throw new Error(chunk.error || 'Streaming error');
                  }
                }
              })(),
              runtimeTuning.llmTimeoutMs + 2_000,
              'Stream fallback call'
            );
          } catch (streamError: any) {
            if (isOutputLimitError(streamError) && adaptiveMaxTokens < 8192) {
              const bumped = getBumpedMaxTokens(adaptiveMaxTokens);
              if (bumped > adaptiveMaxTokens) {
                console.warn(
                  `[Agent:${config.name}] Output limit reached in stream fallback. Retrying with maxTokens=${bumped} (was ${adaptiveMaxTokens}).`
                );
                adaptiveMaxTokens = bumped;
                continue;
              }
            }
            throw streamError;
          }
        }

        if (!response.trim()) {
          break;
        }

        const parsedLegacyToolCalls = parseToolCalls(response);
        toolCalls = parsedLegacyToolCalls.toolCalls;
        cleanText = parsedLegacyToolCalls.cleanText;
      }

      if (!response.trim() && toolCalls.length === 0) {
        break;
      }

      const usageOutputSeed = [
        response || '',
        toolCalls.length > 0
          ? toolCalls.map((toolCall) => `${toolCall.name}:${JSON.stringify(toolCall.params || {})}`).join('\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n');

      try {
        context.recordUsageEvent?.({
          provider: config.provider,
          model: config.model,
          inputTokens: estimateInputTokens(llmMessages, effectiveSystemPrompt),
          outputTokens: estimateTextTokens(usageOutputSeed),
          source: `agent:${context.agentId}:${source}`,
        });
      } catch (usageError: any) {
        console.warn(`[Agent:${config.name}] Could not track usage: ${usageError?.message || usageError}`);
      }

      if (toolCalls.length === 0) {
        // No tool calls: final assistant response.
        let finalChunk = stripToolArtifacts(
          (usedNativeToolCalling ? cleanText : response).trim()
        );
        if (isFastConfirmationTurn && anyToolCalledInSession) {
          finalChunk = trimFollowUpQuestions(finalChunk);
        }

        // ── Anti-hallucination guard ──────────────────────────────────────
        // Detect if the LLM claims to have performed ANY data action
        // without actually calling any tool in the entire session. If so,
        // force a retry with an explicit instruction to use the tools.
        if (finalChunk && iterations < maxToolIterations && !anyToolCalledInSession) {
          const promisesExecutionButNoTool = /^(?:voy\s+a|te\s+voy\s+a|ahora\s+voy\s+a|i\s+will|i'll|let\s+me)\b/i.test(finalChunk)
            || /\b(?:voy\s+a\s+crear|voy\s+a\s+enviar|voy\s+a\s+buscar|voy\s+a\s+ejecutar|i\s+will\s+create|i\s+will\s+send|i\s+will\s+search|i\s+will\s+run)\b/i.test(finalChunk);

          if (isActionFastPath && promisesExecutionButNoTool) {
            console.warn(`[Agent:${config.name}] Forced tool execution retry: action request answered with promise text but no tool call (iteration ${iterations}).`);
            history.push({
              role: 'assistant',
              content: finalChunk,
              timestamp: Date.now(),
            });
            history.push({
              role: 'tool_result' as any,
              content: `ERROR CRÍTICO: El usuario pidió una ACCIÓN y tú solo dijiste que la harías, pero NO ejecutaste ninguna herramienta. Debes ejecutar la herramienta adecuada AHORA y responder con el resultado real. No prometas; actúa.`,
              timestamp: Date.now(),
            });
            continue;
          }

          if (isFastConfirmationTurn && responseAsksConfirmation(finalChunk)) {
            history.push({
              role: 'assistant',
              content: finalChunk,
              timestamp: Date.now(),
            });
            history.push({
              role: 'tool_result' as any,
              content: `ERROR CRÍTICO: El usuario YA confirmó explícitamente. NO debes pedir otra confirmación. Ejecuta ahora la herramienta adecuada y responde con el resultado final.`,
              timestamp: Date.now(),
            });
            continue;
          }

          const claimsAction = /(?:(?:he|ya)\s+(?:creado|añadido|guardado|registrado|programado|eliminado|actualizado|marcado)|evento\s+creado|nota\s+creada|lista\s+creada|gasto\s+registrado|recordatorio\s+(?:creado|programado)|ya\s+est[aá]\s+(?:creado|guardad[oa]|añadid[oa]|registrad[oa])|creado\s+(?:el|la|un|una)\s+(?:evento|nota|lista|recordatorio|gasto)|listo[.,!]?\s*(?:evento|nota|lista|recordatorio|gasto)?|✅\s*(?:listo|creado|guardado|añadido|registrado))/i.test(finalChunk);
          const actionRelated = /calendario|calendar|icloud|google\s*calendar|evento|nota|lista|gasto|recordatorio|tarea/i.test(finalChunk);

          if (claimsAction && actionRelated) {
            console.warn(`[Agent:${config.name}] Anti-hallucination: LLM claimed data action without tool call (iteration ${iterations}). Forcing retry.`);
            // Replace the fake response with a retry instruction
            history.push({
              role: 'assistant',
              content: finalChunk,
              timestamp: Date.now(),
            });
            history.push({
              role: 'tool_result' as any,
              content: `ERROR CRÍTICO: Has dicho que realizaste una acción (crear evento, guardar nota, crear lista, registrar gasto, crear recordatorio, etc.), pero NO llamaste a NINGUNA herramienta. Esto es INACEPTABLE. DEBES usar las herramientas disponibles para realizar acciones reales. NO puedes decir que has hecho algo sin llamar a la herramienta correspondiente. Llama a la herramienta correcta AHORA.`,
              timestamp: Date.now(),
            });
            continue; // Retry the LLM call
          }
        }

        if (finalChunk) {
          fullResponse = fullResponse ? `${fullResponse}\n${finalChunk}` : finalChunk;
        }

        history.push({
          role: 'assistant',
          content: finalChunk || response,
          timestamp: Date.now(),
        });
        break;
      }

      // Execute tool calls.
      // Store a clean, natural-language-only assistant entry in history.
      // Never store raw tool call notation — it poisons future LLM responses.
      const strippedCleanText = stripToolArtifacts(cleanText).trim();
      const assistantContentForHistory = strippedCleanText || '';

      // Only add an assistant message if there's actual text content
      if (assistantContentForHistory) {
        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: assistantContentForHistory,
          timestamp: Date.now(),
        };
        history.push(assistantMsg);
      }

      const toolResults: string[] = [];
      anyToolCalledInSession = true;

      // De-duplicate identical tool calls in the same iteration.
      const dedupedToolCalls: Array<{ name: string; params: Record<string, any> }> = [];
      const seenToolCalls = new Set<string>();
      for (const call of toolCalls) {
        const signature = `${call.name}:${stableStringify(call.params || {})}`;
        if (seenToolCalls.has(signature)) continue;
        seenToolCalls.add(signature);
        dedupedToolCalls.push(call);
      }

      // ── Parallel tool execution ─────────────────────────────────────────
      // Partition into parallel-safe (read-only) and sequential (mutating)
      // tool calls. Parallel-safe calls run concurrently via Promise.all to
      // reduce latency on research-heavy tasks.
      // -------------------------------------------------------------------

      // Helper: execute a single tool call and format the result string
      const executeAndFormatTool = async (
        call: { name: string; params: Record<string, any> },
      ): Promise<string> => {
        const callSignature = `${call.name}:${stableStringify(call.params || {})}`;
        const previousFailures = failedToolAttemptCounts.get(callSignature) || 0;
        if (previousFailures >= 2) {
          return `Herramienta: ${call.name}\nEstado: error\nResultado:\nError: llamada bloqueada para evitar bucle. Esta misma llamada ya falló ${previousFailures} veces seguidas. No la repitas; informa al usuario y pide el dato/configuración faltante.`;
        }

        context.recordResourceEvent?.({
          type: 'agent_tool_call',
          metadata: { tool: call.name },
        });
        callbacks.onToolCall(call.name, call.params);
        const result = await withTimeout(
          executeTool(call, context),
          runtimeTuning.toolTimeoutMs,
          `Tool call \"${call.name}\"`
        );
        callbacks.onToolResult(result);

        if (result.success) {
          failedToolAttemptCounts.delete(callSignature);
        } else {
          failedToolAttemptCounts.set(callSignature, previousFailures + 1);
        }

        const rawResult = result.success ? result.result : `Error: ${result.error || 'Error desconocido'}`;
        const compactResult = compactToolResultForLlm(rawResult, runtimeTuning.toolResultMaxChars);
        return `Herramienta: ${call.name}\nEstado: ${result.success ? 'ok' : 'error'}\nResultado:\n${compactResult}`;
      };

      // Index each call so we can restore original order after parallel exec
      const indexedCalls = dedupedToolCalls.map((call, i) => ({ call, index: i }));
      const parallelBatch = indexedCalls.filter(({ call }) => isToolParallelSafe(call.name));
      const sequentialBatch = indexedCalls.filter(({ call }) => !isToolParallelSafe(call.name));

      // Collect results keyed by original index
      const resultsByIndex = new Map<number, string>();

      // Run parallel-safe tools concurrently
      if (parallelBatch.length > 1) {
        console.log(
          `[Agent:${config.name}] Executing ${parallelBatch.length} tool calls in parallel: ${parallelBatch.map(({ call }) => call.name).join(', ')}`
        );
      }
      const parallelResults = await Promise.all(
        parallelBatch.map(async ({ call, index }) => ({
          index,
          resultStr: await executeAndFormatTool(call),
        }))
      );
      for (const { index, resultStr } of parallelResults) {
        resultsByIndex.set(index, resultStr);
      }

      // Run sequential (mutating) tools one at a time
      for (const { call, index } of sequentialBatch) {
        const resultStr = await executeAndFormatTool(call);
        resultsByIndex.set(index, resultStr);
      }

      // Combine results preserving original call order
      for (let i = 0; i < dedupedToolCalls.length; i++) {
        toolResults.push(resultsByIndex.get(i)!);
      }

      // Add tool results to history for the next LLM iteration
      const allToolResults = toolResults.join('\n\n');
      const compactAllToolResults = compactToolResultForLlm(
        allToolResults,
        runtimeTuning.toolResultsTotalMaxChars
      );

      const toolResultMsg: AgentMessage = {
        role: 'tool_result',
        content: `Resultados de herramientas:\n\n${compactAllToolResults}\n\nAhora procesa estos resultados y responde al usuario de forma clara y completa. Si una llamada a herramienta falló repetidamente, NO la repitas con los mismos parámetros: informa el motivo real y pide lo mínimo necesario para continuar. Si ya tienes toda la información necesaria, proporciona tu respuesta final.`,
        timestamp: Date.now(),
      };
      history.push(toolResultMsg);

      // Do NOT accumulate intermediate text from tool-calling iterations.
      // Only the final response (break above) should appear in fullResponse.
      // Intermediate text like "Voy a buscar..." is noise for the user.
    }

    // Comprehensive cleanup of the final response
    fullResponse = stripToolArtifacts(fullResponse).trim();

    callbacks.onResponse(fullResponse);
    return { response: fullResponse, updatedHistory: history };
  } catch (error: any) {
    const errorMsg = `Error del agente: ${error.message}`;
    callbacks.onError(errorMsg);
    return {
      response: errorMsg,
      updatedHistory: [
        ...history,
        { role: 'assistant', content: errorMsg, timestamp: Date.now() },
      ],
    };
  }
}
