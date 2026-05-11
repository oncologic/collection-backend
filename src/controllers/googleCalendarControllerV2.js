import googleCalendarService from '../services/googleCalendarServiceV2.js';
import { db } from '../db/index.js';
import {
  googleCalendarIntegrations,
  googleCalendarEvents,
  googleCalendarSyncLogs,
} from '../models/googleCalendarSync.js';
import { eq, sql, desc } from 'drizzle-orm';

export const googleCalendarController = {
  // Initiate OAuth flow
  async initiateAuth(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const authUrl = googleCalendarService.getAuthUrl(userId);
      res.json({ authUrl });
    } catch (error) {
      console.error('Error initiating Google auth:', error);
      res.status(500).json({ error: 'Failed to initiate authentication' });
    }
  },

  // Handle OAuth callback
  async handleCallback(req, res) {
    try {
      const { code, state } = req.query;
      const userId = state;

      if (!code) {
        return res.status(400).json({ error: 'Authorization code missing' });
      }

      const tokens = await googleCalendarService.exchangeCodeForTokens(code);
      const userInfo = await googleCalendarService.getUserInfo(tokens);
      await googleCalendarService.saveIntegration(userId, tokens, userInfo);

      res.redirect(
        `${process.env.FRONTEND_URL}/profile?success=google-calendar`
      );
    } catch (error) {
      console.error('Error handling Google callback:', error);
      res.redirect(`${process.env.FRONTEND_URL}/profile?error=google-calendar`);
    }
  },

  // Get integration status
  async getIntegrationStatus(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const integration = await googleCalendarService.getIntegration(userId);

      if (!integration) {
        return res.json({
          connected: false,
          integration: null,
        });
      }

      // Get sync counts for each entity type
      const syncCounts = await db
        .select({
          entityType: googleCalendarEvents.entityType,
          count: sql`COUNT(*)::int`,
        })
        .from(googleCalendarEvents)
        .where(eq(googleCalendarEvents.integrationId, integration.id))
        .groupBy(googleCalendarEvents.entityType);

      res.json({
        connected: true,
        integration: {
          id: integration.id,
          googleAccountEmail: integration.googleAccountEmail,
          syncEnabled: integration.syncEnabled,
          syncDirection: integration.syncDirection,
          lastSyncedAt: integration.lastSyncedAt,
          selectedCalendarIds: integration.selectedCalendarIds,
        },
        syncCounts: syncCounts.reduce((acc, item) => {
          acc[item.entityType] = item.count;
          return acc;
        }, {}),
      });
    } catch (error) {
      console.error('Error getting integration status:', error);
      res.status(500).json({ error: 'Failed to get integration status' });
    }
  },

  // List user's Google calendars
  async listCalendars(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const calendars = await googleCalendarService.listCalendars(userId);
      res.json({ calendars });
    } catch (error) {
      console.error('Error listing calendars:', error);
      res.status(500).json({ error: 'Failed to list calendars' });
    }
  },

  // Update sync settings
  async updateSyncSettings(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { syncEnabled, syncDirection, selectedCalendarIds } = req.body;

      await db
        .update(googleCalendarIntegrations)
        .set({
          syncEnabled,
          syncDirection,
          selectedCalendarIds,
          updatedAt: new Date(),
        })
        .where(eq(googleCalendarIntegrations.userId, userId));

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating sync settings:', error);
      res.status(500).json({ error: 'Failed to update sync settings' });
    }
  },

  // Export entity to Google Calendar
  async exportEntity(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { entityType, entityId } = req.params;

      const googleEventId = await googleCalendarService.exportEntityToGoogle(
        entityType,
        entityId,
        userId
      );

      res.json({
        success: true,
        googleEventId,
      });
    } catch (error) {
      console.error('Error exporting entity:', error);
      res.status(500).json({ error: 'Failed to export to Google Calendar' });
    }
  },

  // Get all calendar items
  async getCalendarItems(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { startDate, endDate } = req.query;

      const items = await googleCalendarService.getAllCalendarItems(
        userId,
        startDate,
        endDate
      );

      res.json({ items });
    } catch (error) {
      console.error('Error getting calendar items:', error);
      res.status(500).json({ error: 'Failed to get calendar items' });
    }
  },

  // Disconnect Google Calendar
  async disconnect(req, res) {
    try {
      const userId = req.auth.dbUserId;
      await googleCalendarService.disconnectIntegration(userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error disconnecting Google Calendar:', error);
      res.status(500).json({ error: 'Failed to disconnect Google Calendar' });
    }
  },

  // Get sync history
  async getSyncHistory(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const integration = await googleCalendarService.getIntegration(userId);

      if (!integration) {
        return res.json({ syncLogs: [] });
      }

      const syncLogs = await db
        .select()
        .from(googleCalendarSyncLogs)
        .where(eq(googleCalendarSyncLogs.integrationId, integration.id))
        .orderBy(desc(googleCalendarSyncLogs.createdAt))
        .limit(10);

      res.json({ syncLogs });
    } catch (error) {
      console.error('Error getting sync history:', error);
      res.status(500).json({ error: 'Failed to get sync history' });
    }
  },

};
