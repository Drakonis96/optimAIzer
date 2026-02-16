// ---------------------------------------------------------------------------
// MCP Client — Connects to MCP servers via stdio JSON-RPC 2.0
// ---------------------------------------------------------------------------
//
// Implements the client side of the Model Context Protocol (MCP).
// Each MCP server runs as a subprocess communicating over stdin/stdout
// using the JSON-RPC 2.0 protocol.
// ---------------------------------------------------------------------------

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MCPToolDefinition {
  /** Fully qualified name: "mcp_<serverId>__<toolName>" */
  qualifiedName: string;
  /** Original tool name from the MCP server */
  originalName: string;
  /** MCP server ID this tool belongs to */
  serverId: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for input parameters */
  inputSchema: Record<string, unknown>;
}

export interface MCPToolCallResult {
  success: boolean;
  content: string;
  error?: string;
  isError?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface MCPServerInfo {
  name: string;
  version: string;
  capabilities?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// MCPClientConnection — Manages a single MCP server subprocess
// ---------------------------------------------------------------------------

const RPC_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 15_000;
type MCPTransportMode = 'line' | 'lsp';

export class MCPClientConnection extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = '';
  private nextId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private _connected = false;
  private _serverInfo: MCPServerInfo | null = null;
  private _tools: MCPToolDefinition[] = [];

  constructor(
    public readonly serverId: string,
    private command: string,
    private args: string[],
    private env: Record<string, string> = {},
    private connectTimeoutMs: number = CONNECT_TIMEOUT_MS,
    private transportMode: MCPTransportMode = 'line'
  ) {
    super();
  }

  get connected(): boolean {
    return this._connected;
  }

  get serverInfo(): MCPServerInfo | null {
    return this._serverInfo;
  }

  get tools(): MCPToolDefinition[] {
    return this._tools;
  }

  // -----------------------------------------------------------------------
  // Connect: spawn process, initialize, discover tools
  // -----------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this._connected) return;

    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const failConnection = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this._connected = false;
        this.rejectAllPending(err);
        this.disconnect();
        reject(err);
      };

      const succeedConnection = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };

      const timeout = setTimeout(() => {
        failConnection(new Error(`MCP server "${this.serverId}" connection timeout (${this.connectTimeoutMs}ms)`));
      }, this.connectTimeoutMs);

      try {
        const mergedEnv = { ...process.env, ...this.env };

        this.process = spawn(this.command, this.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: mergedEnv,
          shell: true,
        });

        this.process.stdout?.on('data', (chunk: Buffer) => {
          this.onStdoutData(chunk);
        });

        this.process.stderr?.on('data', (chunk: Buffer) => {
          const msg = chunk.toString().trim();
          if (msg) {
            console.warn(`[MCP:${this.serverId}:stderr] ${msg.slice(0, 500)}`);

            const hasFatalNpmError = /\bE404\b|not in this registry|No matching version found|could not determine executable to run/i.test(msg);
            if (hasFatalNpmError) {
              failConnection(new Error(`MCP server "${this.serverId}" failed to start: ${msg}`));
            }
          }
        });

        this.process.on('error', (err) => {
          console.error(`[MCP:${this.serverId}] Process error:`, err.message);
          failConnection(err instanceof Error ? err : new Error(String(err)));
        });

        this.process.on('exit', (code, signal) => {
          console.log(`[MCP:${this.serverId}] Process exited (code=${code}, signal=${signal})`);
          if (!settled) {
            failConnection(new Error(`MCP server process exited before initialize (code=${code}, signal=${signal})`));
            return;
          }
          this._connected = false;
          this.rejectAllPending(new Error(`MCP server process exited (code=${code})`));
          this.emit('disconnected', { code, signal });
        });

        // Perform MCP initialize handshake
        this.initialize()
          .then(async (serverInfo) => {
            this._serverInfo = serverInfo;
            this._connected = true;

            // Discover tools
            try {
              this._tools = await this.discoverTools();
            } catch (toolErr: any) {
              console.warn(`[MCP:${this.serverId}] Tool discovery failed: ${toolErr.message}`);
              this._tools = [];
            }

            clearTimeout(timeout);
            console.log(
              `[MCP:${this.serverId}] Connected (server: ${serverInfo.name} v${serverInfo.version}, tools: ${this._tools.length})`
            );
            succeedConnection();
          })
          .catch((err) => {
            failConnection(err instanceof Error ? err : new Error(String(err)));
          });
      } catch (err: any) {
        failConnection(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // -----------------------------------------------------------------------
  // Initialize handshake
  // -----------------------------------------------------------------------

  private async initialize(): Promise<MCPServerInfo> {
    const result = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'optimaizer-agent',
        version: '1.0.0',
      },
    });

    // Send initialized notification
    this.sendNotification('notifications/initialized', {});

    return {
      name: result?.serverInfo?.name || this.serverId,
      version: result?.serverInfo?.version || 'unknown',
      capabilities: result?.capabilities || {},
    };
  }

  // -----------------------------------------------------------------------
  // Discover tools from the MCP server
  // -----------------------------------------------------------------------

  private async discoverTools(): Promise<MCPToolDefinition[]> {
    const result = await this.sendRequest('tools/list', {});
    const rawTools: any[] = result?.tools || [];

    return rawTools.map((tool: any) => ({
      qualifiedName: `mcp_${this.serverId}__${tool.name}`,
      originalName: tool.name,
      serverId: this.serverId,
      description: tool.description || `MCP tool: ${tool.name}`,
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    }));
  }

  // -----------------------------------------------------------------------
  // Call a tool on the MCP server
  // -----------------------------------------------------------------------

  async callTool(toolName: string, args: Record<string, unknown> = {}): Promise<MCPToolCallResult> {
    if (!this._connected) {
      return { success: false, content: '', error: `MCP server "${this.serverId}" not connected` };
    }

    try {
      const result = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: args,
      });

      const isError = result?.isError === true;
      const contentParts: any[] = result?.content || [];
      const textParts = contentParts
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text || '');
      const content = textParts.join('\n') || JSON.stringify(result);

      return {
        success: !isError,
        content,
        isError,
        error: isError ? content : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        content: '',
        error: `MCP tool call failed: ${err.message}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Refresh tools list (re-discover)
  // -----------------------------------------------------------------------

  async refreshTools(): Promise<MCPToolDefinition[]> {
    if (!this._connected) return [];
    try {
      this._tools = await this.discoverTools();
      return this._tools;
    } catch {
      return this._tools;
    }
  }

  // -----------------------------------------------------------------------
  // Disconnect / cleanup
  // -----------------------------------------------------------------------

  disconnect(): void {
    this._connected = false;
    this._tools = [];
    this.rejectAllPending(new Error('Disconnected'));

    if (this.process) {
      try {
        this.process.stdin?.end();
        this.process.kill('SIGTERM');
        // Force kill after 5 seconds if still alive
        const proc = this.process;
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // already dead
          }
        }, 5000);
      } catch {
        // ignore
      }
      this.process = null;
    }

    this.buffer = '';
  }

  // -----------------------------------------------------------------------
  // JSON-RPC transport (stdio)
  // -----------------------------------------------------------------------

  private sendRequest(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error(`Cannot send to MCP server "${this.serverId}": stdin not writable`));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${RPC_TIMEOUT_MS}ms`));
      }, RPC_TIMEOUT_MS);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const message = JSON.stringify(request);

      try {
        if (this.transportMode === 'lsp') {
          const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
          this.process.stdin.write(header + message);
        } else {
          this.process.stdin.write(`${message}\n`);
        }
      } catch (err: any) {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(new Error(`Failed to write to MCP server: ${err.message}`));
      }
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    const message = JSON.stringify(notification);

    try {
      if (this.transportMode === 'lsp') {
        const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;
        this.process.stdin.write(header + message);
      } else {
        this.process.stdin.write(`${message}\n`);
      }
    } catch {
      // ignore notification write failures
    }
  }

  private onStdoutData(chunk: Buffer): void {
    this.buffer += chunk.toString();
    this.processBuffer();
  }

  private processBuffer(): void {
    // Parse messages with Content-Length header (LSP-style framing)
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        const newlineIndex = this.buffer.indexOf('\n');
        if (newlineIndex === -1) break;

        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);

        if (line) {
          try {
            const msg = JSON.parse(line);
            this.handleMessage(msg);
          } catch {
            // Not valid JSON line, ignore
          }
        }
        continue;
      }

      const header = this.buffer.slice(0, headerEnd);
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch) {
        // Try to parse as raw JSON (some servers don't use headers)
        const newlineIndex = this.buffer.indexOf('\n');
        if (newlineIndex === -1) break;

        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);

        if (line) {
          try {
            const msg = JSON.parse(line);
            this.handleMessage(msg);
          } catch {
            // Not valid JSON, skip
          }
        }
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyStart = headerEnd + 4; // after \r\n\r\n
      const totalNeeded = bodyStart + contentLength;

      if (this.buffer.length < totalNeeded) break; // Wait for more data

      const body = this.buffer.slice(bodyStart, totalNeeded);
      this.buffer = this.buffer.slice(totalNeeded);

      try {
        const msg = JSON.parse(body);
        this.handleMessage(msg);
      } catch (err: any) {
        console.warn(`[MCP:${this.serverId}] Failed to parse JSON-RPC message: ${err.message}`);
      }
    }
  }

  private handleMessage(msg: any): void {
    // Check if it's a response (has 'id' field)
    if (typeof msg.id === 'number') {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        clearTimeout(pending.timer);

        if (msg.error) {
          pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // It's a notification from the server
    if (msg.method) {
      this.emit('notification', { method: msg.method, params: msg.params });
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }
}

// ---------------------------------------------------------------------------
// MCPClientManager — Manages multiple MCP server connections for one agent
// ---------------------------------------------------------------------------

export interface MCPServerEntry {
  id: string;
  enabled: boolean;
  config: Record<string, string>;
}

export class MCPClientManager {
  private connections = new Map<string, MCPClientConnection>();
  private _allTools: MCPToolDefinition[] = [];
  private toolByQualifiedName = new Map<string, MCPToolDefinition>();

  constructor(private readonly agentId: string) {}

  get allTools(): MCPToolDefinition[] {
    return this._allTools;
  }

  get connectedServers(): string[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.connected)
      .map(([id]) => id);
  }

  // -----------------------------------------------------------------------
  // Connect to all enabled MCP servers
  // -----------------------------------------------------------------------

  async connectAll(
    servers: MCPServerEntry[],
    registry: MCPServerRegistry
  ): Promise<{ connected: string[]; failed: Array<{ id: string; error: string }> }> {
    const connected: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    const enabledServers = servers.filter((s) => s.enabled);

    const attempts = await Promise.all(enabledServers.map(async (server) => {
      try {
        const entry = registry.getServer(server.id);
        if (!entry) {
          return { id: server.id, success: false as const, error: `Unknown MCP server: "${server.id}"` };
        }

        const { command, args, env, connectTimeoutMs } = registry.buildCommand(server.id, server.config);

        const connection = new MCPClientConnection(server.id, command, args, env, connectTimeoutMs);

        connection.on('disconnected', () => {
          console.log(`[MCPManager:${this.agentId}] Server "${server.id}" disconnected`);
          this.rebuildToolList();
        });

        await connection.connect();
        return { id: server.id, success: true as const, connection };
      } catch (err: any) {
        console.error(`[MCPManager:${this.agentId}] Failed to connect "${server.id}":`, err.message);
        return { id: server.id, success: false as const, error: err?.message || String(err) };
      }
    }));

    for (const attempt of attempts) {
      if (attempt.success) {
        this.connections.set(attempt.id, attempt.connection);
        connected.push(attempt.id);
      } else {
        failed.push({ id: attempt.id, error: attempt.error });
      }
    }

    this.rebuildToolList();

    if (connected.length > 0) {
      console.log(
        `[MCPManager:${this.agentId}] Connected to ${connected.length} MCP servers, ${this._allTools.length} tools available`
      );
    }

    return { connected, failed };
  }

  // -----------------------------------------------------------------------
  // Call an MCP tool (routed by qualified name)
  // -----------------------------------------------------------------------

  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<MCPToolCallResult> {
    const tool = this.toolByQualifiedName.get(qualifiedName);
    if (!tool) {
      return { success: false, content: '', error: `Unknown MCP tool: "${qualifiedName}"` };
    }

    const connection = this.connections.get(tool.serverId);
    if (!connection || !connection.connected) {
      return {
        success: false,
        content: '',
        error: `MCP server "${tool.serverId}" is not connected`,
      };
    }

    return connection.callTool(tool.originalName, args);
  }

  // -----------------------------------------------------------------------
  // Get tools for a specific server
  // -----------------------------------------------------------------------

  getServerTools(serverId: string): MCPToolDefinition[] {
    return this._allTools.filter((t) => t.serverId === serverId);
  }

  // -----------------------------------------------------------------------
  // Refresh tools from all servers
  // -----------------------------------------------------------------------

  async refreshAllTools(): Promise<MCPToolDefinition[]> {
    await Promise.all(
      Array.from(this.connections.values()).map(async (connection) => {
        if (connection.connected) {
          await connection.refreshTools();
        }
      })
    );
    this.rebuildToolList();
    return this._allTools;
  }

  // -----------------------------------------------------------------------
  // Disconnect all
  // -----------------------------------------------------------------------

  disconnectAll(): void {
    for (const connection of this.connections.values()) {
      connection.disconnect();
    }
    this.connections.clear();
    this._allTools = [];
    this.toolByQualifiedName.clear();
  }

  // -----------------------------------------------------------------------
  // Check if a specific server is connected
  // -----------------------------------------------------------------------

  isServerConnected(serverId: string): boolean {
    return this.connections.get(serverId)?.connected === true;
  }

  // -----------------------------------------------------------------------
  // Get connection status summary
  // -----------------------------------------------------------------------

  getStatus(): Array<{
    id: string;
    connected: boolean;
    toolCount: number;
    serverInfo: MCPServerInfo | null;
  }> {
    return Array.from(this.connections.entries()).map(([id, conn]) => ({
      id,
      connected: conn.connected,
      toolCount: conn.tools.length,
      serverInfo: conn.serverInfo,
    }));
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private rebuildToolList(): void {
    this._allTools = [];
    this.toolByQualifiedName.clear();
    for (const connection of this.connections.values()) {
      if (connection.connected) {
        for (const tool of connection.tools) {
          this._allTools.push(tool);
          this.toolByQualifiedName.set(tool.qualifiedName, tool);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// MCPServerRegistry — Maps catalog IDs to spawn commands
// ---------------------------------------------------------------------------

interface MCPRegistryEntry {
  npmPackage: string;
  description: string;
  connectTimeoutMs?: number;
  /** Extra CLI args derived from config */
  buildArgs?: (config: Record<string, string>) => string[];
  /** Environment variables derived from config */
  buildEnv?: (config: Record<string, string>) => Record<string, string>;
}

export class MCPServerRegistry {
  private entries = new Map<string, MCPRegistryEntry>();

  register(id: string, entry: MCPRegistryEntry): void {
    this.entries.set(id, entry);
  }

  getServer(id: string): MCPRegistryEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  listRegistered(): string[] {
    return Array.from(this.entries.keys());
  }

  buildCommand(
    id: string,
    config: Record<string, string>
  ): { command: string; args: string[]; env: Record<string, string>; connectTimeoutMs?: number } {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(`MCP server "${id}" not registered`);
    }

    const extraArgs = entry.buildArgs?.(config) || [];
    const env = {
      npm_config_prefer_offline: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      npm_config_loglevel: 'error',
      ...(entry.buildEnv?.(config) || {}),
    };

    return {
      command: 'npx',
      args: ['-y', entry.npmPackage, ...extraArgs],
      env,
      connectTimeoutMs: entry.connectTimeoutMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Default MCP Server Registry — Matches the frontend catalog
// ---------------------------------------------------------------------------

export function createDefaultRegistry(): MCPServerRegistry {
  const registry = new MCPServerRegistry();

  registry.register('brave-search', {
    npmPackage: '@modelcontextprotocol/server-brave-search',
    description: 'Brave Search API',
    buildEnv: (config) => ({
      ...(config.apiKey ? { BRAVE_API_KEY: config.apiKey } : {}),
    }),
  });

  registry.register('puppeteer', {
    npmPackage: '@modelcontextprotocol/server-puppeteer',
    description: 'Puppeteer headless browser',
    connectTimeoutMs: 45_000,
  });

  registry.register('playwright', {
    npmPackage: '@executeautomation/playwright-mcp-server',
    description: 'Playwright browser automation',
    connectTimeoutMs: 45_000,
  });

  registry.register('fetch', {
    npmPackage: '@kazuph/mcp-fetch',
    description: 'HTTP fetch requests',
  });

  registry.register('memory', {
    npmPackage: '@modelcontextprotocol/server-memory',
    description: 'Persistent memory (knowledge graph)',
  });

  registry.register('github', {
    npmPackage: '@modelcontextprotocol/server-github',
    description: 'GitHub repository access',
    buildEnv: (config) => ({
      ...(config.token ? { GITHUB_PERSONAL_ACCESS_TOKEN: config.token } : {}),
    }),
  });

  registry.register('google-drive', {
    npmPackage: '@modelcontextprotocol/server-google-drive',
    description: 'Google Drive file access',
    buildEnv: (config) => ({
      ...(config.credentials ? { GOOGLE_DRIVE_CREDENTIALS: config.credentials } : {}),
    }),
  });

  registry.register('slack', {
    npmPackage: '@modelcontextprotocol/server-slack',
    description: 'Slack messaging',
    buildEnv: (config) => ({
      ...(config.botToken ? { SLACK_BOT_TOKEN: config.botToken } : {}),
    }),
  });

  registry.register('notion', {
    npmPackage: '@modelcontextprotocol/server-notion',
    description: 'Notion pages and databases',
    buildEnv: (config) => ({
      ...(config.apiKey ? { NOTION_API_KEY: config.apiKey } : {}),
    }),
  });

  registry.register('postgres', {
    npmPackage: '@modelcontextprotocol/server-postgres',
    description: 'PostgreSQL database',
    buildArgs: (config) => (config.connectionString ? [config.connectionString] : []),
  });

  registry.register('sqlite', {
    npmPackage: '@modelcontextprotocol/server-sqlite',
    description: 'SQLite database',
    buildArgs: (config) => (config.dbPath ? [config.dbPath] : []),
  });

  registry.register('filesystem', {
    npmPackage: '@modelcontextprotocol/server-filesystem',
    description: 'Filesystem access (sandboxed)',
    buildArgs: (config) => {
      const dirs = config.allowedDirs?.split(',').map((d) => d.trim()).filter(Boolean) || [];
      return dirs.length > 0 ? dirs : ['/tmp/mcp-sandbox'];
    },
  });

  registry.register('exa', {
    npmPackage: '@modelcontextprotocol/server-exa',
    description: 'Exa AI semantic search',
    buildEnv: (config) => ({
      ...(config.apiKey ? { EXA_API_KEY: config.apiKey } : {}),
    }),
  });

  registry.register('firecrawl', {
    npmPackage: 'firecrawl-mcp',
    description: 'Firecrawl web extraction',
    buildEnv: (config) => ({
      ...(config.apiKey ? { FIRECRAWL_API_KEY: config.apiKey } : {}),
    }),
  });

  registry.register('google-maps', {
    npmPackage: '@modelcontextprotocol/server-google-maps',
    description: 'Google Maps API',
    buildEnv: (config) => ({
      ...(config.apiKey ? { GOOGLE_MAPS_API_KEY: config.apiKey } : {}),
    }),
  });

  return registry;
}

// ---------------------------------------------------------------------------
// Singleton registry instance
// ---------------------------------------------------------------------------

let _registryInstance: MCPServerRegistry | null = null;

export function getMCPRegistry(): MCPServerRegistry {
  if (!_registryInstance) {
    _registryInstance = createDefaultRegistry();
  }
  return _registryInstance;
}
