// ---------------------------------------------------------------------------
// iCloud Calendar Integration — CalDAV protocol (no external dependencies)
// ---------------------------------------------------------------------------

import { CalendarEvent, CalendarProvider, ICloudCalendarConfig } from './calendar';

const ICLOUD_CALDAV_BASE = 'https://caldav.icloud.com';
const CALDAV_TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------
// CalDAV + iCalendar helpers
// ---------------------------------------------------------------------------

function basicAuthHeader(email: string, password: string): string {
  return 'Basic ' + Buffer.from(`${email}:${password}`).toString('base64');
}

function normalizeICloudAppPassword(password: string): string {
  return password.replace(/[\s-]/g, '');
}

function resolveRedirectUrl(currentUrl: string, location: string): string {
  return new URL(location, currentUrl).toString();
}

function generateUID(): string {
  const chars = 'abcdef0123456789';
  const segments = [8, 4, 4, 4, 12];
  return segments
    .map((len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join(''))
    .join('-') + '@optimaizer';
}

function toICalDateTime(iso: string, allDay?: boolean): string {
  const date = new Date(iso);
  if (allDay) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function fromICalDateTime(value: string): string {
  // Handles both 20260213T090000Z and 20260213 formats
  const cleaned = value.replace(/[^0-9TZ]/g, '');
  if (cleaned.length === 8) {
    // All-day: YYYYMMDD
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }
  // DateTime: YYYYMMDDTHHmmssZ or YYYYMMDDTHHmmss
  const year = cleaned.slice(0, 4);
  const month = cleaned.slice(4, 6);
  const day = cleaned.slice(6, 8);
  const hour = cleaned.slice(9, 11) || '00';
  const minute = cleaned.slice(11, 13) || '00';
  const second = cleaned.slice(13, 15) || '00';
  const tz = cleaned.endsWith('Z') ? 'Z' : '';
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${tz}`;
}

function escapeICalText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function unescapeICalText(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function buildVEvent(event: Omit<CalendarEvent, 'id' | 'calendarType'>, uid?: string): string {
  const eventUid = uid || generateUID();
  const now = toICalDateTime(new Date().toISOString());

  const dtStartProp = event.allDay ? 'DTSTART;VALUE=DATE' : 'DTSTART';
  const dtEndProp = event.allDay ? 'DTEND;VALUE=DATE' : 'DTEND';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Optimaizer//Agent//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${eventUid}`,
    `DTSTAMP:${now}`,
    `${dtStartProp}:${toICalDateTime(event.startTime, event.allDay)}`,
    `${dtEndProp}:${toICalDateTime(event.endTime, event.allDay)}`,
    `SUMMARY:${escapeICalText(event.title)}`,
  ];

  if (event.description) {
    lines.push(`DESCRIPTION:${escapeICalText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeICalText(event.location)}`);
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

function parseICalProperty(vevent: string, property: string): string | null {
  // Match property with optional parameters (e.g., DTSTART;VALUE=DATE:20260213)
  const regex = new RegExp(`^${property}(?:;[^:]*)?:(.*)$`, 'mi');
  const match = vevent.match(regex);
  return match ? match[1].trim() : null;
}

function parseVEvent(veventBlock: string, calendarType: 'icloud'): CalendarEvent | null {
  const uid = parseICalProperty(veventBlock, 'UID');
  if (!uid) return null;

  const summary = parseICalProperty(veventBlock, 'SUMMARY') || '(Sin título)';
  const description = parseICalProperty(veventBlock, 'DESCRIPTION');
  const location = parseICalProperty(veventBlock, 'LOCATION');
  const dtStart = parseICalProperty(veventBlock, 'DTSTART');
  const dtEnd = parseICalProperty(veventBlock, 'DTEND');
  const status = parseICalProperty(veventBlock, 'STATUS');

  if (!dtStart) return null;

  const isAllDay = veventBlock.includes('VALUE=DATE') && !veventBlock.includes('VALUE=DATE-TIME');

  return {
    id: uid,
    title: unescapeICalText(summary),
    description: description ? unescapeICalText(description) : undefined,
    location: location ? unescapeICalText(location) : undefined,
    startTime: fromICalDateTime(dtStart),
    endTime: dtEnd ? fromICalDateTime(dtEnd) : fromICalDateTime(dtStart),
    allDay: isAllDay,
    calendarType,
    status: status || undefined,
  };
}

function extractVEvents(icalData: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const regex = /BEGIN:VEVENT[\s\S]*?END:VEVENT/gi;
  let match;
  while ((match = regex.exec(icalData)) !== null) {
    const parsed = parseVEvent(match[0], 'icloud');
    if (parsed) events.push(parsed);
  }
  return events;
}

// ---------------------------------------------------------------------------
// CalDAV requests
// ---------------------------------------------------------------------------

async function caldavRequest(
  url: string,
  method: string,
  config: ICloudCalendarConfig,
  body?: string,
  extraHeaders?: Record<string, string>,
  depth?: string
): Promise<{ status: number; body: string }> {
  const normalizedEmail = config.email.trim();
  const normalizedPassword = normalizeICloudAppPassword(config.appSpecificPassword.trim());
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(normalizedEmail, normalizedPassword),
    'Content-Type': 'application/xml; charset=utf-8',
    ...extraHeaders,
  };
  if (depth !== undefined) {
    headers['Depth'] = depth;
  }

  let currentUrl = url;
  const maxRedirects = 5;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const response = await fetch(currentUrl, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(CALDAV_TIMEOUT_MS),
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { status: response.status, body: await response.text() };
      }
      currentUrl = resolveRedirectUrl(currentUrl, location);
      continue;
    }

    const responseBody = await response.text();
    return { status: response.status, body: responseBody };
  }

  throw new Error('CalDAV request exceeded redirect limit.');
}

// ---------------------------------------------------------------------------
// CalDAV discovery — find the user's calendar URL
// ---------------------------------------------------------------------------

interface DiscoveredCalendar {
  href: string;
  displayName: string;
}

interface ResolvedCalendarTargets {
  primaryUrl: string;
  queryUrls: string[];
}

async function discoverPrincipalUrl(config: ICloudCalendarConfig): Promise<string> {
  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal/>
  </d:prop>
</d:propfind>`;

  const result = await caldavRequest(ICLOUD_CALDAV_BASE + '/', 'PROPFIND', config, propfindBody, {}, '0');
  if (result.status >= 400) {
    throw new Error(`CalDAV discovery failed (${result.status}): Check iCloud email and app-specific password.`);
  }

  const principalMatch = result.body.match(/<d:current-user-principal[^>]*>\s*<d:href[^>]*>([^<]+)<\/d:href>/i)
    || result.body.match(/<current-user-principal[^>]*>\s*<href[^>]*>([^<]+)<\/href>/i);

  if (!principalMatch) {
    throw new Error('Could not discover CalDAV principal URL from iCloud response.');
  }

  return principalMatch[1].trim();
}

async function discoverCalendarHome(config: ICloudCalendarConfig, principalUrl: string): Promise<string> {
  const fullUrl = principalUrl.startsWith('http') ? principalUrl : `${ICLOUD_CALDAV_BASE}${principalUrl}`;

  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set/>
  </d:prop>
</d:propfind>`;

  const result = await caldavRequest(fullUrl, 'PROPFIND', config, propfindBody, {}, '0');
  if (result.status >= 400) {
    throw new Error(`CalDAV calendar-home-set discovery failed (${result.status}).`);
  }

  const homeMatch = result.body.match(/<(?:c:|cal:)?calendar-home-set[^>]*>\s*<(?:d:)?href[^>]*>([^<]+)<\/(?:d:)?href>/i);
  if (!homeMatch) {
    throw new Error('Could not discover CalDAV calendar home from iCloud response.');
  }

  return homeMatch[1].trim();
}

async function discoverCalendars(config: ICloudCalendarConfig, calendarHomeUrl: string): Promise<DiscoveredCalendar[]> {
  const fullUrl = calendarHomeUrl.startsWith('http') ? calendarHomeUrl : `${ICLOUD_CALDAV_BASE}${calendarHomeUrl}`;

  const propfindBody = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cs:getctag/>
  </d:prop>
</d:propfind>`;

  const result = await caldavRequest(fullUrl, 'PROPFIND', config, propfindBody, {}, '1');
  if (result.status >= 400) {
    throw new Error(`CalDAV calendars discovery failed (${result.status}).`);
  }

  const calendars: DiscoveredCalendar[] = [];
  // Parse response entries
  const responseRegex = /<(?:d:)?response\b[^>]*>([\s\S]*?)<\/(?:d:)?response>/gi;
  let match;

  while ((match = responseRegex.exec(result.body)) !== null) {
    const entry = match[1];

    // Check it's a calendar resource
    if (!/<(?:d:)?resourcetype[^>]*>[\s\S]*?<(?:c:|cal:)?calendar/i.test(entry)) {
      continue;
    }

    const hrefMatch = entry.match(/<(?:d:)?href[^>]*>([^<]+)<\/(?:d:)?href>/i);
    const nameMatch = entry.match(/<(?:d:)?displayname[^>]*>([^<]*)<\/(?:d:)?displayname>/i);

    if (hrefMatch) {
      calendars.push({
        href: hrefMatch[1].trim(),
        displayName: nameMatch ? nameMatch[1].trim() : 'Calendar',
      });
    }
  }

  return calendars;
}

// Cache discovered calendars per user
const calendarTargetsCache = new Map<string, { calendars: DiscoveredCalendar[]; expiresAt: number }>();

async function resolveCalendarTargets(config: ICloudCalendarConfig): Promise<ResolvedCalendarTargets> {
  const cacheKey = config.email;
  const cached = calendarTargetsCache.get(cacheKey);

  let calendars: DiscoveredCalendar[];
  if (cached && cached.expiresAt > Date.now()) {
    calendars = cached.calendars;
  } else {
    const principalUrl = await discoverPrincipalUrl(config);
    const calendarHome = await discoverCalendarHome(config, principalUrl);
    calendars = await discoverCalendars(config, calendarHome);

    if (calendars.length === 0) {
      throw new Error('No iCloud calendars found. Ensure you have at least one calendar in your iCloud account.');
    }

    calendarTargetsCache.set(cacheKey, { calendars, expiresAt: Date.now() + 3_600_000 });
  }

  // Select primary calendar by name or take first
  let selectedCalendar = calendars[0];
  if (config.calendarName) {
    const byName = calendars.find(
      (c) => c.displayName.toLowerCase() === config.calendarName!.toLowerCase()
    );
    if (!byName) {
      throw new Error(`iCloud calendar \"${config.calendarName}\" not found. Available calendars: ${calendars.map((c) => c.displayName).join(', ')}`);
    }
    selectedCalendar = byName;
  }

  const primaryUrl = selectedCalendar.href.startsWith('http')
    ? selectedCalendar.href
    : `${ICLOUD_CALDAV_BASE}${selectedCalendar.href}`;

  const queryCalendars = config.calendarName ? [selectedCalendar] : calendars;
  const queryUrls = queryCalendars.map((calendar) => (
    calendar.href.startsWith('http') ? calendar.href : `${ICLOUD_CALDAV_BASE}${calendar.href}`
  ));

  // Log calendar names only — never log the full URL which contains user-specific CalDAV paths
  if (config.calendarName) {
    console.log(`[iCloud CalDAV] Using calendar: "${selectedCalendar.displayName}"`);
  } else {
    console.log(`[iCloud CalDAV] Querying ${queryCalendars.length} calendars: ${queryCalendars.map((c) => `"${c.displayName}"`).join(', ')}`);
  }

  return { primaryUrl, queryUrls };
}

function extractEventsFromCalDavReport(body: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const calDataRegex = /<(?:c:|cal:)?calendar-data[^>]*>([\s\S]*?)<\/(?:c:|cal:)?calendar-data>/gi;
  let match;

  while ((match = calDataRegex.exec(body)) !== null) {
    const icalData = match[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"');
    const parsed = extractVEvents(icalData);
    events.push(...parsed);
  }

  return events;
}

// ---------------------------------------------------------------------------
// iCloud Calendar Provider
// ---------------------------------------------------------------------------

export function createICloudCalendarProvider(config: ICloudCalendarConfig): CalendarProvider {
  return {
    async createEvent(event) {
      const targets = await resolveCalendarTargets(config);
      const calendarUrl = targets.primaryUrl;
      const uid = generateUID();
      const icsData = buildVEvent(event, uid);
      const eventUrl = `${calendarUrl.replace(/\/$/, '')}/${uid}.ics`;

      const result = await caldavRequest(eventUrl, 'PUT', config, icsData, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
      });

      if (result.status >= 400) {
        throw new Error(`Failed to create iCloud event (HTTP ${result.status}). Check your iCloud credentials and try again.`);
      }

      return {
        id: uid,
        title: event.title,
        description: event.description,
        location: event.location,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        calendarType: 'icloud',
      };
    },

    async listEvents(startDate, endDate, maxResults = 50) {
      const targets = await resolveCalendarTargets(config);

      const reportBody = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${toICalDateTime(startDate)}" end="${toICalDateTime(endDate)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

      const events: CalendarEvent[] = [];
      for (const calendarUrl of targets.queryUrls) {
        const result = await caldavRequest(calendarUrl, 'REPORT', config, reportBody, {}, '1');
        if (result.status >= 400) {
          throw new Error(`Failed to list iCloud events (HTTP ${result.status}). Check your iCloud credentials and try again.`);
        }
        events.push(...extractEventsFromCalDavReport(result.body));
      }

      const dedup = new Map<string, CalendarEvent>();
      for (const event of events) {
        const key = `${event.id}::${event.startTime}::${event.endTime}`;
        if (!dedup.has(key)) dedup.set(key, event);
      }

      const merged = Array.from(dedup.values());
      merged.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      return merged.slice(0, maxResults);
    },

    async searchEvents(query, startDate, endDate) {
      // CalDAV doesn't have native text search, so we list and filter client-side
      const start = startDate || new Date(Date.now() - 30 * 86_400_000).toISOString();
      const end = endDate || new Date(Date.now() + 365 * 86_400_000).toISOString();
      const allEvents = await this.listEvents(start, end, 200);
      const lowerQuery = query.toLowerCase();
      return allEvents.filter(
        (e) =>
          e.title.toLowerCase().includes(lowerQuery) ||
          (e.description || '').toLowerCase().includes(lowerQuery) ||
          (e.location || '').toLowerCase().includes(lowerQuery)
      );
    },

    async updateEvent(eventId, updates) {
      const targets = await resolveCalendarTargets(config);
      const calendarUrl = targets.primaryUrl;
      const eventUrl = `${calendarUrl.replace(/\/$/, '')}/${eventId}.ics`;

      // First, fetch existing event
      const getResult = await caldavRequest(eventUrl, 'GET', config, undefined, {
        Accept: 'text/calendar',
      });

      if (getResult.status >= 400) {
        return null;
      }

      // Parse existing event
      const existingEvents = extractVEvents(getResult.body);
      if (existingEvents.length === 0) return null;
      const existing = existingEvents[0];

      // Merge updates
      const merged: Omit<CalendarEvent, 'id' | 'calendarType'> = {
        title: updates.title ?? existing.title,
        description: updates.description ?? existing.description,
        location: updates.location ?? existing.location,
        startTime: updates.startTime ?? existing.startTime,
        endTime: updates.endTime ?? existing.endTime,
        allDay: updates.allDay ?? existing.allDay,
      };

      const icsData = buildVEvent(merged, eventId);
      const putResult = await caldavRequest(eventUrl, 'PUT', config, icsData, {
        'Content-Type': 'text/calendar; charset=utf-8',
      });

      if (putResult.status >= 400) {
        return null;
      }

      return {
        id: eventId,
        ...merged,
        calendarType: 'icloud' as const,
      };
    },

    async deleteEvent(eventId) {
      const targets = await resolveCalendarTargets(config);
      const calendarUrl = targets.primaryUrl;
      const eventUrl = `${calendarUrl.replace(/\/$/, '')}/${eventId}.ics`;

      const result = await caldavRequest(eventUrl, 'DELETE', config);
      return result.status < 400;
    },
  };
}
