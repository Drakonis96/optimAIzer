import assert from 'node:assert/strict';
import http, { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import { after, before, test } from 'node:test';

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

const jsonResponse = (res: ServerResponse, statusCode: number, payload: unknown): void => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
};

let fakeTelegramServer: http.Server | null = null;
const requests: Array<{ method: string; body: any }> = [];
let updatesQueue: any[] = [];

before(async () => {
  fakeTelegramServer = http.createServer(async (req, res) => {
    const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '/';
    const parts = pathname.split('/').filter(Boolean);
    const method = parts[1] || '';
    const body = req.method === 'POST' ? await readJsonBody(req) : {};
    requests.push({ method, body });

    if (method === 'sendMessage') {
      jsonResponse(res, 200, { ok: true, result: { message_id: Date.now() } });
      return;
    }
    if (method === 'getUpdates') {
      const current = updatesQueue;
      updatesQueue = [];
      jsonResponse(res, 200, { ok: true, result: current });
      return;
    }

    jsonResponse(res, 200, { ok: true, result: true });
  });

  fakeTelegramServer.listen(0, '127.0.0.1');
  if (!fakeTelegramServer.listening) {
    await once(fakeTelegramServer, 'listening');
  }
  const address = fakeTelegramServer.address();
  assert.ok(address && typeof address === 'object');
  process.env.TELEGRAM_API_BASE_URL = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  delete process.env.TELEGRAM_API_BASE_URL;
  if (fakeTelegramServer) {
    await closeServer(fakeTelegramServer);
  }
});

test('Telegram bot divide mensajes largos en chunks válidos', async () => {
  const { createTelegramBot } = await import('../server/src/agents/telegram');
  const bot = createTelegramBot('chunk-token', '123');

  const baseline = requests.length;
  const longMessage = 'x'.repeat(9100);
  const ok = await bot.sendMessage('123', longMessage);

  assert.equal(ok, true);
  const sendCalls = requests
    .slice(baseline)
    .filter((entry) => entry.method === 'sendMessage');
  assert.equal(sendCalls.length, 3);
  assert.ok(sendCalls.every((entry) => String(entry.body?.text || '').length <= 4000));
});

test('Telegram bot ignora mensajes no autorizados y responde con rechazo', async () => {
  const { createTelegramBot } = await import('../server/src/agents/telegram');
  const bot = createTelegramBot('auth-token', '123');
  let authorizedMessages = 0;

  bot.onMessage(() => {
    authorizedMessages += 1;
  });

  const baseline = requests.length;
  updatesQueue = [
    {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 999, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: 'hola',
        from: { id: 50, first_name: 'Mallory' },
      },
    },
  ];

  bot.start();
  await new Promise((resolve) => setTimeout(resolve, 150));
  bot.stop();

  assert.equal(authorizedMessages, 0);
  const sendCalls = requests
    .slice(baseline)
    .filter((entry) => entry.method === 'sendMessage')
    .map((entry) => ({
      chatId: String(entry.body?.chat_id || ''),
      text: String(entry.body?.text || ''),
    }));

  assert.ok(sendCalls.some((call) => call.chatId === '999' && call.text.includes('No estás autorizado')));
});
