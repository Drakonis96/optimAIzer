import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optimaizer-users-test-'));
const dbPath = path.join(tempDir, 'users.db');
process.env.OPTIMAIZER_DB_PATH = dbPath;

type DatabaseModule = typeof import('../server/src/database');
type UsersModule = typeof import('../server/src/auth/users');
type SessionsModule = typeof import('../server/src/auth/sessions');

let database: DatabaseModule;
let users: UsersModule;
let sessions: SessionsModule;

before(async () => {
  database = await import('../server/src/database');
  users = await import('../server/src/auth/users');
  sessions = await import('../server/src/auth/sessions');

  database.initDatabase();
  users.initializeUsers();
  sessions.initializeSessionStore();
});

after(() => {
  database.closeDatabase();
  delete process.env.OPTIMAIZER_DB_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('usuario admin por defecto existe y autentica correctamente', () => {
  const allUsers = users.listUsers();
  assert.equal(allUsers.length, 1);
  assert.equal(allUsers[0].username, 'admin');
  assert.equal(allUsers[0].role, 'admin');

  const validAuth = users.authenticateUser('admin', 'admin');
  assert.ok(validAuth);
  assert.equal(validAuth?.username, 'admin');
  assert.equal(users.authenticateUser('admin', 'wrong-password'), null);
});

test('crear usuario normaliza datos y permite autenticación', () => {
  const created = users.createUser({
    username: '  Test.User  ',
    password: 'pass1234',
    role: 'user',
    monthlyCostLimitUsd: 10.129,
    modelAllowlistByProvider: {
      openai: ['gpt-4', 'gpt-4', ' ', 'gpt-3'],
      anthropic: ['claude-3-sonnet', 'claude-3-sonnet'],
    },
  });

  assert.equal(created.username, 'test.user');
  assert.equal(created.role, 'user');
  assert.equal(created.monthlyCostLimitUsd, 10.13);
  assert.deepEqual(created.modelAllowlistByProvider, {
    openai: ['gpt-3', 'gpt-4'],
    anthropic: ['claude-3-sonnet'],
  });
  assert.ok(users.authenticateUser('test.user', 'pass1234'));
});

test('cambio de contraseña invalida la anterior y valida la nueva', () => {
  const auth = users.authenticateUser('test.user', 'pass1234');
  assert.ok(auth);

  const changed = users.changeOwnPassword(auth.id, 'pass1234', 'new-pass-123');
  assert.equal(changed, true);

  assert.equal(users.authenticateUser('test.user', 'pass1234'), null);
  assert.ok(users.authenticateUser('test.user', 'new-pass-123'));
  assert.throws(
    () => users.changeOwnPassword(auth.id, 'bad-current-password', 'another-pass'),
    /Current password is incorrect/
  );
});

test('sesiones de usuario: crear, leer desde cookie y revocar', () => {
  const auth = users.authenticateUser('test.user', 'new-pass-123');
  assert.ok(auth);

  const { token, expiresAt } = sessions.createUserSession(auth.id);
  assert.equal(typeof token, 'string');
  assert.ok(expiresAt > Date.now());

  const fromCookie = sessions.getSessionTokenFromRequest({
    headers: {
      cookie: `foo=1; ${sessions.SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; bar=2`,
    },
  } as any);
  assert.equal(fromCookie, token);

  const lookedUp = sessions.getSessionByToken(token);
  assert.ok(lookedUp);
  assert.equal(lookedUp?.userId, auth.id);

  sessions.revokeSessionByToken(token);
  assert.equal(sessions.getSessionByToken(token), null);
});

test('no permite borrar el último admin', () => {
  const admin = users.authenticateUser('admin', 'admin');
  assert.ok(admin);

  const blocked = users.deleteUser(admin.id);
  assert.equal(blocked.deleted, false);
  assert.equal(blocked.reason, 'Cannot delete the last admin user.');

  const secondAdmin = users.createUser({
    username: 'admin2',
    password: 'admin2',
    role: 'admin',
  });
  const deleted = users.deleteUser(admin.id);
  assert.equal(deleted.deleted, true);
  assert.ok(users.getUserById(secondAdmin.id));
});
