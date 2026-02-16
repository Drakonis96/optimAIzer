import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import fs from 'fs';
import path from 'path';

const ENCRYPTED_PREFIX = 'encwc.v1';
const CIPHER_ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const KDF_SALT = 'optimaizer-web-credentials-v1';
const KEY_ENV_VAR = 'AGENT_CREDENTIALS_ENCRYPTION_KEY';
const DATA_DIR = path.resolve(__dirname, '../../../data');
const KEY_FILE_PATH = path.join(DATA_DIR, '.agent-credentials.key');

let cachedKey: Buffer | null = null;
let keySourceAnnounced = false;

interface TransformWorkspaceResult {
  workspace: unknown;
  changed: boolean;
  plaintextDetected: boolean;
}

const ensureSecretDir = (): void => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const readOrCreateFileSecret = (): string => {
  ensureSecretDir();

  if (fs.existsSync(KEY_FILE_PATH)) {
    const fromFile = fs.readFileSync(KEY_FILE_PATH, 'utf-8').trim();
    if (!fromFile) {
      throw new Error(
        `Credentials encryption key file is empty at ${KEY_FILE_PATH}. Set ${KEY_ENV_VAR} or regenerate the file.`
      );
    }
    if (!keySourceAnnounced) {
      console.log(`[Security] Using persisted credentials encryption key from ${KEY_FILE_PATH}`);
      keySourceAnnounced = true;
    }
    return fromFile;
  }

  const generated = randomBytes(KEY_BYTES).toString('base64url');
  fs.writeFileSync(KEY_FILE_PATH, `${generated}\n`, { encoding: 'utf-8', mode: 0o600 });
  if (!keySourceAnnounced) {
    console.warn(
      `[Security] ${KEY_ENV_VAR} not set. Generated local credentials key at ${KEY_FILE_PATH}.`
    );
    keySourceAnnounced = true;
  }
  return generated;
};

const getKeyMaterial = (): string => {
  const fromEnv = (process.env[KEY_ENV_VAR] || '').trim();
  if (fromEnv) {
    if (!keySourceAnnounced) {
      console.log(`[Security] Using credentials encryption key from ${KEY_ENV_VAR}`);
      keySourceAnnounced = true;
    }
    return fromEnv;
  }
  return readOrCreateFileSecret();
};

const getEncryptionKey = (): Buffer => {
  if (cachedKey) return cachedKey;
  cachedKey = scryptSync(getKeyMaterial(), KDF_SALT, KEY_BYTES) as Buffer;
  return cachedKey;
};

const decodeEnvelope = (value: string): { iv: Buffer; authTag: Buffer; ciphertext: Buffer } | null => {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== ENCRYPTED_PREFIX) return null;

  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const authTag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) return null;
    return { iv, authTag, ciphertext };
  } catch {
    return null;
  }
};

export const isEncryptedCredentialValue = (value: string): boolean =>
  decodeEnvelope(value) !== null;

export const encryptCredentialValue = (value: string): string => {
  if (!value) return '';
  if (isEncryptedCredentialValue(value)) return value;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER_ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}:${iv.toString('base64url')}:${authTag.toString('base64url')}:${ciphertext.toString('base64url')}`;
};

export const decryptCredentialValue = (value: string): string => {
  if (!value) return '';
  const envelope = decodeEnvelope(value);
  if (!envelope) return value;

  try {
    const decipher = createDecipheriv(CIPHER_ALGORITHM, getEncryptionKey(), envelope.iv);
    decipher.setAuthTag(envelope.authTag);
    const cleartext = Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
    return cleartext.toString('utf8');
  } catch (error) {
    throw new Error(
      `Could not decrypt stored web credential. Verify ${KEY_ENV_VAR} or ${KEY_FILE_PATH}. ${
        error instanceof Error ? error.message : ''
      }`.trim()
    );
  }
};

const transformAgentWorkspaceWebCredentials = (
  workspace: unknown,
  mode: 'encrypt' | 'decrypt'
): TransformWorkspaceResult => {
  if (!workspace || typeof workspace !== 'object') {
    return { workspace, changed: false, plaintextDetected: false };
  }

  const workspaceRecord = workspace as Record<string, unknown>;
  const agentsRaw = workspaceRecord.agents;
  if (!Array.isArray(agentsRaw)) {
    return { workspace, changed: false, plaintextDetected: false };
  }

  let workspaceChanged = false;
  let plaintextDetected = false;

  const transformField = (fieldValue: string, onChange: () => void): string => {
    if (!fieldValue) return '';

    if (mode === 'encrypt') {
      if (!isEncryptedCredentialValue(fieldValue)) {
        onChange();
        return encryptCredentialValue(fieldValue);
      }
      return fieldValue;
    }

    if (isEncryptedCredentialValue(fieldValue)) {
      onChange();
      return decryptCredentialValue(fieldValue);
    }

    plaintextDetected = true;
    return fieldValue;
  };

  const nextAgents = agentsRaw.map((agentRaw) => {
    if (!agentRaw || typeof agentRaw !== 'object') return agentRaw;

    const agentRecord = agentRaw as Record<string, unknown>;
    let agentChanged = false;

    const integrationsRaw = agentRecord.integrations;
    let nextIntegrations: Record<string, unknown> | null = null;

    if (integrationsRaw && typeof integrationsRaw === 'object') {
      const integrations = integrationsRaw as Record<string, unknown>;
      nextIntegrations = integrations;

      const telegramRaw = integrations.telegram;
      if (telegramRaw && typeof telegramRaw === 'object') {
        const telegram = telegramRaw as Record<string, unknown>;
        let telegramChanged = false;

        const botToken = typeof telegram.botToken === 'string'
          ? transformField(telegram.botToken, () => {
              telegramChanged = true;
            })
          : telegram.botToken;
        const chatId = typeof telegram.chatId === 'string'
          ? transformField(telegram.chatId, () => {
              telegramChanged = true;
            })
          : telegram.chatId;

        if (telegramChanged) {
          agentChanged = true;
          nextIntegrations = {
            ...(nextIntegrations || {}),
            telegram: {
              ...telegram,
              botToken,
              chatId,
            },
          };
        }
      }

      const calendarRaw = integrations.calendar;
      if (calendarRaw && typeof calendarRaw === 'object') {
        const calendar = calendarRaw as Record<string, unknown>;
        let calendarChanged = false;
        let nextCalendar: Record<string, unknown> = { ...calendar };

        const googleRaw = calendar.google;
        if (googleRaw && typeof googleRaw === 'object') {
          const google = googleRaw as Record<string, unknown>;
          let googleChanged = false;
          const nextGoogle: Record<string, unknown> = { ...google };

          for (const key of ['clientId', 'clientSecret', 'refreshToken', 'calendarId']) {
            if (typeof google[key] !== 'string') continue;
            nextGoogle[key] = transformField(String(google[key]), () => {
              googleChanged = true;
            });
          }

          if (googleChanged) {
            calendarChanged = true;
            nextCalendar = {
              ...nextCalendar,
              google: nextGoogle,
            };
          }
        }

        const icloudRaw = calendar.icloud;
        if (icloudRaw && typeof icloudRaw === 'object') {
          const icloud = icloudRaw as Record<string, unknown>;
          let icloudChanged = false;
          const nextIcloud: Record<string, unknown> = { ...icloud };

          for (const key of ['email', 'appSpecificPassword', 'calendarName']) {
            if (typeof icloud[key] !== 'string') continue;
            nextIcloud[key] = transformField(String(icloud[key]), () => {
              icloudChanged = true;
            });
          }

          if (icloudChanged) {
            calendarChanged = true;
            nextCalendar = {
              ...nextCalendar,
              icloud: nextIcloud,
            };
          }
        }

        if (calendarChanged) {
          agentChanged = true;
          nextIntegrations = {
            ...(nextIntegrations || {}),
            calendar: nextCalendar,
          };
        }
      }

      const mcpServersRaw = integrations.mcpServers;
      if (Array.isArray(mcpServersRaw)) {
        let mcpServersChanged = false;

        const nextMcpServers = mcpServersRaw.map((serverRaw) => {
          if (!serverRaw || typeof serverRaw !== 'object') return serverRaw;
          const server = serverRaw as Record<string, unknown>;
          const configRaw = server.config;
          if (!configRaw || typeof configRaw !== 'object' || Array.isArray(configRaw)) return serverRaw;

          const config = configRaw as Record<string, unknown>;
          let configChanged = false;
          const nextConfig: Record<string, unknown> = { ...config };

          Object.entries(config).forEach(([key, value]) => {
            if (typeof value !== 'string') return;
            nextConfig[key] = transformField(value, () => {
              configChanged = true;
            });
          });

          if (!configChanged) return serverRaw;
          mcpServersChanged = true;
          return {
            ...server,
            config: nextConfig,
          };
        });

        if (mcpServersChanged) {
          agentChanged = true;
          nextIntegrations = {
            ...(nextIntegrations || {}),
            mcpServers: nextMcpServers,
          };
        }
      }

      // ── Media (Radarr / Sonarr) ──────────────────────────────────────
      const mediaRaw = integrations.media;
      if (mediaRaw && typeof mediaRaw === 'object') {
        const media = mediaRaw as Record<string, unknown>;
        let mediaChanged = false;
        const nextMedia: Record<string, unknown> = { ...media };

        for (const serviceKey of ['radarr', 'sonarr']) {
          const serviceRaw = media[serviceKey];
          if (!serviceRaw || typeof serviceRaw !== 'object') continue;
          const service = serviceRaw as Record<string, unknown>;
          let serviceChanged = false;
          const nextService: Record<string, unknown> = { ...service };

          for (const field of ['url', 'apiKey']) {
            if (typeof service[field] !== 'string') continue;
            nextService[field] = transformField(String(service[field]), () => {
              serviceChanged = true;
            });
          }

          if (serviceChanged) {
            mediaChanged = true;
            nextMedia[serviceKey] = nextService;
          }
        }

        if (mediaChanged) {
          agentChanged = true;
          nextIntegrations = {
            ...(nextIntegrations || {}),
            media: nextMedia,
          };
        }
      }
    }

    const permissionsRaw = agentRecord.permissions;
    if (!permissionsRaw || typeof permissionsRaw !== 'object') {
      if (!agentChanged) return agentRaw;
      workspaceChanged = true;
      return {
        ...agentRecord,
        integrations: nextIntegrations || integrationsRaw,
      };
    }

    const permissions = permissionsRaw as Record<string, unknown>;
    const webCredentialsRaw = permissions.webCredentials;
    if (!Array.isArray(webCredentialsRaw)) {
      if (!agentChanged) return agentRaw;
      workspaceChanged = true;
      return {
        ...agentRecord,
        integrations: nextIntegrations || integrationsRaw,
      };
    }

    let credentialsChanged = false;

    const nextCredentials = webCredentialsRaw.map((credentialRaw) => {
      if (!credentialRaw || typeof credentialRaw !== 'object') return credentialRaw;

      const credential = credentialRaw as Record<string, unknown>;
      const site = typeof credential.site === 'string' ? credential.site : '';
      const username = typeof credential.username === 'string' ? credential.username : '';
      const password = typeof credential.password === 'string' ? credential.password : '';
      let credentialChanged = false;

      const nextSite = transformField(site, () => {
        credentialChanged = true;
      });
      const nextUsername = transformField(username, () => {
        credentialChanged = true;
      });
      const nextPassword = transformField(password, () => {
        credentialChanged = true;
      });

      if (!credentialChanged) return credentialRaw;

      credentialsChanged = true;

      return {
        ...credential,
        site: nextSite,
        username: nextUsername,
        password: nextPassword,
      };
    });

    if (!credentialsChanged && !agentChanged) return agentRaw;

    workspaceChanged = true;
    const nextPermissions = credentialsChanged
      ? {
          ...permissions,
          webCredentials: nextCredentials,
        }
      : permissions;

    return {
      ...agentRecord,
      ...(agentChanged ? { integrations: nextIntegrations || integrationsRaw } : {}),
      permissions: nextPermissions,
    };
  });

  if (!workspaceChanged) {
    return { workspace, changed: false, plaintextDetected };
  }

  return {
    workspace: {
      ...workspaceRecord,
      agents: nextAgents,
    },
    changed: true,
    plaintextDetected,
  };
};

export const encryptAgentWorkspaceWebCredentials = (workspace: unknown): TransformWorkspaceResult =>
  transformAgentWorkspaceWebCredentials(workspace, 'encrypt');

export const decryptAgentWorkspaceWebCredentials = (workspace: unknown): TransformWorkspaceResult =>
  transformAgentWorkspaceWebCredentials(workspace, 'decrypt');
