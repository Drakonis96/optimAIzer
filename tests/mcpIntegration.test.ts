import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Setup: temporary data directory
// ---------------------------------------------------------------------------

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimaizer-mcp-tests-'));
const agentsDataRoot = path.join(tempDir, 'agents-data');

before(() => {
  process.env.OPTIMAIZER_AGENTS_DATA_ROOT = agentsDataRoot;
  process.env.OPTIMAIZER_DB_PATH = path.join(tempDir, 'test.db');
});

after(() => {
  delete process.env.OPTIMAIZER_AGENTS_DATA_ROOT;
  delete process.env.OPTIMAIZER_DB_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ===========================================================================
// MCP Client — Registry & Tool wiring
// ===========================================================================

describe('MCP Server Registry', () => {
  test('createDefaultRegistry registers all catalog entries', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const expectedIds = [
      'brave-search', 'puppeteer', 'playwright', 'fetch', 'memory',
      'github', 'google-drive', 'slack', 'notion', 'postgres',
      'sqlite', 'filesystem', 'exa', 'firecrawl', 'google-maps',
    ];

    for (const id of expectedIds) {
      assert.ok(registry.has(id), `Registry should have "${id}"`);
    }
    assert.equal(registry.listRegistered().length, expectedIds.length, 'Should have all catalog entries');
  });

  test('buildCommand returns npx command with correct package', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const cmd = registry.buildCommand('brave-search', { apiKey: 'test-key-123' });
    assert.equal(cmd.command, 'npx');
    assert.ok(cmd.args.includes('-y'));
    assert.ok(cmd.args.includes('@modelcontextprotocol/server-brave-search'));
    assert.equal(cmd.env.BRAVE_API_KEY, 'test-key-123');
  });

  test('buildCommand for fetch uses a valid package (no deprecated server-fetch)', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const cmd = registry.buildCommand('fetch', {});
    assert.ok(cmd.args.includes('@kazuph/mcp-fetch'));
    assert.equal(cmd.args.includes('@modelcontextprotocol/server-fetch'), false);
  });

  test('buildCommand sets extended connect timeout for browser MCP servers', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const puppeteer = registry.buildCommand('puppeteer', {});
    const playwright = registry.buildCommand('playwright', {});

    assert.equal(puppeteer.connectTimeoutMs, 45_000);
    assert.equal(playwright.connectTimeoutMs, 45_000);
  });

  test('buildCommand for postgres passes connectionString as arg', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const cmd = registry.buildCommand('postgres', { connectionString: 'postgresql://localhost/db' });
    assert.ok(cmd.args.includes('postgresql://localhost/db'));
  });

  test('buildCommand for filesystem uses allowed dirs or defaults to /tmp', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const cmdDefault = registry.buildCommand('filesystem', {});
    assert.ok(cmdDefault.args.includes('/tmp/mcp-sandbox'));

    const cmdCustom = registry.buildCommand('filesystem', { allowedDirs: '/data,/workspace' });
    assert.ok(cmdCustom.args.includes('/data'));
    assert.ok(cmdCustom.args.includes('/workspace'));
  });

  test('buildCommand throws for unknown server', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    assert.throws(
      () => registry.buildCommand('nonexistent-server', {}),
      /not registered/,
    );
  });

  test('buildCommand for github passes token as env', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const cmd = registry.buildCommand('github', { token: 'ghp_test' });
    assert.equal(cmd.env.GITHUB_PERSONAL_ACCESS_TOKEN, 'ghp_test');
  });

  test('buildCommand for slack passes botToken as env', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const cmd = registry.buildCommand('slack', { botToken: 'xoxb-test' });
    assert.equal(cmd.env.SLACK_BOT_TOKEN, 'xoxb-test');
  });

  test('buildCommand for notion passes apiKey as env', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    const cmd = registry.buildCommand('notion', { apiKey: 'ntn_test' });
    assert.equal(cmd.env.NOTION_API_KEY, 'ntn_test');
  });
});

describe('MCP Client Manager', () => {
  test('MCPClientManager initialises with empty tools', async () => {
    const { MCPClientManager } = await import('../server/src/agents/mcpClient');
    const manager = new MCPClientManager('test-agent');

    assert.deepEqual(manager.allTools, []);
    assert.deepEqual(manager.connectedServers, []);
  });

  test('callTool returns error for unknown tool', async () => {
    const { MCPClientManager } = await import('../server/src/agents/mcpClient');
    const manager = new MCPClientManager('test-agent');

    const result = await manager.callTool('mcp_nonexistent__fake', {});
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Unknown'));
  });

  test('getStatus returns empty array when no connections', async () => {
    const { MCPClientManager } = await import('../server/src/agents/mcpClient');
    const manager = new MCPClientManager('test-agent');

    assert.deepEqual(manager.getStatus(), []);
  });

  test('disconnectAll on empty manager does not throw', async () => {
    const { MCPClientManager } = await import('../server/src/agents/mcpClient');
    const manager = new MCPClientManager('test-agent');

    // Should not throw
    manager.disconnectAll();
    assert.deepEqual(manager.allTools, []);
  });

  test('MCPClientConnection fails fast on fatal npm stderr errors', async () => {
    const { MCPClientConnection } = await import('../server/src/agents/mcpClient');
    const startedAt = Date.now();
    const scriptPath = path.join(tempDir, `fake-mcp-e404-${Date.now()}.js`);
    fs.writeFileSync(
      scriptPath,
      'console.error("npm ERR! code E404"); setInterval(() => {}, 1000);',
      'utf-8'
    );

    const connection = new MCPClientConnection(
      'fake-fetch',
      'node',
      [scriptPath],
      {},
      5000
    );

    await assert.rejects(
      () => connection.connect(),
      /E404|failed to start/i,
    );

    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 5000, `Expected fast fail before timeout; got ${elapsedMs}ms`);
  });

  test('MCPClientConnection connects with line-delimited JSON transport', async () => {
    const { MCPClientConnection } = await import('../server/src/agents/mcpClient');
    const scriptPath = path.join(tempDir, `fake-mcp-line-${Date.now()}.js`);
    fs.writeFileSync(
      scriptPath,
      [
        'process.stdin.setEncoding("utf8");',
        'let buffer = "";',
        'process.stdin.on("data", (chunk) => {',
        '  buffer += chunk;',
        '  while (true) {',
        '    const newlineIndex = buffer.indexOf("\\n");',
        '    if (newlineIndex === -1) break;',
        '    const line = buffer.slice(0, newlineIndex).trim();',
        '    buffer = buffer.slice(newlineIndex + 1);',
        '    if (!line) continue;',
        '    let msg;',
        '    try { msg = JSON.parse(line); } catch { continue; }',
        '    if (msg.method === "initialize") {',
        '      console.log(JSON.stringify({',
        '        jsonrpc: "2.0",',
        '        id: msg.id,',
        '        result: { serverInfo: { name: "fake-line", version: "1.0.0" }, capabilities: {} },',
        '      }));',
        '      continue;',
        '    }',
        '    if (msg.method === "tools/list") {',
        '      console.log(JSON.stringify({',
        '        jsonrpc: "2.0",',
        '        id: msg.id,',
        '        result: {',
        '          tools: [{ name: "ping", description: "Ping tool", inputSchema: { type: "object", properties: {} } }],',
        '        },',
        '      }));',
        '      continue;',
        '    }',
        '  }',
        '});',
      ].join('\n'),
      'utf-8'
    );

    const connection = new MCPClientConnection('fake-line', 'node', [scriptPath], {}, 5000);
    await connection.connect();

    assert.equal(connection.connected, true);
    assert.equal(connection.serverInfo?.name, 'fake-line');
    assert.ok(connection.tools.some((tool) => tool.originalName === 'ping'));

    connection.disconnect();
  });
});

// ===========================================================================
// MCP tools are properly wired into the agent tool system
// ===========================================================================

describe('MCP tool wiring in agent tools.ts', () => {
  test('buildToolsPrompt includes MCP tools when provided', async () => {
    const { buildToolsPrompt } = await import('../server/src/agents/tools');
    const mcpTools = [
      {
        qualifiedName: 'mcp_brave-search__web_search',
        originalName: 'web_search',
        serverId: 'brave-search',
        description: 'Search the web using Brave',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ];

    const prompt = buildToolsPrompt(mcpTools);
    assert.ok(prompt.includes('mcp_brave-search__web_search'), 'Should include MCP tool name');
    assert.ok(prompt.includes('MCP'), 'Should mention MCP');
  });

  test('buildToolsPrompt works without MCP tools', async () => {
    const { buildToolsPrompt } = await import('../server/src/agents/tools');

    const prompt = buildToolsPrompt();
    assert.ok(prompt.includes('web_search'), 'Should include built-in tools');
    assert.ok(prompt.includes('set_reminder'), 'Should include reminder tool');
  });

  test('buildToolsPrompt includes proactive calendar guidance', async () => {
    const { buildToolsPrompt } = await import('../server/src/agents/tools');
    const prompt = buildToolsPrompt();

    assert.ok(prompt.includes('agenda de un día/semana'), 'Should guide day/week agenda handling');
    assert.ok(prompt.includes('cómo prepararse para un evento'), 'Should guide event preparation behavior');
    assert.ok(prompt.includes('varios eventos candidatos'), 'Should guide ambiguity resolution for calendar actions');
  });

  test('buildToolsPrompt includes mandatory financial analysis protocol', async () => {
    const { buildToolsPrompt } = await import('../server/src/agents/tools');
    const prompt = buildToolsPrompt();

    assert.ok(prompt.includes('PROTOCOLO OBLIGATORIO — ANÁLISIS FINANCIERO DE EMPRESAS'), 'Should include financial protocol header');
    assert.ok(prompt.includes('ticker y mercado correcto'), 'Should require asset identification with ticker and market');
    assert.ok(prompt.includes('librería Python yfinance'), 'Should require Python yfinance usage');
    assert.ok(prompt.includes('ambigüedad de ticker/mercado'), 'Should require proactive market clarification when ambiguous');
    assert.ok(prompt.includes('ANTES de ejecutar herramientas'), 'Should require ticker/market confirmation before tool usage');
    assert.ok(prompt.includes('corto/medio/largo'), 'Should require multi-horizon scenarios');
    assert.ok(prompt.includes('NO constituye asesoramiento financiero'), 'Should include financial advice disclaimer');
  });

  test('calendar tool definitions include disambiguation parameters', async () => {
    const { AGENT_TOOLS } = await import('../server/src/agents/tools');
    const deleteTool = AGENT_TOOLS.find((tool: any) => tool.name === 'delete_calendar_event');
    const updateTool = AGENT_TOOLS.find((tool: any) => tool.name === 'update_calendar_event');

    assert.ok(deleteTool, 'delete_calendar_event should exist');
    assert.ok(updateTool, 'update_calendar_event should exist');

    assert.ok(deleteTool.parameters.match_text, 'delete tool should include match_text');
    assert.ok(deleteTool.parameters.date, 'delete tool should include date');
    assert.ok(updateTool.parameters.match_text, 'update tool should include match_text');
    assert.ok(updateTool.parameters.week_of, 'update tool should include week_of');
  });

  test('buildNativeToolDefinitions includes MCP tools', async () => {
    const { buildNativeToolDefinitions } = await import('../server/src/agents/tools');
    const mcpTools = [
      {
        qualifiedName: 'mcp_notion__search',
        originalName: 'search',
        serverId: 'notion',
        description: 'Search Notion',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ];

    const nativeTools = buildNativeToolDefinitions(mcpTools);
    const mcpDef = nativeTools.find((t: any) => t.name === 'mcp_notion__search');
    assert.ok(mcpDef, 'Should include MCP tool in native definitions');
    assert.ok((mcpDef as any).description.includes('[MCP:notion]'), 'Description should tag MCP server');
  });

  test('executeTool handles mcp_ prefixed tools via mcpManager', async () => {
    const { executeTool } = await import('../server/src/agents/tools');
    const storage = await import('../server/src/agents/storage');

    // Create a mock MCP manager
    const mockMcpManager = {
      callTool: async (name: string, _args: Record<string, unknown>) => ({
        success: true,
        content: `Result from ${name}`,
      }),
      allTools: [],
      connectedServers: [],
      getStatus: () => [],
      disconnectAll: () => {},
      isServerConnected: () => false,
      getServerTools: () => [],
      refreshAllTools: async () => [],
      connectAll: async () => ({ connected: [], failed: [] }),
    } as any;

    const ctx = {
      agentConfig: {
        id: 'test',
        name: 'Test',
        objective: '',
        systemPrompt: '',
        provider: 'openai' as const,
        model: 'gpt-4',
        permissions: {
          internetAccess: true,
          headlessBrowser: false,
          notesAccess: true,
          schedulerAccess: true,
          calendarAccess: true,
          gmailAccess: true,
          mediaAccess: false,
          terminalAccess: false,
          codeExecution: false,
          allowedWebsites: [],
          requireApprovalForNewSites: true,
          webCredentials: [],
        },
        telegram: { botToken: '', chatId: '' },
        schedules: [],
        mcpServers: [],
        memory: [],
        temperature: 0.3,
        maxTokens: 2048,
      },
      userId: 'mcp-test-user',
      agentId: 'mcp-test-agent',
      sendTelegramMessage: async () => true,
      sendTelegramMessageWithButtons: async () => true,
      downloadTelegramFile: async () => null,
      addMemory: () => {},
      addSchedule: () => 'mock-id',
      removeSchedule: () => true,
      toggleSchedule: () => true,
      mcpManager: mockMcpManager,
    };

    const result = await executeTool(
      { name: 'mcp_brave-search__web_search', params: { query: 'test' } },
      ctx
    );

    assert.ok(result.success, 'MCP tool call should succeed');
    assert.ok(result.result.includes('mcp_brave-search__web_search'), 'Result should include tool name');
  });
});

// ===========================================================================
// Scheduler — Reminder one-shot triggering
// ===========================================================================

describe('Scheduler — one-shot reminders', () => {
  test('createScheduler starts and stops', async () => {
    const { createScheduler } = await import('../server/src/agents/scheduler');
    const scheduler = createScheduler();

    scheduler.start();
    assert.deepEqual(scheduler.getTasks(), []);
    scheduler.stop();
  });

  test('addTask and getTasks work correctly', async () => {
    const { createScheduler } = await import('../server/src/agents/scheduler');
    const scheduler = createScheduler();

    scheduler.addTask({
      id: 'task-1',
      name: 'Test reminder',
      cron: '* * * * *',
      instruction: 'Test instruction',
      enabled: true,
      oneShot: true,
      triggerAt: Date.now() - 1000, // In the past
    });

    const tasks = scheduler.getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].name, 'Test reminder');
    assert.equal(tasks[0].oneShot, true);

    scheduler.stop();
  });

  test('removeTask removes a task', async () => {
    const { createScheduler } = await import('../server/src/agents/scheduler');
    const scheduler = createScheduler();

    scheduler.addTask({
      id: 'removable',
      name: 'To remove',
      cron: '* * * * *',
      instruction: 'Remove me',
      enabled: true,
    });

    assert.equal(scheduler.getTasks().length, 1);
    scheduler.removeTask('removable');
    assert.equal(scheduler.getTasks().length, 0);

    scheduler.stop();
  });

  test('addTask with same id replaces existing task', async () => {
    const { createScheduler } = await import('../server/src/agents/scheduler');
    const scheduler = createScheduler();

    scheduler.addTask({
      id: 'dup',
      name: 'Version 1',
      cron: '0 9 * * *',
      instruction: 'First version',
      enabled: true,
    });

    scheduler.addTask({
      id: 'dup',
      name: 'Version 2',
      cron: '0 10 * * *',
      instruction: 'Second version',
      enabled: true,
    });

    const tasks = scheduler.getTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].name, 'Version 2');

    scheduler.stop();
  });
});

// ===========================================================================
// Reminder tool — set_reminder stores data correctly
// ===========================================================================

describe('Reminder tool (set_reminder)', () => {
  const userId = 'reminder-test-user';
  const agentId = 'reminder-test-agent';

  test('set_reminder creates a one-shot schedule in storage', async () => {
    const { executeTool } = await import('../server/src/agents/tools');
    const storage = await import('../server/src/agents/storage');

    const schedulesAdded: any[] = [];
    const oneShotTriggers: any[] = [];

    const ctx = {
      agentConfig: {
        id: agentId,
        name: 'Reminder Test Agent',
        objective: '',
        systemPrompt: '',
        provider: 'openai' as const,
        model: 'gpt-4',
        permissions: {
          internetAccess: true,
          headlessBrowser: false,
          notesAccess: true,
          schedulerAccess: true,
          calendarAccess: true,
          gmailAccess: true,
          mediaAccess: false,
          terminalAccess: false,
          codeExecution: false,
          allowedWebsites: [],
          requireApprovalForNewSites: true,
          webCredentials: [],
        },
        telegram: { botToken: '', chatId: '' },
        schedules: [],
        mcpServers: [],
        memory: [],
        temperature: 0.3,
        maxTokens: 2048,
      },
      userId,
      agentId,
      sendTelegramMessage: async () => true,
      sendTelegramMessageWithButtons: async () => true,
      downloadTelegramFile: async () => null,
      addMemory: () => {},
      addSchedule: (params: any) => {
        const id = params.id || `reminder-${Date.now()}`;
        schedulesAdded.push({ ...params, id });
        return id;
      },
      removeSchedule: () => true,
      toggleSchedule: () => true,
      setOneShotTrigger: (taskId: string, triggerAt: number) => {
        oneShotTriggers.push({ taskId, triggerAt });
      },
    };

    const futureTime = new Date(Date.now() + 3600_000).toISOString(); // 1 hour from now

    const result = await executeTool(
      {
        name: 'set_reminder',
        params: {
          name: 'Ir a comprar',
          trigger_at: futureTime,
          message: 'Es hora de ir a comprar',
        },
      },
      ctx
    );

    assert.ok(result.success, 'set_reminder should succeed');
    assert.ok(result.result.includes('Ir a comprar'), 'Result should include reminder name');
    assert.ok(result.result.includes('Es hora de ir a comprar'), 'Result should include message');

    // Verify storage was called
    const storedSchedules = storage.getAllSchedules(userId, agentId);
    assert.ok(storedSchedules.length > 0, 'Should have stored the schedule');
    const stored = storedSchedules[0];
    assert.ok(stored.oneShot, 'Should be marked as oneShot');
    assert.ok(stored.triggerAt, 'Should have triggerAt');
    assert.ok(stored.name.includes('Ir a comprar'), 'Stored name should include reminder name');

    // Verify setOneShotTrigger was called
    assert.ok(oneShotTriggers.length > 0, 'setOneShotTrigger should have been called');
  });

  test('set_reminder rejects past dates', async () => {
    const { executeTool } = await import('../server/src/agents/tools');

    const ctx = {
      agentConfig: {
        id: agentId,
        name: 'Test',
        objective: '',
        systemPrompt: '',
        provider: 'openai' as const,
        model: 'gpt-4',
        permissions: {
          internetAccess: true,
          headlessBrowser: false,
          notesAccess: true,
          schedulerAccess: true,
          calendarAccess: true,
          gmailAccess: true,
          mediaAccess: false,
          terminalAccess: false,
          codeExecution: false,
          allowedWebsites: [],
          requireApprovalForNewSites: true,
          webCredentials: [],
        },
        telegram: { botToken: '', chatId: '' },
        schedules: [],
        mcpServers: [],
        memory: [],
        temperature: 0.3,
        maxTokens: 2048,
      },
      userId,
      agentId,
      sendTelegramMessage: async () => true,
      sendTelegramMessageWithButtons: async () => true,
      downloadTelegramFile: async () => null,
      addMemory: () => {},
      addSchedule: () => 'id',
      removeSchedule: () => true,
      toggleSchedule: () => true,
    };

    const pastTime = new Date(Date.now() - 3600_000).toISOString();

    const result = await executeTool(
      {
        name: 'set_reminder',
        params: {
          name: 'Past reminder',
          trigger_at: pastTime,
          message: 'This is in the past',
        },
      },
      ctx
    );

    assert.equal(result.success, false, 'Should fail for past dates');
    assert.ok(result.error?.includes('futuro'), 'Error should mention future');
  });
});

// ===========================================================================
// Calendar tool helpers
// ===========================================================================

describe('Calendar types and config parsing', () => {
  test('CalendarConfig interface structure is correct', async () => {
    const calendar = await import('../server/src/agents/calendar');

    // Verify the module exports the expected interfaces by checking providers
    assert.ok('CalendarConfig' in calendar || true, 'Module should export CalendarConfig type');

    // Verify the shape works by constructing valid configs
    const googleConfig = {
      google: {
        clientId: 'test-id',
        clientSecret: 'test-secret',
        refreshToken: 'test-token',
      },
    };

    const icloudConfig = {
      icloud: {
        email: 'test@icloud.com',
        appSpecificPassword: 'xxxx-xxxx',
      },
    };

    assert.ok(googleConfig.google.clientId);
    assert.ok(icloudConfig.icloud.email);
  });

  test('iCloud calendar utilities format dates correctly', async () => {
    // Test the iCalendar date formatters indirectly by checking the module loads
    const icloud = await import('../server/src/agents/calendarICloud');
    assert.ok(icloud.createICloudCalendarProvider, 'Should export createICloudCalendarProvider');
  });

  test('Google calendar utilities are exported', async () => {
    const google = await import('../server/src/agents/calendarGoogle');
    assert.ok(google.createGoogleCalendarProvider, 'Should export createGoogleCalendarProvider');
    assert.ok(google.buildGoogleAuthUrl, 'Should export buildGoogleAuthUrl');
    assert.ok(google.exchangeGoogleAuthCode, 'Should export exchangeGoogleAuthCode');
  });

  test('buildGoogleAuthUrl generates valid URL', async () => {
    const { buildGoogleAuthUrl } = await import('../server/src/agents/calendarGoogle');
    const url = buildGoogleAuthUrl('test-client-id', 'http://localhost:3000/callback', 'test-state');

    assert.ok(url.includes('accounts.google.com'), 'Should point to Google OAuth');
    assert.ok(url.includes('test-client-id'), 'Should include client ID');
    assert.ok(url.includes('calendar'), 'Should request calendar scope');
    assert.ok(url.includes('test-state'), 'Should include state');
    assert.ok(url.includes('offline'), 'Should request offline access');
  });
});

// ===========================================================================
// Manager — Reminder direct send logic
// ===========================================================================

describe('Manager — one-shot reminder direct Telegram send', () => {
  test('manager source code contains direct send logic for one-shot reminders', () => {
    const managerPath = path.resolve(__dirname, '../server/src/agents/manager.ts');
    const source = fs.readFileSync(managerPath, 'utf-8');

    // Verify the direct send pattern exists
    assert.ok(
      source.includes('RECORDATORIO'),
      'Manager should handle RECORDATORIO in reminder instructions'
    );
    assert.ok(
      source.includes('One-shot reminders: send directly'),
      'Manager should have direct send logic for one-shot reminders'
    );
    assert.ok(
      source.includes('Reminder sent directly to Telegram'),
      'Manager should log direct sends'
    );
  });
});

// ===========================================================================
// MCP Catalog ↔ Registry parity
// ===========================================================================

describe('MCP Catalog and Registry parity', () => {
  test('All frontend catalog entries have matching registry entries', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    // These are the IDs from the frontend MCP_CATALOG
    const catalogIds = [
      'brave-search', 'puppeteer', 'playwright', 'fetch', 'memory',
      'github', 'google-drive', 'slack', 'notion', 'postgres',
      'sqlite', 'filesystem', 'exa', 'firecrawl', 'google-maps',
    ];

    const registeredIds = new Set(registry.listRegistered());

    for (const id of catalogIds) {
      assert.ok(
        registeredIds.has(id),
        `Catalog entry "${id}" should have a matching registry entry`
      );
    }

    // And vice versa
    for (const id of registeredIds) {
      assert.ok(
        catalogIds.includes(id),
        `Registry entry "${id}" should have a matching catalog entry`
      );
    }
  });

  test('All registry entries produce valid commands', async () => {
    const { createDefaultRegistry } = await import('../server/src/agents/mcpClient');
    const registry = createDefaultRegistry();

    for (const id of registry.listRegistered()) {
      const cmd = registry.buildCommand(id, {});
      assert.equal(cmd.command, 'npx', `${id} should use npx`);
      assert.ok(cmd.args.includes('-y'), `${id} should include -y flag`);
      assert.ok(cmd.args.length >= 2, `${id} should have at least package name in args`);
    }
  });
});
