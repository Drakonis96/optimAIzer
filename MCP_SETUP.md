# MCP Server Setup Guide — Optimaizer Agents

## What is MCP?

**MCP (Model Context Protocol)** is an open standard that lets your AI agent connect to external tools and data sources. Think of it like USB ports for AI — you plug in an MCP server and your agent instantly gains new capabilities (search, database access, file management, etc.).

---

## How It Works (Simple Version)

```
Your Agent  ←→  MCP Client (built into Optimaizer)  ←→  MCP Server (runs as subprocess)
                                                           ↕
                                                     External Service
                                                     (GitHub, Slack, DB, etc.)
```

1. You pick an MCP server from the **Marketplace** in the agent's Integrations tab
2. You enter any required config (API keys, etc.)
3. When you **Deploy** the agent, Optimaizer automatically:
   - Spawns the MCP server as a background process
   - Discovers all available tools via the MCP protocol
   - Makes those tools available to your agent's LLM
4. Your agent can now use those tools just like built-in ones!

---

## Quick Start (3 Minutes)

### Step 1: Prerequisites

Make sure you have **Node.js 18+** and **npm** installed:

```bash
node --version   # Should show v18.x or higher
npm --version    # Should show 9.x or higher
```

That's it! No other global installs needed — MCP servers are downloaded automatically via `npx`.

### Step 2: Pick an MCP Server

Go to your agent's **Integrations** tab → **Marketplace de MCPs**.

Here are the easiest ones to start with (zero API keys needed):

| MCP Server   | What it does                          | Config needed |
|-------------|---------------------------------------|---------------|
| **Fetch**    | Makes HTTP requests to any URL        | None          |
| **Memory**   | Persistent knowledge graph memory     | None          |
| **Puppeteer**| Headless browser automation           | None          |
| **SQLite**   | Local SQLite database                 | File path     |
| **Filesystem**| Read/write files in a sandboxed dir  | Directory path |

### Step 3: Add the MCP Server

1. Click **"Añadir"** on the MCP server you want
2. Fill in any required fields (API keys, paths, etc.)
3. Toggle the server to **enabled**
4. **Deploy** your agent

### Step 4: Verify It Works

After deploying, check the agent status. You should see:
- `mcpServers: 1` (or however many you enabled)
- `mcpTools: X` (number of tools discovered)

You can also call the API directly:
```bash
curl http://localhost:3000/api/agents/<agent-id>/mcp/status
```

---

## MCP Server Catalog — Detailed Setup

### 🔍 Brave Search
**What:** Privacy-focused web search using Brave's API.

**Setup:**
1. Go to [brave.com/search/api](https://brave.com/search/api/) and sign up
2. Create a free API key (2,000 queries/month free)
3. Paste the API key in the config field

**Config:**
| Field   | Value                | Required |
|---------|----------------------|----------|
| API Key | `BSA...` (your key)  | ✅        |

---

### 🌐 Puppeteer
**What:** Headless Chrome browser for web automation, screenshots, and scraping.

**Setup:** No configuration needed! Just add it and deploy.

**Note:** Requires Chrome/Chromium installed on the server machine. On most systems it will auto-download.

---

### 🎭 Playwright
**What:** Cross-platform browser automation (Chrome, Firefox, Safari).

**Setup:** No configuration needed! First run may take a moment to download browsers.

---

### 📡 Fetch
**What:** Makes HTTP requests (GET, POST, etc.) to any URL and returns the response.

**Setup:** No configuration needed! Just add it and deploy.

---

### 🧠 Memory
**What:** Gives your agent persistent memory using a knowledge graph. Information stored survives restarts.

**Setup:** No configuration needed! Just add it and deploy.

---

### 🐙 GitHub
**What:** Access GitHub repos, issues, PRs, code search, and more.

**Setup:**
1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click "Generate new token (classic)"
3. Select scopes: `repo`, `read:org` (minimum)
4. Copy the token

**Config:**
| Field          | Value               | Required |
|---------------|----------------------|----------|
| Personal token | `ghp_...` (your token) | ✅     |

---

### 📁 Google Drive
**What:** Read, search, and manage files on Google Drive.

**Setup:**
1. Create a Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the Google Drive API
3. Create OAuth 2.0 credentials (Desktop app type)
4. Download the credentials JSON

**Config:**
| Field            | Value                          | Required |
|-----------------|--------------------------------|----------|
| JSON credentials | `{"client_id": ...}` (paste full JSON) | ✅ |

---

### 💬 Slack
**What:** Send and read messages in Slack channels, manage conversations.

**Setup:**
1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under "OAuth & Permissions", add scopes: `channels:read`, `chat:write`, `channels:history`
3. Install the app to your workspace
4. Copy the Bot User OAuth Token

**Config:**
| Field     | Value                | Required |
|----------|----------------------|----------|
| Bot Token | `xoxb-...` (your token) | ✅    |

---

### 📝 Notion
**What:** Read and write Notion databases, pages, and blocks.

**Setup:**
1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click "New integration"
3. Give it a name and select the workspace
4. Copy the "Internal Integration Secret"
5. **Important:** Share your Notion pages/databases with the integration

**Config:**
| Field   | Value                | Required |
|---------|----------------------|----------|
| API Key | `ntn_...` (your secret) | ✅    |

---

### 🗄️ PostgreSQL
**What:** Query and modify PostgreSQL databases with SQL.

**Setup:** You need a PostgreSQL connection string.

**Config:**
| Field            | Value                                         | Required |
|-----------------|-----------------------------------------------|----------|
| Connection URL   | `postgresql://user:password@host:5432/dbname` | ✅       |

---

### 💾 SQLite
**What:** Work with a local SQLite database file.

**Setup:** Just provide a path for the database file.

**Config:**
| Field     | Value              | Required |
|----------|---------------------|----------|
| File path | `/path/to/data.db` | ✅       |

---

### 📂 Filesystem (Sandbox)
**What:** Read, write, search, and manage files within specified directories.

**Setup:** Specify which directories the agent can access (sandboxed for security).

**Config:**
| Field              | Value                    | Required |
|-------------------|--------------------------|----------|
| Allowed directories | `/tmp/mcp-sandbox`      | No (defaults to `/tmp/mcp-sandbox`) |

---

### ⚡ Exa
**What:** AI-powered semantic search — finds meaning, not just keywords.

**Setup:**
1. Go to [exa.ai](https://exa.ai) and create an account
2. Get your API key from the dashboard

**Config:**
| Field   | Value                | Required |
|---------|----------------------|----------|
| API Key | `exa-...` (your key) | ✅       |

---

### 🔥 Firecrawl
**What:** Extract clean, structured content from any webpage (better than raw scraping).

**Setup:**
1. Go to [firecrawl.dev](https://www.firecrawl.dev) and create an account
2. Get your API key

**Config:**
| Field   | Value               | Required |
|---------|----------------------|----------|
| API Key | `fc-...` (your key) | ✅       |

---

### 🗺️ Google Maps
**What:** Geocoding, directions, places search, and distance calculations.

**Setup:**
1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the Maps JavaScript API, Geocoding API, Directions API
3. Create an API key and restrict it to Maps APIs

**Config:**
| Field   | Value                 | Required |
|---------|-----------------------|----------|
| API Key | `AIza...` (your key)  | ✅       |

---

## Testing MCP Connections

You can test any MCP server before deploying your agent:

```bash
# Test a server with no config
curl -X POST http://localhost:3000/api/agents/mcp/test \
  -H "Content-Type: application/json" \
  -d '{"serverId": "fetch"}'

# Test a server with config
curl -X POST http://localhost:3000/api/agents/mcp/test \
  -H "Content-Type: application/json" \
  -d '{"serverId": "brave-search", "config": {"apiKey": "BSA_YOUR_KEY"}}'
```

**Expected response:**
```json
{
  "success": true,
  "serverName": "fetch",
  "serverVersion": "1.0.0",
  "toolCount": 1,
  "tools": [
    { "name": "fetch", "description": "Fetches a URL and returns its content" }
  ]
}
```

---

## API Reference

### Check MCP Status for a Running Agent
```
GET /api/agents/:agentId/mcp/status
```
Returns connection status of all MCP servers and discovered tools.

### List MCP Tools for a Running Agent
```
GET /api/agents/:agentId/mcp/tools
```
Returns all MCP tools available to the agent.

### Test an MCP Server Connection
```
POST /api/agents/mcp/test
Body: { "serverId": "...", "config": { ... } }
```
Spawns the MCP server temporarily, performs handshake, discovers tools, then disconnects.

### List Registered MCP Servers
```
GET /api/agents/mcp/registry
```
Returns all MCP servers registered in the backend registry.

---

## Troubleshooting

### "MCP server connection timeout"
- **Cause:** The MCP server process took too long to start
- **Fix:** Make sure `npx` works correctly: `npx -y @kazuph/mcp-fetch`
- **Fix:** Check your internet connection (npx downloads packages on first run)

### "Unknown MCP server"
- **Cause:** The server ID from the UI doesn't match the backend registry
- **Fix:** Check `GET /api/agents/mcp/registry` for valid IDs

### "MCP tool call failed"
- **Cause:** The MCP server returned an error
- **Fix:** Check if required config (API keys) are set correctly
- **Fix:** Test the server standalone: `npx -y @modelcontextprotocol/server-brave-search`

### "Process exited with code 1"
- **Cause:** The MCP server crashed on startup
- **Fix:** Check stderr logs in the server console for details
- **Fix:** Verify Node.js version is 18+ (`node --version`)

### Agent deploys but MCP tools show 0
- MCP servers connect **asynchronously** after deploy — wait 5-10 seconds
- Check the server console for `[MCP:serverId]` log messages
- Use `GET /api/agents/:id/mcp/status` to check connection state

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  Optimaizer UI                   │
│  (AgentsWorkspace → MCP Marketplace)            │
└──────────────────────┬──────────────────────────┘
                       │ REST API
┌──────────────────────▼──────────────────────────┐
│              Express Server                      │
│  routes/agents.ts  →  MCP API endpoints         │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│            Agent Manager                         │
│  (deploys agents, manages lifecycle)            │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │         MCPClientManager                 │    │
│  │  (one per agent, manages N connections)  │    │
│  │                                          │    │
│  │  ┌──────────────┐  ┌──────────────┐     │    │
│  │  │ Connection 1  │  │ Connection 2  │    │    │
│  │  │ (brave-search)│  │ (github)     │     │    │
│  │  └──────┬───────┘  └──────┬───────┘     │    │
│  └─────────┼─────────────────┼─────────────┘    │
└────────────┼─────────────────┼──────────────────┘
             │ stdio           │ stdio
      ┌──────▼───────┐  ┌─────▼────────┐
      │  npx server  │  │  npx server  │
      │  brave-search│  │  github      │
      └──────────────┘  └──────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `server/src/agents/mcpClient.ts` | MCP client connection, manager, and server registry |
| `server/src/agents/tools.ts` | Tool definitions + MCP tool integration |
| `server/src/agents/engine.ts` | LLM execution loop (passes MCP tools to LLM) |
| `server/src/agents/manager.ts` | Agent lifecycle (connects MCP on deploy) |
| `server/src/routes/agents.ts` | REST API endpoints for MCP |
| `services/api.ts` | Frontend API functions for MCP |

---

## Adding a Custom MCP Server

If you want to add an MCP server that's not in the marketplace:

### 1. Register it in the backend

Edit `server/src/agents/mcpClient.ts`, inside `createDefaultRegistry()`:

```typescript
registry.register('my-custom-server', {
  npmPackage: '@myorg/mcp-server-custom',  // npm package name
  description: 'My custom MCP server',
  buildEnv: (config) => ({
    ...(config.apiKey ? { MY_API_KEY: config.apiKey } : {}),
  }),
});
```

### 2. Add it to the UI catalog

Edit `components/AgentsWorkspace.tsx`, inside `MCP_CATALOG`:

```typescript
{
  id: 'my-custom-server',  // Must match the registry ID
  name: 'My Custom Server',
  description: {
    es: 'Mi servidor MCP personalizado',
    en: 'My custom MCP server',
  },
  category: 'data',  // search | browser | data | communication | productivity | database
  icon: '🔧',
  configFields: [
    { key: 'apiKey', label: { es: 'API Key', en: 'API Key' }, type: 'password', placeholder: 'sk-...', required: true },
  ],
},
```

### 3. Deploy and test

```bash
curl -X POST http://localhost:3000/api/agents/mcp/test \
  -H "Content-Type: application/json" \
  -d '{"serverId": "my-custom-server", "config": {"apiKey": "sk-test"}}'
```

---

## FAQ

**Q: Do I need to install MCP servers globally?**
A: No! Optimaizer uses `npx -y` which downloads and runs packages on-the-fly. They're cached automatically.

**Q: Are MCP servers sandboxed?**
A: MCP servers run as separate subprocesses. File-system MCP servers are restricted to directories you specify. Network access depends on the specific server.

**Q: Can I use multiple MCP servers on one agent?**
A: Yes! Add as many as you need. Each server's tools are namespaced to avoid conflicts (e.g., `mcp_github__search_repositories`).

**Q: What happens if an MCP server crashes?**
A: The agent continues working with built-in tools. The failed MCP server's tools become unavailable but don't affect other servers.

**Q: How do I update an MCP server?**
A: Stop the agent, redeploy. `npx -y` will fetch the latest version. To pin a version, modify the registry entry's `npmPackage` to include a version: `@kazuph/mcp-fetch@1.6.2`.
