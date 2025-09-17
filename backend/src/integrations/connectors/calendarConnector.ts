import { ApiConnector, ApiRequest, ApiResponse } from '../apiConnector';

export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: CalendarAttendee[];
  location?: string;
  recurrence?: string[];
  reminders?: {
    useDefault: boolean;
    overrides?: Array<{
      method: string;
      minutes: number;
    }>;
  };
}

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
  optional?: boolean;
}

export interface Calendar {
  id: string;
  summary: string;
  description?: string;
  timeZone: string;
  accessRole: string;
  primary?: boolean;
}

export class CalendarConnector {
  private apiConnector: ApiConnector;

  constructor(apiConnector: ApiConnector) {
    this.apiConnector = apiConnector;
  }

  // Create calendar event
  async createEvent(
    connectionId: string,
    tenantId: string,
    calendarId: string,
    event: CalendarEvent
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'POST',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      data: event,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Get calendar events
  async getEvents(
    connectionId: string,
    tenantId: string,
    calendarId: string,
    timeMin?: string,
    timeMax?: string,
    maxResults: number = 10,
    singleEvents: boolean = true
  ): Promise<CalendarEvent[]> {
    const params: any = {
      maxResults,
      singleEvents,
      orderBy: 'startTime'
    };

    if (timeMin) params.timeMin = timeMin;
    if (timeMax) params.timeMax = timeMax;

    const request: ApiRequest = {
      method: 'GET',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      params
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    
    if (response.success && response.data?.items) {
      return response.data.items.map((item: any) => this.formatEvent(item));
    }

    return [];
  }

  // Update calendar event
  async updateEvent(
    connectionId: string,
    tenantId: string,
    calendarId: string,
    eventId: string,
    event: Partial<CalendarEvent>
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'PUT',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      data: event
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Delete calendar event
  async deleteEvent(
    connectionId: string,
    tenantId: string,
    calendarId: string,
    eventId: string
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'DELETE',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Get calendars list
  async getCalendars(
    connectionId: string,
    tenantId: string
  ): Promise<Calendar[]> {
    const request: ApiRequest = {
      method: 'GET',
      endpoint: '/calendar/v3/users/me/calendarList'
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    
    if (response.success && response.data?.items) {
      return response.data.items.map((item: any) => ({
        id: item.id,
        summary: item.summary,
        description: item.description,
        timeZone: item.timeZone,
        accessRole: item.accessRole,
        primary: item.primary
      }));
    }

    return [];
  }

  // Get free/busy information
  async getFreeBusy(
    connectionId: string,
    tenantId: string,
    timeMin: string,
    timeMax: string,
    calendarIds: string[]
  ): Promise<any> {
    const request: ApiRequest = {
      method: 'POST',
      endpoint: '/calendar/v3/freeBusy',
      data: {
        timeMin,
        timeMax,
        items: calendarIds.map(id => ({ id }))
      }
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    return response.success ? response.data : null;
  }

  // Search events
  async searchEvents(
    connectionId: string,
    tenantId: string,
    calendarId: string,
    query: string,
    maxResults: number = 10
  ): Promise<CalendarEvent[]> {
    const request: ApiRequest = {
      method: 'GET',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      params: {
        q: query,
        maxResults,
        singleEvents: true,
        orderBy: 'startTime'
      }
    };

    const response = await this.apiConnector.makeRequest(connectionId, request, tenantId);
    
    if (response.success && response.data?.items) {
      return response.data.items.map((item: any) => this.formatEvent(item));
    }

    return [];
  }

  // Get today's events
  async getTodaysEvents(
    connectionId: string,
    tenantId: string,
    calendarId: string = 'primary'
  ): Promise<CalendarEvent[]> {
    const today = new Date();
    const timeMin = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const timeMax = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();

    return await this.getEvents(connectionId, tenantId, calendarId, timeMin, timeMax);
  }

  // Get upcoming events
  async getUpcomingEvents(
    connectionId: string,
    tenantId: string,
    calendarId: string = 'primary',
    days: number = 7
  ): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));

    return await this.getEvents(connectionId, tenantId, calendarId, now.toISOString(), future.toISOString());
  }

  // Create quick event
  async createQuickEvent(
    connectionId: string,
    tenantId: string,
    calendarId: string,
    text: string
  ): Promise<ApiResponse> {
    const request: ApiRequest = {
      method: 'POST',
      endpoint: `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/quickAdd`,
      params: {
        text
      }
    };

    return await this.apiConnector.makeRequest(connectionId, request, tenantId);
  }

  // Private helper methods
  private formatEvent(item: any): CalendarEvent {
    return {
      id: item.id,
      summary: item.summary,
      description: item.description,
      start: item.start,
      end: item.end,
      attendees: item.attendees?.map((attendee: any) => ({
        email: attendee.email,
        displayName: attendee.displayName,
        responseStatus: attendee.responseStatus,
        optional: attendee.optional
      })),
      location: item.location,
      recurrence: item.recurrence,
      reminders: item.reminders
    };
  }

  // Create Google Calendar connection configuration with encrypted OAuth2 tokens
  static createConnectionConfig(accessToken: string, refreshToken?: string, encryptionKey?: string): any {
    // Import encryption utilities
    const { encryptPayload } = require('../../utils/encryption');
    
    let credentials: any = {
      accessToken,
      refreshToken,
      tokenType: 'Bearer'
    };

    // Encrypt OAuth2 tokens if encryption key is provided
    if (encryptionKey) {
      try {
        credentials = {
          accessToken: encryptPayload(accessToken, encryptionKey),
          refreshToken: refreshToken ? encryptPayload(refreshToken, encryptionKey) : undefined,
          tokenType: 'Bearer',
          encrypted: true
        };
      } catch (error) {
        console.warn('Failed to encrypt OAuth2 tokens for Calendar connector:', error);
        // Fall back to unencrypted (should be avoided in production)
      }
    } else {
      console.warn('Calendar connector: No encryption key provided. OAuth2 tokens will be stored unencrypted.');
    }

    return {
      name: 'Google Calendar Integration',
      type: 'google_calendar',
      baseUrl: 'https://www.googleapis.com',
      authentication: {
        type: 'oauth2',
        credentials
      },
      headers: {
        'Content-Type': 'application/json'
      },
      rateLimit: {
        requestsPerSecond: 10,
        requestsPerMinute: 600,
        requestsPerHour: 1000000,
        burstLimit: 20
      },
      retryConfig: {
        maxRetries: 3,
        backoffMultiplier: 2,
        maxBackoffMs: 10000,
        retryableStatusCodes: [429, 500, 502, 503, 504]
      },
      isActive: true,
      metadata: {
        provider: 'google_calendar',
        version: '1.0',
        scopes: ['https://www.googleapis.com/auth/calendar']
      }
    };
  }
}
