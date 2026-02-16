import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const resolveDatabasePath = (): string => {
  const explicitPath = (process.env.OPTIMAIZER_DB_PATH || '').trim();
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  const defaultDir = path.resolve(__dirname, '../../../data');
  return path.join(defaultDir, 'optimaizer.db');
};

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
  if (db) return db;

  const databasePath = resolveDatabasePath();
  const databaseDir = path.dirname(databasePath);

  // Ensure data directory exists
  if (!fs.existsSync(databaseDir)) {
    fs.mkdirSync(databaseDir, { recursive: true });
  }

  db = new Database(databasePath);

  // Enable WAL mode for better concurrent read/write performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create state store table
  db.exec(`
    CREATE TABLE IF NOT EXISTS state_store (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
  `);

  console.log(`[Database] SQLite initialized at ${databasePath}`);
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  db.close();
  db = null;
}

// --- State Store Operations ---

const parseSerializedValue = (value: string): any => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export function getStateValue(key: string): string | null {
  const row = getDatabase()
    .prepare('SELECT value FROM state_store WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setStateValue(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO state_store (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, Date.now());
}

export function deleteStateValue(key: string): void {
  getDatabase().prepare('DELETE FROM state_store WHERE key = ?').run(key);
}

export function getAllState(): Record<string, any> {
  const rows = getDatabase()
    .prepare('SELECT key, value FROM state_store')
    .all() as { key: string; value: string }[];

  const result: Record<string, any> = {};
  for (const row of rows) {
    result[row.key] = parseSerializedValue(row.value);
  }
  return result;
}

export function setMultipleStateValues(entries: Record<string, any>): void {
  const stmt = getDatabase().prepare(
    `INSERT INTO state_store (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  const now = Date.now();
  const transaction = getDatabase().transaction((items: [string, any][]) => {
    for (const [key, value] of items) {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      stmt.run(key, serialized, now);
    }
  });

  transaction(Object.entries(entries));
}

export function clearAllState(): void {
  getDatabase().prepare('DELETE FROM state_store').run();
}

export function getAllStateByPrefix(prefix: string): Record<string, any> {
  const likePrefix = `${prefix}%`;
  const rows = getDatabase()
    .prepare('SELECT key, value FROM state_store WHERE key LIKE ?')
    .all(likePrefix) as { key: string; value: string }[];

  const result: Record<string, any> = {};
  for (const row of rows) {
    const localKey = row.key.startsWith(prefix) ? row.key.slice(prefix.length) : row.key;
    result[localKey] = parseSerializedValue(row.value);
  }
  return result;
}

export function getLegacyStateWithoutUserPrefix(): Record<string, any> {
  const rows = getDatabase()
    .prepare("SELECT key, value FROM state_store WHERE key NOT LIKE 'user:%'")
    .all() as { key: string; value: string }[];

  const result: Record<string, any> = {};
  for (const row of rows) {
    result[row.key] = parseSerializedValue(row.value);
  }
  return result;
}

export function setMultipleStateValuesWithPrefix(prefix: string, entries: Record<string, any>): void {
  const normalizedEntries = Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [`${prefix}${key}`, value])
  );
  setMultipleStateValues(normalizedEntries);
}

export function clearStateByPrefix(prefix: string): void {
  const likePrefix = `${prefix}%`;
  getDatabase().prepare('DELETE FROM state_store WHERE key LIKE ?').run(likePrefix);
}
