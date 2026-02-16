import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { Provider } from './types';
import { normalizeOpenRouterApiKey } from './providers/openrouterAuth';

// Load .env from project root
const envPath = (process.env.OPTIMAIZER_ENV_PATH || '').trim()
  ? path.resolve(process.env.OPTIMAIZER_ENV_PATH as string)
  : path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

export interface ServerConfig {
  port: number;
  corsOrigin: string;
  nodeEnv: string;
}

interface ProviderEnvConfig {
  legacyVar: string;
  keysVar: string;
  activeVar: string;
}

export type ApiKeyProvider = Exclude<Provider, 'ollama' | 'lmstudio'>;

interface StoredApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: number;
}

interface ProviderApiKeyStore {
  keys: StoredApiKey[];
  activeKeyId: string | null;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  masked: string;
  createdAt: number;
  isActive: boolean;
}

export interface ApiKeyBackupEntry {
  name: string;
  key: string;
  createdAt: number;
  isActive: boolean;
}

const providerEnvConfig: Record<ApiKeyProvider, ProviderEnvConfig> = {
  openai: {
    legacyVar: 'OPENAI_API_KEY',
    keysVar: 'OPENAI_API_KEYS',
    activeVar: 'OPENAI_ACTIVE_API_KEY_ID',
  },
  anthropic: {
    legacyVar: 'ANTHROPIC_API_KEY',
    keysVar: 'ANTHROPIC_API_KEYS',
    activeVar: 'ANTHROPIC_ACTIVE_API_KEY_ID',
  },
  google: {
    legacyVar: 'GOOGLE_API_KEY',
    keysVar: 'GOOGLE_API_KEYS',
    activeVar: 'GOOGLE_ACTIVE_API_KEY_ID',
  },
  groq: {
    legacyVar: 'GROQ_API_KEY',
    keysVar: 'GROQ_API_KEYS',
    activeVar: 'GROQ_ACTIVE_API_KEY_ID',
  },
  openrouter: {
    legacyVar: 'OPENROUTER_API_KEY',
    keysVar: 'OPENROUTER_API_KEYS',
    activeVar: 'OPENROUTER_ACTIVE_API_KEY_ID',
  },
};

const ALL_API_KEY_PROVIDERS = Object.keys(providerEnvConfig) as ApiKeyProvider[];
const PROVIDERS_WITHOUT_API_KEYS: Provider[] = ['ollama', 'lmstudio'];

const maskApiKey = (key: string): string => {
  if (!key || !key.trim()) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
};

const createApiKeyId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const sanitizeApiKeyName = (name: string | undefined, fallback: string): string => {
  const candidate = (name || '').trim();
  if (!candidate) return fallback;
  return candidate.slice(0, 40);
};

const normalizeApiKeyForProvider = (provider: ApiKeyProvider, rawKey: string): string => {
  const trimmed = (rawKey || '').trim();
  if (!trimmed) return '';
  if (provider === 'openrouter') {
    return normalizeOpenRouterApiKey(trimmed);
  }
  return trimmed.replace(/^Bearer\s+/i, '').trim();
};

const parseStoredKeys = (raw: string | undefined, provider: ApiKeyProvider): StoredApiKey[] => {
  if (!raw || !raw.trim()) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const keys: StoredApiKey[] = [];
    const usedIds = new Set<string>();

    parsed.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;

      const keyValue =
        typeof (item as any).key === 'string'
          ? normalizeApiKeyForProvider(provider, (item as any).key)
          : '';
      if (!keyValue) return;

      const baseId =
        typeof (item as any).id === 'string' && (item as any).id.trim()
          ? (item as any).id.trim()
          : `${provider}-key-${index + 1}`;
      let id = baseId;
      while (usedIds.has(id)) {
        id = `${baseId}-${Math.random().toString(36).slice(2, 5)}`;
      }
      usedIds.add(id);

      const defaultName = `Key ${keys.length + 1}`;
      const name =
        typeof (item as any).name === 'string'
          ? sanitizeApiKeyName((item as any).name, defaultName)
          : defaultName;
      const createdAtRaw = Number((item as any).createdAt);
      const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? createdAtRaw : Date.now();

      keys.push({
        id,
        name,
        key: keyValue,
        createdAt,
      });
    });

    return keys;
  } catch {
    return [];
  }
};

const initializeProviderStore = (provider: ApiKeyProvider): ProviderApiKeyStore => {
  const envVars = providerEnvConfig[provider];
  const parsedKeys = parseStoredKeys(process.env[envVars.keysVar], provider);
  const legacyKey = normalizeApiKeyForProvider(provider, process.env[envVars.legacyVar] || '');
  const keys: StoredApiKey[] = [...parsedKeys];

  if (keys.length === 0 && legacyKey) {
    keys.push({
      id: `${provider}-legacy`,
      name: 'Legacy Key',
      key: legacyKey,
      createdAt: Date.now(),
    });
  }

  const requestedActiveId = (process.env[envVars.activeVar] || '').trim();
  const activeKeyId = keys.some((key) => key.id === requestedActiveId)
    ? requestedActiveId
    : keys[0]?.id || null;

  return { keys, activeKeyId };
};

const apiKeyStore: Record<ApiKeyProvider, ProviderApiKeyStore> = ALL_API_KEY_PROVIDERS.reduce(
  (acc, provider) => {
    acc[provider] = initializeProviderStore(provider);
    return acc;
  },
  {} as Record<ApiKeyProvider, ProviderApiKeyStore>
);

const upsertEnvVar = (content: string, envVar: string, value: string): string => {
  const regex = new RegExp(`^${envVar}=.*$`, 'm');
  const line = `${envVar}=${value}`;
  if (regex.test(content)) {
    return content.replace(regex, line);
  }
  return content + (content.endsWith('\n') || content === '' ? '' : '\n') + line + '\n';
};

const encodeEnvValue = (value: string): string => `'${value.replace(/'/g, "\\'")}'`;

const persistProviderStateToEnv = (provider: ApiKeyProvider): void => {
  const envVars = providerEnvConfig[provider];
  const state = apiKeyStore[provider];
  const active = state.keys.find((key) => key.id === state.activeKeyId) || null;

  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    const serializedKeys = JSON.stringify(
      state.keys.map((key) => ({
        id: key.id,
        name: key.name,
        key: key.key,
        createdAt: key.createdAt,
      }))
    );

    envContent = upsertEnvVar(envContent, envVars.keysVar, encodeEnvValue(serializedKeys));
    envContent = upsertEnvVar(envContent, envVars.activeVar, encodeEnvValue(state.activeKeyId || ''));
    envContent = upsertEnvVar(envContent, envVars.legacyVar, encodeEnvValue(active?.key || ''));

    fs.writeFileSync(envPath, envContent, 'utf-8');
  } catch (err) {
    console.error(`[Config] Failed to persist API keys for ${provider}:`, err);
  }
};

const normalizeApiKeyProvider = (provider: string): ApiKeyProvider | null => {
  if (!ALL_API_KEY_PROVIDERS.includes(provider as ApiKeyProvider)) return null;
  return provider as ApiKeyProvider;
};

const ensureActiveKey = (provider: ApiKeyProvider): void => {
  const state = apiKeyStore[provider];
  if (state.keys.length === 0) {
    state.activeKeyId = null;
    return;
  }
  if (!state.activeKeyId || !state.keys.some((key) => key.id === state.activeKeyId)) {
    state.activeKeyId = state.keys[0].id;
  }
};

const getActiveStoredKey = (provider: ApiKeyProvider): StoredApiKey | null => {
  ensureActiveKey(provider);
  const state = apiKeyStore[provider];
  return state.keys.find((key) => key.id === state.activeKeyId) || null;
};

export function getApiKey(provider: string): string {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) return '';
  return getActiveStoredKey(normalizedProvider)?.key || '';
}

export function setApiKey(provider: string, key: string): void {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) return;

  const cleanKey = normalizeApiKeyForProvider(normalizedProvider, key);
  if (!cleanKey) {
    clearProviderApiKeys(normalizedProvider);
    return;
  }

  const state = apiKeyStore[normalizedProvider];
  const newEntry: StoredApiKey = {
    id: createApiKeyId(),
    name: 'Primary Key',
    key: cleanKey,
    createdAt: Date.now(),
  };
  state.keys = [newEntry];
  state.activeKeyId = newEntry.id;
  persistProviderStateToEnv(normalizedProvider);
}

export function hasApiKey(provider: string): boolean {
  if (!providerRequiresApiKey(provider)) {
    return true;
  }
  return !!getApiKey(provider);
}

export function getProviderApiKeySummaries(provider: string): { activeKeyId: string | null; keys: ApiKeySummary[] } {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) {
    return { activeKeyId: null, keys: [] };
  }

  ensureActiveKey(normalizedProvider);
  const state = apiKeyStore[normalizedProvider];
  return {
    activeKeyId: state.activeKeyId,
    keys: state.keys.map((entry) => ({
      id: entry.id,
      name: entry.name,
      masked: maskApiKey(entry.key),
      createdAt: entry.createdAt,
      isActive: entry.id === state.activeKeyId,
    })),
  };
}

export function getProviderApiKeysForBackup(provider: string): ApiKeyBackupEntry[] {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) {
    return [];
  }

  ensureActiveKey(normalizedProvider);
  const state = apiKeyStore[normalizedProvider];
  return state.keys.map((entry) => ({
    name: entry.name,
    key: entry.key,
    createdAt: entry.createdAt,
    isActive: entry.id === state.activeKeyId,
  }));
}

export function restoreProviderApiKeysFromBackup(provider: string, entries: unknown): number {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) {
    return 0;
  }

  const state = apiKeyStore[normalizedProvider];
  const parsedEntries = Array.isArray(entries) ? entries : [];
  const restored: StoredApiKey[] = [];
  let activeIndex = -1;

  parsedEntries.forEach((rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object') return;
    const candidate = rawEntry as Partial<ApiKeyBackupEntry>;
    const normalizedKey = normalizeApiKeyForProvider(normalizedProvider, String(candidate.key || ''));
    if (!normalizedKey) return;

    const index = restored.length;
    restored.push({
      id: createApiKeyId(),
      name: sanitizeApiKeyName(
        typeof candidate.name === 'string' ? candidate.name : '',
        `Key ${index + 1}`,
      ),
      key: normalizedKey,
      createdAt: Number.isFinite(candidate.createdAt) && Number(candidate.createdAt) > 0
        ? Number(candidate.createdAt)
        : Date.now(),
    });

    if (candidate.isActive === true) {
      activeIndex = index;
    }
  });

  state.keys = restored;
  state.activeKeyId =
    restored.length === 0
      ? null
      : restored[Math.max(0, activeIndex)]?.id || restored[0].id;
  persistProviderStateToEnv(normalizedProvider);

  return restored.length;
}

export function addProviderApiKey(
  provider: string,
  apiKey: string,
  options?: { name?: string; makeActive?: boolean }
): ApiKeySummary | null {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) return null;

  const cleanKey = normalizeApiKeyForProvider(normalizedProvider, apiKey);
  if (!cleanKey) return null;

  const state = apiKeyStore[normalizedProvider];
  const newEntry: StoredApiKey = {
    id: createApiKeyId(),
    name: sanitizeApiKeyName(options?.name, `Key ${state.keys.length + 1}`),
    key: cleanKey,
    createdAt: Date.now(),
  };

  state.keys.push(newEntry);
  if (options?.makeActive !== false) {
    state.activeKeyId = newEntry.id;
  } else {
    ensureActiveKey(normalizedProvider);
  }

  persistProviderStateToEnv(normalizedProvider);

  return {
    id: newEntry.id,
    name: newEntry.name,
    masked: maskApiKey(newEntry.key),
    createdAt: newEntry.createdAt,
    isActive: newEntry.id === state.activeKeyId,
  };
}

export function setActiveProviderApiKey(provider: string, keyId: string): ApiKeySummary | null {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) return null;

  const state = apiKeyStore[normalizedProvider];
  const key = state.keys.find((entry) => entry.id === keyId);
  if (!key) return null;

  state.activeKeyId = key.id;
  persistProviderStateToEnv(normalizedProvider);

  return {
    id: key.id,
    name: key.name,
    masked: maskApiKey(key.key),
    createdAt: key.createdAt,
    isActive: true,
  };
}

export function deleteProviderApiKey(provider: string, keyId: string): boolean {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) return false;

  const state = apiKeyStore[normalizedProvider];
  const nextKeys = state.keys.filter((entry) => entry.id !== keyId);
  if (nextKeys.length === state.keys.length) return false;

  state.keys = nextKeys;
  ensureActiveKey(normalizedProvider);
  persistProviderStateToEnv(normalizedProvider);
  return true;
}

export function clearProviderApiKeys(provider: string): void {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) return;
  apiKeyStore[normalizedProvider] = { keys: [], activeKeyId: null };
  persistProviderStateToEnv(normalizedProvider);
}

export function getActiveProviderApiKeySummary(provider: string): ApiKeySummary | null {
  const normalizedProvider = normalizeApiKeyProvider(provider);
  if (!normalizedProvider) return null;

  const active = getActiveStoredKey(normalizedProvider);
  if (!active) return null;
  return {
    id: active.id,
    name: active.name,
    masked: maskApiKey(active.key),
    createdAt: active.createdAt,
    isActive: true,
  };
}

export function providerRequiresApiKey(provider: string): provider is ApiKeyProvider {
  return !PROVIDERS_WITHOUT_API_KEYS.includes(provider as Provider);
}

export function getProviderBaseUrl(provider: string): string {
  if (provider === 'ollama') {
    return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  }
  if (provider === 'lmstudio') {
    return (process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234').replace(/\/+$/, '');
  }
  return '';
}

export const serverConfig: ServerConfig = {
  port: parseInt(process.env.PORT || '3001', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
};

// ---------------------------------------------------------------------------
// Host Filesystem Mount Detection
// ---------------------------------------------------------------------------
// When running inside Docker the host FS is mounted under /host.
// This helper auto-detects available mount points so the agent knows which
// host paths it can access and how to translate them.
// ---------------------------------------------------------------------------

export interface HostMount {
  /** Path inside the container, e.g. /host/Users */
  containerPath: string;
  /** Equivalent host path, e.g. /Users (macOS) or /home (Linux) */
  hostPath: string;
}

/**
 * Detect host filesystem mounts available under /host.
 * Returns an array of { containerPath, hostPath } objects.
 */
export function detectHostMounts(): HostMount[] {
  const HOST_ROOT = '/host';
  const mounts: HostMount[] = [];

  try {
    if (!fs.existsSync(HOST_ROOT)) return mounts;

    const entries = fs.readdirSync(HOST_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const containerPath = path.join(HOST_ROOT, entry.name);
        // Map common conventions back to host paths
        const hostPath = `/${entry.name}`;
        mounts.push({ containerPath, hostPath });
      }
    }
  } catch {
    // Not running in Docker or /host doesn't exist — that's fine
  }

  return mounts;
}

/** Cached result so we don't re-scan on every request */
let _cachedHostMounts: HostMount[] | null = null;

export function getHostMounts(): HostMount[] {
  if (_cachedHostMounts === null) {
    _cachedHostMounts = detectHostMounts();
  }
  return _cachedHostMounts;
}

/**
 * Build a human-readable description of available host mounts
 * for inclusion in the agent system prompt.
 */
export function getHostMountsPromptSection(): string {
  const mounts = getHostMounts();
  if (mounts.length === 0) return '';

  const lines = mounts.map(
    (m) => `  - Host "${m.hostPath}" → accessible at "${m.containerPath}" inside the container`
  );

  return `
HOST FILESYSTEM ACCESS:
The application is running inside a Docker container. The following host filesystem paths are mounted and accessible:
${lines.join('\n')}

IMPORTANT RULES for host file access:
- When the user asks you to access files on their computer (Desktop, Documents, home folder, etc.), translate the path to the container mount point.
  Example: if the user says "list files on my Desktop" and the host is macOS, the real path is /host/Users/<username>/Desktop.
- ALWAYS use the /host/... prefix when accessing host files through run_terminal_command or execute_code.
- To discover the username, you can run: ls /host/Users (macOS) or ls /host/home (Linux).
- Never modify system files on the host. Only interact with user data directories.
- Inform the user which host path you are accessing for transparency.
`;
}
