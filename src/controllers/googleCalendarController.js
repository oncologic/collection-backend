import googleCalendarService from '../services/googleCalendarService.js';
import { db } from '../db/index.js';
import { googleCalendarIntegrations } from '../models/googleCalendarSync.js';
import { eq } from 'drizzle-orm';

export const googleCalendarController = {
  // Initiate OAuth flow
  async initiateAuth(req, res) {
    try {
      const userId = req.user.id;
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
      const userId = state; // User ID passed in state parameter

      if (!code) {
        return res.status(400).json({ error: 'Authorization code missing' });
      }

      // Exchange code for tokens
      const tokens = await googleCalendarService.exchangeCodeForTokens(code);

      // Get user info
      const userInfo = await googleCalendarService.getUserInfo(tokens);

      // Save integration
      await googleCalendarService.saveIntegration(userId, tokens, userInfo);

      // Redirect to success page in frontend
      res.redirect(
        `${process.env.FRONTEND_URL}/settings/integrations?success=google-calendar`
      );
    } catch (error) {
      console.error('Error handling Google callback:', error);
      res.redirect(
        `${process.env.FRONTEND_URL}/settings/integrations?error=google-calendar`
      );
    }
  },

  // Get integration status
  async getIntegrationStatus(req, res) {
    try {
      const userId = req.user.id;
      const integration = await googleCalendarService.getIntegration(userId);

      if (!integration) {
        return res.json({
          connected: false,
          integration: null,
        });
      }

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
      });
    } catch (error) {
      console.error('Error getting integration status:', error);
      res.status(500).json({ error: 'Failed to get integration status' });
    }
  },

  // List user's Google calendars
  async listCalendars(req, res) {
    try {
      const userId = req.user.id;
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
      const userId = req.user.id;
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


  // Export single event to Google Calendar
  async exportEvent(req, res) {
    try {
      const userId = req.user.id;
      const { eventId } = req.params;

      const googleEventId = await googleCalendarService.exportEventToGoogle(
        eventId,
        userId
      );
      res.json({
        success: true,
        googleEventId,
      });
    } catch (error) {
      console.error('Error exporting event:', error);
      res
        .status(500)
        .json({ error: 'Failed to export event to Google Calendar' });
    }
  },

  // Disconnect Google Calendar
  async disconnect(req, res) {
    try {
      const userId = req.user.id;
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
      const userId = req.user.id;
      const integration = await googleCalendarService.getIntegration(userId);

      if (!integration) {
        return res.json({ syncLogs: [] });
      }

      const syncLogs = await db
        .select()
        .from(googleCalendarSyncLogs)
        .where(eq(googleCalendarSyncLogs.integrationId, integration.id))
        .orderBy(googleCalendarSyncLogs.createdAt.desc())
        .limit(10);

      res.json({ syncLogs });
    } catch (error) {
      console.error('Error getting sync history:', error);
      res.status(500).json({ error: 'Failed to get sync history' });
    }
  },
};
