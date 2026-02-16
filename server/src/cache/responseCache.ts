import crypto from 'crypto';

export type StreamCacheRoute =
  | 'chat'
  | 'concilium_member'
  | 'concilium_leader'
  | 'summarize';

export interface StreamCacheKeyInput {
  route: StreamCacheRoute;
  provider: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string;
  tooling?: unknown;
  extra?: Record<string, unknown>;
}

interface CacheEntry {
  value: string;
  createdAt: number;
  expiresAt: number;
}

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const CACHE_ENABLED = process.env.STREAM_CACHE_ENABLED !== 'false';
const CACHE_TTL_MS = parsePositiveInt(process.env.STREAM_CACHE_TTL_MS, 10 * 60 * 1000);
const CACHE_MAX_ENTRIES = parsePositiveInt(process.env.STREAM_CACHE_MAX_ENTRIES, 500);

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${entries.join(',')}}`;
};

const removeExpired = (store: Map<string, CacheEntry>, now: number): void => {
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
};

const evictIfNeeded = (store: Map<string, CacheEntry>): void => {
  if (store.size <= CACHE_MAX_ENTRIES) return;
  const entries = [...store.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
  const overflow = store.size - CACHE_MAX_ENTRIES;
  for (let index = 0; index < overflow; index += 1) {
    const oldest = entries[index];
    if (oldest) {
      store.delete(oldest[0]);
    }
  }
};

export class InMemoryStreamCache {
  private readonly store = new Map<string, CacheEntry>();

  isEnabled(): boolean {
    return CACHE_ENABLED;
  }

  get(key: string): string | null {
    if (!CACHE_ENABLED) return null;
    const now = Date.now();
    removeExpired(this.store, now);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: string): void {
    if (!CACHE_ENABLED || !value.trim()) return;
    const now = Date.now();
    removeExpired(this.store, now);
    this.store.set(key, {
      value,
      createdAt: now,
      expiresAt: now + CACHE_TTL_MS,
    });
    evictIfNeeded(this.store);
  }
}

export const streamResponseCache = new InMemoryStreamCache();

export const buildStreamCacheKey = (input: StreamCacheKeyInput): string => {
  const normalized = {
    route: input.route,
    provider: input.provider,
    model: input.model,
    systemPrompt: input.systemPrompt || '',
    maxTokens: input.maxTokens ?? null,
    temperature: input.temperature ?? null,
    reasoningEffort: input.reasoningEffort || null,
    tooling: input.tooling || {},
    messages: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    extra: input.extra || {},
  };

  return crypto.createHash('sha256').update(stableStringify(normalized)).digest('hex');
};
