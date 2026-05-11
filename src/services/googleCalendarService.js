import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../db/index.js';
import {
  googleCalendarIntegrations,
  googleCalendarEvents,
  googleCalendarSyncLogs,
} from '../models/googleCalendarSync.js';
import { events } from '../models/events.js';
import { eq, and, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';

// Initialize OAuth2 client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Scopes required for Google Calendar access
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

export class GoogleCalendarService {
  constructor() {
    this.calendar = google.calendar('v3');
  }

  // Generate OAuth2 authorization URL
  getAuthUrl(userId) {
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_CALENDAR_SCOPES,
      state: userId, // Pass userId in state to link after callback
      prompt: 'consent', // Force consent to ensure refresh token
    });
  }

  // Exchange authorization code for tokens
  async exchangeCodeForTokens(code) {
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }

  // Get user info from Google
  async getUserInfo(tokens) {
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: 'v2',
    });
    const { data } = await oauth2.userinfo.get();
    return data;
  }

  // Save or update Google Calendar integration
  async saveIntegration(userId, tokens, userInfo) {
    const integration = {
      userId,
      googleAccountEmail: userInfo.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(tokens.expiry_date),
      primaryCalendarId: userInfo.email, // Default to primary calendar
    };

    // Check if integration exists
    const existing = await db
      .select()
      .from(googleCalendarIntegrations)
      .where(eq(googleCalendarIntegrations.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      // Update existing integration
      await db
        .update(googleCalendarIntegrations)
        .set({
          ...integration,
          updatedAt: new Date(),
        })
        .where(eq(googleCalendarIntegrations.userId, userId));
      return existing[0].id;
    } else {
      // Create new integration
      const [newIntegration] = await db
        .insert(googleCalendarIntegrations)
        .values(integration)
        .returning();
      return newIntegration.id;
    }
  }

  // Get user's Google Calendar integration
  async getIntegration(userId) {
    const [integration] = await db
      .select()
      .from(googleCalendarIntegrations)
      .where(
        and(
          eq(googleCalendarIntegrations.userId, userId),
          eq(googleCalendarIntegrations.isActive, true)
        )
      )
      .limit(1);
    return integration;
  }

  // Refresh access token if expired
  async refreshAccessToken(integration) {
    oauth2Client.setCredentials({
      refresh_token: integration.refreshToken,
    });

    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update stored tokens
    await db
      .update(googleCalendarIntegrations)
      .set({
        accessToken: credentials.access_token,
        tokenExpiresAt: new Date(credentials.expiry_date),
        updatedAt: new Date(),
      })
      .where(eq(googleCalendarIntegrations.id, integration.id));

    return credentials;
  }

  // Get authenticated calendar client
  async getAuthenticatedClient(integration) {
    // Check if token is expired
    if (new Date(integration.tokenExpiresAt) < new Date()) {
      const newCredentials = await this.refreshAccessToken(integration);
      oauth2Client.setCredentials(newCredentials);
    } else {
      oauth2Client.setCredentials({
        access_token: integration.accessToken,
        refresh_token: integration.refreshToken,
      });
    }

    return oauth2Client;
  }

  // List user's calendars
  async listCalendars(userId) {
    const integration = await this.getIntegration(userId);
    if (!integration) {
      throw new Error('No Google Calendar integration found');
    }

    const auth = await this.getAuthenticatedClient(integration);
    const response = await this.calendar.calendarList.list({
      auth,
    });

    return response.data.items;
  }


  // Export event to Google Calendar
  async exportEventToGoogle(eventId, userId) {
    const integration = await this.getIntegration(userId);
    if (!integration) {
      throw new Error('No Google Calendar integration found');
    }

    // Get event details
    const [event] = await db
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .limit(1);

    if (!event) {
      throw new Error('Event not found');
    }

    const auth = await this.getAuthenticatedClient(integration);

    // Convert event to Google Calendar format
    const googleEvent = {
      summary: event.title,
      description: event.description,
      start: {
        dateTime: DateTime.fromJSDate(event.startDate).toISO(),
        timeZone: event.timezone || 'America/New_York',
      },
      end: {
        dateTime: DateTime.fromJSDate(event.endDate).toISO(),
        timeZone: event.timezone || 'America/New_York',
      },
      location: event.locationName,
    };

    // Check if event already exists in Google
    const [existingMapping] = await db
      .select()
      .from(googleCalendarEvents)
      .where(
        and(
          eq(googleCalendarEvents.eventId, eventId),
          eq(googleCalendarEvents.integrationId, integration.id)
        )
      )
      .limit(1);

    let googleEventId;
    if (existingMapping) {
      // Update existing Google event
      const response = await this.calendar.events.update({
        auth,
        calendarId: integration.primaryCalendarId,
        eventId: existingMapping.googleEventId,
        requestBody: googleEvent,
      });
      googleEventId = response.data.id;
    } else {
      // Create new Google event
      const response = await this.calendar.events.insert({
        auth,
        calendarId: integration.primaryCalendarId,
        requestBody: googleEvent,
      });
      googleEventId = response.data.id;

      // Create sync mapping
      await db.insert(googleCalendarEvents).values({
        eventId,
        googleEventId,
        googleCalendarId: integration.primaryCalendarId,
        integrationId: integration.id,
        googleEventData: response.data,
        syncDirection: 'exported',
      });
    }

    return googleEventId;
  }

  // Disconnect Google Calendar integration
  async disconnectIntegration(userId) {
    await db
      .update(googleCalendarIntegrations)
      .set({
        isActive: false,
        syncEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(googleCalendarIntegrations.userId, userId));
  }
}

export default new GoogleCalendarService();
