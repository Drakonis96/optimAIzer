import { Router, Request, Response } from 'express';
import {
  getAllStateByPrefix,
  setMultipleStateValuesWithPrefix,
  clearStateByPrefix,
  getStateValue,
  setStateValue,
  getLegacyStateWithoutUserPrefix,
} from '../database';
import {
  decryptAgentWorkspaceWebCredentials,
  encryptAgentWorkspaceWebCredentials,
} from '../security/webCredentials';

export const dataRouter = Router();

const getStatePrefixForRequest = (req: Request): string => `user:${req.authUser!.id}:`;
const AGENT_WORKSPACE_STATE_KEY = 'agentWorkspace';

const persistEncryptedAgentWorkspace = (scopePrefix: string, workspace: unknown): void => {
  try {
    const serialized = typeof workspace === 'string' ? workspace : JSON.stringify(workspace);
    setStateValue(`${scopePrefix}${AGENT_WORKSPACE_STATE_KEY}`, serialized);
  } catch (error) {
    console.warn('[Data] Could not migrate plaintext web credentials to encrypted format:', error);
  }
};

const protectAgentWorkspaceForStorage = (workspace: unknown): unknown => {
  const transformed = encryptAgentWorkspaceWebCredentials(workspace);
  return transformed.workspace;
};

const exposeAgentWorkspaceForClient = (scopePrefix: string, workspace: unknown): unknown => {
  const transformed = decryptAgentWorkspaceWebCredentials(workspace);
  if (transformed.plaintextDetected) {
    const encrypted = encryptAgentWorkspaceWebCredentials(transformed.workspace);
    if (encrypted.changed) {
      persistEncryptedAgentWorkspace(scopePrefix, encrypted.workspace);
    }
  }
  return transformed.workspace;
};

const protectStateForStorage = (state: Record<string, unknown>): Record<string, unknown> => {
  if (!Object.prototype.hasOwnProperty.call(state, AGENT_WORKSPACE_STATE_KEY)) return state;

  return {
    ...state,
    [AGENT_WORKSPACE_STATE_KEY]: protectAgentWorkspaceForStorage(state[AGENT_WORKSPACE_STATE_KEY]),
  };
};

const exposeStateForClient = (scopePrefix: string, state: Record<string, unknown>): Record<string, unknown> => {
  if (!Object.prototype.hasOwnProperty.call(state, AGENT_WORKSPACE_STATE_KEY)) return state;

  return {
    ...state,
    [AGENT_WORKSPACE_STATE_KEY]: exposeAgentWorkspaceForClient(scopePrefix, state[AGENT_WORKSPACE_STATE_KEY]),
  };
};

const protectStateValueForStorage = (key: string, value: unknown): unknown =>
  key === AGENT_WORKSPACE_STATE_KEY ? protectAgentWorkspaceForStorage(value) : value;

const exposeStateValueForClient = (scopePrefix: string, key: string, value: unknown): unknown =>
  key === AGENT_WORKSPACE_STATE_KEY ? exposeAgentWorkspaceForClient(scopePrefix, value) : value;

/**
 * GET /api/data/state
 * Returns the full persisted application state.
 * NEVER contains API keys — only user data (conversations, settings, etc.)
 */
dataRouter.get('/state', (req: Request, res: Response) => {
  try {
    const scopePrefix = getStatePrefixForRequest(req);
    const state = getAllStateByPrefix(scopePrefix) as Record<string, unknown>;

    if (Object.keys(state).length === 0 && req.authUser?.role === 'admin') {
      const legacyState = getLegacyStateWithoutUserPrefix() as Record<string, unknown>;
      if (Object.keys(legacyState).length > 0) {
        const securedLegacyState = protectStateForStorage(legacyState);
        setMultipleStateValuesWithPrefix(scopePrefix, securedLegacyState);
        res.json(exposeStateForClient(scopePrefix, securedLegacyState));
        return;
      }
    }

    res.json(exposeStateForClient(scopePrefix, state));
  } catch (err) {
    console.error('[Data] Failed to read state:', err);
    res.status(500).json({ error: 'Failed to read application state.' });
  }
});

/**
 * PUT /api/data/state
 * Bulk upsert application state. Only provided keys are updated.
 */
dataRouter.put('/state', (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).json({ error: 'Request body must be a JSON object.' });
      return;
    }

    const securedState = protectStateForStorage(body as Record<string, unknown>);
    setMultipleStateValuesWithPrefix(getStatePrefixForRequest(req), securedState);
    res.json({ success: true });
  } catch (err) {
    console.error('[Data] Failed to save state:', err);
    res.status(500).json({ error: 'Failed to save application state.' });
  }
});

/**
 * PATCH /api/data/state/:key
 * Update a single state key.
 */
dataRouter.patch('/state/:key', (req: Request, res: Response) => {
  try {
    const key = String(req.params.key || '');
    if (!key) {
      res.status(400).json({ error: 'Key is required.' });
      return;
    }

    const { value } = req.body;
    if (value === undefined) {
      res.status(400).json({ error: 'Value is required.' });
      return;
    }

    const protectedValue = protectStateValueForStorage(key, value);
    const serialized = typeof protectedValue === 'string' ? protectedValue : JSON.stringify(protectedValue);
    setStateValue(`${getStatePrefixForRequest(req)}${key}`, serialized);
    res.json({ success: true });
  } catch (err) {
    console.error('[Data] Failed to update state key:', err);
    res.status(500).json({ error: 'Failed to update state.' });
  }
});

/**
 * GET /api/data/state/:key
 * Get a single state value.
 */
dataRouter.get('/state/:key', (req: Request, res: Response) => {
  try {
    const scopePrefix = getStatePrefixForRequest(req);
    const key = String(req.params.key || '');
    const raw = getStateValue(`${scopePrefix}${key}`);
    if (raw === null) {
      res.status(404).json({ error: 'Key not found.' });
      return;
    }

    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }

    res.json({ key, value: exposeStateValueForClient(scopePrefix, key, parsed) });
  } catch (err) {
    console.error('[Data] Failed to read state key:', err);
    res.status(500).json({ error: 'Failed to read state.' });
  }
});

/**
 * DELETE /api/data/state
 * Clear all persisted application state.
 */
dataRouter.delete('/state', (req: Request, res: Response) => {
  try {
    clearStateByPrefix(getStatePrefixForRequest(req));
    res.json({ success: true });
  } catch (err) {
    console.error('[Data] Failed to clear state:', err);
    res.status(500).json({ error: 'Failed to clear application state.' });
  }
});
