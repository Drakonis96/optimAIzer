import { createHash, randomBytes, randomUUID } from 'crypto';
import { Request } from 'express';
import { getDatabase } from '../database';

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
}

export const SESSION_COOKIE_NAME = 'optimaizer_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const parseCookieHeader = (cookieHeader: string): Record<string, string> => {
  const output: Record<string, string> = {};
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = rawKey?.trim();
    if (!key) continue;
    const value = rawValueParts.join('=').trim();
    if (!value) continue;
    output[key] = decodeURIComponent(value);
  }
  return output;
};

export const initializeSessionStore = (): void => {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
  `);

  getDatabase().prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(Date.now());
};

export const createUserSession = (userId: string): { token: string; expiresAt: number } => {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;

  getDatabase()
    .prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), userId, tokenHash, now, expiresAt, now);

  return { token, expiresAt };
};

export const getSessionTokenFromRequest = (req: Request): string | null => {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') return null;
  const cookies = parseCookieHeader(header);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token || typeof token !== 'string') return null;
  return token;
};

export const getSessionByToken = (token: string): { sessionId: string; userId: string; expiresAt: number } | null => {
  const tokenHash = hashToken(token);
  const now = Date.now();

  const row = getDatabase()
    .prepare(
      `SELECT id, user_id, token_hash, created_at, expires_at, last_seen_at
       FROM user_sessions
       WHERE token_hash = ?`
    )
    .get(tokenHash) as SessionRow | undefined;

  if (!row) return null;
  if (Number(row.expires_at) <= now) {
    getDatabase().prepare('DELETE FROM user_sessions WHERE id = ?').run(row.id);
    return null;
  }

  getDatabase().prepare('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?').run(now, row.id);

  return {
    sessionId: row.id,
    userId: row.user_id,
    expiresAt: Number(row.expires_at),
  };
};

export const revokeSessionByToken = (token: string): void => {
  const tokenHash = hashToken(token);
  getDatabase().prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
};

export const revokeSessionsForUser = (userId: string): void => {
  getDatabase().prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
};
