// ---------------------------------------------------------------------------
// Agent API Routes
// ---------------------------------------------------------------------------

import { Router, Request, Response } from 'express';
import {
  deployAgent,
  stopAgent,
  getAgentStatus,
  getRunningAgentIds,
  upsertAgentRuntimeSchedule,
  removeAgentRuntimeSchedule,
  resetAgentRuntimeMemory,
  getAgentMCPStatus,
  testMCPServer,
  updateAgentBudget,
  updateAgentRuntimeConfig,
  getAgentConversationHistory,
  sendAgentWebMessage,
} from '../agents/manager';
import { AgentConfig } from '../agents/types';
import { Provider } from '../types';
import * as agentStorage from '../agents/storage';
import { getTelegramBotBaseUrl } from '../agents/telegram';
import { getAgentCostSummary, getAgentDailyCostUsd } from '../auth/usage';
import { getMCPRegistry } from '../agents/mcpClient';
import { buildGoogleAuthUrl, exchangeGoogleAuthCode } from '../agents/calendarGoogle';
import { buildGmailAuthUrl, exchangeGmailAuthCode, GmailConfig } from '../agents/gmail';
import { CalendarConfig } from '../agents/calendar';
import { MediaConfig } from '../agents/types';
import { HomeAssistantConfig } from '../agents/homeAssistant';
import { safeErrorMessage } from '../security/redact';
import { readRecentAuditLogs } from '../security/terminalSecurity';

export const agentsRouter = Router();

const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
};

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(min, Math.min(max, numeric));
};

const clampOptionalInteger = (value: unknown, min: number, max: number): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const numeric = Math.floor(value);
  return Math.max(min, Math.min(max, numeric));
};

const parseTags = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
};

const parseListItems = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const parseOptionalText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
};

const SUPPORTED_TIMEZONES = (() => {
  try {
    return new Set(Intl.supportedValuesOf('timeZone'));
  } catch {
    return new Set<string>();
  }
})();

const parseOptionalTimezone = (value: unknown): string | undefined => {
  const candidate = parseOptionalText(value);
  if (!candidate) return undefined;
  if (SUPPORTED_TIMEZONES.size === 0) return candidate;
  return SUPPORTED_TIMEZONES.has(candidate) ? candidate : undefined;
};

const parseScheduleStartAt = (value: unknown): { parsed?: number; invalid: boolean } => {
  if (value === null || value === undefined || value === '') return { parsed: undefined, invalid: false };
  if (typeof value === 'number' && Number.isFinite(value)) return { parsed: value, invalid: false };
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return { parsed, invalid: false };
  }
  return { parsed: undefined, invalid: true };
};

const hasOwn = (value: unknown, key: string): boolean =>
  Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));

// ---------------------------------------------------------------------------
// Build AgentConfig from frontend payload (reusable for deploy + always-on)
// ---------------------------------------------------------------------------

export function buildAgentConfigFromPayload(body: any): AgentConfig | null {
  if (!body || !body.id) return null;

  return {
    id: String(body.id),
    name: String(body.name || 'Agent'),
    objective: String(body.objective || ''),
    systemPrompt: String(body.systemPrompt || ''),
    provider: String(body.setupProvider || body.provider || 'openai').trim() as Provider,
    model: String(body.setupModel || body.model || '').trim(),
    permissions: {
      internetAccess: body.permissions?.internetAccess !== false,
      headlessBrowser: body.permissions?.headlessBrowser !== false,
      notesAccess: body.permissions?.notesAccess !== false,
      schedulerAccess: body.permissions?.schedulerAccess !== false,
      calendarAccess: body.permissions?.calendarAccess !== false,
      gmailAccess: body.permissions?.gmailAccess !== false,
      mediaAccess: body.permissions?.mediaAccess !== false,
      terminalAccess: body.permissions?.terminalAccess === true,
      codeExecution: body.permissions?.codeExecution === true,
      allowedWebsites: Array.isArray(body.permissions?.allowedWebsites) ? body.permissions.allowedWebsites : [],
      requireApprovalForNewSites: body.permissions?.requireApprovalForNewSites !== false,
      webCredentials: Array.isArray(body.permissions?.webCredentials)
        ? body.permissions.webCredentials.map((c: any) => ({
            site: String(c.site || ''),
            username: String(c.username || ''),
            password: String(c.password || ''),
          }))
        : [],
    },
    telegram: {
      botToken: String(body.integrations?.telegram?.botToken || body.telegram?.botToken || '').trim(),
      chatId: String(body.integrations?.telegram?.chatId || body.telegram?.chatId || '').trim(),
    },
    schedules: Array.isArray(body.schedules)
      ? body.schedules.map((s: any) => ({
          id: String(s.id || `s-${Date.now()}`),
          name: String(s.name || ''),
          schedule: String(s.schedule || ''),
          enabled: s.enabled !== false,
        }))
      : [],
    mcpServers: Array.isArray(body.integrations?.mcpServers)
      ? body.integrations.mcpServers.map((s: any) => ({
          id: String(s.id || ''),
          enabled: s.enabled !== false,
          config: s.config || {},
        }))
      : [],
    calendar: parseCalendarConfig(body.integrations?.calendar || body.calendar),
    gmail: parseGmailConfig(body.integrations?.gmail || body.gmail),
    media: parseMediaConfig(body.integrations?.media || body.media),
    homeAssistant: parseHomeAssistantConfig(body.integrations?.homeAssistant || body.homeAssistant),
    memory: Array.isArray(body.trainingMemory)
      ? body.trainingMemory
          .filter((item: unknown): item is string => typeof item === 'string')
          .map((item: string) => item.trim())
          .filter(Boolean)
      : [],
    temperature: clampNumber(body.setupTemperature, 0.3, 0, 2),
    maxTokens: clampInteger(body.setupMaxTokens, 2048, 128, 8192),
    memoryRecentWindow: clampInteger(body.memoryRecentWindow, 30, 8, 120),
    memoryRecallLimit: clampInteger(body.memoryRecallLimit, 8, 0, 20),
    enableSmartRAG: body.enableSmartRAG !== false,
    dailyBudgetUsd: clampNumber(body.dailyBudgetUsd, 0, 0, 10000),
    timezone: parseOptionalTimezone(body.timezone),
    runtimeTuning: body.runtimeTuning && typeof body.runtimeTuning === 'object'
      ? {
          fastToolsPrompt: body.runtimeTuning.fastToolsPrompt === true,
          compactToolsPrompt: body.runtimeTuning.compactToolsPrompt !== false,
          maxMcpToolsInPrompt: clampOptionalInteger(body.runtimeTuning.maxMcpToolsInPrompt, 0, 200),
          maxToolIterations: clampOptionalInteger(body.runtimeTuning.maxToolIterations, 2, 12),
          fastConfirmationMaxToolIterations: clampOptionalInteger(body.runtimeTuning.fastConfirmationMaxToolIterations, 1, 8),
          toolResultMaxChars: clampOptionalInteger(body.runtimeTuning.toolResultMaxChars, 200, 6000),
          toolResultsTotalMaxChars: clampOptionalInteger(body.runtimeTuning.toolResultsTotalMaxChars, 600, 24000),
          llmTimeoutMs: clampOptionalInteger(body.runtimeTuning.llmTimeoutMs, 10_000, 240_000),
          toolTimeoutMs: clampOptionalInteger(body.runtimeTuning.toolTimeoutMs, 10_000, 180_000),
          queueDelayUserMs: clampOptionalInteger(body.runtimeTuning.queueDelayUserMs, 10, 2_000),
          queueDelayBackgroundMs: clampOptionalInteger(body.runtimeTuning.queueDelayBackgroundMs, 20, 5_000),
        }
      : undefined,
    webhooks: body.integrations?.webhooks
      ? {
          enabled: body.integrations.webhooks.enabled === true,
          secret: String(body.integrations.webhooks.secret || '').trim(),
          allowedSources: Array.isArray(body.integrations.webhooks.allowedSources)
            ? body.integrations.webhooks.allowedSources
                .filter((s: unknown): s is string => typeof s === 'string')
                .map((s: string) => s.trim().toLowerCase())
                .filter(Boolean)
            : [],
        }
      : undefined,
  };
}

/**
 * POST /api/agents/deploy
 * Deploy an agent (start Telegram bot + scheduler + engine)
 */
agentsRouter.post('/deploy', (req: Request, res: Response) => {
  try {
    const body = req.body;
    const config = buildAgentConfigFromPayload(body);

    if (!config) {
      res.status(400).json({ error: 'Missing agent configuration' });
      return;
    }

    const userId = req.authUser?.id || 'default';
    const result = deployAgent(config, userId);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    // If this agent has always-on enabled, update the stored config
    const alwaysOnIds = agentStorage.getAlwaysOnAgentIds(userId);
    if (alwaysOnIds.includes(config.id)) {
      agentStorage.setAlwaysOn(userId, config.id, true, JSON.stringify(body));
    }

    res.json({
      success: true,
      agentId: config.id,
      message: `Agent "${config.name}" deployed successfully`,
    });
  } catch (error: any) {
    console.error('[Agents API] Deploy error:', error.message);
    res.status(500).json({ error: `Failed to deploy agent: ${error.message}` });
  }
});

/**
 * POST /api/agents/:id/stop
 * Stop a running agent
 */
agentsRouter.post('/:id/stop', (req: Request, res: Response) => {
  const agentId = String(req.params.id);
  const stopped = stopAgent(agentId);

  if (!stopped) {
    res.status(404).json({ error: 'Agent not found or not running' });
    return;
  }

  res.json({ success: true, message: 'Agent stopped' });
});

/**
 * GET /api/agents/:id/status
 * Get the status of an agent
 */
agentsRouter.get('/:id/status', (req: Request, res: Response) => {
  const agentId = String(req.params.id);
  const status = getAgentStatus(agentId);
  res.json(status);
});

/**
 * GET /api/agents/:id/conversation
 * Get agent conversation history (user + assistant messages) for live chat
 */
agentsRouter.get('/:id/conversation', (req: Request, res: Response) => {
  const agentId = String(req.params.id);
  const messages = getAgentConversationHistory(agentId);
  res.json({ messages });
});

/**
 * POST /api/agents/:id/message
 * Send a message to a running agent from the web UI
 */
agentsRouter.post('/:id/message', (req: Request, res: Response) => {
  const agentId = String(req.params.id);
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    res.status(400).json({ success: false, error: 'Missing or invalid text' });
    return;
  }
  const result = sendAgentWebMessage(agentId, text);
  if (!result.success) {
    res.status(result.error === 'Agent not running' ? 404 : 400).json(result);
    return;
  }
  res.json(result);
});

/**
 * GET /api/agents/running
 * List all running agent IDs
 */
agentsRouter.get('/running', (_req: Request, res: Response) => {
  const ids = getRunningAgentIds();
  res.json({ agents: ids });
});

/**
 * GET /api/agents/always-on
 * List all always-on agent IDs for the current user
 */
agentsRouter.get('/always-on', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const ids = agentStorage.getAlwaysOnAgentIds(userId);
  res.json({ agents: ids });
});

/**
 * PUT /api/agents/:id/always-on
 * Toggle always-on for an agent. When enabled, the agent config is persisted
 * so the server can auto-deploy it on restart.
 */
agentsRouter.put('/:id/always-on', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const alwaysOn = req.body?.alwaysOn === true;

  try {
    if (alwaysOn) {
      // We need the full agent workspace state to get the agent config.
      // The frontend sends the alwaysOn flag — we store the latest config
      // from the state_store (agentWorkspace).
      const scopePrefix = `user:${userId}:`;
      const { getStateValue: getState } = require('../database');
      const rawWorkspace = getState(`${scopePrefix}agentWorkspace`);
      let agentConfigJson = '';
      if (rawWorkspace) {
        try {
          const workspace = typeof rawWorkspace === 'string' ? JSON.parse(rawWorkspace) : rawWorkspace;
          const agents = workspace?.agents || [];
          const agent = agents.find((a: any) => a.id === agentId);
          if (agent) {
            agentConfigJson = JSON.stringify(agent);
          }
        } catch {
          // ignore parse errors
        }
      }
      agentStorage.setAlwaysOn(userId, agentId, true, agentConfigJson);
    } else {
      agentStorage.setAlwaysOn(userId, agentId, false);
    }

    res.json({ success: true, agentId, alwaysOn });
  } catch (error: any) {
    console.error('[Agents API] Always-on error:', error.message);
    res.status(500).json({ error: `Failed to set always-on: ${error.message}` });
  }
});

/**
 * GET /api/agents/:id/costs
 * Get real-time cost breakdown for an agent
 */
agentsRouter.get('/:id/costs', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const summary = getAgentCostSummary(userId, agentId);
  res.json(summary);
});

/**
 * PUT /api/agents/:id/budget
 * Update the daily budget for an agent (also updates the running instance)
 */
agentsRouter.put('/:id/budget', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const dailyBudgetUsd = clampNumber(req.body?.dailyBudgetUsd, 0, 0, 10000);

  // Update the running agent if it exists
  const result = updateAgentBudget(agentId, userId, dailyBudgetUsd);

  // Also return current daily cost for context
  const currentDailyCostUsd = getAgentDailyCostUsd(userId, agentId);

  res.json({
    success: true,
    agentId,
    dailyBudgetUsd,
    currentDailyCostUsd,
    runtimeUpdated: result.success,
  });
});

/**
 * PATCH /api/agents/:id/runtime-config
 * Update provider/model/runtime tuning for a running agent without redeploy.
 */
agentsRouter.patch('/:id/runtime-config', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);

  const providerRaw = typeof req.body?.provider === 'string' ? req.body.provider.trim() : undefined;
  const provider = providerRaw && providerRaw.length > 0 ? (providerRaw as Provider) : undefined;
  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : undefined;

  const runtimeTuning = req.body?.runtimeTuning && typeof req.body.runtimeTuning === 'object'
    ? {
        fastToolsPrompt: req.body.runtimeTuning.fastToolsPrompt === true,
        compactToolsPrompt: req.body.runtimeTuning.compactToolsPrompt !== false,
        maxMcpToolsInPrompt: clampOptionalInteger(req.body.runtimeTuning.maxMcpToolsInPrompt, 0, 200),
        maxToolIterations: clampOptionalInteger(req.body.runtimeTuning.maxToolIterations, 2, 12),
        fastConfirmationMaxToolIterations: clampOptionalInteger(req.body.runtimeTuning.fastConfirmationMaxToolIterations, 1, 8),
        toolResultMaxChars: clampOptionalInteger(req.body.runtimeTuning.toolResultMaxChars, 200, 6000),
        toolResultsTotalMaxChars: clampOptionalInteger(req.body.runtimeTuning.toolResultsTotalMaxChars, 600, 24000),
        llmTimeoutMs: clampOptionalInteger(req.body.runtimeTuning.llmTimeoutMs, 10_000, 240_000),
        toolTimeoutMs: clampOptionalInteger(req.body.runtimeTuning.toolTimeoutMs, 10_000, 180_000),
        queueDelayUserMs: clampOptionalInteger(req.body.runtimeTuning.queueDelayUserMs, 10, 2_000),
        queueDelayBackgroundMs: clampOptionalInteger(req.body.runtimeTuning.queueDelayBackgroundMs, 20, 5_000),
      }
    : undefined;

  const result = updateAgentRuntimeConfig(agentId, userId, {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(runtimeTuning ? { runtimeTuning } : {}),
  });

  if (!result.success) {
    res.status(400).json({ success: false, error: result.error || 'Could not update runtime config' });
    return;
  }

  res.json({
    success: true,
    agentId,
    updated: result.updated,
  });
});

/**
 * POST /api/agents/:id/memory/reset
 * Reset persisted + runtime memory for a specific agent
 */
agentsRouter.post('/:id/memory/reset', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);

  const clearedPersistentMessages = agentStorage.clearConversationMessages(userId, agentId);
  const clearedWorkingMemory = agentStorage.clearWorkingMemory(userId, agentId);
  const runtime = resetAgentRuntimeMemory(agentId, userId);

  res.json({
    success: true,
    agentId,
    clearedPersistentMessages,
    clearedWorkingMemory,
    clearedRuntimeMessages: runtime.clearedRuntimeMessages,
    clearedConfigMemories: runtime.clearedConfigMemories,
    runtimeUpdated: runtime.running,
  });
});

// ---------------------------------------------------------------------------
// Working Memory endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/agents/:id/working-memory
 * Get all working memory entries for an agent
 */
agentsRouter.get('/:id/working-memory', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const entries = agentStorage.getAllWorkingMemory(userId, agentId);
  res.json({ success: true, agentId, entries });
});

/**
 * PATCH /api/agents/:id/working-memory/:entryId
 * Update a working memory entry for an agent
 */
agentsRouter.patch('/:id/working-memory/:entryId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const entryId = String(req.params.entryId || '');
  if (!entryId) {
    res.status(400).json({ error: 'entryId is required.' });
    return;
  }

  const updates: Partial<{ label: string; content: string }> = {};
  if (typeof req.body?.label === 'string') updates.label = req.body.label.trim();
  if (typeof req.body?.content === 'string') updates.content = req.body.content;

  if (updates.label === '' || (updates.label === undefined && updates.content === undefined)) {
    res.status(400).json({ error: 'Provide at least one of: label, content.' });
    return;
  }

  const entry = agentStorage.updateWorkingMemoryEntry(userId, agentId, entryId, updates);
  if (!entry) {
    res.status(404).json({ error: 'Working memory entry not found.' });
    return;
  }
  res.json({ success: true, agentId, entry });
});

/**
 * DELETE /api/agents/:id/working-memory/:entryId
 * Delete one working memory entry
 */
agentsRouter.delete('/:id/working-memory/:entryId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const entryId = String(req.params.entryId || '');
  if (!entryId) {
    res.status(400).json({ error: 'entryId is required.' });
    return;
  }

  const deleted = agentStorage.deleteWorkingMemoryEntry(userId, agentId, entryId);
  if (!deleted) {
    res.status(404).json({ error: 'Working memory entry not found.' });
    return;
  }
  res.json({ success: true, agentId, deleted: true });
});

/**
 * POST /api/agents/:id/working-memory/clear
 * Clear all working memory for an agent
 */
agentsRouter.post('/:id/working-memory/clear', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const deleted = agentStorage.clearWorkingMemory(userId, agentId);
  res.json({ success: true, agentId, cleared: deleted });
});

/**
 * POST /api/agents/verify-telegram
 * Test if a Telegram bot token and chat ID are valid
 */
agentsRouter.post('/verify-telegram', async (req: Request, res: Response) => {
  const { botToken, chatId } = req.body;

  if (!botToken) {
    res.status(400).json({ error: 'Missing botToken' });
    return;
  }

  try {
    const telegramBaseUrl = getTelegramBotBaseUrl(botToken);
    // Test the bot token
    const meResponse = await fetch(`${telegramBaseUrl}/getMe`, {
      signal: AbortSignal.timeout(10000),
    });
    const meData = await meResponse.json() as any;

    if (!meData.ok) {
      res.json({
        valid: false,
        error: `Bot token inválido: ${meData.description || 'Unknown error'}`,
      });
      return;
    }

    const botName = meData.result?.username || 'unknown';
    const canReadAllGroupMessages = Boolean(meData.result?.can_read_all_group_messages);

    // If chatId provided, try sending a test message
    if (chatId) {
      let chatType = '';
      try {
        const chatInfoResponse = await fetch(`${telegramBaseUrl}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId }),
          signal: AbortSignal.timeout(10000),
        });
        const chatInfoData = await chatInfoResponse.json() as any;
        if (chatInfoData?.ok && chatInfoData?.result?.type) {
          chatType = String(chatInfoData.result.type);
        }
      } catch {
        // Non-blocking diagnostic.
      }

      const testResponse = await fetch(`${telegramBaseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '✅ ¡Verificación exitosa! El bot está conectado correctamente.',
        }),
        signal: AbortSignal.timeout(10000),
      });
      const testData = await testResponse.json() as any;

      if (!testData.ok) {
        const description = String(testData.description || 'Unknown error');
        const chatNotFoundHint =
          /chat not found/i.test(description)
            ? ` Abre @${botName} en Telegram, pulsa Start (/start), envía un mensaje al bot y vuelve a verificar con ese chat ID.`
            : '';
        res.json({
          valid: true,
          botName,
          chatIdValid: false,
          error: `Bot válido (@${botName}), pero el chat ID "${chatId}" no es accesible: ${description}.${chatNotFoundHint}`,
        });
        return;
      }

      res.json({
        valid: true,
        botName,
        chatIdValid: true,
        message: (() => {
          const base = `Bot @${botName} verificado y chat ID ${chatId} accesible`;
          if ((chatType === 'group' || chatType === 'supergroup') && !canReadAllGroupMessages) {
            return `${base}. Aviso: en grupos con Privacy Mode activo, el bot solo recibe comandos/@menciones.`;
          }
          return base;
        })(),
      });
      return;
    }

    res.json({
      valid: true,
      botName,
      chatIdValid: false,
      message: `Bot @${botName} válido. Añade el chat ID para verificar la conexión completa.`,
    });
  } catch (error: any) {
    res.status(500).json({ error: `Error de verificación: ${error.message}` });
  }
});

// ===========================================================================
// Agent Data API — Notes, Lists, Schedules
// ===========================================================================

/**
 * GET /api/agents/:id/notes
 * Get all notes for an agent
 */
agentsRouter.get('/:id/notes', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const notes = agentStorage.getAllNotes(userId, agentId);
  res.json({ notes });
});

/**
 * POST /api/agents/:id/notes
 * Create a note for an agent/user scope
 */
agentsRouter.post('/:id/notes', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const content = typeof req.body?.content === 'string' ? req.body.content : '';

  if (!title || !content) {
    res.status(400).json({ error: 'title and content are required.' });
    return;
  }

  const note = agentStorage.createNote(userId, agentId, title, content, parseTags(req.body?.tags));
  res.status(201).json({ note });
});

/**
 * PATCH /api/agents/:id/notes/:noteId
 * Update an existing note
 */
agentsRouter.patch('/:id/notes/:noteId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const noteId = String(req.params.noteId || '');
  if (!noteId) {
    res.status(400).json({ error: 'noteId is required.' });
    return;
  }

  const updates: Partial<{ title: string; content: string; tags: string[] }> = {};
  if (typeof req.body?.title === 'string') updates.title = req.body.title.trim();
  if (typeof req.body?.content === 'string') updates.content = req.body.content;
  if (req.body?.tags !== undefined) updates.tags = parseTags(req.body.tags);
  const updated = agentStorage.updateNote(userId, agentId, noteId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Note not found.' });
    return;
  }
  res.json({ note: updated });
});

/**
 * DELETE /api/agents/:id/notes/:noteId
 * Delete a note
 */
agentsRouter.delete('/:id/notes/:noteId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const noteId = String(req.params.noteId || '');
  if (!noteId) {
    res.status(400).json({ error: 'noteId is required.' });
    return;
  }
  const deleted = agentStorage.deleteNote(userId, agentId, noteId);
  if (!deleted) {
    res.status(404).json({ error: 'Note not found.' });
    return;
  }
  res.json({ success: true });
});

/**
 * GET /api/agents/:id/lists
 * Get all lists for an agent
 */
agentsRouter.get('/:id/lists', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const lists = agentStorage.getAllLists(userId, agentId);
  res.json({ lists });
});

/**
 * GET /api/agents/:id/lists/:listId
 * Get one list by ID
 */
agentsRouter.get('/:id/lists/:listId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const listId = String(req.params.listId || '');
  if (!listId) {
    res.status(400).json({ error: 'listId is required.' });
    return;
  }

  const list = agentStorage.getList(userId, agentId, listId);
  if (!list) {
    res.status(404).json({ error: 'List not found.' });
    return;
  }

  res.json({ list });
});

/**
 * POST /api/agents/:id/lists
 * Create a list
 */
agentsRouter.post('/:id/lists', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  const items = parseListItems(req.body?.items);

  if (!title) {
    res.status(400).json({ error: 'title is required.' });
    return;
  }

  const list = agentStorage.createList(userId, agentId, title, items);
  res.status(201).json({ list });
});

/**
 * PATCH /api/agents/:id/lists/:listId
 * Update list metadata
 */
agentsRouter.patch('/:id/lists/:listId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const listId = String(req.params.listId || '');
  if (!listId) {
    res.status(400).json({ error: 'listId is required.' });
    return;
  }

  const updates: Partial<Pick<agentStorage.UserList, 'title'>> = {};
  if (typeof req.body?.title === 'string') {
    const title = req.body.title.trim();
    if (!title) {
      res.status(400).json({ error: 'title cannot be empty.' });
      return;
    }
    updates.title = title;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'At least one valid field is required.' });
    return;
  }

  const updated = agentStorage.updateList(userId, agentId, listId, updates);
  if (!updated) {
    res.status(404).json({ error: 'List not found.' });
    return;
  }

  res.json({ list: updated });
});

/**
 * POST /api/agents/:id/lists/:listId/items
 * Add one or more items to a list
 */
agentsRouter.post('/:id/lists/:listId/items', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const listId = String(req.params.listId || '');
  if (!listId) {
    res.status(400).json({ error: 'listId is required.' });
    return;
  }

  const items = parseListItems(req.body?.items);
  if (items.length === 0) {
    res.status(400).json({ error: 'At least one item is required.' });
    return;
  }

  const updated = agentStorage.addItemsToList(userId, agentId, listId, items);
  if (!updated) {
    res.status(404).json({ error: 'List not found.' });
    return;
  }

  res.json({ list: updated });
});

/**
 * PATCH /api/agents/:id/lists/:listId/items/:itemId
 * Update a list item
 */
agentsRouter.patch('/:id/lists/:listId/items/:itemId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const listId = String(req.params.listId || '');
  const itemId = String(req.params.itemId || '');
  if (!listId || !itemId) {
    res.status(400).json({ error: 'listId and itemId are required.' });
    return;
  }

  const updates: Partial<Pick<agentStorage.ListItem, 'text' | 'checked'>> = {};
  if (typeof req.body?.text === 'string') {
    const text = req.body.text.trim();
    if (!text) {
      res.status(400).json({ error: 'text cannot be empty.' });
      return;
    }
    updates.text = text;
  }
  if (typeof req.body?.checked === 'boolean') {
    updates.checked = req.body.checked;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'At least one valid field is required.' });
    return;
  }

  const updated = agentStorage.updateListItemById(userId, agentId, listId, itemId, updates);
  if (!updated) {
    res.status(404).json({ error: 'List or item not found.' });
    return;
  }

  res.json({ list: updated });
});

/**
 * DELETE /api/agents/:id/lists/:listId/items/:itemId
 * Delete a list item
 */
agentsRouter.delete('/:id/lists/:listId/items/:itemId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const listId = String(req.params.listId || '');
  const itemId = String(req.params.itemId || '');
  if (!listId || !itemId) {
    res.status(400).json({ error: 'listId and itemId are required.' });
    return;
  }

  const updated = agentStorage.deleteListItemById(userId, agentId, listId, itemId);
  if (!updated) {
    res.status(404).json({ error: 'List or item not found.' });
    return;
  }

  res.json({ list: updated });
});

/**
 * DELETE /api/agents/:id/lists/:listId
 * Delete a list
 */
agentsRouter.delete('/:id/lists/:listId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const listId = String(req.params.listId || '');
  if (!listId) {
    res.status(400).json({ error: 'listId is required.' });
    return;
  }

  const deleted = agentStorage.deleteList(userId, agentId, listId);
  if (!deleted) {
    res.status(404).json({ error: 'List not found.' });
    return;
  }

  res.json({ success: true });
});

/**
 * GET /api/agents/:id/schedules
 * Get all scheduled tasks for an agent
 */
agentsRouter.get('/:id/schedules', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const schedules = agentStorage.getAllSchedules(userId, agentId);
  res.json({ schedules });
});

/**
 * GET /api/agents/:id/schedules/:scheduleId
 * Get one schedule by ID
 */
agentsRouter.get('/:id/schedules/:scheduleId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const scheduleId = String(req.params.scheduleId || '');
  if (!scheduleId) {
    res.status(400).json({ error: 'scheduleId is required.' });
    return;
  }

  const schedule = agentStorage.getSchedule(userId, agentId, scheduleId);
  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found.' });
    return;
  }

  res.json({ schedule });
});

/**
 * POST /api/agents/:id/schedules
 * Create a persisted schedule
 */
agentsRouter.post('/:id/schedules', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const cron = typeof req.body?.cron === 'string' ? req.body.cron.trim() : '';
  const instructionRaw = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
  const instruction = instructionRaw || name;
  const enabled = req.body?.enabled !== false;
  const startAtResult = parseScheduleStartAt(req.body?.startAt);
  const frequency = parseOptionalText(req.body?.frequency);
  const conditions = parseOptionalText(req.body?.conditions);
  const timezone = parseOptionalTimezone(req.body?.timezone);

  if (!name || !cron) {
    res.status(400).json({ error: 'name and cron are required.' });
    return;
  }
  if (startAtResult.invalid) {
    res.status(400).json({ error: 'startAt must be a valid timestamp or ISO date.' });
    return;
  }

  const schedule: agentStorage.PersistedSchedule = {
    id: typeof req.body?.id === 'string' && req.body.id.trim()
      ? req.body.id.trim()
      : `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    cron,
    instruction,
    enabled,
    startAt: startAtResult.parsed,
    frequency,
    conditions,
    timezone,
    createdAt: Date.now(),
  };

  agentStorage.saveSchedule(userId, agentId, schedule);
  upsertAgentRuntimeSchedule(agentId, userId, schedule);
  res.status(201).json({ schedule });
});

/**
 * PATCH /api/agents/:id/schedules/:scheduleId
 * Update a persisted schedule
 */
agentsRouter.patch('/:id/schedules/:scheduleId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const scheduleId = String(req.params.scheduleId || '');
  if (!scheduleId) {
    res.status(400).json({ error: 'scheduleId is required.' });
    return;
  }

  const current = agentStorage.getSchedule(userId, agentId, scheduleId);
  if (!current) {
    res.status(404).json({ error: 'Schedule not found.' });
    return;
  }

  const updates: Partial<agentStorage.PersistedSchedule> = {};

  if (typeof req.body?.name === 'string') {
    const value = req.body.name.trim();
    if (!value) {
      res.status(400).json({ error: 'name cannot be empty.' });
      return;
    }
    updates.name = value;
  }

  if (typeof req.body?.cron === 'string') {
    const value = req.body.cron.trim();
    if (!value) {
      res.status(400).json({ error: 'cron cannot be empty.' });
      return;
    }
    updates.cron = value;
  }

  if (typeof req.body?.instruction === 'string') {
    const value = req.body.instruction.trim();
    if (!value) {
      res.status(400).json({ error: 'instruction cannot be empty.' });
      return;
    }
    updates.instruction = value;
  }

  if (typeof req.body?.enabled === 'boolean') {
    updates.enabled = req.body.enabled;
  }

  if (hasOwn(req.body, 'startAt')) {
    const parsedStartAt = parseScheduleStartAt(req.body?.startAt);
    if (parsedStartAt.invalid) {
      res.status(400).json({ error: 'startAt must be a valid timestamp or ISO date.' });
      return;
    }
    updates.startAt = parsedStartAt.parsed;
  }

  if (hasOwn(req.body, 'frequency')) {
    updates.frequency = parseOptionalText(req.body?.frequency);
  }
  if (hasOwn(req.body, 'conditions')) {
    updates.conditions = parseOptionalText(req.body?.conditions);
  }
  if (hasOwn(req.body, 'timezone')) {
    updates.timezone = parseOptionalTimezone(req.body?.timezone);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: 'At least one valid field is required.' });
    return;
  }

  const updated = agentStorage.updateSchedule(userId, agentId, scheduleId, updates);
  if (!updated) {
    res.status(404).json({ error: 'Schedule not found.' });
    return;
  }

  upsertAgentRuntimeSchedule(agentId, userId, updated);
  res.json({ schedule: updated });
});

/**
 * DELETE /api/agents/:id/schedules/:scheduleId
 * Delete a persisted schedule
 */
agentsRouter.delete('/:id/schedules/:scheduleId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const scheduleId = String(req.params.scheduleId || '');
  if (!scheduleId) {
    res.status(400).json({ error: 'scheduleId is required.' });
    return;
  }

  const deleted = agentStorage.deleteSchedule(userId, agentId, scheduleId);
  if (!deleted) {
    res.status(404).json({ error: 'Schedule not found.' });
    return;
  }

  removeAgentRuntimeSchedule(agentId, userId, scheduleId);
  res.json({ success: true });
});

// ===========================================================================
// Expenses API — CRUD for agent expense tracking
// ===========================================================================

/**
 * GET /api/agents/:id/expenses
 * List all expenses for an agent with optional filters
 */
agentsRouter.get('/:id/expenses', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const startDate = typeof req.query.start_date === 'string' ? Date.parse(req.query.start_date) : undefined;
  const endDate = typeof req.query.end_date === 'string' ? Date.parse(req.query.end_date) : undefined;
  const query = typeof req.query.query === 'string' ? req.query.query : undefined;

  const expenses = agentStorage.searchExpenses(userId, agentId, {
    category,
    startDate: Number.isFinite(startDate) ? startDate : undefined,
    endDate: Number.isFinite(endDate) ? endDate : undefined,
    query,
  });
  res.json({ expenses });
});

/**
 * POST /api/agents/:id/expenses
 * Create a new expense
 */
agentsRouter.post('/:id/expenses', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const { amount, currency, category, description, date, recurring, recurringFrequency, tags } = req.body;

  if (typeof amount !== 'number' || !description) {
    res.status(400).json({ error: 'amount (number) and description are required.' });
    return;
  }

  const expense = agentStorage.createExpense(userId, agentId, {
    amount,
    currency: typeof currency === 'string' ? currency : 'EUR',
    category: typeof category === 'string' ? category : 'otros',
    description,
    date: typeof date === 'number' ? date : (typeof date === 'string' ? Date.parse(date) : Date.now()),
    recurring: recurring === true,
    recurringFrequency: typeof recurringFrequency === 'string' ? recurringFrequency : undefined,
    tags: parseTags(tags),
  });
  res.json({ expense });
});

/**
 * DELETE /api/agents/:id/expenses/:expenseId
 * Delete an expense
 */
agentsRouter.delete('/:id/expenses/:expenseId', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const expenseId = String(req.params.expenseId || '');
  if (!expenseId) {
    res.status(400).json({ error: 'expenseId is required.' });
    return;
  }

  const deleted = agentStorage.deleteExpense(userId, agentId, expenseId);
  if (!deleted) {
    res.status(404).json({ error: 'Expense not found.' });
    return;
  }
  res.json({ success: true });
});

/**
 * GET /api/agents/:id/expenses/summary
 * Get expense summary with totals by category
 */
agentsRouter.get('/:id/expenses/summary', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const startDate = typeof req.query.start_date === 'string' ? Date.parse(req.query.start_date) : undefined;
  const endDate = typeof req.query.end_date === 'string' ? Date.parse(req.query.end_date) : undefined;

  const summary = agentStorage.getExpenseSummary(userId, agentId,
    Number.isFinite(startDate) ? startDate : undefined,
    Number.isFinite(endDate) ? endDate : undefined,
  );
  res.json(summary);
});

/**
 * GET /api/agents/:id/expenses/export
 * Export expenses as CSV
 */
agentsRouter.get('/:id/expenses/export', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const startDate = typeof req.query.start_date === 'string' ? Date.parse(req.query.start_date) : undefined;
  const endDate = typeof req.query.end_date === 'string' ? Date.parse(req.query.end_date) : undefined;

  const csv = agentStorage.exportExpensesToCSV(userId, agentId,
    Number.isFinite(startDate) ? startDate : undefined,
    Number.isFinite(endDate) ? endDate : undefined,
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=gastos.csv');
  res.send(csv);
});

// ===========================================================================
// MCP Server API — Test, status, tools discovery
// ===========================================================================

/**
 * GET /api/agents/:id/mcp/status
 * Get MCP connection status and discovered tools for a running agent
 */
agentsRouter.get('/:id/mcp/status', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const status = getAgentMCPStatus(agentId, userId);
  res.json(status);
});

/**
 * GET /api/agents/:id/mcp/tools
 * List all MCP tools available to a running agent
 */
agentsRouter.get('/:id/mcp/tools', (req: Request, res: Response) => {
  const userId = req.authUser?.id || 'default';
  const agentId = String(req.params.id);
  const status = getAgentMCPStatus(agentId, userId);
  res.json({ tools: status.tools });
});

/**
 * POST /api/agents/mcp/test
 * Test an MCP server connection (without deploying an agent)
 */
agentsRouter.post('/mcp/test', async (req: Request, res: Response) => {
  const { serverId, config } = req.body;

  if (!serverId || typeof serverId !== 'string') {
    res.status(400).json({ error: 'serverId is required' });
    return;
  }

  try {
    const result = await testMCPServer(serverId, config || {});
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/agents/mcp/registry
 * List all registered MCP servers in the registry
 */
agentsRouter.get('/mcp/registry', (_req: Request, res: Response) => {
  const registry = getMCPRegistry();
  const ids = registry.listRegistered();
  const entries = ids.map((id) => {
    const entry = registry.getServer(id);
    return {
      id,
      npmPackage: entry?.npmPackage,
      description: entry?.description,
    };
  });
  res.json({ servers: entries });
});

// ===========================================================================
// Calendar Integration — Google OAuth2 + iCloud CalDAV
// ===========================================================================

function parseCalendarConfig(raw: any): CalendarConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const config: CalendarConfig = {};

  const normalizeICloudAppPassword = (value: unknown): string => String(value || '').trim().replace(/[\s-]/g, '');

  if (raw.google && typeof raw.google === 'object') {
    const g = raw.google;
    if (g.clientId && g.clientSecret && g.refreshToken) {
      config.google = {
        clientId: String(g.clientId).trim(),
        clientSecret: String(g.clientSecret).trim(),
        refreshToken: String(g.refreshToken).trim(),
        calendarId: typeof g.calendarId === 'string' ? g.calendarId.trim() || undefined : undefined,
      };
    }
  }

  if (raw.icloud && typeof raw.icloud === 'object') {
    const i = raw.icloud;
    const normalizedPassword = normalizeICloudAppPassword(i.appSpecificPassword);
    if (i.email && normalizedPassword) {
      config.icloud = {
        email: String(i.email).trim(),
        appSpecificPassword: normalizedPassword,
        calendarName: typeof i.calendarName === 'string' ? i.calendarName.trim() || undefined : undefined,
      };
    }
  }

  if (!config.google && !config.icloud) return undefined;
  return config;
}

function parseMediaConfig(raw: any): MediaConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const config: MediaConfig = {};

  if (raw.radarr && typeof raw.radarr === 'object') {
    const r = raw.radarr;
    const url = String(r.url || '').trim();
    const apiKey = String(r.apiKey || '').trim();
    if (url && apiKey) {
      config.radarr = { url, apiKey };
    }
  }

  if (raw.sonarr && typeof raw.sonarr === 'object') {
    const s = raw.sonarr;
    const url = String(s.url || '').trim();
    const apiKey = String(s.apiKey || '').trim();
    if (url && apiKey) {
      config.sonarr = { url, apiKey };
    }
  }

  if (!config.radarr && !config.sonarr) return undefined;
  return config;
}

function parseHomeAssistantConfig(raw: any): HomeAssistantConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const url = String(raw.url || '').trim();
  const token = String(raw.token || '').trim();
  if (!url || !token) return undefined;
  return { url, token };
}

function parseGmailConfig(raw: any): GmailConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const clientId = String(raw.clientId || '').trim();
  const clientSecret = String(raw.clientSecret || '').trim();
  const refreshToken = String(raw.refreshToken || '').trim();
  if (!clientId || !clientSecret || !refreshToken) return undefined;
  return { clientId, clientSecret, refreshToken };
}

/**
 * POST /api/agents/calendar/google/auth-url
 * Generate Google OAuth2 authorization URL for calendar access
 */
agentsRouter.post('/calendar/google/auth-url', (req: Request, res: Response) => {
  const { clientId, redirectUri } = req.body;

  if (!clientId || !redirectUri) {
    res.status(400).json({ error: 'clientId and redirectUri are required' });
    return;
  }

  const state = `optimaizer-${Date.now()}`;
  const authUrl = buildGoogleAuthUrl(String(clientId), String(redirectUri), state);
  res.json({ authUrl, state });
});

/**
 * POST /api/agents/calendar/google/exchange-code
 * Exchange Google OAuth2 authorization code for tokens
 */
agentsRouter.post('/calendar/google/exchange-code', async (req: Request, res: Response) => {
  const { code, clientId, clientSecret, redirectUri } = req.body;

  if (!code || !clientId || !clientSecret || !redirectUri) {
    res.status(400).json({ error: 'code, clientId, clientSecret, and redirectUri are required' });
    return;
  }

  try {
    const tokens = await exchangeGoogleAuthCode(
      String(code),
      String(clientId),
      String(clientSecret),
      String(redirectUri)
    );

    res.json({
      success: true,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      message: 'Google Calendar authorized successfully. Save the refreshToken in the agent calendar config.',
    });
  } catch (error: any) {
    console.error('[Calendar] Google OAuth code exchange error:', safeErrorMessage(error));
    res.status(400).json({ error: safeErrorMessage(error) });
  }
});

/**
 * POST /api/agents/calendar/google/test
 * Test Google Calendar connection by listing upcoming events
 */
agentsRouter.post('/calendar/google/test', async (req: Request, res: Response) => {
  const { clientId, clientSecret, refreshToken, calendarId } = req.body;

  if (!clientId || !clientSecret || !refreshToken) {
    res.status(400).json({ error: 'clientId, clientSecret, and refreshToken are required' });
    return;
  }

  try {
    const { createGoogleCalendarProvider: createGCP } = await import('../agents/calendarGoogle');
    const provider = createGCP({
      clientId: String(clientId),
      clientSecret: String(clientSecret),
      refreshToken: String(refreshToken),
      calendarId: calendarId ? String(calendarId) : undefined,
    });

    const now = new Date();
    const end = new Date(now.getTime() + 7 * 86_400_000);
    const events = await provider.listEvents(now.toISOString(), end.toISOString(), 5);

    res.json({
      success: true,
      message: `Google Calendar connected. Found ${events.length} upcoming events.`,
      events: events.map(e => ({ title: e.title, startTime: e.startTime, endTime: e.endTime })),
    });
  } catch (error: any) {
    console.error('[Calendar] Google test error:', safeErrorMessage(error));
    res.status(400).json({ success: false, error: safeErrorMessage(error) });
  }
});

/**
 * POST /api/agents/calendar/icloud/test
 * Test iCloud Calendar connection
 */
agentsRouter.post('/calendar/icloud/test', async (req: Request, res: Response) => {
  const { email, appSpecificPassword, calendarName } = req.body;
  const normalizedPassword = String(appSpecificPassword || '').trim().replace(/[\s-]/g, '');

  if (!email || !normalizedPassword) {
    res.status(400).json({ error: 'email and appSpecificPassword are required' });
    return;
  }

  try {
    const { createICloudCalendarProvider: createICP } = await import('../agents/calendarICloud');
    const provider = createICP({
      email: String(email),
      appSpecificPassword: normalizedPassword,
      calendarName: calendarName ? String(calendarName) : undefined,
    });

    const now = new Date();
    const end = new Date(now.getTime() + 7 * 86_400_000);
    const events = await provider.listEvents(now.toISOString(), end.toISOString(), 5);

    res.json({
      success: true,
      message: `iCloud Calendar connected. Found ${events.length} upcoming events.`,
      events: events.map(e => ({ title: e.title, startTime: e.startTime, endTime: e.endTime })),
    });
  } catch (error: any) {
    console.error('[Calendar] iCloud test error:', safeErrorMessage(error));
    res.status(400).json({ success: false, error: safeErrorMessage(error) });
  }
});

/**
 * POST /api/agents/media/test-radarr
 * Test Radarr connection
 */
agentsRouter.post('/media/test-radarr', async (req: Request, res: Response) => {
  const { url, apiKey } = req.body;
  if (!url || !apiKey) {
    res.status(400).json({ error: 'url and apiKey are required' });
    return;
  }
  try {
    const { testRadarrConnection } = await import('../agents/radarr');
    const result = await testRadarrConnection({ url: String(url).trim(), apiKey: String(apiKey).trim() });
    if (result.success) {
      res.json({ success: true, version: result.version, message: `Radarr conectado (v${result.version})` });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    res.status(400).json({ success: false, error: safeErrorMessage(error) });
  }
});

/**
 * POST /api/agents/media/test-sonarr
 * Test Sonarr connection
 */
agentsRouter.post('/media/test-sonarr', async (req: Request, res: Response) => {
  const { url, apiKey } = req.body;
  if (!url || !apiKey) {
    res.status(400).json({ error: 'url and apiKey are required' });
    return;
  }
  try {
    const { testSonarrConnection } = await import('../agents/sonarr');
    const result = await testSonarrConnection({ url: String(url).trim(), apiKey: String(apiKey).trim() });
    if (result.success) {
      res.json({ success: true, version: result.version, message: `Sonarr conectado (v${result.version})` });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    res.status(400).json({ success: false, error: safeErrorMessage(error) });
  }
});

// ===========================================================================
// Home Assistant Integration
// ===========================================================================

/**
 * POST /api/agents/homeassistant/test
 * Test Home Assistant connection
 */
agentsRouter.post('/homeassistant/test', async (req: Request, res: Response) => {
  const { url, token } = req.body;
  if (!url || !token) {
    res.status(400).json({ error: 'url and token are required' });
    return;
  }
  try {
    const { testHomeAssistantConnection } = await import('../agents/homeAssistant');
    const result = await testHomeAssistantConnection({ url: String(url).trim(), token: String(token).trim() });
    if (result.success) {
      res.json({
        success: true,
        version: result.version,
        locationName: result.locationName,
        message: `Home Assistant conectado (v${result.version}) — ${result.locationName || 'Sin nombre'}`,
      });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    res.status(400).json({ success: false, error: safeErrorMessage(error) });
  }
});

// ===========================================================================
// Gmail Integration — Google OAuth2
// ===========================================================================

/**
 * POST /api/agents/gmail/auth-url
 * Generate Google OAuth2 authorization URL for Gmail access
 */
agentsRouter.post('/gmail/auth-url', (req: Request, res: Response) => {
  const { clientId, redirectUri } = req.body;

  if (!clientId || !redirectUri) {
    res.status(400).json({ error: 'clientId and redirectUri are required' });
    return;
  }

  const state = `optimaizer-gmail-${Date.now()}`;
  const authUrl = buildGmailAuthUrl(String(clientId), String(redirectUri), state);
  res.json({ authUrl, state });
});

/**
 * POST /api/agents/gmail/exchange-code
 * Exchange Google OAuth2 authorization code for Gmail tokens
 */
agentsRouter.post('/gmail/exchange-code', async (req: Request, res: Response) => {
  const { code, clientId, clientSecret, redirectUri } = req.body;

  if (!code || !clientId || !clientSecret || !redirectUri) {
    res.status(400).json({ error: 'code, clientId, clientSecret, and redirectUri are required' });
    return;
  }

  try {
    const tokens = await exchangeGmailAuthCode(
      String(code),
      String(clientId),
      String(clientSecret),
      String(redirectUri)
    );

    res.json({
      success: true,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      message: 'Gmail authorized successfully. Save the refreshToken in the agent Gmail config.',
    });
  } catch (error: any) {
    console.error('[Gmail] OAuth code exchange error:', safeErrorMessage(error));
    res.status(400).json({ error: safeErrorMessage(error) });
  }
});

/**
 * POST /api/agents/gmail/test
 * Test Gmail connection by checking unread count and listing recent emails
 */
agentsRouter.post('/gmail/test', async (req: Request, res: Response) => {
  const { clientId, clientSecret, refreshToken } = req.body;

  if (!clientId || !clientSecret || !refreshToken) {
    res.status(400).json({ error: 'clientId, clientSecret, and refreshToken are required' });
    return;
  }

  try {
    const { createGmailProvider } = await import('../agents/gmail');
    const provider = createGmailProvider({
      clientId: String(clientId),
      clientSecret: String(clientSecret),
      refreshToken: String(refreshToken),
    });

    const unreadCount = await provider.getUnreadCount();
    const messages = await provider.listMessages(undefined, 3);

    res.json({
      success: true,
      message: `Gmail conectado correctamente. ${unreadCount} correo${unreadCount === 1 ? '' : 's'} sin leer.`,
      unreadCount,
      recentEmails: messages.map(m => ({ subject: m.subject, from: m.from, date: m.date })),
    });
  } catch (error: any) {
    console.error('[Gmail] Test error:', safeErrorMessage(error));
    res.status(400).json({ success: false, error: safeErrorMessage(error) });
  }
});

// ---------------------------------------------------------------------------
// Execution Audit Logs
// ---------------------------------------------------------------------------

/**
 * GET /api/agents/security/audit-logs
 * Returns recent terminal/code execution audit logs.
 */
agentsRouter.get('/security/audit-logs', (_req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(_req.query.limit) || 50, 200);
    const logs = readRecentAuditLogs(limit);
    res.json({ success: true, logs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: safeErrorMessage(error) });
  }
});
