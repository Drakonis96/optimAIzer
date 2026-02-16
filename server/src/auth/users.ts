import { randomUUID } from 'crypto';
import { getDatabase } from '../database';
import { hashPassword, verifyPassword } from './password';
import { AuthUser, ModelAllowlistByProvider, UserRole } from './types';

interface UserRow {
  id: string;
  username: string;
  role: string;
  password_hash: string;
  password_salt: string;
  monthly_cost_limit_usd: number;
  model_allowlist_json: string;
  created_at: number;
  updated_at: number;
}

interface UserPublicRow {
  id: string;
  username: string;
  role: string;
  monthly_cost_limit_usd: number;
  model_allowlist_json: string;
  created_at: number;
  updated_at: number;
}

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/i;
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 200;

const normalizeUsername = (username: string): string => username.trim().toLowerCase();

const sanitizeRole = (role: unknown): UserRole => (role === 'admin' ? 'admin' : 'user');

const sanitizeMonthlyCostLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed * 100) / 100;
};

const sanitizeModelAllowlistByProvider = (value: unknown): ModelAllowlistByProvider => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const output: ModelAllowlistByProvider = {};
  for (const [providerRaw, modelsRaw] of Object.entries(value as Record<string, unknown>)) {
    const provider = String(providerRaw || '').trim();
    if (!provider) continue;
    if (!Array.isArray(modelsRaw)) continue;

    const uniqueModels = Array.from(
      new Set(
        modelsRaw
          .filter((modelId): modelId is string => typeof modelId === 'string')
          .map((modelId) => modelId.trim())
          .filter((modelId) => modelId.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));

    output[provider] = uniqueModels;
  }

  return output;
};

const parseModelAllowlistByProvider = (serialized: string): ModelAllowlistByProvider => {
  if (!serialized || !serialized.trim()) return {};
  try {
    const parsed = JSON.parse(serialized);
    return sanitizeModelAllowlistByProvider(parsed);
  } catch {
    return {};
  }
};

const toAuthUser = (row: UserPublicRow): AuthUser => ({
  id: row.id,
  username: row.username,
  role: sanitizeRole(row.role),
  monthlyCostLimitUsd: sanitizeMonthlyCostLimit(row.monthly_cost_limit_usd),
  modelAllowlistByProvider: parseModelAllowlistByProvider(row.model_allowlist_json),
  createdAt: Number(row.created_at) || Date.now(),
  updatedAt: Number(row.updated_at) || Date.now(),
});

const ensureUserSchema = (): void => {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      monthly_cost_limit_usd REAL NOT NULL DEFAULT 0,
      model_allowlist_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  `);
};

const countUsers = (): number => {
  const row = getDatabase().prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return Number(row?.count || 0);
};

const readUserAuthRowById = (userId: string): UserRow | null => {
  const row = getDatabase()
    .prepare(
      `SELECT id, username, role, password_hash, password_salt, monthly_cost_limit_usd, model_allowlist_json, created_at, updated_at
       FROM users
       WHERE id = ?`
    )
    .get(userId) as UserRow | undefined;
  return row || null;
};

const readUserAuthRowByUsername = (username: string): UserRow | null => {
  const normalized = normalizeUsername(username);
  const row = getDatabase()
    .prepare(
      `SELECT id, username, role, password_hash, password_salt, monthly_cost_limit_usd, model_allowlist_json, created_at, updated_at
       FROM users
       WHERE username = ?`
    )
    .get(normalized) as UserRow | undefined;
  return row || null;
};

const validateUsername = (username: string): string | null => {
  const normalized = normalizeUsername(username);
  if (!normalized) return 'Username is required.';
  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Username must be 3-32 chars and use only letters, numbers, dot, underscore, or hyphen.';
  }
  return null;
};

const validatePassword = (password: string): string | null => {
  if (!password || typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
};

const createUserRow = (params: {
  username: string;
  password: string;
  role: UserRole;
  monthlyCostLimitUsd?: number;
  modelAllowlistByProvider?: ModelAllowlistByProvider;
}): AuthUser => {
  const usernameError = validateUsername(params.username);
  if (usernameError) throw new Error(usernameError);

  const passwordError = validatePassword(params.password);
  if (passwordError) throw new Error(passwordError);

  const normalizedUsername = normalizeUsername(params.username);

  const existing = readUserAuthRowByUsername(normalizedUsername);
  if (existing) throw new Error('Username already exists.');

  const now = Date.now();
  const { salt, hash } = hashPassword(params.password);
  const modelAllowlistByProvider = sanitizeModelAllowlistByProvider(params.modelAllowlistByProvider || {});
  const monthlyCostLimitUsd = sanitizeMonthlyCostLimit(params.monthlyCostLimitUsd);

  getDatabase()
    .prepare(
      `INSERT INTO users (
        id,
        username,
        role,
        password_hash,
        password_salt,
        monthly_cost_limit_usd,
        model_allowlist_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      normalizedUsername,
      params.role,
      hash,
      salt,
      monthlyCostLimitUsd,
      JSON.stringify(modelAllowlistByProvider),
      now,
      now
    );

  const created = readUserAuthRowByUsername(normalizedUsername);
  if (!created) {
    throw new Error('Could not create user.');
  }

  return toAuthUser(created);
};

export const initializeUsers = (): void => {
  ensureUserSchema();
  if (countUsers() > 0) return;

  createUserRow({
    username: 'admin',
    password: 'admin',
    role: 'admin',
  });

  console.log('[Auth] Default admin user created (username: admin).');
};

export const authenticateUser = (username: string, password: string): AuthUser | null => {
  const user = readUserAuthRowByUsername(username);
  if (!user) return null;
  const valid = verifyPassword(password, user.password_salt, user.password_hash);
  if (!valid) return null;
  return toAuthUser(user);
};

export const getUserById = (userId: string): AuthUser | null => {
  const user = readUserAuthRowById(userId);
  if (!user) return null;
  return toAuthUser(user);
};

export const listUsers = (): AuthUser[] => {
  const rows = getDatabase()
    .prepare(
      `SELECT id, username, role, monthly_cost_limit_usd, model_allowlist_json, created_at, updated_at
       FROM users
       ORDER BY created_at ASC`
    )
    .all() as UserPublicRow[];

  return rows.map((row) => toAuthUser(row));
};

export const createUser = (params: {
  username: string;
  password: string;
  role?: UserRole;
  monthlyCostLimitUsd?: number;
  modelAllowlistByProvider?: ModelAllowlistByProvider;
}): AuthUser =>
  createUserRow({
    username: params.username,
    password: params.password,
    role: sanitizeRole(params.role),
    monthlyCostLimitUsd: params.monthlyCostLimitUsd,
    modelAllowlistByProvider: params.modelAllowlistByProvider,
  });

export const updateUserAccess = (
  userId: string,
  patch: {
    role?: UserRole;
    monthlyCostLimitUsd?: number;
    modelAllowlistByProvider?: ModelAllowlistByProvider;
  }
): AuthUser | null => {
  const current = readUserAuthRowById(userId);
  if (!current) return null;

  const nextRole = sanitizeRole(patch.role ?? current.role);
  const nextCostLimit =
    patch.monthlyCostLimitUsd === undefined
      ? sanitizeMonthlyCostLimit(current.monthly_cost_limit_usd)
      : sanitizeMonthlyCostLimit(patch.monthlyCostLimitUsd);

  const nextAllowlist =
    patch.modelAllowlistByProvider === undefined
      ? parseModelAllowlistByProvider(current.model_allowlist_json)
      : sanitizeModelAllowlistByProvider(patch.modelAllowlistByProvider);

  const now = Date.now();

  getDatabase()
    .prepare(
      `UPDATE users
       SET role = ?, monthly_cost_limit_usd = ?, model_allowlist_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextRole, nextCostLimit, JSON.stringify(nextAllowlist), now, userId);

  return getUserById(userId);
};

const changePasswordInternal = (userId: string, newPassword: string): boolean => {
  const passwordError = validatePassword(newPassword);
  if (passwordError) throw new Error(passwordError);

  const user = readUserAuthRowById(userId);
  if (!user) return false;

  const { hash, salt } = hashPassword(newPassword);
  getDatabase()
    .prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
    .run(hash, salt, Date.now(), userId);

  return true;
};

export const changeOwnPassword = (userId: string, currentPassword: string, newPassword: string): boolean => {
  const user = readUserAuthRowById(userId);
  if (!user) return false;

  const validCurrentPassword = verifyPassword(currentPassword, user.password_salt, user.password_hash);
  if (!validCurrentPassword) throw new Error('Current password is incorrect.');

  return changePasswordInternal(userId, newPassword);
};

export const deleteUser = (userId: string): { deleted: boolean; reason?: string } => {
  const user = readUserAuthRowById(userId);
  if (!user) return { deleted: false, reason: 'User not found.' };

  if (sanitizeRole(user.role) === 'admin') {
    const row = getDatabase()
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND id != ?")
      .get(userId) as { count: number };
    if (!row || Number(row.count || 0) === 0) {
      return { deleted: false, reason: 'Cannot delete the last admin user.' };
    }
  }

  const result = getDatabase().prepare('DELETE FROM users WHERE id = ?').run(userId);
  return { deleted: result.changes > 0 };
};

export const isModelAllowedForUser = (user: AuthUser, providerId: string, modelId: string): boolean => {
  const allowlist = user.modelAllowlistByProvider?.[providerId];
  if (!Array.isArray(allowlist)) return true;
  return allowlist.includes(modelId);
};
