import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../db/index.js';
import {
  googleCalendarIntegrations,
  googleCalendarEvents,
  googleCalendarSyncLogs,
} from '../models/googleCalendarSync.js';
import { events } from '../models/events.js';
import { externalLinks } from '../models/external_links.js';
import { collectionExternalLinksNotations } from '../models/collectionExternalLinksNotations.js';
import { users } from '../models/users.js';
import { usersTenants } from '../models/usersTenants.js';
import { eq, and, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';

// Scopes required for Google Calendar access
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
];

export class GoogleCalendarServiceV2 {
  constructor() {
    this.calendar = google.calendar('v3');
    // Initialize OAuth2 client in constructor to ensure env vars are loaded
    this.oauth2Client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  // Generate OAuth2 authorization URL
  getAuthUrl(userId) {
    // Debug logging
    console.log('Google OAuth Config:', {
      clientId: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set',
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
      envFile: process.env.ENV_FILE || 'default .env',
    });

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: GOOGLE_CALENDAR_SCOPES,
      state: userId,
      prompt: 'consent',
    });
  }

  // Exchange authorization code for tokens
  async exchangeCodeForTokens(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens;
  }

  // Get user info from Google
  async getUserInfo(tokens) {
    this.oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({
      auth: this.oauth2Client,
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
      primaryCalendarId: userInfo.email,
    };

    const existing = await db
      .select()
      .from(googleCalendarIntegrations)
      .where(eq(googleCalendarIntegrations.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(googleCalendarIntegrations)
        .set({
          ...integration,
          updatedAt: new Date(),
        })
        .where(eq(googleCalendarIntegrations.userId, userId));
      return existing[0].id;
    } else {
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
    this.oauth2Client.setCredentials({
      refresh_token: integration.refreshToken,
    });

    const { credentials } = await this.oauth2Client.refreshAccessToken();

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
    if (new Date(integration.tokenExpiresAt) < new Date()) {
      const newCredentials = await this.refreshAccessToken(integration);
      this.oauth2Client.setCredentials(newCredentials);
    } else {
      this.oauth2Client.setCredentials({
        access_token: integration.accessToken,
        refresh_token: integration.refreshToken,
      });
    }

    return this.oauth2Client;
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

  // Export any entity to Google Calendar
  async exportEntityToGoogle(entityType, entityId, userId) {
    const integration = await this.getIntegration(userId);
    if (!integration) {
      throw new Error('No Google Calendar integration found');
    }

    // Get entity details based on type
    let entity;
    let googleEvent;

    switch (entityType) {
      case 'event':
        [entity] = await db
          .select()
          .from(events)
          .where(eq(events.id, entityId))
          .limit(1);

        if (!entity) throw new Error('Event not found');

        googleEvent = {
          summary: entity.title,
          description: entity.description,
          start: {
            dateTime: DateTime.fromJSDate(entity.startDate).toISO(),
            timeZone: entity.timezone || 'America/New_York',
          },
          end: {
            dateTime: DateTime.fromJSDate(entity.endDate).toISO(),
            timeZone: entity.timezone || 'America/New_York',
          },
          location: entity.locationName,
        };
        break;

      case 'external_link':
        [entity] = await db
          .select()
          .from(externalLinks)
          .where(eq(externalLinks.id, entityId))
          .limit(1);

        if (!entity) throw new Error('External link not found');

        // Create event from external link
        const linkStartDateTime = this.combineDateAndTime(
          entity.dateAdded,
          entity.startTime,
          entity.timezone
        );
        const linkEndDateTime = entity.endTime
          ? this.combineDateAndTime(
              entity.dateAdded,
              entity.endTime,
              entity.timezone
            )
          : linkStartDateTime.plus({ hours: 1 });

        googleEvent = {
          summary: entity.name || 'External Link',
          description: `${entity.description || ''}\n\nURL: ${entity.url || ''}`,
          start: {
            dateTime: linkStartDateTime.toISO(),
            timeZone: entity.timezone || 'America/New_York',
          },
          end: {
            dateTime: linkEndDateTime.toISO(),
            timeZone: entity.timezone || 'America/New_York',
          },
        };
        break;

      case 'notation':
        [entity] = await db
          .select()
          .from(collectionExternalLinksNotations)
          .where(eq(collectionExternalLinksNotations.id, entityId))
          .limit(1);

        if (!entity) throw new Error('Notation not found');

        // Create event from notation
        const notationStartDateTime = this.combineDateAndTime(
          entity.date,
          entity.startTime,
          entity.timezone
        );
        const notationEndDateTime = entity.endTime
          ? this.combineDateAndTime(
              entity.date,
              entity.endTime,
              entity.timezone
            )
          : notationStartDateTime.plus({ hours: 1 });

        googleEvent = {
          summary: entity.title || 'Notation',
          description: entity.description || entity.notes || '',
          start: {
            dateTime: notationStartDateTime.toISO(),
            timeZone: entity.timezone || 'America/New_York',
          },
          end: {
            dateTime: notationEndDateTime.toISO(),
            timeZone: entity.timezone || 'America/New_York',
          },
        };

        if (entity.category) {
          googleEvent.description = `Category: ${entity.category}\n\n${googleEvent.description}`;
        }
        break;

      default:
        throw new Error(`Unknown entity type: ${entityType}`);
    }

    const auth = await this.getAuthenticatedClient(integration);

    // Check if entity already exists in Google
    const [existingMapping] = await db
      .select()
      .from(googleCalendarEvents)
      .where(
        and(
          eq(googleCalendarEvents.entityType, entityType),
          eq(googleCalendarEvents.entityId, entityId),
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

      // Update sync mapping
      await db
        .update(googleCalendarEvents)
        .set({
          googleEventData: response.data,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(googleCalendarEvents.id, existingMapping.id));
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
        entityType,
        entityId,
        googleEventId,
        googleCalendarId: integration.primaryCalendarId,
        integrationId: integration.id,
        googleEventData: response.data,
        syncDirection: 'exported',
      });
    }

    return googleEventId;
  }

  // Helper function to combine date and time
  combineDateAndTime(date, time, timezone = 'America/New_York') {
    if (!date) {
      date = new Date();
    }

    // Convert date to DateTime
    const dateTime =
      typeof date === 'string'
        ? DateTime.fromISO(date, { zone: timezone })
        : DateTime.fromJSDate(date, { zone: timezone });

    if (!time) {
      // If no time specified, default to 9 AM
      return dateTime.set({ hour: 9, minute: 0, second: 0 });
    }

    // Parse time string (assumes HH:mm format)
    const [hours, minutes] = time.split(':').map(Number);
    return dateTime.set({ hour: hours, minute: minutes || 0, second: 0 });
  }

  // Get all calendar items for a user (events, external links, and notations)
  async getAllCalendarItems(userId, startDate, endDate) {
    const items = [];

    // Get events
    const userEvents = await db
      .select()
      .from(events)
      .where(
        and(
          eq(events.addedByUserId, userId)
          // Add date filtering if needed
        )
      );

    userEvents.forEach((event) => {
      items.push({
        type: 'event',
        id: event.id,
        title: event.title,
        description: event.description,
        startDate: event.startDate,
        endDate: event.endDate,
        location: event.locationName,
        isGoogleCalendarEvent: event.isGoogleCalendarEvent,
      });
    });

    // Get external links with dates
    const userExternalLinks = await db
      .select()
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.addedByUserId, userId),
          // Only get external links that have dates
          externalLinks.dateAdded !== null
        )
      );

    userExternalLinks.forEach((link) => {
      if (link.dateAdded) {
        items.push({
          type: 'external_link',
          id: link.id,
          title: link.name,
          description: link.description,
          url: link.url,
          date: link.dateAdded,
          startTime: link.startTime,
          endTime: link.endTime,
          timezone: link.timezone,
          isGoogleCalendarEvent: link.isGoogleCalendarEvent,
        });
      }
    });

    // Get notations with dates
    const userNotations = await db
      .select()
      .from(collectionExternalLinksNotations)
      .where(
        and(
          eq(collectionExternalLinksNotations.userId, userId),
          // Only get notations that have dates
          collectionExternalLinksNotations.date !== null
        )
      );

    userNotations.forEach((notation) => {
      if (notation.date) {
        items.push({
          type: 'notation',
          id: notation.id,
          title: notation.title,
          description: notation.description || notation.notes,
          date: notation.date,
          startTime: notation.startTime,
          endTime: notation.endTime,
          timezone: notation.timezone,
          category: notation.category,
          isGoogleCalendarEvent: notation.isGoogleCalendarEvent,
        });
      }
    });

    return items;
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

export default new GoogleCalendarServiceV2();
