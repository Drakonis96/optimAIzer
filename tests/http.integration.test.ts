import assert from 'node:assert/strict';
import { once } from 'node:events';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimaizer-http-it-'));
const dbPath = path.join(tempDir, 'integration.db');
const agentsDataRoot = path.join(tempDir, 'agents-data');

let appServer: http.Server | null = null;
let shutdownApp: (() => Promise<void>) | null = null;
let baseUrl = '';

let fakeTelegramServer: http.Server | null = null;
let telegramBaseUrl = '';
const telegramRequests: Array<{ token: string; method: string; body: any }> = [];

const jsonResponse = (res: ServerResponse, statusCode: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
};

const readJsonBody = async (req: IncomingMessage): Promise<any> => {
  let raw = '';
  for await (const chunk of req) {
    raw += String(chunk);
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const closeServer = async (server: http.Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const parseSessionCookie = (setCookieHeader: string | null): string => {
  const match = (setCookieHeader || '').match(/optimaizer_session=[^;]+/);
  return match ? match[0] : '';
};

const apiRequest = async (
  routePath: string,
  options?: { method?: string; body?: unknown; cookie?: string }
): Promise<{ status: number; body: any; sessionCookie: string }> => {
  const response = await fetch(`${baseUrl}${routePath}`, {
    method: options?.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options?.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return {
    status: response.status,
    body: payload,
    sessionCookie: parseSessionCookie(response.headers.get('set-cookie')),
  };
};

before(async () => {
  fakeTelegramServer = http.createServer(async (req, res) => {
    const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '/';
    const parts = pathname.split('/').filter(Boolean);
    const botPath = parts[0] || '';
    const method = parts[1] || '';
    const token = botPath.startsWith('bot') ? botPath.slice(3) : '';
    const body = req.method === 'POST' ? await readJsonBody(req) : {};

    if (!token || !method) {
      jsonResponse(res, 404, { ok: false, description: 'Invalid Telegram path' });
      return;
    }

    telegramRequests.push({ token, method, body });

    if (method === 'getMe') {
      if (token === 'invalid-token') {
        jsonResponse(res, 200, { ok: false, description: 'Unauthorized' });
        return;
      }
      jsonResponse(res, 200, { ok: true, result: { username: 'test_bot' } });
      return;
    }

    if (method === 'sendMessage') {
      if (String(body?.chat_id || '') === 'blocked-chat') {
        jsonResponse(res, 200, { ok: false, description: 'chat not found' });
        return;
      }
      jsonResponse(res, 200, { ok: true, result: { message_id: Date.now() } });
      return;
    }

    if (method === 'getUpdates') {
      jsonResponse(res, 200, { ok: true, result: [] });
      return;
    }

    if (method === 'sendChatAction') {
      jsonResponse(res, 200, { ok: true, result: true });
      return;
    }

    jsonResponse(res, 404, { ok: false, description: `Unknown method: ${method}` });
  });

  fakeTelegramServer.listen(0, '127.0.0.1');
  if (!fakeTelegramServer.listening) {
    await once(fakeTelegramServer, 'listening');
  }
  const telegramAddress = fakeTelegramServer.address();
  assert.ok(telegramAddress && typeof telegramAddress === 'object');
  telegramBaseUrl = `http://127.0.0.1:${telegramAddress.port}`;

  process.env.OPTIMAIZER_DB_PATH = dbPath;
  process.env.OPTIMAIZER_AGENTS_DATA_ROOT = agentsDataRoot;
  process.env.TELEGRAM_API_BASE_URL = telegramBaseUrl;
  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY = 'http-integration-tests-key';

  const serverIndex = await import('../server/src/index');
  const started = serverIndex.startServer({ port: 0, registerSignalHandlers: false });
  appServer = started.server;
  shutdownApp = started.shutdown;

  if (!appServer.listening) {
    await once(appServer, 'listening');
  }

  const appAddress = appServer.address();
  assert.ok(appAddress && typeof appAddress === 'object');
  baseUrl = `http://127.0.0.1:${appAddress.port}`;
});

after(async () => {
  const manager = await import('../server/src/agents/manager');
  manager.stopAllAgents();

  if (shutdownApp) {
    await shutdownApp();
  } else if (appServer) {
    await closeServer(appServer);
  }

  const database = await import('../server/src/database');
  database.closeDatabase();

  if (fakeTelegramServer) {
    await closeServer(fakeTelegramServer);
  }

  delete process.env.OPTIMAIZER_DB_PATH;
  delete process.env.OPTIMAIZER_AGENTS_DATA_ROOT;
  delete process.env.TELEGRAM_API_BASE_URL;
  delete process.env.PORT;
  delete process.env.NODE_ENV;
  delete process.env.CORS_ORIGIN;
  delete process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY;

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('HTTP integración auth: login, /me y permisos admin', async () => {
  const invalidLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong' },
  });
  assert.equal(invalidLogin.status, 401);

  const adminLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  assert.equal(adminLogin.status, 200);
  assert.ok(adminLogin.sessionCookie);

  const me = await apiRequest('/api/auth/me', {
    cookie: adminLogin.sessionCookie,
  });
  assert.equal(me.status, 200);
  assert.equal(me.body?.user?.username, 'admin');
  assert.equal(me.body?.user?.role, 'admin');

  const createdUser = await apiRequest('/api/auth/users', {
    method: 'POST',
    cookie: adminLogin.sessionCookie,
    body: {
      username: 'http_user',
      password: 'pass1234',
      role: 'user',
    },
  });
  assert.equal(createdUser.status, 201);
  assert.equal(createdUser.body?.user?.username, 'http_user');

  const userLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { username: 'http_user', password: 'pass1234' },
  });
  assert.equal(userLogin.status, 200);
  assert.ok(userLogin.sessionCookie);

  const usersAsRegular = await apiRequest('/api/auth/users', {
    cookie: userLogin.sessionCookie,
  });
  assert.equal(usersAsRegular.status, 403);
  assert.equal(usersAsRegular.body?.error, 'Insufficient permissions.');
});

test('HTTP integración agentes: deploy/status/running/stop + mensajes telegram', async () => {
  const adminLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.sessionCookie;
  assert.ok(adminCookie);

  const baselineRequests = telegramRequests.length;
  const agentId = `agent-http-${Date.now()}`;

  const deploy = await apiRequest('/api/agents/deploy', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      id: agentId,
      name: 'HTTP Integration Agent',
      objective: 'Probar deploy y stop',
      systemPrompt: 'Eres un agente de pruebas.',
      setupProvider: 'openai',
      setupModel: 'gpt-4o-mini',
      permissions: {
        internetAccess: true,
        headlessBrowser: true,
        allowedWebsites: [],
        requireApprovalForNewSites: true,
        webCredentials: [],
      },
      integrations: {
        telegram: {
          botToken: 'test-token',
          chatId: '12345',
        },
        mcpServers: [],
      },
      schedules: [],
      trainingMemory: [],
    },
  });
  assert.equal(deploy.status, 200);
  assert.equal(deploy.body?.success, true);
  assert.equal(deploy.body?.agentId, agentId);

  const statusRunning = await apiRequest(`/api/agents/${agentId}/status`, {
    cookie: adminCookie,
  });
  assert.equal(statusRunning.status, 200);
  assert.equal(statusRunning.body?.running, true);

  const running = await apiRequest('/api/agents/running', {
    cookie: adminCookie,
  });
  assert.equal(running.status, 200);
  assert.ok(Array.isArray(running.body?.agents));
  assert.ok(running.body.agents.includes(agentId));

  const stopped = await apiRequest(`/api/agents/${agentId}/stop`, {
    method: 'POST',
    cookie: adminCookie,
  });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body?.success, true);

  const statusStopped = await apiRequest(`/api/agents/${agentId}/status`, {
    cookie: adminCookie,
  });
  assert.equal(statusStopped.status, 200);
  assert.equal(statusStopped.body?.running, false);

  await new Promise((resolve) => setTimeout(resolve, 120));

  const newRequests = telegramRequests.slice(baselineRequests);
  const sentTexts = newRequests
    .filter((entry) => entry.method === 'sendMessage')
    .map((entry) => String(entry.body?.text || ''));

  assert.ok(sentTexts.some((text) => text.includes('Agente conectado y listo')));
  assert.ok(sentTexts.some((text) => text.includes('Agente desconectado')));
});

test('HTTP integración verify-telegram: bot válido, chat inválido y token inválido', async () => {
  const adminLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.sessionCookie;

  const valid = await apiRequest('/api/agents/verify-telegram', {
    method: 'POST',
    cookie: adminCookie,
    body: { botToken: 'test-token', chatId: '12345' },
  });
  assert.equal(valid.status, 200);
  assert.equal(valid.body?.valid, true);
  assert.equal(valid.body?.chatIdValid, true);
  assert.equal(valid.body?.botName, 'test_bot');

  const blockedChat = await apiRequest('/api/agents/verify-telegram', {
    method: 'POST',
    cookie: adminCookie,
    body: { botToken: 'test-token', chatId: 'blocked-chat' },
  });
  assert.equal(blockedChat.status, 200);
  assert.equal(blockedChat.body?.valid, true);
  assert.equal(blockedChat.body?.chatIdValid, false);

  const invalidToken = await apiRequest('/api/agents/verify-telegram', {
    method: 'POST',
    cookie: adminCookie,
    body: { botToken: 'invalid-token', chatId: '12345' },
  });
  assert.equal(invalidToken.status, 200);
  assert.equal(invalidToken.body?.valid, false);
});

test('HTTP integración agentes: CRUD notas/listas/scheduler + reset memoria + costes por periodos', async () => {
  const adminLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin' },
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = adminLogin.sessionCookie;
  assert.ok(adminCookie);

  const agentId = `agent-data-${Date.now()}`;

  const createdNote = await apiRequest(`/api/agents/${agentId}/notes`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      title: 'Nota integración',
      content: 'Contenido inicial',
      tags: ['qa', 'integration'],
    },
  });
  assert.equal(createdNote.status, 201);
  assert.equal(createdNote.body?.note?.title, 'Nota integración');
  const noteId = String(createdNote.body?.note?.id || '');
  assert.ok(noteId);

  const notesList = await apiRequest(`/api/agents/${agentId}/notes`, {
    cookie: adminCookie,
  });
  assert.equal(notesList.status, 200);
  assert.ok(Array.isArray(notesList.body?.notes));
  assert.ok(notesList.body.notes.some((item: any) => item.id === noteId));

  const updatedNote = await apiRequest(`/api/agents/${agentId}/notes/${noteId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      title: 'Nota integración actualizada',
      content: 'Contenido actualizado',
      tags: 'qa,updated',
    },
  });
  assert.equal(updatedNote.status, 200);
  assert.equal(updatedNote.body?.note?.title, 'Nota integración actualizada');

  const deletedNote = await apiRequest(`/api/agents/${agentId}/notes/${noteId}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(deletedNote.status, 200);
  assert.equal(deletedNote.body?.success, true);

  const createdList = await apiRequest(`/api/agents/${agentId}/lists`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      title: 'Lista integración',
      items: ['uno', 'dos'],
    },
  });
  assert.equal(createdList.status, 201);
  const listId = String(createdList.body?.list?.id || '');
  assert.ok(listId);
  assert.equal(createdList.body?.list?.title, 'Lista integración');

  const fetchedList = await apiRequest(`/api/agents/${agentId}/lists/${listId}`, {
    cookie: adminCookie,
  });
  assert.equal(fetchedList.status, 200);
  assert.equal(fetchedList.body?.list?.id, listId);

  const updatedList = await apiRequest(`/api/agents/${agentId}/lists/${listId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      title: 'Lista integración actualizada',
    },
  });
  assert.equal(updatedList.status, 200);
  assert.equal(updatedList.body?.list?.title, 'Lista integración actualizada');

  const addedListItems = await apiRequest(`/api/agents/${agentId}/lists/${listId}/items`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      items: ['tres', 'cuatro'],
    },
  });
  assert.equal(addedListItems.status, 200);
  const firstItemId = String(addedListItems.body?.list?.items?.[0]?.id || '');
  assert.ok(firstItemId);

  const toggledItem = await apiRequest(`/api/agents/${agentId}/lists/${listId}/items/${firstItemId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      checked: true,
    },
  });
  assert.equal(toggledItem.status, 200);
  assert.equal(
    toggledItem.body?.list?.items?.find((item: any) => item.id === firstItemId)?.checked,
    true
  );

  const deletedItem = await apiRequest(`/api/agents/${agentId}/lists/${listId}/items/${firstItemId}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(deletedItem.status, 200);
  assert.ok(Array.isArray(deletedItem.body?.list?.items));
  assert.ok(!deletedItem.body.list.items.some((item: any) => item.id === firstItemId));

  const deletedList = await apiRequest(`/api/agents/${agentId}/lists/${listId}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(deletedList.status, 200);
  assert.equal(deletedList.body?.success, true);

  const createdSchedule = await apiRequest(`/api/agents/${agentId}/schedules`, {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'Schedule integración',
      cron: '0 9 * * *',
      instruction: 'Enviar resumen diario',
      enabled: true,
    },
  });
  assert.equal(createdSchedule.status, 201);
  const scheduleId = String(createdSchedule.body?.schedule?.id || '');
  assert.ok(scheduleId);

  const allSchedules = await apiRequest(`/api/agents/${agentId}/schedules`, {
    cookie: adminCookie,
  });
  assert.equal(allSchedules.status, 200);
  assert.ok(Array.isArray(allSchedules.body?.schedules));
  assert.ok(allSchedules.body.schedules.some((item: any) => item.id === scheduleId));

  const fetchedSchedule = await apiRequest(`/api/agents/${agentId}/schedules/${scheduleId}`, {
    cookie: adminCookie,
  });
  assert.equal(fetchedSchedule.status, 200);
  assert.equal(fetchedSchedule.body?.schedule?.id, scheduleId);

  const updatedSchedule = await apiRequest(`/api/agents/${agentId}/schedules/${scheduleId}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: {
      enabled: false,
      frequency: 'daily',
    },
  });
  assert.equal(updatedSchedule.status, 200);
  assert.equal(updatedSchedule.body?.schedule?.enabled, false);
  assert.equal(updatedSchedule.body?.schedule?.frequency, 'daily');

  const deletedSchedule = await apiRequest(`/api/agents/${agentId}/schedules/${scheduleId}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(deletedSchedule.status, 200);
  assert.equal(deletedSchedule.body?.success, true);

  const memoryReset = await apiRequest(`/api/agents/${agentId}/memory/reset`, {
    method: 'POST',
    cookie: adminCookie,
  });
  assert.equal(memoryReset.status, 200);
  assert.equal(memoryReset.body?.success, true);
  assert.equal(memoryReset.body?.agentId, agentId);
  assert.equal(typeof memoryReset.body?.clearedPersistentMessages, 'number');

  const costs = await apiRequest(`/api/agents/${agentId}/costs`, {
    cookie: adminCookie,
  });
  assert.equal(costs.status, 200);
  assert.equal(costs.body?.agentId, agentId);
  assert.ok(costs.body?.periods?.lastDay);
  assert.ok(costs.body?.periods?.lastWeek);
  assert.ok(costs.body?.periods?.lastMonth);
  assert.ok(costs.body?.periods?.lastYear);
});
