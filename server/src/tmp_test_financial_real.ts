import Database from 'better-sqlite3';
import { initDatabase } from './database';
import { processAgentMessage } from './agents/engine';
import type { AgentConfig, AgentMessage } from './agents/types';
import { MCPClientManager, getMCPRegistry } from './agents/mcpClient';

const USER_ID = process.env.TEST_USER_ID || '71d64a50-27b8-45bf-a8b2-1e4c95021382';
const PROMPT = process.env.TEST_PROMPT || 'Analiza Apple e Iberdrola';

function buildConfigFromWorkspaceAgent(agent: any): AgentConfig {
  return {
    id: String(agent.id),
    name: String(agent.name || 'Agent'),
    objective: String(agent.objective || ''),
    systemPrompt: String(agent.systemPrompt || ''),
    provider: String(agent.setupProvider || agent.provider || 'openai') as any,
    model: String(agent.setupModel || agent.model || ''),
    permissions: {
      internetAccess: agent?.permissions?.internetAccess !== false,
      headlessBrowser: agent?.permissions?.headlessBrowser !== false,
      notesAccess: agent?.permissions?.notesAccess !== false,
      schedulerAccess: agent?.permissions?.schedulerAccess !== false,
      calendarAccess: agent?.permissions?.calendarAccess !== false,
      gmailAccess: agent?.permissions?.gmailAccess !== false,
      mediaAccess: agent?.permissions?.mediaAccess !== false,
      terminalAccess: agent?.permissions?.terminalAccess === true,
      codeExecution: agent?.permissions?.codeExecution === true,
      allowedWebsites: Array.isArray(agent?.permissions?.allowedWebsites) ? agent.permissions.allowedWebsites : [],
      requireApprovalForNewSites: agent?.permissions?.requireApprovalForNewSites !== false,
      webCredentials: Array.isArray(agent?.permissions?.webCredentials)
        ? agent.permissions.webCredentials.map((c: any) => ({
            site: String(c.site || ''),
            username: String(c.username || ''),
            password: String(c.password || ''),
          }))
        : [],
    },
    telegram: {
      botToken: String(agent?.integrations?.telegram?.botToken || ''),
      chatId: String(agent?.integrations?.telegram?.chatId || ''),
    },
    schedules: Array.isArray(agent?.schedules)
      ? agent.schedules.map((s: any) => ({
          id: String(s.id || `s-${Date.now()}`),
          name: String(s.name || ''),
          schedule: String(s.schedule || ''),
          enabled: s.enabled !== false,
        }))
      : [],
    mcpServers: Array.isArray(agent?.integrations?.mcpServers)
      ? agent.integrations.mcpServers.map((s: any) => ({
          id: String(s.id || ''),
          enabled: s.enabled !== false,
          config: s.config && typeof s.config === 'object' ? s.config : {},
        }))
      : [],
    calendar: agent?.integrations?.calendar && typeof agent.integrations.calendar === 'object'
      ? agent.integrations.calendar
      : undefined,
    memory: Array.isArray(agent?.trainingMemory)
      ? agent.trainingMemory.filter((x: unknown) => typeof x === 'string')
      : [],
    temperature: typeof agent?.setupTemperature === 'number' ? agent.setupTemperature : 0.3,
    maxTokens: typeof agent?.setupMaxTokens === 'number' ? agent.setupMaxTokens : 2048,
    memoryRecentWindow: 30,
    memoryRecallLimit: 8,
  };
}

async function main() {
  initDatabase();
  const db = new Database('./data/optimaizer.db', { readonly: true });
  const row = db
    .prepare('SELECT value FROM state_store WHERE key = ?')
    .get(`user:${USER_ID}:agentWorkspace`) as { value: string } | undefined;

  if (!row?.value) {
    throw new Error(`No se encontró workspace para user ${USER_ID}`);
  }

  const workspace = JSON.parse(row.value);
  const activeAgentId = String(workspace.activeAgentId || '');
  const activeAgent = (workspace.agents || []).find((a: any) => String(a.id) === activeAgentId) || workspace.agents?.[0];
  if (!activeAgent) {
    throw new Error('No hay agente activo en el workspace');
  }

  const config = buildConfigFromWorkspaceAgent(activeAgent);

  console.log('\n=== ACTIVE AGENT ===');
  console.log(JSON.stringify({
    userId: USER_ID,
    agentId: config.id,
    name: config.name,
    provider: config.provider,
    model: config.model,
    mcpServers: config.mcpServers,
  }, null, 2));

  const mcpManager = new MCPClientManager(config.id);
  const enabledServers = config.mcpServers.filter((s) => s.enabled);
  if (enabledServers.length > 0) {
    const connectResult = await mcpManager.connectAll(enabledServers, getMCPRegistry());
    console.log('\n=== MCP CONNECT ===');
    console.log(JSON.stringify(connectResult, null, 2));
    console.log(`MCP tools discovered: ${mcpManager.allTools.length}`);
  } else {
    console.log('\n=== MCP CONNECT ===');
    console.log('No hay servidores MCP habilitados en el agente activo.');
  }

  const history: AgentMessage[] = [];
  const toolCalls: Array<{ name: string; params: Record<string, any> }> = [];

  const result = await processAgentMessage(
    config,
    PROMPT,
    history,
    {
      agentConfig: config,
      userId: USER_ID,
      agentId: config.id,
      mcpManager,
      sendTelegramMessage: async (_message: string) => true,
      addMemory: (_info: string) => {},
      addSchedule: (_params) => `tmp-${Date.now()}`,
      removeSchedule: (_taskId: string) => true,
      toggleSchedule: (_taskId: string, _enabled: boolean) => true,
      recordUsageEvent: (_event) => {},
      recordResourceEvent: (_event) => {},
    },
    {
      onResponse: (_text) => {},
      onToolCall: (toolName, params) => {
        toolCalls.push({ name: toolName, params });
      },
      onToolResult: (_toolResult) => {},
      onError: (error) => {
        console.error('ENGINE_ERROR:', error);
      },
    },
    'user'
  );

  console.log('\n=== TOOL CALLS ===');
  if (toolCalls.length === 0) {
    console.log('No hubo tool calls.');
  } else {
    console.log(JSON.stringify(toolCalls, null, 2));
  }

  console.log('\n=== FINAL RESPONSE ===');
  console.log(result.response);

  mcpManager.disconnectAll();
}

main().catch((error) => {
  console.error('\nFATAL:', error?.message || error);
  process.exit(1);
});
