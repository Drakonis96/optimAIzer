import { Router, Request, Response } from 'express';
import {
  addProviderApiKey,
  clearProviderApiKeys,
  deleteProviderApiKey,
  getProviderApiKeysForBackup,
  getActiveProviderApiKeySummary,
  getProviderBaseUrl,
  getProviderApiKeySummaries,
  hasApiKey,
  providerRequiresApiKey,
  restoreProviderApiKeysFromBackup,
  setActiveProviderApiKey,
} from '../config';
import { Provider, ProviderStatus } from '../types';
import { getProviderModelsCatalog } from '../providers/models';
import { getOpenRouterApiKeyError } from '../providers/openrouterAuth';
import { resolveModelPricingFromProvider } from '../providers/pricingResolver';
import { isModelAllowedForUser } from '../auth/users';

export const providersRouter = Router();

const PROVIDER_NAMES: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  google: 'Google Gemini',
  groq: 'Groq',
  lmstudio: 'LM Studio',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
};

const ALL_PROVIDERS: Provider[] = ['openai', 'anthropic', 'google', 'groq', 'lmstudio', 'ollama', 'openrouter'];

const isKnownProvider = (providerId: string): providerId is Provider =>
  ALL_PROVIDERS.includes(providerId as Provider);

const ensureAdmin = (req: Request, res: Response): boolean => {
  if (req.authUser?.role === 'admin') return true;
  res.status(403).json({ error: 'Only admin users can modify shared API keys.' });
  return false;
};

const buildProviderStatus = (providerId: Provider): ProviderStatus => {
  const summaries = getProviderApiKeySummaries(providerId);
  const active = getActiveProviderApiKeySummary(providerId);
  return {
    id: providerId,
    name: PROVIDER_NAMES[providerId],
    configured: providerRequiresApiKey(providerId) ? hasApiKey(providerId) : true,
    keyCount: summaries.keys.length,
    activeKeyId: active?.id || null,
    activeKeyName: active?.name || '',
    activeKeyMasked: active?.masked || '',
  };
};

/**
 * GET /api/providers
 * Returns the list of all providers and whether each one has a configured API key.
 * NEVER returns the actual API key values — only a boolean status.
 */
providersRouter.get('/', (_req: Request, res: Response) => {
  const providers: ProviderStatus[] = ALL_PROVIDERS.map((id) => buildProviderStatus(id));

  res.json({ providers });
});

/**
 * GET /api/providers/backup/api-keys
 * Export API keys in raw format for explicit backup flow.
 * Admin-only endpoint.
 */
providersRouter.get('/backup/api-keys', (req: Request, res: Response) => {
  if (!ensureAdmin(req, res)) return;

  const providers = ALL_PROVIDERS
    .filter((providerId) => providerRequiresApiKey(providerId))
    .reduce((acc, providerId) => {
      acc[providerId] = getProviderApiKeysForBackup(providerId);
      return acc;
    }, {} as Record<string, ReturnType<typeof getProviderApiKeysForBackup>>);

  res.json({ providers });
});

/**
 * PUT /api/providers/backup/api-keys
 * Restore API keys from backup payload.
 * Admin-only endpoint.
 */
providersRouter.put('/backup/api-keys', (req: Request, res: Response) => {
  if (!ensureAdmin(req, res)) return;

  const providersPayload = (req.body as { providers?: unknown } | undefined)?.providers;
  if (!providersPayload || typeof providersPayload !== 'object' || Array.isArray(providersPayload)) {
    res.status(400).json({ error: 'Invalid backup payload.' });
    return;
  }
  const providersById = providersPayload as Record<string, unknown>;

  const restoredCounts = ALL_PROVIDERS
    .filter((providerId) => providerRequiresApiKey(providerId))
    .reduce((acc, providerId) => {
      acc[providerId] = restoreProviderApiKeysFromBackup(providerId, providersById[providerId]);
      return acc;
    }, {} as Record<string, number>);

  res.json({
    success: true,
    restoredCounts,
    providers: ALL_PROVIDERS.map((providerId) => buildProviderStatus(providerId)),
  });
});

/**
 * GET /api/providers/:id/status
 * Check if a specific provider has an API key configured.
 * Returns { configured: boolean, masked: string } — NEVER the full key.
 */
providersRouter.get('/:id/status', (req: Request, res: Response) => {
  const providerId = String(req.params.id || '');

  if (!isKnownProvider(providerId)) {
    res.status(400).json({ error: `Unknown provider: ${providerId}` });
    return;
  }

  const summaries = getProviderApiKeySummaries(providerId);
  const baseStatus = buildProviderStatus(providerId);
  res.json({
    ...baseStatus,
    keys: req.authUser?.role === 'admin' ? summaries.keys : [],
  });
});

/**
 * GET /api/providers/:id/models
 * Returns discovered models from the provider with graceful fallback.
 */
providersRouter.get('/:id/models', async (req: Request, res: Response) => {
  const providerId = String(req.params.id || '');
  const authUser = req.authUser!;
  if (!isKnownProvider(providerId)) {
    res.status(400).json({ error: `Unknown provider: ${providerId}` });
    return;
  }

  const forceRefresh = String(req.query.refresh || '').toLowerCase();
  const result = await getProviderModelsCatalog(providerId, {
    forceRefresh: forceRefresh === '1' || forceRefresh === 'true' || forceRefresh === 'yes',
  });
  const filteredModels = result.models.filter((model) => isModelAllowedForUser(authUser, providerId, model.id));

  res.json({
    ...result,
    models: filteredModels,
    providerName: PROVIDER_NAMES[providerId],
    baseUrl: providerId === 'ollama' || providerId === 'lmstudio' ? getProviderBaseUrl(providerId) : undefined,
  });
});

/**
 * POST /api/providers/:id/pricing/resolve
 * Resolve official pricing for a specific provider/model pair.
 */
providersRouter.post('/:id/pricing/resolve', async (req: Request, res: Response) => {
  const providerId = String(req.params.id || '');
  const authUser = req.authUser!;
  if (!isKnownProvider(providerId)) {
    res.status(400).json({ error: `Unknown provider: ${providerId}` });
    return;
  }

  const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  if (!model) {
    res.status(400).json({ error: 'Model is required.' });
    return;
  }

  if (!isModelAllowedForUser(authUser, providerId, model)) {
    res.status(403).json({ error: `Model "${model}" is not allowed for user "${authUser.username}".` });
    return;
  }

  const result = await resolveModelPricingFromProvider(providerId, model);
  if (!result.found || !result.pricing) {
    res.status(404).json({
      found: false,
      provider: providerId,
      model,
      error: result.error || 'Could not resolve model pricing.',
    });
    return;
  }

  res.json({
    found: true,
    provider: providerId,
    model,
    pricing: result.pricing,
  });
});

/**
 * POST /api/providers/:id/key
 * Set or update the API key for a provider.
 * The key is stored ONLY on the server side — never sent back to the client.
 */
providersRouter.post('/:id/key', (req: Request, res: Response) => {
  if (!ensureAdmin(req, res)) return;
  const providerId = String(req.params.id || '');

  if (!isKnownProvider(providerId)) {
    res.status(400).json({ error: `Unknown provider: ${providerId}` });
    return;
  }
  if (!providerRequiresApiKey(providerId)) {
    res.status(400).json({ error: `${PROVIDER_NAMES[providerId]} does not require an API key.` });
    return;
  }

  const { apiKey, name, makeActive } = req.body as {
    apiKey: string;
    name?: string;
    makeActive?: boolean;
  };

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    res.status(400).json({ error: 'A valid API key is required.' });
    return;
  }
  if (providerId === 'openrouter') {
    const keyError = getOpenRouterApiKeyError(apiKey);
    if (keyError) {
      res.status(400).json({ error: keyError });
      return;
    }
  }

  const added = addProviderApiKey(providerId, apiKey, { name, makeActive });
  if (!added) {
    res.status(400).json({ error: 'Could not save API key.' });
    return;
  }

  console.log(`[Providers] API key added for ${providerId}`);

  res.json({
    success: true,
    key: added,
    status: buildProviderStatus(providerId),
  });
});

/**
 * PATCH /api/providers/:id/key/:keyId/active
 * Set active API key for a provider.
 */
providersRouter.patch('/:id/key/:keyId/active', (req: Request, res: Response) => {
  if (!ensureAdmin(req, res)) return;
  const providerId = String(req.params.id || '');
  const keyId = String(req.params.keyId || '');

  if (!isKnownProvider(providerId)) {
    res.status(400).json({ error: `Unknown provider: ${providerId}` });
    return;
  }
  if (!providerRequiresApiKey(providerId)) {
    res.status(400).json({ error: `${PROVIDER_NAMES[providerId]} does not require an API key.` });
    return;
  }

  const active = setActiveProviderApiKey(providerId, keyId);
  if (!active) {
    res.status(404).json({ error: 'API key not found for this provider.' });
    return;
  }

  console.log(`[Providers] Active API key changed for ${providerId}`);

  res.json({
    success: true,
    key: active,
    status: buildProviderStatus(providerId),
  });
});

/**
 * DELETE /api/providers/:id/key/:keyId
 * Remove a single API key for a provider.
 */
providersRouter.delete('/:id/key/:keyId', (req: Request, res: Response) => {
  if (!ensureAdmin(req, res)) return;
  const providerId = String(req.params.id || '');
  const keyId = String(req.params.keyId || '');

  if (!isKnownProvider(providerId)) {
    res.status(400).json({ error: `Unknown provider: ${providerId}` });
    return;
  }
  if (!providerRequiresApiKey(providerId)) {
    res.status(400).json({ error: `${PROVIDER_NAMES[providerId]} does not require an API key.` });
    return;
  }

  const removed = deleteProviderApiKey(providerId, keyId);
  if (!removed) {
    res.status(404).json({ error: 'API key not found for this provider.' });
    return;
  }

  console.log(`[Providers] API key removed for ${providerId} (${keyId})`);

  res.json({ success: true, status: buildProviderStatus(providerId) });
});

/**
 * DELETE /api/providers/:id/key
 * Remove all API keys for a provider.
 */
providersRouter.delete('/:id/key', (req: Request, res: Response) => {
  if (!ensureAdmin(req, res)) return;
  const providerId = String(req.params.id || '');

  if (!isKnownProvider(providerId)) {
    res.status(400).json({ error: `Unknown provider: ${providerId}` });
    return;
  }
  if (!providerRequiresApiKey(providerId)) {
    res.status(400).json({ error: `${PROVIDER_NAMES[providerId]} does not require an API key.` });
    return;
  }

  clearProviderApiKeys(providerId);
  console.log(`[Providers] All API keys removed for ${providerId}`);

  res.json({ success: true, status: buildProviderStatus(providerId) });
});
