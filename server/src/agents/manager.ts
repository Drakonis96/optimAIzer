// ---------------------------------------------------------------------------
// Agent Manager — Orchestrates Telegram bot + Engine + Scheduler per agent
// ---------------------------------------------------------------------------

import { AgentConfig, AgentMessage, AgentRuntimeState } from './types';
import { createTelegramBot, getTelegramBotBaseUrl, TelegramBotService, TelegramFileInfo, TelegramLocationInfo } from './telegram';
import { processAgentMessage } from './engine';
import { ToolExecutionContext } from './tools';
import { createScheduler, ScheduledTask, SchedulerService } from './scheduler';
import { MCPClientManager, getMCPRegistry } from './mcpClient';
import { Provider } from '../types';
import * as agentStorage from './storage';
import { getAgentDailyCostUsd, recordUserResourceEvent, recordUserUsageEvent } from '../auth/usage';
import { transcribeAudio } from './transcription';
import { buildWebhookInstruction, IncomingWebhookPayload } from './webhooks';
import * as eventSubs from './eventSubscriptions';
import { findSkillsByMessage, findSkillsByEvent } from './skills';
import {
  HomeAssistantWebSocket,
  HAStateChangedEvent,
  buildHAStateChangeInstruction,
} from './homeAssistantWs';
import {
  gmailWatch,
  gmailStopWatch,
  hasActiveWatch,
  GmailPushConfig,
} from './gmailPush';
import {
  getEventRouter,
  generateEventId,
  detectEventPriority,
  RealtimeEvent,
  RealtimeEventSource,
} from './eventRouter';
import * as radarr from './radarr';
import * as sonarr from './sonarr';

interface RunningAgent {
  config: AgentConfig;
  userId: string;
  telegram: TelegramBotService;
  scheduler: SchedulerService;
  mcpManager: MCPClientManager;
  conversationHistory: AgentMessage[];
  persistedConversationCount: number;
  isProcessing: boolean;
  messageQueue: Array<{ text: string; source: 'user' | 'scheduler' | 'webhook'; channel?: 'telegram' | 'web'; task?: ScheduledTask }>;
  dynamicSchedules: ScheduledTask[];
  /** Interval for poll-type event subscriptions */
  pollTickerInterval?: ReturnType<typeof setInterval>;
  /** Trigger queue processing (set during deploy, used by webhook enqueue) */
  triggerProcessQueue?: () => void;
  /** Home Assistant WebSocket connection (real-time state changes) */
  haWebSocket?: HomeAssistantWebSocket;
  /** Whether Gmail push is active for this agent */
  gmailPushActive?: boolean;
  /** Polling interval for proactive media queue notifications */
  mediaMonitorInterval?: ReturnType<typeof setInterval>;
  /** Last known Sonarr queue snapshot */
  sonarrQueueSnapshot?: Map<number, { title: string; trackedDownloadState?: string; trackedDownloadStatus?: string; status?: string }>;
  /** Last known Radarr queue snapshot */
  radarrQueueSnapshot?: Map<number, { title: string; trackedDownloadState?: string; trackedDownloadStatus?: string; status?: string }>;
  /** Media monitor initialized flag to avoid startup spam */
  mediaMonitorReady?: boolean;
}

function enqueueUserMessage(running: RunningAgent, text: string, channel?: 'telegram' | 'web'): void {
  const item = { text, source: 'user' as const, channel };
  const queue = running.messageQueue;

  // Keep FIFO among user messages, but place user messages ahead of
  // scheduler/webhook backlog so confirmations execute faster.
  const lastUserIndex = (() => {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i].source === 'user') return i;
    }
    return -1;
  })();

  if (lastUserIndex >= 0) {
    queue.splice(lastUserIndex + 1, 0, item);
    return;
  }

  const firstNonUserIndex = queue.findIndex((entry) => entry.source !== 'user');
  if (firstNonUserIndex >= 0) {
    queue.splice(firstNonUserIndex, 0, item);
    return;
  }

  queue.push(item);
}

const QUICK_REPLY_TTL_MS = 30 * 60 * 1000;
const pendingQuickReplies = new Map<string, { text: string; timeout: ReturnType<typeof setTimeout> }>();

function registerQuickReply(replyText: string): string {
  const normalized = String(replyText || '').trim();
  if (!normalized) return `reply:${encodeURIComponent('')}`;
  const id = `qr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const timeout = setTimeout(() => {
    pendingQuickReplies.delete(id);
  }, QUICK_REPLY_TTL_MS);
  pendingQuickReplies.set(id, { text: normalized, timeout });
  return `replyid:${id}`;
}

function parseQuickReplyCallbackData(data: string): string {
  const value = String(data || '').trim();
  if (!value) return '';
  if (value.startsWith('replyid:')) {
    const id = value.slice('replyid:'.length).trim();
    if (!id) return '';
    const entry = pendingQuickReplies.get(id);
    if (!entry) return '';
    clearTimeout(entry.timeout);
    pendingQuickReplies.delete(id);
    return entry.text;
  }
  if (!value.startsWith('reply:')) return value;
  try {
    return decodeURIComponent(value.slice('reply:'.length)).trim();
  } catch {
    return value.slice('reply:'.length).trim();
  }
}

function truncateButtonLabel(value: string, maxLen = 28): string {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLen - 1)).trim()}…`;
}

function extractMultipleChoiceOptions(response: string): string[] {
  const text = String(response || '').trim();
  if (!text) return [];

  const asksChoice = /(elige|escoge|selecciona|opci[oó]n|cu[aá]l\s+prefieres|cu[aá]l\s+quieres|which\s+one|choose|select|options?)/i.test(text);
  if (!asksChoice) return [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const options: string[] = [];
  for (const line of lines) {
    const numbered = line.match(/^\d{1,2}[\)\].:\-]\s+(.+)$/);
    const lettered = line.match(/^[A-Ha-h][\)\].:\-]\s+(.+)$/);
    const bulleted = line.match(/^(?:[-*•])\s+(.+)$/);
    const optionText = (numbered?.[1] || lettered?.[1] || bulleted?.[1] || '').trim();
    if (!optionText) continue;
    if (optionText.length < 2) continue;
    if (optionText.length > 120) continue;
    options.push(optionText);
  }

  const unique = [...new Set(options.map((item) => item.trim()))];
  if (unique.length < 2 || unique.length > 6) return [];
  return unique;
}

function buildAutoTelegramButtons(response: string): Array<Array<{ text: string; callback_data: string }>> | null {
  const text = String(response || '').trim();
  if (!text) return null;

  // Auto-generated buttons are intentionally disabled to avoid noisy,
  // low-signal quick replies. Use explicit approval flows or the
  // send_telegram_buttons tool when buttons are truly needed.
  return null;
}

function recordQuickReplyInConversation(
  running: RunningAgent,
  userId: string,
  replyText: string,
  channel: 'telegram' | 'web' = 'telegram'
): void {
  const normalized = String(replyText || '').trim();
  if (!normalized) return;
  const timestamp = Date.now();
  running.conversationHistory.push({
    role: 'user',
    content: normalized,
    timestamp,
    source: channel,
  });
  agentStorage.appendConversationMessage(userId, running.config.id, {
    role: 'user',
    content: normalized,
    timestamp,
  });
  running.persistedConversationCount += 1;
}

// Global registry of running agents
const runningAgents = new Map<string, RunningAgent>();

// Global registry of pending approval requests (terminal/code execution)
const pendingApprovals = new Map<string, {
  type: 'terminal' | 'code' | 'critical_action';
  command?: string;
  code?: string;
  language?: string;
  reason: string;
  actionLabel?: string;
  actionDetails?: string;
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();
const AGENT_PROCESS_TIMEOUT_MS = Math.max(15_000, Number(process.env.AGENT_PROCESS_TIMEOUT_MS || 180_000));

const resolveQueueDelayMs = (running: RunningAgent, source: 'user' | 'scheduler' | 'webhook'): number => {
  const runtime = running.config.runtimeTuning;
  const userDelay = Math.max(
    10,
    Math.min(2_000, Number.isFinite(runtime?.queueDelayUserMs as number) ? Number(runtime?.queueDelayUserMs) : 20)
  );
  const backgroundDelay = Math.max(
    20,
    Math.min(5_000, Number.isFinite(runtime?.queueDelayBackgroundMs as number) ? Number(runtime?.queueDelayBackgroundMs) : 80)
  );
  return source === 'user' ? userDelay : backgroundDelay;
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
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

// ---------------------------------------------------------------------------
// Budget override registry
// When a user approves exceeding the daily budget, we store a timestamp so
// subsequent messages in the same calendar day are not blocked again.
// ---------------------------------------------------------------------------
const budgetOverrides = new Map<string, number>(); // agentId → timestamp of approval

const isBudgetOverrideActive = (agentId: string): boolean => {
  const ts = budgetOverrides.get(agentId);
  if (!ts) return false;
  // Override is valid for the same calendar day it was granted
  const now = new Date();
  const overrideDate = new Date(ts);
  return (
    now.getFullYear() === overrideDate.getFullYear() &&
    now.getMonth() === overrideDate.getMonth() &&
    now.getDate() === overrideDate.getDate()
  );
};

const grantBudgetOverride = (agentId: string): void => {
  budgetOverrides.set(agentId, Date.now());
};

const getRunningAgentForUser = (agentId: string, userId: string): RunningAgent | null => {
  const running = runningAgents.get(agentId);
  if (!running) return null;
  if (running.userId !== userId) return null;
  return running;
};

const buildScheduledTaskInstruction = (task: ScheduledTask): string => {
  const lines: string[] = [
    `[TAREA PROGRAMADA - "${task.name}"]`,
    '',
    'Ejecuta la siguiente tarea programada y al finalizar deja un estado de ejecución claro.',
    '',
    task.instruction || task.name,
  ];

  if (typeof task.startAt === 'number' && Number.isFinite(task.startAt)) {
    lines.push('', `Inicio configurado: ${new Date(task.startAt).toLocaleString('es-ES', task.timezone ? { timeZone: task.timezone } : undefined)}`);
  }
  if (task.frequency) {
    lines.push(`Frecuencia declarada: ${task.frequency}`);
  }
  if (task.conditions) {
    lines.push(`Condiciones: ${task.conditions}`);
  }
  if (task.timezone) {
    lines.push(`Zona horaria: ${task.timezone}`);
  }

  lines.push('', 'Responde siempre con: resultado final, estado (completada/error) y próximos pasos si aplica.');
  return lines.join('\n');
};

const buildScheduledTaskConfirmation = (task: ScheduledTask, response: string): string => {
  const trimmed = response.trim();
  const snippet = trimmed
    ? trimmed.slice(0, 1400)
    : 'El agente ejecutó la tarea, pero no devolvió detalles en su respuesta.';
  return [
    `✅ Tarea programada completada: "${task.name}"`,
    `Estado final: ${trimmed ? 'completada' : 'completada con respuesta vacía'}`,
    '',
    'Resumen:',
    snippet,
  ].join('\n');
};

const parseConfiguredSchedule = (scheduleText: string): { cron: string; oneShot?: boolean; triggerAt?: number } => {
  const raw = String(scheduleText || '').trim();
  if (!raw) {
    return { cron: '' };
  }

  if (/^once:/i.test(raw)) {
    const dateLiteral = raw.slice(5).trim();
    const triggerAt = Date.parse(dateLiteral);
    if (Number.isFinite(triggerAt)) {
      return {
        cron: '0 0 * * *',
        oneShot: true,
        triggerAt,
      };
    }
  }

  return { cron: raw };
};

const extractReminderMessage = (instruction: string): string | null => {
  const reminderMatch = instruction.match(
    /\[RECORDATORIO\]\s*(?:Envía este mensaje al usuario por Telegram:\s*\n?\n?)?(.+)/s
  );
  if (!reminderMatch) return null;

  return reminderMatch[1]
    .replace(/\n\n?Este es un recordatorio que el usuario configuró\.[\s\S]*$/i, '')
    .trim();
};

const queueStatusLooksFailed = (value?: string): boolean => {
  const normalized = String(value || '').toLowerCase();
  return normalized.includes('fail') || normalized.includes('error') || normalized.includes('rejected');
};

const buildMediaQueueExitMessage = (
  app: 'sonarr' | 'radarr',
  item: { title: string; trackedDownloadState?: string; trackedDownloadStatus?: string; status?: string }
): string => {
  const failed = queueStatusLooksFailed(item.trackedDownloadState)
    || queueStatusLooksFailed(item.trackedDownloadStatus)
    || queueStatusLooksFailed(item.status);

  if (failed) {
    return app === 'sonarr'
      ? `⚠️ Sonarr: la descarga de "${item.title}" salió de la cola con estado de error.`
      : `⚠️ Radarr: la descarga de "${item.title}" salió de la cola con estado de error.`;
  }

  return app === 'sonarr'
    ? `✅ Sonarr: ha terminado la descarga de "${item.title}".`
    : `✅ Radarr: ha terminado la descarga de "${item.title}".`;
};

async function runMediaQueueMonitor(running: RunningAgent): Promise<void> {
  const sonarrConfig = running.config.media?.sonarr;
  const radarrConfig = running.config.media?.radarr;
  if (!sonarrConfig && !radarrConfig) return;

  try {
    if (sonarrConfig) {
      const sonarrQueue = await sonarr.getQueue(sonarrConfig);
      const current = new Map<number, { title: string; trackedDownloadState?: string; trackedDownloadStatus?: string; status?: string }>();
      for (const item of sonarrQueue) {
        current.set(item.id, {
          title: item.series?.title ? `${item.series.title} — ${item.title}` : item.title,
          trackedDownloadState: item.trackedDownloadState,
          trackedDownloadStatus: item.trackedDownloadStatus,
          status: item.status,
        });
      }

      if (running.mediaMonitorReady && running.sonarrQueueSnapshot) {
        for (const [id, previous] of running.sonarrQueueSnapshot.entries()) {
          if (!current.has(id)) {
            const msg = buildMediaQueueExitMessage('sonarr', previous);
            running.telegram.sendMessage(running.config.telegram.chatId, msg).catch(() => {});
          }
        }
      }

      running.sonarrQueueSnapshot = current;
    }

    if (radarrConfig) {
      const radarrQueue = await radarr.getQueue(radarrConfig);
      const current = new Map<number, { title: string; trackedDownloadState?: string; trackedDownloadStatus?: string; status?: string }>();
      for (const item of radarrQueue) {
        current.set(item.id, {
          title: item.title,
          trackedDownloadState: item.trackedDownloadState,
          trackedDownloadStatus: item.trackedDownloadStatus,
          status: item.status,
        });
      }

      if (running.mediaMonitorReady && running.radarrQueueSnapshot) {
        for (const [id, previous] of running.radarrQueueSnapshot.entries()) {
          if (!current.has(id)) {
            const msg = buildMediaQueueExitMessage('radarr', previous);
            running.telegram.sendMessage(running.config.telegram.chatId, msg).catch(() => {});
          }
        }
      }

      running.radarrQueueSnapshot = current;
    }

    running.mediaMonitorReady = true;
  } catch (error: any) {
    console.warn(`[Agent:${running.config.name}] Media queue monitor warning:`, error?.message || error);
  }
}

// ---------------------------------------------------------------------------
// Deploy an agent (start Telegram bot + scheduler)
// ---------------------------------------------------------------------------

export function deployAgent(config: AgentConfig, userId: string = 'default'): { success: boolean; error?: string } {
  // Validate config
  if (!config.telegram.botToken) {
    return { success: false, error: 'Falta el bot token de Telegram' };
  }
  if (!config.telegram.chatId) {
    return { success: false, error: 'Falta el chat ID de Telegram' };
  }
  if (!config.provider || !config.model) {
    return { success: false, error: 'Falta el proveedor o modelo del agente' };
  }

  // Stop existing instance if any
  if (runningAgents.has(config.id)) {
    stopAgent(config.id);
  }

  const telegram = createTelegramBot(config.telegram.botToken, config.telegram.chatId);
  const scheduler = createScheduler();
  const mcpManager = new MCPClientManager(config.id);
  // Load ALL persisted messages so early user messages are never lost behind a
  // flood of system/webhook events. The in-memory soft cap (300) bounds growth
  // at runtime; at startup we want the full picture.
  const allPersistedMessages = agentStorage.getAllConversationMessages(userId, config.id);
  const persistedConversationCount = allPersistedMessages.length;
  // If there are more than the soft cap, keep the most recent 300 but always
  // include every user message (so they stay visible in the live chat).
  let persistedConversation = allPersistedMessages;
  const MAX_STARTUP_HISTORY = 300;
  if (allPersistedMessages.length > MAX_STARTUP_HISTORY) {
    const recentSlice = allPersistedMessages.slice(allPersistedMessages.length - MAX_STARTUP_HISTORY);
    // Collect user messages that fell outside the recent window
    const recentTimestamps = new Set(recentSlice.map((m) => m.timestamp));
    const missingUserMsgs = allPersistedMessages
      .filter((m) => m.role === 'user' && !recentTimestamps.has(m.timestamp));
    persistedConversation = [...missingUserMsgs, ...recentSlice];
    persistedConversation.sort((a, b) => a.timestamp - b.timestamp);
  }

  const running: RunningAgent = {
    config,
    userId,
    telegram,
    scheduler,
    mcpManager,
    conversationHistory: persistedConversation.map((message) => ({
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    })),
    persistedConversationCount,
    isProcessing: false,
    messageQueue: [],
    dynamicSchedules: [],
  };

  // Build tool execution context
  const toolContext: ToolExecutionContext = {
    agentConfig: config,
    userId,
    agentId: config.id,
    sendTelegramMessage: (message: string) => telegram.sendMessage(config.telegram.chatId, message),
    sendTelegramMessageWithButtons: (message: string, buttons: Array<Array<{ text: string; callback_data: string }>>) =>
      telegram.sendMessageWithButtons(config.telegram.chatId, message, buttons),
    downloadTelegramFile: (fileId: string) => telegram.downloadFile(fileId),
    addMemory: (info: string) => {
      running.config.memory = [...(running.config.memory || []), info];
    },
    addSchedule: (params): string => {
      const taskId = params.id || `dynamic-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const task: ScheduledTask = {
        id: taskId,
        name: params.name,
        cron: params.cron,
        instruction: params.instruction,
        enabled: params.enabled !== false,
        startAt: params.startAt,
        frequency: params.frequency,
        conditions: params.conditions,
        timezone: params.timezone || config.timezone,
      };
      running.dynamicSchedules = running.dynamicSchedules.filter((item) => item.id !== taskId);
      running.dynamicSchedules.push(task);
      scheduler.addTask(task);
      console.log(`[Agent:${config.name}] Dynamic schedule added: "${task.name}" (${task.cron})`);
      return taskId;
    },
    removeSchedule: (taskId: string): boolean => {
      const before = running.dynamicSchedules.length;
      running.dynamicSchedules = running.dynamicSchedules.filter((item) => item.id !== taskId);
      scheduler.removeTask(taskId);
      return running.dynamicSchedules.length < before;
    },
    toggleSchedule: (taskId: string, enabled: boolean): boolean => {
      const existing = running.dynamicSchedules.find((item) => item.id === taskId);
      if (!existing) return false;
      existing.enabled = enabled;
      scheduler.addTask(existing);
      return true;
    },
    setOneShotTrigger: (taskId: string, triggerAt: number): void => {
      const existing = running.dynamicSchedules.find((item) => item.id === taskId);
      if (existing) {
        existing.oneShot = true;
        existing.triggerAt = triggerAt;
        scheduler.addTask(existing);
      } else {
        // Find in scheduler tasks and set oneShot
        const tasks = scheduler.getTasks();
        const task = tasks.find((t) => t.id === taskId);
        if (task) {
          task.oneShot = true;
          task.triggerAt = triggerAt;
          scheduler.addTask(task);
        }
      }
    },
    recordUsageEvent: (event) => {
      try {
        recordUserUsageEvent({
          userId,
          provider: event.provider,
          model: event.model,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          source: event.source,
          tooling: event.tooling,
        });
      } catch (error: any) {
        console.warn(`[Agent:${config.name}] Could not record usage event:`, error?.message || error);
      }
    },
    recordResourceEvent: (event) => {
      try {
        recordUserResourceEvent({
          userId,
          agentId: config.id,
          resourceType: event.type,
          units: event.units,
          costUsd: event.costUsd,
          metadata: event.metadata,
        });
      } catch (error: any) {
        console.warn(`[Agent:${config.name}] Could not record resource event:`, error?.message || error);
      }
    },
    checkBudget: () => {
      const limitUsd = Number(running.config.dailyBudgetUsd || 0);
      if (!Number.isFinite(limitUsd) || limitUsd <= 0) {
        return { exceeded: false, currentCostUsd: 0, limitUsd: 0 };
      }
      if (isBudgetOverrideActive(config.id)) {
        return { exceeded: false, currentCostUsd: 0, limitUsd };
      }
      const currentCostUsd = getAgentDailyCostUsd(userId, config.id);
      return {
        exceeded: currentCostUsd >= limitUsd - 1e-9,
        currentCostUsd,
        limitUsd,
      };
    },
    requestApproval: async (request) => {
      const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Build the approval message for Telegram
      const emoji = request.type === 'terminal'
        ? '🖥️'
        : request.type === 'code'
          ? '💻'
          : '⚠️';
      const typeLabel = request.type === 'terminal'
        ? 'Comando de terminal'
        : request.type === 'code'
          ? 'Ejecución de código'
          : (request.actionLabel || 'Acción crítica');
      let detail = '';
      if (request.type === 'terminal' && request.command) {
        detail = `\`\`\`\n${request.command.slice(0, 500)}\n\`\`\``;
      } else if (request.type === 'code' && request.code) {
        const langLabel = request.language || 'python';
        const codePreview = request.code.length > 800 ? request.code.slice(0, 800) + '\n... (código truncado)' : request.code;
        detail = `Lenguaje: *${langLabel}*\n\`\`\`${langLabel}\n${codePreview}\n\`\`\``;
      } else if (request.type === 'critical_action') {
        detail = String(request.actionDetails || '').trim() || 'Acción sensible solicitada por el agente.';
      }

      const message = [
        `${emoji} *${typeLabel} — Solicitud de aprobación*`,
        '',
        '🔒 _Verificación de seguridad: ✅ superada_',
        '',
        `📋 *Motivo:* ${request.reason}`,
        '',
        detail,
        '',
        '⚠️ *¿Autorizas esta acción?* Pulsa un botón para responder.',
      ].join('\n');

      const buttons = [
        [
          { text: '✅ Autorizar', callback_data: `approve:${approvalId}` },
          { text: '❌ Denegar', callback_data: `deny:${approvalId}` },
        ],
      ];

      return new Promise<boolean>((resolve) => {
        // Set a timeout (2 minutes) — if the user doesn't respond, deny by default
        const timeout = setTimeout(() => {
          pendingApprovals.delete(approvalId);
          console.log(`[Agent:${config.name}] Approval ${approvalId} timed out (2 min)`);
          resolve(false);
        }, 120000);

        pendingApprovals.set(approvalId, {
          type: request.type,
          command: request.command,
          code: request.code,
          language: request.language,
          reason: request.reason,
          actionLabel: request.actionLabel,
          actionDetails: request.actionDetails,
          resolve: (approved: boolean) => {
            clearTimeout(timeout);
            pendingApprovals.delete(approvalId);
            resolve(approved);
          },
          timeout,
        });

        // Send the approval request via Telegram with buttons
        if (telegram.sendMessageWithButtons) {
          telegram.sendMessageWithButtons(config.telegram.chatId, message, buttons).catch((err) => {
            console.error(`[Agent:${config.name}] Failed to send approval request:`, err);
            clearTimeout(timeout);
            pendingApprovals.delete(approvalId);
            resolve(false);
          });
        } else {
          // Fallback: send plain message (no buttons)
          telegram.sendMessage(config.telegram.chatId, message + '\n\nResponde "sí" o "no".').then(() => {
            // Without buttons, auto-deny after timeout
          }).catch((err) => {
            console.error(`[Agent:${config.name}] Failed to send approval request:`, err);
            clearTimeout(timeout);
            pendingApprovals.delete(approvalId);
            resolve(false);
          });
        }
      });
    },
    mcpManager,
  };

  // Process message queue
  async function processQueue(): Promise<void> {
    if (running.isProcessing || running.messageQueue.length === 0) return;

    running.isProcessing = true;
    const { text, source, channel, task } = running.messageQueue.shift()!;
    let telegramAlreadySentByTool = false;

    // ── Immediate visibility: add the inbound message to conversationHistory
    // right away so the web UI live chat can see it while the agent processes.
    const isUserSourceMessage = source === 'user';
    const nowTs = Date.now();
    if (text.trim()) {
      running.conversationHistory.push({
        role: isUserSourceMessage ? 'user' : 'system',
        content: text,
        timestamp: nowTs,
        ...(isUserSourceMessage && channel ? { source: channel } : {}),
      });
    }

    try {
      // ── Daily budget gate ───────────────────────────────────────────────
      // Before invoking the LLM, verify that the agent's daily budget has
      // not been exceeded. If it has (and no override is active), ask the
      // user via Telegram for permission to continue spending.
      const budgetLimit = Number(running.config.dailyBudgetUsd || 0);
      if (Number.isFinite(budgetLimit) && budgetLimit > 0 && !isBudgetOverrideActive(config.id)) {
        const currentCost = getAgentDailyCostUsd(userId, config.id);
        if (currentCost >= budgetLimit - 1e-9) {
          console.log(
            `[Agent:${config.name}] Daily budget exceeded ($${currentCost.toFixed(4)} / $${budgetLimit.toFixed(2)}). Requesting approval.`
          );
          const budgetApprovalId = `budget-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const budgetMessage = [
            '💰 *Presupuesto diario agotado*',
            '',
            `Tu agente *${config.name}* ha alcanzado su límite diario de gasto.`,
            '',
            `📊 *Gasto actual:* $${currentCost.toFixed(4)}`,
            `📋 *Límite diario:* $${budgetLimit.toFixed(2)}`,
            '',
            '¿Quieres autorizar gasto adicional para el resto del día?',
          ].join('\n');

          const budgetApproved = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
              pendingApprovals.delete(budgetApprovalId);
              console.log(`[Agent:${config.name}] Budget approval ${budgetApprovalId} timed out (2 min)`);
              resolve(false);
            }, 120000);

            pendingApprovals.set(budgetApprovalId, {
              type: 'terminal', // reuse the existing approval infrastructure
              reason: 'daily_budget_exceeded',
              resolve: (approved: boolean) => {
                clearTimeout(timeout);
                pendingApprovals.delete(budgetApprovalId);
                resolve(approved);
              },
              timeout,
            });

            const buttons = [
              [
                { text: '✅ Autorizar gasto', callback_data: `approve:${budgetApprovalId}` },
                { text: '❌ Detener', callback_data: `deny:${budgetApprovalId}` },
              ],
            ];

            if (telegram.sendMessageWithButtons) {
              telegram.sendMessageWithButtons(config.telegram.chatId, budgetMessage, buttons).catch((err) => {
                console.error(`[Agent:${config.name}] Failed to send budget approval request:`, err);
                clearTimeout(timeout);
                pendingApprovals.delete(budgetApprovalId);
                resolve(false);
              });
            } else {
              telegram.sendMessage(config.telegram.chatId, budgetMessage + '\n\nResponde "sí" o "no".').catch((err) => {
                console.error(`[Agent:${config.name}] Failed to send budget approval request:`, err);
                clearTimeout(timeout);
                pendingApprovals.delete(budgetApprovalId);
                resolve(false);
              });
            }
          });

          if (budgetApproved) {
            grantBudgetOverride(config.id);
            console.log(`[Agent:${config.name}] Budget override granted for today.`);
            await telegram.sendMessage(
              config.telegram.chatId,
              '✅ Presupuesto adicional autorizado. Continuando con tu mensaje...'
            ).catch(() => {});
          } else {
            console.log(`[Agent:${config.name}] Budget override denied. Skipping message.`);
            await telegram.sendMessage(
              config.telegram.chatId,
              '🚫 Gasto no autorizado. Tu mensaje no ha sido procesado. El agente seguirá activo y procesará mensajes mañana o cuando autorices gasto adicional.'
            ).catch(() => {});
            running.isProcessing = false;
            processQueue();
            return;
          }
        }
      }

      // Send typing indicator (non-blocking, Telegram-only)
      if (source === 'user' && channel === 'telegram') {
        sendTypingAction(config.telegram.botToken, config.telegram.chatId).catch(() => {});
      }

      console.log(`[Agent:${config.name}] Processing message (source: ${source}, channel: ${channel || 'n/a'}, queueRemaining: ${running.messageQueue.length})...`);
      const processingStart = Date.now();

      // Pass a copy of the full history to the engine. The engine will
      // truncate it internally (.slice(-maxHistoryMessages)) for the LLM
      // context window — but we keep the full history in
      // running.conversationHistory so the live chat never loses messages.
      // We pass history WITHOUT the message we just pushed (the engine adds
      // it again internally as userMessage).
      const historyForEngine = text.trim()
        ? running.conversationHistory.slice(0, -1)
        : [...running.conversationHistory];

      const { response } = await withTimeout(
        processAgentMessage(
          running.config,
          text,
          historyForEngine,
          toolContext,
          {
            onResponse: (resp) => {
              if (resp.trim()) {
                if (source === 'scheduler' || source === 'webhook') {
                  return;
                }
                // Only send via Telegram if this turn did not already send content
                // through explicit Telegram tools.
                if (!telegramAlreadySentByTool) {
                  const autoButtons = buildAutoTelegramButtons(resp);
                  if (autoButtons && telegram.sendMessageWithButtons) {
                    telegram.sendMessageWithButtons(config.telegram.chatId, resp, autoButtons).catch((err) => {
                      console.error(`[Agent:${config.name}] Failed to send response with buttons:`, err);
                      telegram.sendMessage(config.telegram.chatId, resp).catch((fallbackErr) => {
                        console.error(`[Agent:${config.name}] Failed to send fallback response:`, fallbackErr);
                      });
                    });
                  } else {
                    telegram.sendMessage(config.telegram.chatId, resp).catch(err => {
                      console.error(`[Agent:${config.name}] Failed to send response:`, err);
                    });
                  }
                }
              }
            },
            onToolCall: (toolName, params) => {
              if (toolName === 'send_telegram_message' || toolName === 'send_telegram_buttons') {
                telegramAlreadySentByTool = true;
              }
              // Redact sensitive fields from logged params to prevent credential leakage
              const safeParams = { ...params };
              for (const key of ['password', 'appSpecificPassword', 'clientSecret', 'refreshToken', 'botToken', 'access_token', 'secret', 'token', 'api_key']) {
                if (key in safeParams) safeParams[key] = '[REDACTED]';
              }
              console.log(`[Agent:${config.name}] Tool call: ${toolName}`, JSON.stringify(safeParams).slice(0, 100));
            },
            onToolResult: (result) => {
              console.log(`[Agent:${config.name}] Tool result: ${result.name} = ${result.success ? 'OK' : 'FAIL'}`);
            },
            onError: (error) => {
              console.error(`[Agent:${config.name}] Error:`, error);
              telegram.sendMessage(config.telegram.chatId, `⚠️ Error: ${error}`).catch(() => {});
            },
          },
          source
        ),
        AGENT_PROCESS_TIMEOUT_MS,
        'Agent message processing'
      );

      console.log(`[Agent:${config.name}] Message processed in ${Date.now() - processingStart}ms`);

      // ── Append assistant response to the full in-memory history ─────
      // We do NOT replace running.conversationHistory with the engine's
      // truncated updatedHistory — that caused older user/assistant
      // messages to be evicted when HA/webhook events flooded the window.
      if (response.trim()) {
        running.conversationHistory.push({
          role: 'assistant',
          content: response,
          timestamp: Date.now(),
        });
      }

      // ── Soft cap: keep in-memory history bounded ────────────────────
      // When trimming, always preserve user messages so they stay visible
      // in the live chat even when HA/webhook system events dominate.
      const MAX_MEMORY_HISTORY = 300;
      if (running.conversationHistory.length > MAX_MEMORY_HISTORY) {
        const recentSlice = running.conversationHistory.slice(
          running.conversationHistory.length - MAX_MEMORY_HISTORY
        );
        const recentTs = new Set(recentSlice.map((m) => m.timestamp));
        const missingUsers = running.conversationHistory
          .filter((m) => m.role === 'user' && !recentTs.has(m.timestamp));
        if (missingUsers.length > 0) {
          running.conversationHistory = [...missingUsers, ...recentSlice];
          running.conversationHistory.sort((a, b) => a.timestamp - b.timestamp);
        } else {
          running.conversationHistory = recentSlice;
        }
      }

      if (text.trim()) {
        agentStorage.appendConversationMessage(userId, config.id, {
          role: (source === 'scheduler' || source === 'webhook') ? 'system' : 'user',
          content: text,
          timestamp: Date.now(),
        });
        running.persistedConversationCount += 1;
      }
      if (response.trim()) {
        agentStorage.appendConversationMessage(userId, config.id, {
          role: 'assistant',
          content: response,
          timestamp: Date.now(),
        });
        running.persistedConversationCount += 1;
      }

      if (source === 'scheduler' && task) {
        const confirmation = buildScheduledTaskConfirmation(task, response);
        telegram.sendMessage(config.telegram.chatId, confirmation).catch(() => {});
        agentStorage.recordScheduleExecution(userId, config.id, task.id, {
          status: 'success',
          result: response,
          executedAt: Date.now(),
        });
      }
    } catch (error: any) {
      console.error(`[Agent:${config.name}] Processing error:`, error.message);

      // The inbound message was already pushed to conversationHistory above.
      // We only need to persist it and add the error assistant message.
      if (text.trim()) {
        agentStorage.appendConversationMessage(userId, config.id, {
          role: (source === 'scheduler' || source === 'webhook') ? 'system' : 'user',
          content: text,
          timestamp: Date.now(),
        });
        running.persistedConversationCount += 1;
      }
      const errorMsg = `⚠️ Error procesando mensaje: ${error.message}`;
      running.conversationHistory.push({
        role: 'assistant',
        content: errorMsg,
        timestamp: Date.now(),
      });
      agentStorage.appendConversationMessage(userId, config.id, {
        role: 'assistant',
        content: errorMsg,
        timestamp: Date.now(),
      });
      running.persistedConversationCount += 1;
      telegram.sendMessage(config.telegram.chatId, errorMsg).catch(() => {});
      if (source === 'scheduler' && task) {
        agentStorage.recordScheduleExecution(userId, config.id, task.id, {
          status: 'error',
          result: error.message,
          executedAt: Date.now(),
        });
        telegram.sendMessage(
          config.telegram.chatId,
          `❌ Tarea programada "${task.name}" finalizó con error.\nEstado final: error\nDetalle: ${error.message}`
        ).catch(() => {});
      }
    } finally {
      running.isProcessing = false;
      // Process next message in queue
      if (running.messageQueue.length > 0) {
        const next = running.messageQueue[0];
        const nextDelay = resolveQueueDelayMs(running, next?.source || 'scheduler');
        setTimeout(() => processQueue(), nextDelay);
      }
    }
  }

  // Expose processQueue for external callers (webhooks)
  running.triggerProcessQueue = () => processQueue();

  // Handle incoming Telegram messages
  telegram.onMessage(async (_chatId, text, fromUser, file, _location) => {
    console.log(`[Agent:${config.name}] Received from ${fromUser}: ${text.slice(0, 80)}`);

    let finalText = text;

    // Auto-transcribe voice/audio messages before passing to the engine
    if (file && (file.type === 'voice' || file.type === 'audio')) {
      try {
        console.log(`[Agent:${config.name}] Auto-transcribing ${file.type} message...`);
        await sendTypingAction(config.telegram.botToken, config.telegram.chatId);
        const downloaded = await telegram.downloadFile(file.file_id);
        if (downloaded) {
          const transcription = await transcribeAudio(downloaded.data, downloaded.mimeType, downloaded.fileName);
          if (transcription.text.trim()) {
            // Replace or augment the file description with the actual transcription
            const durationStr = transcription.duration ? `${Math.round(transcription.duration)}s` : (file.duration ? `${file.duration}s` : '?');
            const transcriptionBlock = `[🎤 Mensaje de voz transcrito (duración: ${durationStr}, idioma: ${transcription.language || 'auto'})]\nTranscripción: "${transcription.text.trim()}"`;
            // Remove the original file description placeholder and replace with transcription
            finalText = finalText
              .replace(/\[🎤 Nota de voz adjunta[^\]]*\]/g, '')
              .replace(/\[🎵 Audio adjunto[^\]]*\]/g, '')
              .trim();
            finalText = finalText ? `${finalText}\n${transcriptionBlock}` : transcriptionBlock;
            console.log(`[Agent:${config.name}] Transcription complete (${transcription.provider}): ${transcription.text.slice(0, 80)}...`);

            // Record resource event
            toolContext.recordResourceEvent?.({
              type: 'agent_audio_transcription',
              metadata: {
                provider: transcription.provider,
                duration: transcription.duration,
                language: transcription.language,
                autoTranscribed: true,
              },
            });
          } else {
            console.warn(`[Agent:${config.name}] Transcription returned empty text`);
          }
        }
      } catch (error: any) {
        console.error(`[Agent:${config.name}] Auto-transcription failed:`, error.message);
        // Keep the original text with file description — the agent can still try using the tool manually
      }
    }

    enqueueUserMessage(running, finalText, 'telegram');

    // ── Keyword-triggered event subscriptions ─────────────────────────
    // Check if the message matches any keyword event subscriptions
    const keywordEvent: eventSubs.EventPayload = {
      eventType: 'user_message',
      source: 'telegram',
      data: { message: finalText, from: fromUser },
      timestamp: Date.now(),
    };
    const matchedSubs = eventSubs.matchSubscriptions(userId, config.id, keywordEvent)
      .filter((sub) => sub.type === 'keyword' && sub.keyword && finalText.toLowerCase().includes(sub.keyword.toLowerCase()));

    for (const sub of matchedSubs) {
      console.log(`[Agent:${config.name}] Keyword subscription "${sub.name}" triggered by message`);
      eventSubs.recordSubscriptionFiring(userId, config.id, sub.id);
      const instruction = eventSubs.buildEventSubscriptionInstruction(sub, keywordEvent);
      running.messageQueue.push({ text: instruction, source: 'webhook' });
    }

    processQueue();
  });

  // Handle Telegram callback queries (button presses)
  telegram.onCallbackQuery((_chatId, data, _queryId, fromUser, originalMessage) => {
    console.log(`[Agent:${config.name}] Button pressed by ${fromUser}: ${data}`);

    // Handle terminal/code approval responses
    if (data.startsWith('approve:') || data.startsWith('deny:')) {
      const approvalId = data.replace(/^(approve|deny):/, '');
      const pending = pendingApprovals.get(approvalId);
      if (pending) {
        const approved = data.startsWith('approve:');
        console.log(`[Agent:${config.name}] Approval ${approvalId}: ${approved ? 'APPROVED' : 'DENIED'} by ${fromUser}`);
        pending.resolve(approved);
        const approvalReply = approved ? '✅ Autorizar' : '❌ Denegar';
        recordQuickReplyInConversation(running, userId, approvalReply, 'telegram');
        const statusMsg = approved
          ? '✅ Acción autorizada. Ejecutando...'
          : '❌ Acción denegada por el usuario.';
        telegram.sendMessage(config.telegram.chatId, statusMsg).catch(() => {});
        return;
      }
    }

    const replyText = parseQuickReplyCallbackData(data) || data;
    const acknowledged = truncateButtonLabel(replyText || data, 60) || 'opción';
    telegram.sendMessage(config.telegram.chatId, `✅ Confirmado: ${acknowledged}`).catch(() => {});
    enqueueUserMessage(running, replyText, 'telegram');
    processQueue();
  });

  // Handle scheduled tasks
  scheduler.onTaskTrigger((task) => {
    console.log(`[Agent:${config.name}] Scheduled task triggered: "${task.name}"`);
    toolContext.recordResourceEvent?.({
      type: 'agent_scheduler_trigger',
      metadata: { taskId: task.id, taskName: task.name },
    });

    // ── One-shot reminders: send directly to Telegram immediately ──
    // Don't rely on the LLM to call send_telegram_message — send it now.
    if (task.oneShot && task.instruction) {
      const reminderMessage = extractReminderMessage(task.instruction);
      if (reminderMessage) {
        const directMessage = `⏰ *Recordatorio*\n\n${reminderMessage}`;
        telegram.sendMessage(config.telegram.chatId, directMessage).catch((err) => {
          console.error(`[Agent:${config.name}] Failed to send reminder directly:`, err);
        });
        console.log(`[Agent:${config.name}] Reminder sent directly to Telegram: "${task.name}"`);
        // Record execution and skip LLM processing for simple reminders
        agentStorage.recordScheduleExecution(userId, config.id, task.id, {
          status: 'success',
          result: directMessage,
          executedAt: Date.now(),
        });
        return;
      }
    }

    running.messageQueue.push({
      text: buildScheduledTaskInstruction(task),
      source: 'scheduler',
      task,
    });
    processQueue();
  });

  // Add configured schedules
  for (const schedule of config.schedules) {
    const runtimeSchedule = parseConfiguredSchedule(schedule.schedule);
    scheduler.addTask({
      id: schedule.id,
      name: schedule.name,
      cron: runtimeSchedule.cron,
      instruction: schedule.name,
      enabled: schedule.enabled !== false,
      timezone: config.timezone,
      oneShot: runtimeSchedule.oneShot,
      triggerAt: runtimeSchedule.triggerAt,
    });
  }

  // Load persisted dynamic schedules from storage
  const persistedSchedules = agentStorage.getAllSchedules(userId, config.id);
  for (const ps of persistedSchedules) {
    const task: ScheduledTask = {
      id: ps.id,
      name: ps.name,
      cron: ps.cron,
      instruction: ps.instruction,
      enabled: ps.enabled !== false,
      startAt: ps.startAt,
      frequency: ps.frequency,
      conditions: ps.conditions,
      timezone: ps.timezone || config.timezone,
      lastRun: ps.lastRunAt,
      oneShot: ps.oneShot,
      triggerAt: ps.triggerAt,
    };
    running.dynamicSchedules.push(task);
    scheduler.addTask(task);
  }
  if (persistedSchedules.length > 0) {
    console.log(`[Agent:${config.name}] Loaded ${persistedSchedules.length} persisted schedules`);
  }

  // Handle one-shot task auto-disable: persist the disabled state
  scheduler.onOneShotFired = (task: ScheduledTask) => {
    console.log(`[Agent:${config.name}] One-shot task "${task.name}" fired, persisting disabled state`);
    agentStorage.updateSchedule(userId, config.id, task.id, { enabled: false });
  };

  // Start everything
  telegram.start();
  scheduler.start();

  // ── Proactive media queue monitor (Sonarr/Radarr) ───────────────────
  if (config.media?.sonarr || config.media?.radarr) {
    runMediaQueueMonitor(running).catch(() => {});
    running.mediaMonitorInterval = setInterval(() => {
      runMediaQueueMonitor(running).catch(() => {});
    }, 45_000);
  }

  // ── Poll Ticker for event subscriptions ─────────────────────────────
  // Every 60 seconds, check if any poll-type event subscriptions are due
  running.pollTickerInterval = setInterval(() => {
    try {
      const dueSubs = eventSubs.getDuePollSubscriptions(userId, config.id);
      for (const sub of dueSubs) {
        console.log(`[Agent:${config.name}] Poll subscription "${sub.name}" is due, enqueuing...`);
        eventSubs.recordSubscriptionFiring(userId, config.id, sub.id);
        const instruction = eventSubs.buildPollInstruction(sub);
        running.messageQueue.push({ text: instruction, source: 'webhook' });
      }
      if (dueSubs.length > 0 && running.triggerProcessQueue) {
        running.triggerProcessQueue();
      }
    } catch (err: any) {
      console.error(`[Agent:${config.name}] Poll ticker error:`, err.message);
    }
  }, 60_000);

  runningAgents.set(config.id, running);

  // ── Register with Event Router ──────────────────────────────────────
  const eventSources: RealtimeEventSource[] = ['webhook', 'system'];
  if (config.homeAssistant?.url && config.homeAssistant?.token) {
    eventSources.push('home_assistant');
  }
  if (config.gmail?.clientId && config.gmail?.refreshToken) {
    eventSources.push('gmail');
  }
  const eventRouter = getEventRouter();
  eventRouter.registerAgent(config.id, userId, eventSources);

  // Wire up event router → agent message queue
  eventRouter.onEvent((agentId, _userId, _event, instruction) => {
    const agent = runningAgents.get(agentId);
    if (!agent) return;
    agent.messageQueue.push({ text: instruction, source: 'webhook' });
    if (agent.triggerProcessQueue) {
      agent.triggerProcessQueue();
    }
  });

  // ── Home Assistant WebSocket (real-time state changes) ──────────────
  if (config.homeAssistant?.url && config.homeAssistant?.token && config.realtimeEvents?.haWebSocket !== false) {
    const haWs = new HomeAssistantWebSocket(config.homeAssistant, {
      entityFilters: config.realtimeEvents?.haEntityFilters || [],
      debounceMs: config.realtimeEvents?.haDebounceMs ?? 2500,
      autoReconnect: true,
    });

    haWs.onStateChanged((event: HAStateChangedEvent) => {
      const priority = detectEventPriority('home_assistant', 'state_changed', {
        entity_id: event.entityId,
        new_state: event.newState,
        old_state: event.oldState,
      });

      // Route through the event router for subscription matching
      const rtEvent: RealtimeEvent = {
        id: generateEventId('ha-ws'),
        source: 'home_assistant',
        eventType: 'state_changed',
        targetAgentIds: [config.id],
        data: {
          entity_id: event.entityId,
          old_state: event.oldState,
          new_state: event.newState,
          changed_attributes: event.changedAttributes,
        },
        timestamp: Date.now(),
        priority,
      };

      const routeResult = eventRouter.dispatch(rtEvent);

      // If no subscription matched but priority is high/critical, still deliver
      if (routeResult.matchedSubscriptions === 0 && (priority === 'high' || priority === 'critical')) {
        const instruction = buildHAStateChangeInstruction(event);
        running.messageQueue.push({ text: instruction, source: 'webhook' });
        if (running.triggerProcessQueue) {
          running.triggerProcessQueue();
        }
        console.log(`[Agent:${config.name}] HA critical event auto-forwarded: ${event.entityId} (${priority})`);
      }
    });

    haWs.on('connected', (info: { version: string }) => {
      console.log(`[Agent:${config.name}] HA WebSocket connected (HA ${info.version})`);
    });
    haWs.on('disconnected', () => {
      console.log(`[Agent:${config.name}] HA WebSocket disconnected (will auto-reconnect)`);
    });
    haWs.on('reconnect_failed', () => {
      console.error(`[Agent:${config.name}] HA WebSocket failed to reconnect after max attempts`);
    });

    // Connect in background
    haWs.connect().catch((err) => {
      console.error(`[Agent:${config.name}] HA WebSocket connection failed:`, err.message);
    });

    running.haWebSocket = haWs;
  }

  // ── Gmail Push Notifications (real-time new emails) ─────────────────
  if (config.gmail?.clientId && config.gmail?.refreshToken && config.webhooks?.enabled) {
    const gmailPushTopic = process.env.GMAIL_PUBSUB_TOPIC;
    if (gmailPushTopic) {
      const pushConfig: GmailPushConfig = {
        topicName: gmailPushTopic,
        labelIds: ['INBOX'],
      };

      gmailWatch(config.id, config.gmail, pushConfig)
        .then((result) => {
          running.gmailPushActive = true;
          console.log(`[Agent:${config.name}] Gmail push notifications active (expires: ${new Date(parseInt(result.expiration)).toISOString()})`);
        })
        .catch((err) => {
          console.warn(`[Agent:${config.name}] Gmail push setup failed (falling back to polling):`, err.message);
        });
    }
  }

  // Connect MCP servers in the background (non-blocking)
  if (config.mcpServers && config.mcpServers.length > 0) {
    const enabledMcp = config.mcpServers.filter((s) => s.enabled);
    if (enabledMcp.length > 0) {
      const registry = getMCPRegistry();
      mcpManager.connectAll(enabledMcp, registry)
        .then(({ connected, failed }) => {
          if (connected.length > 0) {
            console.log(`[Agent:${config.name}] MCP servers connected: ${connected.join(', ')}`);
          }
          if (failed.length > 0) {
            console.warn(`[Agent:${config.name}] MCP servers failed: ${failed.map((f) => `${f.id}: ${f.error}`).join('; ')}`);
          }
        })
        .catch((err: any) => {
          console.error(`[Agent:${config.name}] MCP connection error:`, err.message);
        });
    }
  }

  console.log(`[Agent:${config.name}] Deployed successfully (provider: ${config.provider}, model: ${config.model})`);

  return { success: true };
}

// ---------------------------------------------------------------------------
// Stop an agent
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enqueue a webhook event into a running agent's message queue
// ---------------------------------------------------------------------------

export function enqueueWebhookEvent(
  agentId: string,
  payload: IncomingWebhookPayload
): { success: boolean; error?: string } {
  const running = runningAgents.get(agentId);
  if (!running) {
    return { success: false, error: 'Agent not running' };
  }

  // Check if webhooks are enabled for this agent
  if (!running.config.webhooks?.enabled) {
    return { success: false, error: 'Webhooks not enabled for this agent' };
  }

  // Check if this source is allowed
  const allowedSources = running.config.webhooks.allowedSources || [];
  if (allowedSources.length > 0 && !allowedSources.includes(payload.source)) {
    return { success: false, error: `Source "${payload.source}" is not in the allowed list` };
  }

  const instruction = buildWebhookInstruction(payload);
  console.log(`[Agent:${running.config.name}] Webhook event enqueued: ${payload.source}${payload.eventType ? `/${payload.eventType}` : ''}`);

  running.messageQueue.push({ text: instruction, source: 'webhook' });

  // ── Event subscription matching for webhook events ──────────────────
  const webhookEventPayload: eventSubs.EventPayload = {
    eventType: `${payload.source}${payload.eventType ? `:${payload.eventType}` : ''}`,
    source: payload.source,
    data: payload.data,
    timestamp: Date.now(),
  };

  const matchedSubs = eventSubs.matchSubscriptions(running.userId, agentId, webhookEventPayload);
  for (const sub of matchedSubs) {
    console.log(`[Agent:${running.config.name}] Event subscription "${sub.name}" triggered by webhook ${payload.source}`);
    eventSubs.recordSubscriptionFiring(running.userId, agentId, sub.id);
    const subInstruction = eventSubs.buildEventSubscriptionInstruction(sub, webhookEventPayload);
    running.messageQueue.push({ text: subInstruction, source: 'webhook' });
  }

  // Also check skill-based triggers
  const triggeredSkills = findSkillsByEvent(running.userId, agentId, `webhook:${webhookEventPayload.eventType}`);
  for (const skill of triggeredSkills) {
    console.log(`[Agent:${running.config.name}] Skill "${skill.name}" triggered by webhook event`);
  }

  // Trigger queue processing
  if (running.triggerProcessQueue) {
    running.triggerProcessQueue();
  }

  return { success: true };
}

// ---------------------------------------------------------------------------
// Enqueue a real-time event (from HA WebSocket, Gmail push, etc.)
// Unlike webhook events, these bypass webhook source filtering since they
// come from integrated real-time listeners, not external HTTP calls.
// ---------------------------------------------------------------------------

export interface RealtimeEventPayload {
  source: string;
  eventType: string;
  instruction: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  data?: Record<string, any>;
}

export function enqueueRealtimeEvent(
  agentId: string,
  payload: RealtimeEventPayload
): { success: boolean; error?: string } {
  const running = runningAgents.get(agentId);
  if (!running) {
    return { success: false, error: 'Agent not running' };
  }

  console.log(
    `[Agent:${running.config.name}] Real-time event enqueued: ${payload.source}/${payload.eventType} (priority: ${payload.priority})`
  );

  running.messageQueue.push({ text: payload.instruction, source: 'webhook' });

  // Trigger queue processing immediately
  if (running.triggerProcessQueue) {
    running.triggerProcessQueue();
  }

  return { success: true };
}

/**
 * Get the webhook config (including secret) for a running agent.
 * Used by routes to validate signatures.
 */
export function getAgentWebhookConfig(agentId: string): {
  running: boolean;
  webhooks?: {
    enabled: boolean;
    secret: string;
    allowedSources: string[];
  };
} {
  const running = runningAgents.get(agentId);
  if (!running) {
    return { running: false };
  }
  return {
    running: true,
    webhooks: running.config.webhooks,
  };
}

export function stopAgent(agentId: string): boolean {
  const running = runningAgents.get(agentId);
  if (!running) return false;

  running.telegram.sendMessage(
    running.config.telegram.chatId,
    '🔴 Agente desconectado.'
  ).catch(() => {});

  running.telegram.stop();
  running.scheduler.stop();
  running.mcpManager.disconnectAll();
  if (running.pollTickerInterval) {
    clearInterval(running.pollTickerInterval);
  }

  // ── Clean up real-time connections ──────────────────────────────────
  if (running.haWebSocket) {
    running.haWebSocket.disconnect();
    console.log(`[Agent:${running.config.name}] HA WebSocket disconnected`);
  }
  if (running.gmailPushActive) {
    gmailStopWatch(agentId);
    console.log(`[Agent:${running.config.name}] Gmail push notifications stopped`);
  }
  if (running.mediaMonitorInterval) {
    clearInterval(running.mediaMonitorInterval);
  }
  getEventRouter().unregisterAgent(agentId);

  runningAgents.delete(agentId);

  console.log(`[Agent:${running.config.name}] Stopped`);
  return true;
}

// ---------------------------------------------------------------------------
// Get agent status
// ---------------------------------------------------------------------------

export function getAgentStatus(agentId: string): {
  running: boolean;
  isProcessing: boolean;
  queueLength: number;
  historyLength: number;
  dynamicSchedules: number;
  memorySize: number;
  mcpServers: number;
  mcpTools: number;
  realtimeConnections: {
    haWebSocket: boolean;
    gmailPush: boolean;
  };
} {
  const running = runningAgents.get(agentId);
  if (!running) {
    return { running: false, isProcessing: false, queueLength: 0, historyLength: 0, dynamicSchedules: 0, memorySize: 0, mcpServers: 0, mcpTools: 0, realtimeConnections: { haWebSocket: false, gmailPush: false } };
  }
  return {
    running: true,
    isProcessing: running.isProcessing,
    queueLength: running.messageQueue.length,
    historyLength: running.conversationHistory.length,
    dynamicSchedules: running.dynamicSchedules.length,
    memorySize: running.config.memory.length + running.persistedConversationCount,
    mcpServers: running.mcpManager.connectedServers.length,
    mcpTools: running.mcpManager.allTools.length,
    realtimeConnections: {
      haWebSocket: running.haWebSocket?.isConnected || false,
      gmailPush: running.gmailPushActive || false,
    },
  };
}

// ---------------------------------------------------------------------------
// List all running agents
// ---------------------------------------------------------------------------

export function getRunningAgentIds(): string[] {
  return Array.from(runningAgents.keys());
}

// ---------------------------------------------------------------------------
// Get agent conversation history (for live chat in the web UI)
// ---------------------------------------------------------------------------

export function getAgentConversationHistory(
  agentId: string,
): Array<{ role: string; content: string; timestamp: number; source?: 'telegram' | 'web' }> {
  const running = runningAgents.get(agentId);
  if (!running) return [];

  // Main history: user + assistant messages
  const result: Array<{ role: string; content: string; timestamp: number; source?: 'telegram' | 'web' }> =
    running.conversationHistory
      .filter((msg) => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        ...(msg.source ? { source: msg.source } : {}),
      }));

  // Also include user messages waiting in the queue (not yet being processed)
  // so they appear in the live chat instantly.
  for (const queued of running.messageQueue) {
    if (queued.source === 'user' && queued.text.trim()) {
      result.push({
        role: 'user',
        content: queued.text,
        timestamp: Date.now(),
        ...(queued.channel ? { source: queued.channel } : {}),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Send a message to a running agent from the web UI (like Telegram)
// ---------------------------------------------------------------------------

export function sendAgentWebMessage(
  agentId: string,
  text: string,
): { success: boolean; error?: string } {
  const running = runningAgents.get(agentId);
  if (!running) {
    return { success: false, error: 'Agent not running' };
  }
  if (!text.trim()) {
    return { success: false, error: 'Empty message' };
  }
  console.log(`[Agent:${running.config.name}] Web UI message: ${text.slice(0, 80)}`);
  enqueueUserMessage(running, text.trim(), 'web');
  if (running.triggerProcessQueue) {
    running.triggerProcessQueue();
  }
  return { success: true };
}

// ---------------------------------------------------------------------------
// Update daily budget for a running agent
// ---------------------------------------------------------------------------

export function updateAgentBudget(
  agentId: string,
  userId: string,
  dailyBudgetUsd: number
): { success: boolean; error?: string } {
  const running = getRunningAgentForUser(agentId, userId);
  if (!running) {
    return { success: false, error: 'Agent not running or not owned by user' };
  }
  running.config.dailyBudgetUsd = Math.max(0, dailyBudgetUsd);
  // Clear any existing override when the budget is changed
  budgetOverrides.delete(agentId);
  console.log(`[Agent:${running.config.name}] Daily budget updated to $${running.config.dailyBudgetUsd.toFixed(2)}`);
  return { success: true };
}

export function updateAgentRuntimeConfig(
  agentId: string,
  userId: string,
  patch: {
    provider?: Provider;
    model?: string;
    runtimeTuning?: AgentConfig['runtimeTuning'];
  }
): { success: boolean; error?: string; updated?: { provider: Provider; model: string } } {
  const running = getRunningAgentForUser(agentId, userId);
  if (!running) {
    return { success: false, error: 'Agent not running or not owned by user' };
  }

  const nextProvider = (patch.provider || running.config.provider) as Provider;
  const nextModel = String(patch.model || running.config.model || '').trim();
  if (!nextModel) {
    return { success: false, error: 'Model is required' };
  }

  running.config.provider = nextProvider;
  running.config.model = nextModel;
  if (patch.runtimeTuning && typeof patch.runtimeTuning === 'object') {
    running.config.runtimeTuning = {
      ...(running.config.runtimeTuning || {}),
      ...patch.runtimeTuning,
    };
  }

  console.log(`[Agent:${running.config.name}] Runtime model updated to ${running.config.provider}/${running.config.model}`);
  return {
    success: true,
    updated: {
      provider: running.config.provider,
      model: running.config.model,
    },
  };
}

export function upsertAgentRuntimeSchedule(
  agentId: string,
  userId: string,
  schedule: agentStorage.PersistedSchedule
): boolean {
  const running = getRunningAgentForUser(agentId, userId);
  if (!running) return false;

  const task: ScheduledTask = {
    id: schedule.id,
    name: schedule.name,
    cron: schedule.cron,
    instruction: schedule.instruction,
    enabled: schedule.enabled !== false,
    startAt: schedule.startAt,
    frequency: schedule.frequency,
    conditions: schedule.conditions,
    timezone: schedule.timezone || running.config.timezone,
    lastRun: schedule.lastRunAt,
    oneShot: schedule.oneShot,
    triggerAt: schedule.triggerAt,
  };

  running.dynamicSchedules = running.dynamicSchedules.filter((item) => item.id !== schedule.id);
  running.dynamicSchedules.push(task);
  running.scheduler.addTask(task);
  return true;
}

export function removeAgentRuntimeSchedule(agentId: string, userId: string, scheduleId: string): boolean {
  const running = getRunningAgentForUser(agentId, userId);
  if (!running) return false;
  const before = running.dynamicSchedules.length;
  running.dynamicSchedules = running.dynamicSchedules.filter((item) => item.id !== scheduleId);
  running.scheduler.removeTask(scheduleId);
  return running.dynamicSchedules.length < before;
}

export function resetAgentRuntimeMemory(agentId: string, userId: string): {
  running: boolean;
  clearedRuntimeMessages: number;
  clearedConfigMemories: number;
} {
  const running = getRunningAgentForUser(agentId, userId);
  if (!running) {
    return {
      running: false,
      clearedRuntimeMessages: 0,
      clearedConfigMemories: 0,
    };
  }

  const clearedRuntimeMessages = running.conversationHistory.length;
  const clearedConfigMemories = running.config.memory.length;
  running.conversationHistory = [];
  running.persistedConversationCount = 0;
  running.config.memory = [];

  return {
    running: true,
    clearedRuntimeMessages,
    clearedConfigMemories,
  };
}

// ---------------------------------------------------------------------------
// MCP status and tools for a running agent
// ---------------------------------------------------------------------------

export function getAgentMCPStatus(agentId: string, userId: string): {
  running: boolean;
  servers: Array<{ id: string; connected: boolean; toolCount: number; serverInfo: any }>;
  tools: Array<{ qualifiedName: string; originalName: string; serverId: string; description: string }>;
} {
  const running = getRunningAgentForUser(agentId, userId);
  if (!running) {
    return { running: false, servers: [], tools: [] };
  }
  return {
    running: true,
    servers: running.mcpManager.getStatus(),
    tools: running.mcpManager.allTools.map((t) => ({
      qualifiedName: t.qualifiedName,
      originalName: t.originalName,
      serverId: t.serverId,
      description: t.description,
    })),
  };
}

export async function testMCPServer(
  serverId: string,
  config: Record<string, string>
): Promise<{
  success: boolean;
  serverName?: string;
  serverVersion?: string;
  toolCount?: number;
  tools?: Array<{ name: string; description: string }>;
  error?: string;
}> {
  const { MCPClientConnection, getMCPRegistry } = await import('./mcpClient');
  const registry = getMCPRegistry();

  if (!registry.has(serverId)) {
    return { success: false, error: `Unknown MCP server: "${serverId}"` };
  }

  let connection: InstanceType<typeof MCPClientConnection> | null = null;
  try {
    const { command, args, env, connectTimeoutMs } = registry.buildCommand(serverId, config);
    connection = new MCPClientConnection(serverId, command, args, env, connectTimeoutMs);
    await connection.connect();

    const tools = connection.tools;
    const serverInfo = connection.serverInfo;

    connection.disconnect();

    return {
      success: true,
      serverName: serverInfo?.name,
      serverVersion: serverInfo?.version,
      toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.originalName, description: t.description })),
    };
  } catch (err: any) {
    if (connection) {
      try { connection.disconnect(); } catch { /* ignore */ }
    }
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------  
// Stop all agents (for server shutdown)
// ---------------------------------------------------------------------------

export function stopAllAgents(): void {
  for (const agentId of runningAgents.keys()) {
    stopAgent(agentId);
  }
}

// ---------------------------------------------------------------------------
// Send typing action
// ---------------------------------------------------------------------------

async function sendTypingAction(botToken: string, chatId: string): Promise<void> {
  try {
    await fetch(`${getTelegramBotBaseUrl(botToken)}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Ignore typing indicator errors
  }
}
