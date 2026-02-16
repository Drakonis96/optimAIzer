import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Setup: temporary data directory for isolated storage tests
// ---------------------------------------------------------------------------

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimaizer-agent-tools-'));
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

// ---------------------------------------------------------------------------
// Storage layer tests — Lists CRUD
// ---------------------------------------------------------------------------

describe('Agent Storage — Lists CRUD', () => {
  const userId = 'test-user-lists';
  const agentId = 'test-agent-lists';

  test('createList creates a list file and returns correct structure', async () => {
    const storage = await import('../server/src/agents/storage');
    const list = storage.createList(userId, agentId, 'Lista de la compra', ['pan', 'huevos']);

    assert.ok(list.id);
    assert.equal(list.title, 'Lista de la compra');
    assert.equal(list.items.length, 2);
    assert.equal(list.items[0].text, 'pan');
    assert.equal(list.items[0].checked, false);
    assert.equal(list.items[1].text, 'huevos');

    // Verify file was written to disk
    const filePath = path.join(agentsDataRoot, userId, agentId, 'lists', `${list.id}.json`);
    assert.ok(fs.existsSync(filePath), 'List file should exist on disk');

    const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.equal(fileContent.title, 'Lista de la compra');
    assert.equal(fileContent.items.length, 2);
  });

  test('findListByTitle finds a list by exact title match', async () => {
    const storage = await import('../server/src/agents/storage');
    const found = storage.findListByTitle(userId, agentId, 'Lista de la compra');
    assert.ok(found, 'Should find list by exact title');
    assert.equal(found!.title, 'Lista de la compra');
  });

  test('findListByTitle finds a list by partial title match', async () => {
    const storage = await import('../server/src/agents/storage');
    const found = storage.findListByTitle(userId, agentId, 'compra');
    assert.ok(found, 'Should find list by partial title');
    assert.equal(found!.title, 'Lista de la compra');
  });

  test('addItemsToList persists new items to disk', async () => {
    const storage = await import('../server/src/agents/storage');

    const list = storage.findListByTitle(userId, agentId, 'Lista de la compra');
    assert.ok(list);
    const listId = list!.id;

    const updated = storage.addItemsToList(userId, agentId, listId, ['mantequilla', 'leche']);
    assert.ok(updated, 'addItemsToList should return updated list');
    assert.equal(updated!.items.length, 4);
    assert.ok(updated!.items.some(i => i.text === 'mantequilla'));
    assert.ok(updated!.items.some(i => i.text === 'leche'));

    // Verify file was updated on disk
    const filePath = path.join(agentsDataRoot, userId, agentId, 'lists', `${listId}.json`);
    const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.equal(fileContent.items.length, 4);
    assert.ok(fileContent.items.some((i: any) => i.text === 'mantequilla'));
    assert.ok(fileContent.updatedAt > fileContent.createdAt, 'updatedAt should be greater than createdAt');
  });

  test('removeItemFromList persists removal to disk', async () => {
    const storage = await import('../server/src/agents/storage');

    const list = storage.findListByTitle(userId, agentId, 'Lista de la compra');
    assert.ok(list);
    const listId = list!.id;

    const updated = storage.removeItemFromList(userId, agentId, listId, 'pan');
    assert.ok(updated, 'removeItemFromList should return updated list');
    assert.ok(!updated!.items.some(i => i.text === 'pan'), 'pan should be removed');

    // Verify file was updated on disk
    const filePath = path.join(agentsDataRoot, userId, agentId, 'lists', `${listId}.json`);
    const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.ok(!fileContent.items.some((i: any) => i.text === 'pan'), 'pan should not exist in file');
  });

  test('toggleListItem persists check state to disk', async () => {
    const storage = await import('../server/src/agents/storage');

    const list = storage.findListByTitle(userId, agentId, 'Lista de la compra');
    assert.ok(list);
    const listId = list!.id;

    const updated = storage.toggleListItem(userId, agentId, listId, 'huevos', true);
    assert.ok(updated, 'toggleListItem should return updated list');
    const item = updated!.items.find(i => i.text === 'huevos');
    assert.ok(item);
    assert.equal(item!.checked, true);

    // Verify file was updated
    const filePath = path.join(agentsDataRoot, userId, agentId, 'lists', `${listId}.json`);
    const fileContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const fileItem = fileContent.items.find((i: any) => i.text === 'huevos');
    assert.ok(fileItem);
    assert.equal(fileItem.checked, true);
  });

  test('getAllLists returns all lists', async () => {
    const storage = await import('../server/src/agents/storage');

    // Create a second list
    storage.createList(userId, agentId, 'Tareas pendientes', ['estudiar', 'lavar']);

    const allLists = storage.getAllLists(userId, agentId);
    assert.ok(allLists.length >= 2, 'Should have at least 2 lists');
    assert.ok(allLists.some(l => l.title === 'Lista de la compra'));
    assert.ok(allLists.some(l => l.title === 'Tareas pendientes'));
  });

  test('deleteList removes list file from disk', async () => {
    const storage = await import('../server/src/agents/storage');

    const list = storage.findListByTitle(userId, agentId, 'Tareas pendientes');
    assert.ok(list);
    const listId = list!.id;

    const deleted = storage.deleteList(userId, agentId, listId);
    assert.ok(deleted);

    const filePath = path.join(agentsDataRoot, userId, agentId, 'lists', `${listId}.json`);
    assert.ok(!fs.existsSync(filePath), 'List file should be deleted from disk');
  });
});

// ---------------------------------------------------------------------------
// Tool execution tests — verify tool calls actually persist data
// ---------------------------------------------------------------------------

describe('Agent Tool Execution — List Tools', () => {
  const userId = 'test-user-tools';
  const agentId = 'test-agent-tools';

  const buildMockContext = () => ({
    agentConfig: {
      id: agentId,
      name: 'Test Agent',
      objective: '',
      systemPrompt: '',
      provider: 'openrouter' as const,
      model: 'test-model',
      permissions: {
        internetAccess: false,
        headlessBrowser: false,
        notesAccess: true,
        schedulerAccess: true,
        calendarAccess: false,
        gmailAccess: false,
        mediaAccess: false,
        terminalAccess: false,
        codeExecution: false,
        allowedWebsites: [],
        requireApprovalForNewSites: false,
        webCredentials: [],
      },
      telegram: { botToken: '', chatId: '' },
      schedules: [],
      mcpServers: [],
      memory: [],
      temperature: 0.3,
      maxTokens: 2048,
      memoryRecentWindow: 30,
      memoryRecallLimit: 8,
    },
    userId,
    agentId,
    sendTelegramMessage: async () => true,
    addMemory: () => {},
    addSchedule: () => 'sched-1',
    removeSchedule: () => true,
    toggleSchedule: () => true,
  });

  test('create_list tool creates a list and persists it', async () => {
    const { executeTool } = await import('../server/src/agents/tools');
    const storage = await import('../server/src/agents/storage');
    const ctx = buildMockContext();

    const result = await executeTool(
      { name: 'create_list', params: { title: 'Lista de la compra', items: 'pan, huevos, leche' } },
      ctx
    );
    assert.ok(result.success, `Tool should succeed: ${result.error}`);
    assert.ok(result.result.includes('Lista de la compra'));

    // Verify persistence
    const lists = storage.getAllLists(userId, agentId);
    assert.ok(lists.some(l => l.title === 'Lista de la compra'));
    const list = lists.find(l => l.title === 'Lista de la compra')!;
    assert.equal(list.items.length, 3);
    assert.ok(list.items.some(i => i.text === 'pan'));
    assert.ok(list.items.some(i => i.text === 'huevos'));
    assert.ok(list.items.some(i => i.text === 'leche'));
  });

  test('add_to_list tool adds items and persists them', async () => {
    const { executeTool } = await import('../server/src/agents/tools');
    const storage = await import('../server/src/agents/storage');
    const ctx = buildMockContext();

    const result = await executeTool(
      { name: 'add_to_list', params: { title: 'Lista de la compra', items: 'mantequilla, yogur' } },
      ctx
    );
    assert.ok(result.success, `Tool should succeed: ${result.error}`);

    // Verify persistence
    const list = storage.findListByTitle(userId, agentId, 'Lista de la compra');
    assert.ok(list);
    assert.equal(list!.items.length, 5);
    assert.ok(list!.items.some(i => i.text === 'mantequilla'));
    assert.ok(list!.items.some(i => i.text === 'yogur'));
  });

  test('remove_from_list tool removes item and persists change', async () => {
    const { executeTool } = await import('../server/src/agents/tools');
    const storage = await import('../server/src/agents/storage');
    const ctx = buildMockContext();

    const result = await executeTool(
      { name: 'remove_from_list', params: { title: 'Lista de la compra', item: 'pan' } },
      ctx
    );
    assert.ok(result.success, `Tool should succeed: ${result.error}`);

    // Verify persistence
    const list = storage.findListByTitle(userId, agentId, 'Lista de la compra');
    assert.ok(list);
    assert.ok(!list!.items.some(i => i.text === 'pan'), 'pan should be removed');
    // Original items minus pan (3 originals - 1 + 2 added = 4)
    assert.equal(list!.items.length, 4);
  });

  test('check_list_item tool marks item as checked', async () => {
    const { executeTool } = await import('../server/src/agents/tools');
    const storage = await import('../server/src/agents/storage');
    const ctx = buildMockContext();

    const result = await executeTool(
      { name: 'check_list_item', params: { title: 'Lista de la compra', item: 'huevos', checked: 'true' } },
      ctx
    );
    assert.ok(result.success, `Tool should succeed: ${result.error}`);

    // Verify persistence
    const list = storage.findListByTitle(userId, agentId, 'Lista de la compra');
    assert.ok(list);
    const huevos = list!.items.find(i => i.text === 'huevos');
    assert.ok(huevos);
    assert.equal(huevos!.checked, true);
  });

  test('get_list tool retrieves list by title', async () => {
    const { executeTool } = await import('../server/src/agents/tools');
    const ctx = buildMockContext();

    const result = await executeTool(
      { name: 'get_list', params: { title: 'Lista de la compra' } },
      ctx
    );
    assert.ok(result.success, `Tool should succeed: ${result.error}`);
    assert.ok(result.result.includes('Lista de la compra'));
    assert.ok(result.result.includes('huevos'));
  });

  test('Full scenario: create, add, remove, verify — mimicking real agent flow', async () => {
    const { executeTool } = await import('../server/src/agents/tools');
    const storage = await import('../server/src/agents/storage');
    const ctx = buildMockContext();
    const scenarioUserId = 'scenario-user';
    const scenarioAgentId = 'scenario-agent';
    const scenarioCtx = { ...ctx, userId: scenarioUserId, agentId: scenarioAgentId };

    // Step 1: Create list
    const createResult = await executeTool(
      { name: 'create_list', params: { title: 'Compra semanal', items: 'pan, huevos' } },
      scenarioCtx
    );
    assert.ok(createResult.success);

    // Step 2: Add item
    const addResult = await executeTool(
      { name: 'add_to_list', params: { title: 'Compra semanal', items: 'mantequilla' } },
      scenarioCtx
    );
    assert.ok(addResult.success);

    // Step 3: Remove item
    const removeResult = await executeTool(
      { name: 'remove_from_list', params: { title: 'Compra semanal', item: 'pan' } },
      scenarioCtx
    );
    assert.ok(removeResult.success);

    // Step 4: Verify final state on disk
    const list = storage.findListByTitle(scenarioUserId, scenarioAgentId, 'Compra semanal');
    assert.ok(list, 'List should exist');
    assert.equal(list!.items.length, 2, 'Should have 2 items (huevos + mantequilla)');
    assert.ok(list!.items.some(i => i.text === 'huevos'));
    assert.ok(list!.items.some(i => i.text === 'mantequilla'));
    assert.ok(!list!.items.some(i => i.text === 'pan'), 'pan should be removed');
    assert.ok(list!.updatedAt > list!.createdAt, 'updatedAt should reflect modifications');
  });
});

describe('Agent Tool Execution — Critical action approvals', () => {
  test('ha_turn_on solicita aprobación crítica y bloquea si se deniega', async () => {
    const { executeTool } = await import('../server/src/agents/tools');

    const server = http.createServer((req, res) => {
      if (req.url?.includes('/api/services/light/turn_on')) {
        res.setHeader('Content-Type', 'application/json');
        res.end('[]');
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const approvalCalls: Array<{ type: string; reason: string; actionLabel?: string; actionDetails?: string }> = [];
    const ctx = {
      agentConfig: {
        id: 'ha-agent-1',
        name: 'HA Agent',
        objective: '',
        systemPrompt: '',
        provider: 'openrouter' as const,
        model: 'test-model',
        permissions: {
          internetAccess: false,
          headlessBrowser: false,
          notesAccess: true,
          schedulerAccess: true,
          calendarAccess: false,
          gmailAccess: false,
          mediaAccess: false,
          terminalAccess: false,
          codeExecution: false,
          allowedWebsites: [],
          requireApprovalForNewSites: false,
          webCredentials: [],
        },
        telegram: { botToken: '', chatId: '' },
        homeAssistant: {
          url: `http://127.0.0.1:${address.port}`,
          token: 'token',
        },
        schedules: [],
        mcpServers: [],
        memory: [],
      },
      userId: 'critical-user-1',
      agentId: 'critical-agent-1',
      sendTelegramMessage: async () => true,
      addMemory: () => {},
      addSchedule: () => 'sched-1',
      removeSchedule: () => true,
      toggleSchedule: () => true,
      requestApproval: async (request: { type: string; reason: string; actionLabel?: string; actionDetails?: string }) => {
        approvalCalls.push(request);
        return false;
      },
    };

    const result = await executeTool(
      { name: 'ha_turn_on', params: { entity_id: 'light.salon', brightness: 65 } },
      ctx as any
    );

    assert.equal(result.success, false);
    assert.ok((result.error || '').includes('denegado'));
    assert.equal(approvalCalls.length, 1);
    assert.equal(approvalCalls[0].type, 'critical_action');
    assert.ok((approvalCalls[0].actionLabel || '').includes('Home Assistant'));

    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  });

  test('ha_turn_on ejecuta servicio cuando la aprobación crítica es positiva', async () => {
    const { executeTool } = await import('../server/src/agents/tools');

    let haServiceCalls = 0;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url?.includes('/api/services/light/turn_on')) {
        haServiceCalls += 1;
        res.setHeader('Content-Type', 'application/json');
        res.end('[]');
        return;
      }
      res.statusCode = 404;
      res.end('not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    assert.ok(address && typeof address === 'object');

    const ctx = {
      agentConfig: {
        id: 'ha-agent-2',
        name: 'HA Agent',
        objective: '',
        systemPrompt: '',
        provider: 'openrouter' as const,
        model: 'test-model',
        permissions: {
          internetAccess: false,
          headlessBrowser: false,
          notesAccess: true,
          schedulerAccess: true,
          calendarAccess: false,
          gmailAccess: false,
          mediaAccess: false,
          terminalAccess: false,
          codeExecution: false,
          allowedWebsites: [],
          requireApprovalForNewSites: false,
          webCredentials: [],
        },
        telegram: { botToken: '', chatId: '' },
        homeAssistant: {
          url: `http://127.0.0.1:${address.port}`,
          token: 'token',
        },
        schedules: [],
        mcpServers: [],
        memory: [],
      },
      userId: 'critical-user-2',
      agentId: 'critical-agent-2',
      sendTelegramMessage: async () => true,
      addMemory: () => {},
      addSchedule: () => 'sched-1',
      removeSchedule: () => true,
      toggleSchedule: () => true,
      requestApproval: async () => true,
    };

    const result = await executeTool(
      { name: 'ha_turn_on', params: { entity_id: 'light.salon' } },
      ctx as any
    );

    assert.equal(result.success, true, result.error || 'ha_turn_on should succeed when approved');
    assert.equal(haServiceCalls, 1);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  });
});

// ---------------------------------------------------------------------------
// Engine parseToolCalls — verify text-based tool parsing
// ---------------------------------------------------------------------------

describe('Engine — parseToolCalls extracts tool calls from text', () => {
  test('parseToolCalls extracts tool_call tags correctly', async () => {
    const { parseToolCalls } = await import('../server/src/agents/tools');

    const response = `Voy a quitar el pan y añadir mantequilla.

<tool_call>
{"name": "remove_from_list", "params": {"title": "Lista de la compra", "item": "pan"}}
</tool_call>

<tool_call>
{"name": "add_to_list", "params": {"title": "Lista de la compra", "items": "mantequilla"}}
</tool_call>

Listo, he actualizado la lista.`;

    const parsed = parseToolCalls(response);
    assert.equal(parsed.toolCalls.length, 2, 'Should extract 2 tool calls');
    assert.equal(parsed.toolCalls[0].name, 'remove_from_list');
    assert.equal(parsed.toolCalls[0].params.title, 'Lista de la compra');
    assert.equal(parsed.toolCalls[0].params.item, 'pan');
    assert.equal(parsed.toolCalls[1].name, 'add_to_list');
    assert.equal(parsed.toolCalls[1].params.items, 'mantequilla');
    assert.ok(parsed.cleanText.includes('Voy a quitar'));
    assert.ok(!parsed.cleanText.includes('<tool_call>'));
  });

  test('parseToolCalls returns empty when no tool calls present', async () => {
    const { parseToolCalls } = await import('../server/src/agents/tools');

    const response = 'He actualizado la lista de la compra. Ahora tiene huevos y mantequilla.';
    const parsed = parseToolCalls(response);
    assert.equal(parsed.toolCalls.length, 0);
    assert.equal(parsed.cleanText, response);
  });
});

// ---------------------------------------------------------------------------
// OpenRouter provider — chatWithTools should throw on tool-unsupported error
// ---------------------------------------------------------------------------

describe('OpenRouter provider — chatWithTools error handling', () => {
  test('chatWithTools throws on API error instead of silently retrying without tools', async () => {
    // We can't easily mock fetch here, but we verify the provider code structure
    // by checking that the retry-without-tools logic was removed from chatWithTools.
    const providerPath = path.resolve(__dirname, '../server/src/providers/openrouter.ts');
    const providerSource = fs.readFileSync(providerPath, 'utf-8');

    // chatWithTools should NOT contain fallback logic that removes tools
    const chatWithToolsMatch = providerSource.match(
      /async chatWithTools[\s\S]*?(?=async \*?chat(?:Stream|WithTools)?|private |$)/
    );
    assert.ok(chatWithToolsMatch, 'Should find chatWithTools method');

    const methodBody = chatWithToolsMatch![0];

    // Should NOT have the problematic pattern: delete tools + retry
    assert.ok(
      !methodBody.includes('delete fallbackBody.tools'),
      'chatWithTools should not silently retry without tools'
    );
    assert.ok(
      !methodBody.includes('delete fallbackBody.tool_choice'),
      'chatWithTools should not silently drop tool_choice'
    );
  });
});

// ---------------------------------------------------------------------------
// Engine — safety net for native tool calling returning no calls
// ---------------------------------------------------------------------------

describe('Engine — native tool calling fallback safety net', () => {
  test('engine source code contains fallback to parseToolCalls when native returns empty', () => {
    const enginePath = path.resolve(__dirname, '../server/src/agents/engine.ts');
    const engineSource = fs.readFileSync(enginePath, 'utf-8');

    // Verify the safety net exists: when toolCalls.length === 0 and response
    // contains tool-call-like patterns, fall back to parseToolCalls
    assert.ok(
      engineSource.includes('textContainsToolCallPatterns(response)'),
      'Engine should have a fallback that checks for tool-call patterns when native returns no tool calls'
    );
    assert.ok(
      engineSource.includes('parseToolCalls(response)'),
      'Engine should call parseToolCalls as fallback'
    );
  });

  test('parseToolCalls handles "parameters" key (not just "params")', async () => {
    const { parseToolCalls } = await import('../server/src/agents/tools');

    const response = `<tool_call>
{"name": "create_calendar_event", "parameters": {"title": "Reunión", "start_time": "2026-02-14T10:00:00", "end_time": "2026-02-14T11:00:00"}}
</tool_call>`;

    const parsed = parseToolCalls(response);
    assert.equal(parsed.toolCalls.length, 1, 'Should extract 1 tool call');
    assert.equal(parsed.toolCalls[0].name, 'create_calendar_event');
    assert.equal(parsed.toolCalls[0].params.title, 'Reunión');
    assert.equal(parsed.toolCalls[0].params.start_time, '2026-02-14T10:00:00');
  });

  test('parseToolCalls handles bare JSON tool calls', async () => {
    const { parseToolCalls } = await import('../server/src/agents/tools');

    const response = `Voy a crear la nota.
{"name": "create_note", "parameters": {"title": "Test", "content": "Hello world"}}
`;

    const parsed = parseToolCalls(response);
    assert.equal(parsed.toolCalls.length, 1, 'Should extract 1 bare JSON tool call');
    assert.equal(parsed.toolCalls[0].name, 'create_note');
    assert.equal(parsed.toolCalls[0].params.title, 'Test');
  });

  test('parseToolCalls handles compact XML MCP tags with encoded JSON attributes', async () => {
    const { parseToolCalls } = await import('../server/src/agents/tools');

    const response = `Voy a guardar la preferencia en memoria.\n<mcp_memory__create_entities variants="{&quot;entities&quot;:[{&quot;name&quot;:&quot;Jorge&quot;,&quot;type&quot;:&quot;Person&quot;,&quot;observations&quot;:[&quot;Prefiere bullets&quot;]}]}"/>`;

    const parsed = parseToolCalls(response);
    assert.equal(parsed.toolCalls.length, 1, 'Should extract 1 compact XML MCP tool call');
    assert.equal(parsed.toolCalls[0].name, 'mcp_memory__create_entities');
    assert.equal(parsed.toolCalls[0].params.entities[0].name, 'Jorge');
    assert.ok(!parsed.cleanText.includes('mcp_memory__create_entities'));
  });
});
