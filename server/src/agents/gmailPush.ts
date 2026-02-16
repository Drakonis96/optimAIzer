// ---------------------------------------------------------------------------
// Gmail Push Notifications — Real-time email notifications via Google Pub/Sub
// ---------------------------------------------------------------------------
// Uses Gmail's watch() API to receive instant push notifications when new
// emails arrive, instead of polling with CRON intervals.
//
// Flow:
// 1. Call gmailWatch() to register a push subscription with Google Cloud Pub/Sub
// 2. Google sends POST requests to our webhook endpoint when new mail arrives
// 3. We decode the Pub/Sub message, fetch the new emails, and forward to agents
//
// Requirements:
// - A Google Cloud project with Pub/Sub API enabled
// - A Pub/Sub topic that Gmail can publish to
// - The service account or app must have gmail.readonly + pubsub subscription
//
// Docs: https://developers.google.com/gmail/api/guides/push
// ---------------------------------------------------------------------------

import { GmailConfig, createGmailProvider, GmailMessage } from './gmail';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailPushConfig {
  /** The Google Cloud Pub/Sub topic (e.g. projects/my-project/topics/gmail-push) */
  topicName: string;
  /** Label IDs to watch. Default: ['INBOX'] */
  labelIds?: string[];
  /** Filter labels (INCLUDE or EXCLUDE). Default: 'include' */
  labelFilterBehavior?: 'include' | 'exclude';
}

export interface GmailWatchResponse {
  historyId: string;
  expiration: string; // ms timestamp as string
}

export interface GmailPubSubMessage {
  /** Base64-encoded data from Pub/Sub */
  data: string;
  /** Pub/Sub message ID */
  messageId: string;
  /** Publish time */
  publishTime: string;
}

export interface GmailPushNotification {
  /** The email address that received the notification */
  emailAddress: string;
  /** History ID — use to fetch changes since last known ID */
  historyId: string;
}

// ---------------------------------------------------------------------------
// Per-agent watch state
// ---------------------------------------------------------------------------

interface WatchState {
  /** Last known history ID (to fetch only new changes) */
  lastHistoryId: string;
  /** When the watch expires (ms) — needs renewal every ~7 days */
  expiration: number;
  /** The Gmail config used */
  config: GmailConfig;
  /** Push config used */
  pushConfig: GmailPushConfig;
  /** Renewal timer */
  renewalTimer?: ReturnType<typeof setTimeout>;
}

const watchStates = new Map<string, WatchState>(); // agentId → WatchState

// ---------------------------------------------------------------------------
// OAuth2 token helper (reuse from gmail.ts logic)
// ---------------------------------------------------------------------------

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

async function getAccessToken(config: GmailConfig): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail OAuth2 token refresh failed (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data: any = await response.json();
  return data.access_token;
}

// ---------------------------------------------------------------------------
// Gmail watch() — Register push notifications
// ---------------------------------------------------------------------------

/**
 * Register a Gmail push notification watch.
 * Must be called at agent start and renewed every 7 days.
 */
export async function gmailWatch(
  agentId: string,
  gmailConfig: GmailConfig,
  pushConfig: GmailPushConfig
): Promise<GmailWatchResponse> {
  const token = await getAccessToken(gmailConfig);

  const body = {
    topicName: pushConfig.topicName,
    labelIds: pushConfig.labelIds || ['INBOX'],
    labelFilterBehavior: pushConfig.labelFilterBehavior || 'include',
  };

  const response = await fetch(`${GMAIL_API_BASE}/users/me/watch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail watch() failed (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data: any = await response.json();
  const watchResponse: GmailWatchResponse = {
    historyId: data.historyId,
    expiration: data.expiration,
  };

  // Store watch state
  const state: WatchState = {
    lastHistoryId: watchResponse.historyId,
    expiration: parseInt(watchResponse.expiration),
    config: gmailConfig,
    pushConfig,
  };

  // Schedule renewal before expiration (renew 1 hour before)
  const renewIn = Math.max(
    parseInt(watchResponse.expiration) - Date.now() - 3600_000,
    3600_000 // At least 1 hour
  );
  state.renewalTimer = setTimeout(() => {
    renewWatch(agentId).catch((err) => {
      console.error(`[Gmail-Push] Watch renewal failed for agent ${agentId}:`, err.message);
    });
  }, renewIn);

  watchStates.set(agentId, state);
  console.log(`[Gmail-Push] Watch registered for agent ${agentId} (expires: ${new Date(state.expiration).toISOString()})`);

  return watchResponse;
}

/**
 * Renew an existing watch.
 */
async function renewWatch(agentId: string): Promise<void> {
  const state = watchStates.get(agentId);
  if (!state) return;

  try {
    const result = await gmailWatch(agentId, state.config, state.pushConfig);
    console.log(`[Gmail-Push] Watch renewed for agent ${agentId} (new expiry: ${new Date(parseInt(result.expiration)).toISOString()})`);
  } catch (err: any) {
    console.error(`[Gmail-Push] Watch renewal failed for agent ${agentId}:`, err.message);
    // Retry in 5 minutes
    setTimeout(() => renewWatch(agentId), 300_000);
  }
}

/**
 * Stop watching (cleanup).
 */
export function gmailStopWatch(agentId: string): void {
  const state = watchStates.get(agentId);
  if (state?.renewalTimer) {
    clearTimeout(state.renewalTimer);
  }
  watchStates.delete(agentId);
  console.log(`[Gmail-Push] Watch stopped for agent ${agentId}`);
}

// ---------------------------------------------------------------------------
// Process incoming Pub/Sub push notification
// ---------------------------------------------------------------------------

/**
 * Decode a Pub/Sub push notification payload.
 */
export function decodePubSubNotification(
  pubsubMessage: GmailPubSubMessage
): GmailPushNotification | null {
  try {
    const decoded = Buffer.from(pubsubMessage.data, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    return {
      emailAddress: parsed.emailAddress || '',
      historyId: String(parsed.historyId || ''),
    };
  } catch (err: any) {
    console.error('[Gmail-Push] Failed to decode Pub/Sub message:', err.message);
    return null;
  }
}

/**
 * Fetch new messages since the last known history ID.
 * Returns the new messages and updated history ID.
 */
export async function fetchNewMessagesSinceHistory(
  agentId: string,
  gmailConfig: GmailConfig,
  historyId: string
): Promise<{ messages: GmailMessage[]; newHistoryId: string }> {
  const token = await getAccessToken(gmailConfig);

  // Use Gmail history API to get changes since last known point
  const params = new URLSearchParams({
    startHistoryId: historyId,
    historyTypes: 'messageAdded',
    labelId: 'INBOX',
  });

  const response = await fetch(
    `${GMAIL_API_BASE}/users/me/history?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!response.ok) {
    // 404 means history ID is too old — fallback to listing recent
    if (response.status === 404) {
      console.warn(`[Gmail-Push] History ID ${historyId} expired, fetching recent messages instead`);
      const provider = createGmailProvider(gmailConfig);
      const messages = await provider.listMessages('is:unread', 5);
      return { messages, newHistoryId: historyId };
    }
    const errorText = await response.text();
    throw new Error(`Gmail history API failed (${response.status}): ${errorText.slice(0, 200)}`);
  }

  const data: any = await response.json();
  const newHistoryId = data.historyId || historyId;

  // Extract message IDs from history records
  const messageIds = new Set<string>();
  if (data.history) {
    for (const record of data.history) {
      if (record.messagesAdded) {
        for (const added of record.messagesAdded) {
          if (added.message?.id) {
            // Only include INBOX messages
            const labels = added.message.labelIds || [];
            if (labels.includes('INBOX')) {
              messageIds.add(added.message.id);
            }
          }
        }
      }
    }
  }

  // Fetch full message details
  const provider = createGmailProvider(gmailConfig);
  const messages: GmailMessage[] = [];
  for (const msgId of messageIds) {
    try {
      const msg = await provider.getMessage(msgId);
      messages.push(msg);
    } catch {
      // Skip messages that can't be retrieved
    }
  }

  // Update stored history ID
  const state = watchStates.get(agentId);
  if (state) {
    state.lastHistoryId = newHistoryId;
  }

  return { messages, newHistoryId };
}

/**
 * Get the last known history ID for an agent (used by push handler).
 */
export function getLastHistoryId(agentId: string): string | null {
  return watchStates.get(agentId)?.lastHistoryId || null;
}

/**
 * Get the Gmail config for an agent (used by push handler).
 */
export function getWatchState(agentId: string): WatchState | null {
  return watchStates.get(agentId) || null;
}

/**
 * Check if an agent has an active Gmail watch.
 */
export function hasActiveWatch(agentId: string): boolean {
  const state = watchStates.get(agentId);
  if (!state) return false;
  return state.expiration > Date.now();
}

/**
 * Get all agent IDs that have active watches (for routing push notifications).
 */
export function getAgentsWithActiveWatch(): string[] {
  const result: string[] = [];
  for (const [agentId, state] of watchStates) {
    if (state.expiration > Date.now()) {
      result.push(agentId);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Build agent instruction from push email notification
// ---------------------------------------------------------------------------

export function buildGmailPushInstruction(messages: GmailMessage[]): string {
  if (messages.length === 0) return '';

  const msgSummaries = messages.map((msg, i) => {
    const lines = [
      `--- Correo ${i + 1} ---`,
      `De: ${msg.from}`,
      `Para: ${msg.to}`,
      `Asunto: ${msg.subject}`,
      `Fecha: ${msg.date}`,
      `No leído: ${msg.isUnread ? 'Sí' : 'No'}`,
      '',
      msg.body.slice(0, 1500),
    ];
    return lines.join('\n');
  }).join('\n\n');

  return [
    `[EVENTO EN TIEMPO REAL — NUEVO CORREO EN GMAIL]`,
    '',
    `Se han recibido ${messages.length} nuevo(s) correo(s) en Gmail:`,
    '',
    msgSummaries,
    '',
    'Analiza estos correos y decide:',
    '1. ¿Alguno es urgente o importante? (ej: factura, cita médica, emergencia, respuesta esperada)',
    '2. ¿Alguno requiere acción inmediata del usuario?',
    '3. ¿Son newsletters/spam/rutinarios que no necesitan notificación?',
    '',
    'Si algún correo es urgente o importante, notifica al usuario por Telegram con un resumen claro.',
    'Si son rutinarios, NO envíes notificación.',
    'Nunca incluyas contraseñas, tokens o información sensible en la notificación.',
  ].join('\n');
}
