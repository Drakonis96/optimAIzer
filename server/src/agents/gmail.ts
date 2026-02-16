// ---------------------------------------------------------------------------
// Gmail Integration — OAuth2 + REST API (no external dependencies)
// ---------------------------------------------------------------------------

import { redactSensitive } from '../security/redact';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// ---------------------------------------------------------------------------
// Gmail Config
// ---------------------------------------------------------------------------

export interface GmailConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// ---------------------------------------------------------------------------
// Gmail message types
// ---------------------------------------------------------------------------

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
  labels: string[];
  isUnread: boolean;
}

export interface GmailSendResult {
  id: string;
  threadId: string;
  labelIds: string[];
}

// ---------------------------------------------------------------------------
// OAuth2 token management
// ---------------------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

const tokenCaches = new Map<string, TokenCache>();

async function getAccessToken(config: GmailConfig): Promise<string> {
  const cacheKey = `gmail:${config.clientId}:${config.refreshToken.slice(-8)}`;
  const cached = tokenCaches.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

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
    throw new Error(`Gmail OAuth2 token refresh failed (${response.status}): ${redactSensitive(errorText.slice(0, 200))}`);
  }

  const data: any = await response.json();
  const accessToken = data.access_token;
  const expiresIn = data.expires_in || 3600;

  tokenCaches.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return accessToken;
}

// ---------------------------------------------------------------------------
// OAuth2 URL generation (for initial setup)
// ---------------------------------------------------------------------------

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ');

export function buildGmailAuthUrl(
  clientId: string,
  redirectUri: string,
  state?: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
  });
  if (state) params.set('state', state);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGmailAuthCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail OAuth2 code exchange failed (${response.status}): ${redactSensitive(errorText.slice(0, 200))}`);
  }

  const data: any = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in || 3600,
  };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function gmailRequest(
  config: GmailConfig,
  method: string,
  path: string,
  body?: Record<string, unknown> | string
): Promise<any> {
  const token = await getAccessToken(config);
  const url = `${GMAIL_API_BASE}/users/me${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  const options: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    if (typeof body === 'string') {
      headers['Content-Type'] = 'message/rfc822';
      options.body = body;
    } else {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(url, options);

  if (response.status === 204) return {};

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gmail API error (${response.status}): ${redactSensitive(errorText.slice(0, 200))}`);
  }

  return await response.json();
}

// ---------------------------------------------------------------------------
// Message parsing helpers
// ---------------------------------------------------------------------------

function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function extractMessageBody(payload: any): string {
  if (!payload) return '';

  // Simple text body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart — find text/plain first, then text/html
  if (payload.parts && Array.isArray(payload.parts)) {
    const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }

    const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      const html = decodeBase64Url(htmlPart.body.data);
      // Basic HTML strip
      return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // Nested multipart
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractMessageBody(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

function parseGmailMessage(raw: any): GmailMessage {
  const headers = raw.payload?.headers || [];
  const labels = raw.labelIds || [];
  const body = extractMessageBody(raw.payload);

  return {
    id: raw.id || '',
    threadId: raw.threadId || '',
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject') || '(Sin asunto)',
    date: getHeader(headers, 'Date'),
    snippet: raw.snippet || '',
    body: body.slice(0, 4000), // Limit body size
    labels,
    isUnread: labels.includes('UNREAD'),
  };
}

// ---------------------------------------------------------------------------
// RFC 2822 email builder
// ---------------------------------------------------------------------------

function buildRfc2822Message(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string,
  inReplyTo?: string,
  references?: string
): string {
  const lines: string[] = [];
  lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  if (bcc) lines.push(`Bcc: ${bcc}`);
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('');
  lines.push(Buffer.from(body).toString('base64'));
  return lines.join('\r\n');
}

function encodeRfc2822ForGmail(raw: string): string {
  return Buffer.from(raw)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// Gmail Provider
// ---------------------------------------------------------------------------

export interface GmailProvider {
  listMessages(query?: string, maxResults?: number): Promise<GmailMessage[]>;
  getMessage(messageId: string): Promise<GmailMessage>;
  searchMessages(query: string, maxResults?: number): Promise<GmailMessage[]>;
  sendMessage(to: string, subject: string, body: string, cc?: string, bcc?: string): Promise<GmailSendResult>;
  replyToMessage(messageId: string, body: string): Promise<GmailSendResult>;
  markAsRead(messageId: string): Promise<boolean>;
  getUnreadCount(): Promise<number>;
}

export function createGmailProvider(config: GmailConfig): GmailProvider {
  return {
    async listMessages(query?: string, maxResults = 15) {
      const params = new URLSearchParams({
        maxResults: String(maxResults),
      });
      if (query) params.set('q', query);
      params.set('labelIds', 'INBOX');

      const list = await gmailRequest(config, 'GET', `/messages?${params.toString()}`);
      const messages: GmailMessage[] = [];

      if (list.messages && Array.isArray(list.messages)) {
        for (const msg of list.messages.slice(0, maxResults)) {
          try {
            const full = await gmailRequest(config, 'GET', `/messages/${msg.id}?format=full`);
            messages.push(parseGmailMessage(full));
          } catch {
            // Skip messages that fail to load
          }
        }
      }

      return messages;
    },

    async getMessage(messageId: string) {
      const full = await gmailRequest(config, 'GET', `/messages/${messageId}?format=full`);
      return parseGmailMessage(full);
    },

    async searchMessages(query: string, maxResults = 10) {
      const params = new URLSearchParams({
        q: query,
        maxResults: String(maxResults),
      });

      const list = await gmailRequest(config, 'GET', `/messages?${params.toString()}`);
      const messages: GmailMessage[] = [];

      if (list.messages && Array.isArray(list.messages)) {
        for (const msg of list.messages.slice(0, maxResults)) {
          try {
            const full = await gmailRequest(config, 'GET', `/messages/${msg.id}?format=full`);
            messages.push(parseGmailMessage(full));
          } catch {
            // Skip messages that fail to load
          }
        }
      }

      return messages;
    },

    async sendMessage(to: string, subject: string, body: string, cc?: string, bcc?: string) {
      const raw = buildRfc2822Message(to, subject, body, cc, bcc);
      const encoded = encodeRfc2822ForGmail(raw);

      const result = await gmailRequest(config, 'POST', '/messages/send', {
        raw: encoded,
      });

      return {
        id: result.id || '',
        threadId: result.threadId || '',
        labelIds: result.labelIds || [],
      };
    },

    async replyToMessage(messageId: string, body: string) {
      // Get original message to extract threading info
      const original = await gmailRequest(config, 'GET', `/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Message-ID&metadataHeaders=References`);
      const headers = original.payload?.headers || [];
      const originalFrom = getHeader(headers, 'From');
      const originalSubject = getHeader(headers, 'Subject');
      const messageIdHeader = getHeader(headers, 'Message-ID');
      const existingRefs = getHeader(headers, 'References');

      const replySubject = originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`;
      const references = existingRefs ? `${existingRefs} ${messageIdHeader}` : messageIdHeader;

      const raw = buildRfc2822Message(
        originalFrom,
        replySubject,
        body,
        undefined,
        undefined,
        messageIdHeader,
        references
      );
      const encoded = encodeRfc2822ForGmail(raw);

      const result = await gmailRequest(config, 'POST', '/messages/send', {
        raw: encoded,
        threadId: original.threadId,
      });

      return {
        id: result.id || '',
        threadId: result.threadId || '',
        labelIds: result.labelIds || [],
      };
    },

    async markAsRead(messageId: string) {
      try {
        await gmailRequest(config, 'POST', `/messages/${messageId}/modify`, {
          removeLabelIds: ['UNREAD'],
        });
        return true;
      } catch {
        return false;
      }
    },

    async getUnreadCount() {
      const params = new URLSearchParams({
        q: 'is:unread',
        labelIds: 'INBOX',
        maxResults: '1',
      });
      const result = await gmailRequest(config, 'GET', `/messages?${params.toString()}`);
      return result.resultSizeEstimate || 0;
    },
  };
}
