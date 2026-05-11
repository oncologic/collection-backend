import express from 'express';
import {
  requireUser,
  requireUserAndTenants,
} from '../middleware/authMiddleware.js';
import {
  requireTenantAdmin,
  canManageSlackWorkspace,
  canConfigureCollectionSlack,
  canConfigureExternalLinkSlack,
} from '../middleware/slackAdminMiddleware.js';
// import { debugAuth } from '../middleware/debugAuthMiddleware.js'; // Commented out - no longer needed
import {
  completeSlackOAuth,
  getSlackChannels,
  configureCollectionSlackChannel,
  testSlackConnection,
  removeSlackWorkspace,
  sendNewExternalLinkNotification,
  sendNewNotationNotification,
} from '../services/slackService.js';
import { db } from '../db/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import {
  slackWorkspaces,
  slackChannelConfigs,
  slackNotificationLogs,
} from '../models/slackIntegrations.js';

const router = express.Router();

/**
 * Test endpoint to check auth
 */
router.get('/test-auth', requireUserAndTenants(), (req, res) => {
  res.json({
    success: true,
    message: 'Auth is working',
    userId: req.auth.dbUserId,
    auth: req.auth,
    tenants: req.tenants,
    adminTenants: req.adminTenants,
  });
});

/**
 * Initiate Slack OAuth flow
 * Only admins can set up Slack integration
 */
router.get(
  '/oauth/initiate',
  requireUserAndTenants(),
  requireTenantAdmin(),
  (req, res) => {
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUri = process.env.SLACK_REDIRECT_URI;
    const state = Buffer.from(
      JSON.stringify({
        userId: req.auth.dbUserId,
        tenantId: req.adminTenants[0], // Use first admin tenant
      })
    ).toString('base64');

    // Scopes required for the app
    const scopes = [
      'channels:read',
      'chat:write',
      'chat:write.public',
      'channels:join',
      'groups:read',
    ].join(',');

    const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}`;

    res.json({
      success: true,
      authUrl,
      message: 'Redirect user to this URL for Slack authorization',
    });
  }
);

/**
 * Handle Slack OAuth callback
 */
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/settings/slack?error=${error}`
      );
    }

    if (!code || !state) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/settings/slack?error=missing_params`
      );
    }

    // Decode state to get user and tenant info
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { userId, tenantId } = stateData;

    // Complete OAuth flow
    const result = await completeSlackOAuth(code, tenantId, userId);

    if (result.success) {
      res.redirect(
        `${process.env.FRONTEND_URL}/settings/slack?success=true&workspace=${result.workspace.teamName}`
      );
    } else {
      res.redirect(
        `${process.env.FRONTEND_URL}/settings/slack?error=oauth_failed`
      );
    }
  } catch (error) {
    console.error('Slack OAuth callback error:', error);
    res.redirect(
      `${process.env.FRONTEND_URL}/settings/slack?error=internal_error`
    );
  }
});

/**
 * Get all Slack workspaces for tenant
 */
router.get(
  '/workspaces',
  requireUserAndTenants(),
  requireTenantAdmin(),
  async (req, res) => {
    try {
      // Use req.adminTenants which is set by requireTenantAdmin
      const workspaces = await db
        .select({
          id: slackWorkspaces.id,
          teamId: slackWorkspaces.teamId,
          teamName: slackWorkspaces.teamName,
          isActive: slackWorkspaces.isActive,
          defaultChannelId: slackWorkspaces.defaultChannelId,
          defaultChannelName: slackWorkspaces.defaultChannelName,
          notifyOnNewExternalLink: slackWorkspaces.notifyOnNewExternalLink,
          notifyOnNewNotation: slackWorkspaces.notifyOnNewNotation,
          installedAt: slackWorkspaces.installedAt,
          availableChannels: slackWorkspaces.availableChannels,
        })
        .from(slackWorkspaces)
        .where(inArray(slackWorkspaces.tenantId, req.adminTenants));

      res.json({
        success: true,
        workspaces,
      });
    } catch (error) {
      console.error('Error fetching workspaces:', error);
      res.status(500).json({
        error: 'Failed to fetch workspaces',
      });
    }
  }
);

/**
 * Get channels for a workspace
 */
router.get(
  '/workspaces/:workspaceId/channels',
  requireUserAndTenants(),
  requireTenantAdmin(),
  canManageSlackWorkspace(),
  async (req, res) => {
    try {
      const channels = await getSlackChannels(req.params.workspaceId);

      res.json({
        success: true,
        channels,
      });
    } catch (error) {
      console.error('Error fetching channels:', error);
      res.status(500).json({
        error: 'Failed to fetch channels',
      });
    }
  }
);

/**
 * Configure Slack channel for a collection
 */
router.post(
  '/collections/:collectionId/configure',
  requireUserAndTenants(),
  canConfigureCollectionSlack(),
  async (req, res) => {
    try {
      const {
        workspaceId,
        channelId,
        channelName,
        notificationSettings = {},
      } = req.body;

      const config = await configureCollectionSlackChannel(
        req.params.collectionId,
        workspaceId,
        channelId,
        channelName,
        notificationSettings,
        req.auth.dbUserId
      );

      res.json({
        success: true,
        config,
      });
    } catch (error) {
      console.error('Error configuring collection Slack:', error);
      res.status(500).json({
        error: 'Failed to configure Slack for collection',
      });
    }
  }
);

/**
 * Get Slack configuration for a collection
 */
router.get(
  '/collections/:collectionId/config',
  requireUser(),
  async (req, res) => {
    try {
      const configs = await db
        .select({
          id: slackChannelConfigs.id,
          workspaceId: slackChannelConfigs.slackWorkspaceId,
          channelId: slackChannelConfigs.channelId,
          channelName: slackChannelConfigs.channelName,
          notifyOnNewExternalLink: slackChannelConfigs.notifyOnNewExternalLink,
          notifyOnNewNotation: slackChannelConfigs.notifyOnNewNotation,
          notifyOnNewAttachment: slackChannelConfigs.notifyOnNewAttachment,
          notifyOnStatusChange: slackChannelConfigs.notifyOnStatusChange,
          isActive: slackChannelConfigs.isActive,
          workspace: {
            teamName: slackWorkspaces.teamName,
            teamId: slackWorkspaces.teamId,
          },
        })
        .from(slackChannelConfigs)
        .innerJoin(
          slackWorkspaces,
          eq(slackChannelConfigs.slackWorkspaceId, slackWorkspaces.id)
        )
        .where(eq(slackChannelConfigs.collectionId, req.params.collectionId));

      res.json({
        success: true,
        configs,
      });
    } catch (error) {
      console.error('Error fetching collection Slack config:', error);
      res.status(500).json({
        error: 'Failed to fetch Slack configuration',
      });
    }
  }
);

/**
 * Configure Slack channel for an external link
 */
router.post(
  '/external-links/:externalLinkId/configure',
  requireUserAndTenants(),
  canConfigureExternalLinkSlack(),
  async (req, res) => {
    try {
      const {
        workspaceId,
        channelId,
        channelName,
        notificationSettings = {},
      } = req.body;

      // Create configuration for external link
      const configData = {
        slackWorkspaceId: workspaceId,
        externalLinkId: req.params.externalLinkId,
        channelId: channelId,
        channelName: channelName,
        notifyOnNewNotation:
          notificationSettings.notifyOnNewNotation ?? true,
        notifyOnNewAttachment:
          notificationSettings.notifyOnNewAttachment ?? false,
        notifyOnStatusChange:
          notificationSettings.notifyOnStatusChange ?? false,
        customMessageTemplate: notificationSettings.customMessageTemplate,
        isActive: true,
        createdByUserId: req.auth.dbUserId,
      };

      // Check if configuration already exists
      const existing = await db
        .select()
        .from(slackChannelConfigs)
        .where(
          and(
            eq(slackChannelConfigs.externalLinkId, req.params.externalLinkId),
            eq(slackChannelConfigs.slackWorkspaceId, workspaceId)
          )
        )
        .limit(1);

      let config;
      if (existing.length > 0) {
        config = await db
          .update(slackChannelConfigs)
          .set({
            ...configData,
            updatedAt: new Date(),
          })
          .where(eq(slackChannelConfigs.id, existing[0].id))
          .returning();
      } else {
        config = await db
          .insert(slackChannelConfigs)
          .values(configData)
          .returning();
      }

      res.json({
        success: true,
        config: config[0],
      });
    } catch (error) {
      console.error('Error configuring external link Slack:', error);
      res.status(500).json({
        error: 'Failed to configure Slack for external link',
      });
    }
  }
);

/**
 * Test Slack connection
 */
router.post(
  '/test',
  requireUserAndTenants(),
  requireTenantAdmin(),
  async (req, res) => {
    try {
      const { workspaceId, channelId } = req.body;

      const result = await testSlackConnection(
        workspaceId,
        channelId,
        req.auth.dbUserId
      );

      res.json({
        success: true,
        result,
      });
    } catch (error) {
      console.error('Error testing Slack:', error);
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

/**
 * Remove Slack workspace
 */
router.delete(
  '/workspaces/:workspaceId',
  requireUserAndTenants(),
  requireTenantAdmin(),
  canManageSlackWorkspace(),
  async (req, res) => {
    try {
      const result = await removeSlackWorkspace(
        req.params.workspaceId,
        req.adminTenants[0]
      );

      res.json(result);
    } catch (error) {
      console.error('Error removing workspace:', error);
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

/**
 * Get notification logs
 */
router.get(
  '/notifications/logs',
  requireUserAndTenants(),
  requireTenantAdmin(),
  async (req, res) => {
    try {
      const { workspaceId, limit = 50, offset = 0 } = req.query;

      let query = db
        .select({
          id: slackNotificationLogs.id,
          workspaceId: slackNotificationLogs.slackWorkspaceId,
          channelId: slackNotificationLogs.channelId,
          eventType: slackNotificationLogs.eventType,
          entityType: slackNotificationLogs.entityType,
          entityId: slackNotificationLogs.entityId,
          success: slackNotificationLogs.success,
          errorMessage: slackNotificationLogs.errorMessage,
          sentAt: slackNotificationLogs.sentAt,
        })
        .from(slackNotificationLogs);

      if (workspaceId) {
        query = query.where(
          eq(slackNotificationLogs.slackWorkspaceId, workspaceId)
        );
      }

      const logs = await query
        .orderBy(slackNotificationLogs.sentAt, 'desc')
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      res.json({
        success: true,
        logs,
      });
    } catch (error) {
      console.error('Error fetching notification logs:', error);
      res.status(500).json({
        error: 'Failed to fetch notification logs',
      });
    }
  }
);

/**
 * Manually trigger a notification (for testing)
 */
router.post(
  '/notifications/test',
  requireUserAndTenants(),
  requireTenantAdmin(),
  async (req, res) => {
    try {
      const { type, entityId } = req.body;

      let result;
      if (type === 'external_link') {
        // Mock external link data for testing
        result = await sendNewExternalLinkNotification(
          req.body.collectionId,
          {
            id: entityId,
            name: 'Test External Link',
            url: 'https://example.com',
            description: 'This is a test notification',
          },
          req.auth.dbUserId
        );
      } else if (type === 'notation') {
        // Mock notation data for testing
        result = await sendNewNotationNotification(
          {
            id: entityId,
            title: 'Test Notation',
            description: 'This is a test notation',
            category: 'Test',
          },
          req.body.collectionExternalLinkId,
          req.auth.dbUserId
        );
      } else {
        return res.status(400).json({
          error: 'Invalid notification type',
        });
      }

      res.json(result);
    } catch (error) {
      console.error('Error sending test notification:', error);
      res.status(500).json({
        error: error.message,
      });
    }
  }
);

export default router;