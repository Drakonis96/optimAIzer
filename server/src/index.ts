import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import type { Server } from 'http';
import { serverConfig } from './config';
import { chatRouter } from './routes/chat';
import { providersRouter } from './routes/providers';
import { healthRouter } from './routes/health';
import { dataRouter } from './routes/data';
import { authRouter } from './routes/auth';
import { agentsRouter } from './routes/agents';
import { webhooksRouter } from './routes/webhooks';
import { errorHandler } from './middleware/errorHandler';
import { closeDatabase, initDatabase } from './database';
import { attachAuthUser, requireAuth } from './middleware/auth';
import { initializeUsers } from './auth/users';
import { initializeSessionStore } from './auth/sessions';
import { initializeUsageStore } from './auth/usage';
import { stopAllAgents, deployAgent, getRunningAgentIds } from './agents/manager';
import { getAllAlwaysOnConfigsGlobal } from './agents/storage';
import { AgentConfig } from './agents/types';
import { buildAgentConfigFromPayload } from './routes/agents';

let coreInitialized = false;

const initializeCore = (): void => {
  if (coreInitialized) return;
  initDatabase();
  initializeUsers();
  initializeSessionStore();
  initializeUsageStore();
  coreInitialized = true;
};

export const createApp = (): express.Express => {
  initializeCore();

  const app = express();

  // --- Security Middleware ---
  app.use(helmet({
    contentSecurityPolicy: false,
  }));

  const allowedOrigins = [
    serverConfig.corsOrigin,
    `http://localhost:${serverConfig.port}`,
  ].filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, curl, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // be permissive for local dev
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  }));

  // Rate limiting — prevent abuse
  const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
  app.use('/api/', limiter);

  // Body parsing
  app.use('/api/data', express.json({ limit: '50mb' }));
  app.use(express.json({ limit: '1mb' }));

  // Attach authenticated user (if session cookie is valid)
  app.use('/api', attachAuthUser);

  // --- OAuth callback (no auth required — Google redirects here) ---
  app.get('/oauth/google/callback', (_req, res) => {
    // Tiny HTML page that relays the authorization code back to the opener
    // window via postMessage, then closes itself.
    res.send(`<!DOCTYPE html>
<html><head><title>Authorizing…</title></head><body>
<p style="font-family:system-ui;text-align:center;margin-top:20vh">Authorizing… you can close this window.</p>
<script>
(function(){
  try {
    var params = new URLSearchParams(window.location.search);
    var code  = params.get('code');
    var state = params.get('state');
    var error = params.get('error');
    if (window.opener) {
      var payload = { type:'google-oauth-callback', code:code, state:state, error:error };
      try { window.opener.postMessage(payload, window.location.origin); } catch (_) {}
      try { window.opener.postMessage(payload, '*'); } catch (_) {}
    }
  } catch(e) {}
  setTimeout(function(){ window.close(); }, 1500);
})();
</script>
</body></html>`);
  });

  // --- Routes ---
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/providers', requireAuth, providersRouter);
  app.use('/api/chat', requireAuth, chatRouter);
  app.use('/api/data', requireAuth, dataRouter);
  app.use('/api/agents', requireAuth, agentsRouter);
  app.use('/api/webhooks', webhooksRouter);

  // --- Error Handler ---
  app.use(errorHandler);

  // --- Serve Frontend (production / single-server mode) ---
  const distPath = path.resolve(__dirname, '../../dist');
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // SPA fallback: serve index.html for any non-API route
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`   Serving frontend from: ${distPath}`);
  }

  return app;
};

// ---------------------------------------------------------------------------
// Always-On: auto-deploy agents that were marked as always-on
// ---------------------------------------------------------------------------

const autoStartAlwaysOnAgents = (): void => {
  try {
    const configs = getAllAlwaysOnConfigsGlobal();
    if (configs.length === 0) return;

    console.log(`\n🔄 Auto-starting ${configs.length} always-on agent(s)...`);

    for (const { userId, agentId, configJson } of configs) {
      try {
        const body = JSON.parse(configJson);
        const config = buildAgentConfigFromPayload(body);
        if (!config) {
          console.warn(`   ⚠️ Agent ${agentId}: invalid config, skipping`);
          continue;
        }
        if (!config.telegram.botToken || !config.telegram.chatId) {
          console.warn(`   ⚠️ Agent ${config.name} (${agentId}): missing Telegram config, skipping`);
          continue;
        }
        const result = deployAgent(config, userId);
        if (result.success) {
          console.log(`   ✅ Agent "${config.name}" (${agentId}) auto-started`);
        } else {
          console.warn(`   ❌ Agent "${config.name}" (${agentId}): ${result.error}`);
        }
      } catch (error: any) {
        console.error(`   ❌ Agent ${agentId}: ${error.message}`);
      }
    }

    const running = getRunningAgentIds();
    console.log(`   📊 ${running.length} agent(s) now running\n`);
  } catch (error: any) {
    console.error('[Auto-start] Failed to auto-start always-on agents:', error.message);
  }
};

export const startServer = (
  options?: { port?: number; registerSignalHandlers?: boolean }
): { app: express.Express; server: Server; shutdown: () => Promise<void> } => {
  const app = createApp();
  const port = options?.port ?? serverConfig.port;
  const registerSignalHandlers = options?.registerSignalHandlers !== false;
  const server = app.listen(port, () => {
    const address = server.address();
    const resolvedPort =
      address && typeof address === 'object'
        ? address.port
        : port;
    console.log(`\n🚀 optimAIzer Server running on port ${resolvedPort}`);
    console.log(`   Environment: ${serverConfig.nodeEnv}`);
    console.log(`   CORS Origin: ${serverConfig.corsOrigin}`);
    console.log(`   API Base: http://localhost:${resolvedPort}/api\n`);

    // Auto-start always-on agents after server is ready
    autoStartAlwaysOnAgents();
  });

  const shutdown = async (): Promise<void> => {
    stopAllAgents();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    closeDatabase();
  };

  if (registerSignalHandlers) {
    const gracefulExit = () => {
      console.log('\n🛑 Shutting down...');
      stopAllAgents();
      server.close(() => {
        closeDatabase();
        process.exit(0);
      });
    };
    process.on('SIGINT', gracefulExit);
    process.on('SIGTERM', gracefulExit);
  }

  return { app, server, shutdown };
};

if (require.main === module) {
  startServer();
}

export default createApp;
