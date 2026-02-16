// ---------------------------------------------------------------------------
// Google Calendar Integration — OAuth2 + REST API (no external dependencies)
// ---------------------------------------------------------------------------

import { CalendarEvent, CalendarProvider, GoogleCalendarConfig } from './calendar';
import { redactSensitive } from '../security/redact';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

// ---------------------------------------------------------------------------
// OAuth2 token management
// ---------------------------------------------------------------------------

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

const tokenCaches = new Map<string, TokenCache>();

async function getAccessToken(config: GoogleCalendarConfig): Promise<string> {
  const cacheKey = `${config.clientId}:${config.refreshToken.slice(-8)}`;
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
    throw new Error(`Google OAuth2 token refresh failed (${response.status}): ${redactSensitive(errorText.slice(0, 200))}`);
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

export function buildGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  state?: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
  });
  if (state) params.set('state', state);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleAuthCode(
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
    throw new Error(`Google OAuth2 code exchange failed (${response.status}): ${redactSensitive(errorText.slice(0, 200))}`);
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

async function googleCalendarRequest(
  config: GoogleCalendarConfig,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<any> {
  const token = await getAccessToken(config);
  const calendarId = encodeURIComponent(config.calendarId || 'primary');
  const url = `${GOOGLE_CALENDAR_BASE}/calendars/${calendarId}${path}`;

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(20_000),
  };

  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (method === 'DELETE' && response.status === 204) {
    return { deleted: true };
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Calendar API error (${response.status}): ${redactSensitive(errorText.slice(0, 200))}`);
  }

  if (response.status === 204) return {};
  return await response.json();
}

// ---------------------------------------------------------------------------
// Event conversion
// ---------------------------------------------------------------------------

function toGoogleEventBody(event: Partial<Omit<CalendarEvent, 'id' | 'calendarType'>>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const hasExplicitOffset = (value: string): boolean => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);

  if (event.title !== undefined) body.summary = event.title;
  if (event.description !== undefined) body.description = event.description;
  if (event.location !== undefined) body.location = event.location;

  if (event.startTime) {
    if (event.allDay) {
      body.start = { date: event.startTime.split('T')[0] };
    } else {
      body.start = hasExplicitOffset(event.startTime)
        ? { dateTime: event.startTime }
        : { dateTime: event.startTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
  }

  if (event.endTime) {
    if (event.allDay) {
      body.end = { date: event.endTime.split('T')[0] };
    } else {
      body.end = hasExplicitOffset(event.endTime)
        ? { dateTime: event.endTime }
        : { dateTime: event.endTime, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    }
  }

  return body;
}

function fromGoogleEvent(raw: any): CalendarEvent {
  const startDateTime = raw.start?.dateTime || raw.start?.date || '';
  const endDateTime = raw.end?.dateTime || raw.end?.date || '';
  const isAllDay = !raw.start?.dateTime;

  return {
    id: raw.id || '',
    title: raw.summary || '(Sin título)',
    description: raw.description || undefined,
    location: raw.location || undefined,
    startTime: startDateTime,
    endTime: endDateTime,
    allDay: isAllDay,
    calendarType: 'google',
    status: raw.status || undefined,
    recurrence: raw.recurrence ? raw.recurrence.join('; ') : undefined,
    url: raw.htmlLink || undefined,
  };
}

// ---------------------------------------------------------------------------
// Google Calendar Provider
// ---------------------------------------------------------------------------

export function createGoogleCalendarProvider(config: GoogleCalendarConfig): CalendarProvider {
  return {
    async createEvent(event) {
      const body = toGoogleEventBody(event);
      const result = await googleCalendarRequest(config, 'POST', '/events', body);
      return fromGoogleEvent(result);
    },

    async listEvents(startDate, endDate, maxResults = 25) {
      const params = new URLSearchParams({
        timeMin: new Date(startDate).toISOString(),
        timeMax: new Date(endDate).toISOString(),
        maxResults: String(maxResults),
        singleEvents: 'true',
        orderBy: 'startTime',
      });
      const result = await googleCalendarRequest(config, 'GET', `/events?${params.toString()}`);
      return (result.items || []).map(fromGoogleEvent);
    },

    async searchEvents(query, startDate, endDate) {
      const params = new URLSearchParams({
        q: query,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '20',
      });
      if (startDate) params.set('timeMin', new Date(startDate).toISOString());
      if (endDate) params.set('timeMax', new Date(endDate).toISOString());
      const result = await googleCalendarRequest(config, 'GET', `/events?${params.toString()}`);
      return (result.items || []).map(fromGoogleEvent);
    },

    async updateEvent(eventId, updates) {
      const body = toGoogleEventBody(updates);
      try {
        const result = await googleCalendarRequest(config, 'PATCH', `/events/${encodeURIComponent(eventId)}`, body);
        return fromGoogleEvent(result);
      } catch {
        return null;
      }
    },

    async deleteEvent(eventId) {
      try {
        await googleCalendarRequest(config, 'DELETE', `/events/${encodeURIComponent(eventId)}`);
        return true;
      } catch {
        return false;
      }
    },
  };
}
