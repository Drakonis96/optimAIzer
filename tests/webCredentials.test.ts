import assert from 'node:assert/strict';
import test from 'node:test';

test('credenciales web se cifran y se pueden descifrar sin perder datos', async () => {
  process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY = 'unit-test-master-key';

  const security = await import('../server/src/security/webCredentials');

  const workspace = {
    agents: [
      {
        permissions: {
          webCredentials: [
            {
              site: 'https://example.com/login',
              username: 'alice@example.com',
              password: 'my-plain-password',
            },
          ],
        },
      },
    ],
  };

  const encrypted = security.encryptAgentWorkspaceWebCredentials(workspace);
  assert.equal(encrypted.changed, true);
  assert.equal(encrypted.plaintextDetected, false);

  const encryptedWorkspace = encrypted.workspace as any;
  const storedCredential = encryptedWorkspace.agents[0].permissions.webCredentials[0];

  assert.ok(security.isEncryptedCredentialValue(storedCredential.site));
  assert.ok(security.isEncryptedCredentialValue(storedCredential.username));
  assert.ok(security.isEncryptedCredentialValue(storedCredential.password));
  assert.equal(storedCredential.password.includes('my-plain-password'), false);

  const decrypted = security.decryptAgentWorkspaceWebCredentials(encryptedWorkspace);
  assert.equal(decrypted.changed, true);

  const decryptedWorkspace = decrypted.workspace as any;
  const decryptedCredential = decryptedWorkspace.agents[0].permissions.webCredentials[0];
  assert.equal(decryptedCredential.site, 'https://example.com/login');
  assert.equal(decryptedCredential.username, 'alice@example.com');
  assert.equal(decryptedCredential.password, 'my-plain-password');
});

test('detecta plaintext en decrypt sin romper el workspace', async () => {
  process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY = 'unit-test-master-key';
  const security = await import('../server/src/security/webCredentials');

  const workspace = {
    agents: [
      {
        permissions: {
          webCredentials: [
            {
              site: 'https://plain.example',
              username: 'plain-user',
              password: 'plain-pass',
            },
          ],
        },
      },
    ],
  };

  const decrypted = security.decryptAgentWorkspaceWebCredentials(workspace);
  assert.equal(decrypted.changed, false);
  assert.equal(decrypted.plaintextDetected, true);
  assert.deepEqual(decrypted.workspace, workspace);
});

test('cifra y descifra secretos de conectores del agent workspace', async () => {
  process.env.AGENT_CREDENTIALS_ENCRYPTION_KEY = 'unit-test-master-key';
  const security = await import('../server/src/security/webCredentials');

  const workspace = {
    agents: [
      {
        integrations: {
          telegram: {
            botToken: '123456789:ABCDEF_telegram_token_test_1234567890',
            chatId: '123456',
          },
          mcpServers: [
            {
              id: 'slack',
              enabled: true,
              config: {
                botToken: 'slack-bot-token-test',
                channel: 'general',
              },
            },
          ],
          calendar: {
            google: {
              clientId: 'google-client-id',
              clientSecret: 'GOCSPX-secret-google-client-secret',
              refreshToken: '1//refresh-token-value-1234567890',
              calendarId: 'primary',
            },
            icloud: {
              email: 'user@example.com',
              appSpecificPassword: 'abcd-efgh-ijkl-mnop',
              calendarName: 'Home',
            },
          },
        },
      },
    ],
  };

  const encrypted = security.encryptAgentWorkspaceWebCredentials(workspace);
  assert.equal(encrypted.changed, true);

  const encryptedWorkspace = encrypted.workspace as any;
  const telegram = encryptedWorkspace.agents[0].integrations.telegram;
  const mcpConfig = encryptedWorkspace.agents[0].integrations.mcpServers[0].config;
  const google = encryptedWorkspace.agents[0].integrations.calendar.google;
  const icloud = encryptedWorkspace.agents[0].integrations.calendar.icloud;

  assert.ok(security.isEncryptedCredentialValue(telegram.botToken));
  assert.ok(security.isEncryptedCredentialValue(telegram.chatId));
  assert.ok(security.isEncryptedCredentialValue(mcpConfig.botToken));
  assert.ok(security.isEncryptedCredentialValue(mcpConfig.channel));
  assert.ok(security.isEncryptedCredentialValue(google.clientId));
  assert.ok(security.isEncryptedCredentialValue(google.clientSecret));
  assert.ok(security.isEncryptedCredentialValue(google.refreshToken));
  assert.ok(security.isEncryptedCredentialValue(google.calendarId));
  assert.ok(security.isEncryptedCredentialValue(icloud.email));
  assert.ok(security.isEncryptedCredentialValue(icloud.appSpecificPassword));
  assert.ok(security.isEncryptedCredentialValue(icloud.calendarName));

  const decrypted = security.decryptAgentWorkspaceWebCredentials(encryptedWorkspace);
  const decryptedWorkspace = decrypted.workspace as any;

  assert.equal(decryptedWorkspace.agents[0].integrations.telegram.botToken, workspace.agents[0].integrations.telegram.botToken);
  assert.equal(decryptedWorkspace.agents[0].integrations.telegram.chatId, workspace.agents[0].integrations.telegram.chatId);
  assert.equal(
    decryptedWorkspace.agents[0].integrations.mcpServers[0].config.botToken,
    workspace.agents[0].integrations.mcpServers[0].config.botToken
  );
  assert.equal(
    decryptedWorkspace.agents[0].integrations.calendar.google.clientSecret,
    workspace.agents[0].integrations.calendar.google.clientSecret
  );
  assert.equal(
    decryptedWorkspace.agents[0].integrations.calendar.icloud.appSpecificPassword,
    workspace.agents[0].integrations.calendar.icloud.appSpecificPassword
  );
});
