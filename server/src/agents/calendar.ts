// ---------------------------------------------------------------------------
// Calendar Types — Shared types for Google Calendar & iCloud CalDAV
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  allDay?: boolean;
  calendarType: 'google' | 'icloud';
  status?: string;
  recurrence?: string;
  url?: string;
}

export interface CalendarConfig {
  google?: GoogleCalendarConfig;
  icloud?: ICloudCalendarConfig;
}

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  calendarId?: string; // defaults to 'primary'
}

export interface ICloudCalendarConfig {
  email: string;
  appSpecificPassword: string;
  calendarName?: string; // name of the calendar to use (defaults to first found)
}

export interface CalendarProvider {
  createEvent(event: Omit<CalendarEvent, 'id' | 'calendarType'>): Promise<CalendarEvent>;
  listEvents(startDate: string, endDate: string, maxResults?: number): Promise<CalendarEvent[]>;
  searchEvents(query: string, startDate?: string, endDate?: string): Promise<CalendarEvent[]>;
  updateEvent(eventId: string, updates: Partial<Omit<CalendarEvent, 'id' | 'calendarType'>>): Promise<CalendarEvent | null>;
  deleteEvent(eventId: string): Promise<boolean>;
}
