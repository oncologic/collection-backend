import { WebClient } from '@slack/web-api';
import { db } from '../db/index.js';
import { eq, and, or, inArray } from 'drizzle-orm';
import {
  slackWorkspaces,
  slackChannelConfigs,
  slackNotificationLogs
} from '../models/slackIntegrations.js';
import { collections } from '../models/collections.js';
import { externalLinks, collectionExternalLinks } from '../models/external_links.js';
import { collectionExternalLinksNotations } from '../models/collectionExternalLinksNotations.js';
import { users } from '../models/users.js';

// Initialize Slack client without token (we'll use workspace-specific tokens)
const createSlackClient = (accessToken) => new WebClient(accessToken);

/**
 * Complete Slack OAuth flow and save workspace
 */
export async function completeSlackOAuth(code, tenantId, userId) {
  try {
    // Exchange code for access token
    const client = new WebClient();
    const result = await client.oauth.v2.access({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code: code,
      redirect_uri: process.env.SLACK_REDIRECT_URI,
    });

    if (!result.ok) {
      throw new Error('Failed to complete OAuth flow');
    }

    // Check if workspace already exists for this tenant
    const existingWorkspace = await db
      .select()
      .from(slackWorkspaces)
      .where(
        and(
          eq(slackWorkspaces.teamId, result.team.id),
          eq(slackWorkspaces.tenantId, tenantId)
        )
      )
      .limit(1);

    // Get list of channels
    const workspaceClient = createSlackClient(result.access_token);
    const channelsResult = await workspaceClient.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
    });

    const availableChannels = channelsResult.channels.map(channel => ({
      id: channel.id,
      name: channel.name,
      is_private: channel.is_private,
      is_member: channel.is_member,
    }));

    const workspaceData = {
      tenantId: tenantId,
      teamId: result.team.id,
      teamName: result.team.name,
      botUserId: result.bot_user_id,
      botAccessToken: result.access_token,
      appId: result.app_id,
      scope: result.scope,
      installedByUserId: userId,
      availableChannels: availableChannels,
      isActive: true,
    };

    let workspace;
    if (existingWorkspace.length > 0) {
      // Update existing workspace
      workspace = await db
        .update(slackWorkspaces)
        .set({
          ...workspaceData,
          updatedAt: new Date(),
        })
        .where(eq(slackWorkspaces.id, existingWorkspace[0].id))
        .returning();
    } else {
      // Create new workspace
      workspace = await db
        .insert(slackWorkspaces)
        .values(workspaceData)
        .returning();
    }

    return {
      success: true,
      workspace: workspace[0],
      message: 'Slack workspace connected successfully',
    };
  } catch (error) {
    console.error('Error completing Slack OAuth:', error);
    throw new Error(`Failed to connect Slack workspace: ${error.message}`);
  }
}

/**
 * Get available Slack channels for a workspace
 */
export async function getSlackChannels(workspaceId) {
  try {
    const workspace = await db
      .select()
      .from(slackWorkspaces)
      .where(eq(slackWorkspaces.id, workspaceId))
      .limit(1);

    if (!workspace[0]) {
      throw new Error('Workspace not found');
    }

    const client = createSlackClient(workspace[0].botAccessToken);
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
    });

    // Update available channels in database
    await db
      .update(slackWorkspaces)
      .set({
        availableChannels: result.channels.map(channel => ({
          id: channel.id,
          name: channel.name,
          is_private: channel.is_private,
          is_member: channel.is_member,
        })),
        updatedAt: new Date(),
      })
      .where(eq(slackWorkspaces.id, workspaceId));

    return result.channels;
  } catch (error) {
    console.error('Error fetching Slack channels:', error);
    throw new Error(`Failed to fetch channels: ${error.message}`);
  }
}

/**
 * Configure Slack channel for a collection
 */
export async function configureCollectionSlackChannel(
  collectionId,
  workspaceId,
  channelId,
  channelName,
  notificationSettings,
  userId
) {
  try {
    // Check if configuration already exists
    const existing = await db
      .select()
      .from(slackChannelConfigs)
      .where(
        and(
          eq(slackChannelConfigs.collectionId, collectionId),
          eq(slackChannelConfigs.slackWorkspaceId, workspaceId)
        )
      )
      .limit(1);

    const configData = {
      slackWorkspaceId: workspaceId,
      collectionId: collectionId,
      channelId: channelId,
      channelName: channelName,
      notifyOnNewExternalLink: notificationSettings.notifyOnNewExternalLink ?? true,
      notifyOnNewNotation: notificationSettings.notifyOnNewNotation ?? true,
      notifyOnNewAttachment: notificationSettings.notifyOnNewAttachment ?? false,
      notifyOnStatusChange: notificationSettings.notifyOnStatusChange ?? false,
      customMessageTemplate: notificationSettings.customMessageTemplate,
      isActive: true,
      createdByUserId: userId,
    };

    let config;
    if (existing.length > 0) {
      // Update existing configuration
      config = await db
        .update(slackChannelConfigs)
        .set({
          ...configData,
          updatedAt: new Date(),
        })
        .where(eq(slackChannelConfigs.id, existing[0].id))
        .returning();
    } else {
      // Create new configuration
      config = await db
        .insert(slackChannelConfigs)
        .values(configData)
        .returning();
    }

    return config[0];
  } catch (error) {
    console.error('Error configuring Slack channel:', error);
    throw new Error(`Failed to configure Slack channel: ${error.message}`);
  }
}

/**
 * Send notification for new external link
 */
export async function sendNewExternalLinkNotification(
  collectionId,
  externalLinkData,
  addedByUserId
) {
  try {
    // Check if external link is private - don't send notification if it is
    if (externalLinkData.visibility === 'private') {
      return { success: false, message: 'External link is private - no notification sent' };
    }

    // Get Slack configuration for this collection
    const configs = await db
      .select({
        config: slackChannelConfigs,
        workspace: slackWorkspaces,
      })
      .from(slackChannelConfigs)
      .innerJoin(
        slackWorkspaces,
        eq(slackChannelConfigs.slackWorkspaceId, slackWorkspaces.id)
      )
      .where(
        and(
          eq(slackChannelConfigs.collectionId, collectionId),
          eq(slackChannelConfigs.isActive, true),
          eq(slackChannelConfigs.notifyOnNewExternalLink, true),
          eq(slackWorkspaces.isActive, true)
        )
      );

    if (configs.length === 0) {
      return { success: false, message: 'No active Slack configuration found' };
    }

    // Get collection and user details
    const [collection] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, collectionId))
      .limit(1);

    const [addedByUser] = await db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, addedByUserId))
      .limit(1);

    const notifications = [];
    for (const { config, workspace } of configs) {
      try {
        const client = createSlackClient(workspace.botAccessToken);

        // Build message
        const message = {
          channel: config.channelId,
          text: `New link added to collection "${collection.name}"`,
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: '🔗 New External Link Added',
              },
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Collection:*\n${collection.name}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*Added by:*\n${addedByUser?.firstName || ''} ${addedByUser?.lastName || ''}`,
                },
              ],
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Link:* ${externalLinkData.name || 'Untitled'}`,
              },
            },
          ],
        };

        // Add description (first line only) as context to keep compact
        if (externalLinkData.description) {
          const firstLine = externalLinkData.description.split('\n')[0];
          const truncatedDesc = firstLine.length > 150
            ? firstLine.substring(0, 147) + '...'
            : firstLine;
          message.blocks.push({
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: truncatedDesc,
              },
            ],
          });
        }

        // Add view button
        const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        message.blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'View Link',
              },
              url: `${baseUrl}/external-links/${externalLinkData.id}`,
            },
          ],
        });

        const result = await client.chat.postMessage(message);

        // Log notification
        await db.insert(slackNotificationLogs).values({
          slackWorkspaceId: workspace.id,
          channelId: config.channelId,
          eventType: 'new_external_link',
          entityType: 'external_link',
          entityId: externalLinkData.id,
          messageTs: result.ts,
          messageContent: message,
          success: result.ok,
          sentByUserId: addedByUserId,
        });

        notifications.push({ success: true, workspace: workspace.teamName });
      } catch (error) {
        console.error('Error sending Slack notification:', error);

        // Log failed notification
        await db.insert(slackNotificationLogs).values({
          slackWorkspaceId: workspace.id,
          channelId: config.channelId,
          eventType: 'new_external_link',
          entityType: 'external_link',
          entityId: externalLinkData.id,
          success: false,
          errorMessage: error.message,
          sentByUserId: addedByUserId,
        });

        notifications.push({
          success: false,
          workspace: workspace.teamName,
          error: error.message
        });
      }
    }

    return { success: true, notifications };
  } catch (error) {
    console.error('Error in sendNewExternalLinkNotification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send notification for new notation
 */
export async function sendNewNotationNotification(
  notationData,
  collectionExternalLinkId,
  addedByUserId,
  isUpdate = false
) {
  try {
    // Check if notation is private - don't send notification if it is
    if (notationData.visibility === 'private') {
      return { success: false, message: 'Notation is private - no notification sent' };
    }

    // Get external link and collection details using Drizzle ORM
    const linkDetails = await db
      .select({
        collectionId: collectionExternalLinks.collectionId,
        externalLinkId: collectionExternalLinks.externalLinkId,
        externalLinkName: externalLinks.name,
        externalLinkUrl: externalLinks.url,
        externalLinkVisibility: externalLinks.visibility,
        collectionName: collections.name,
      })
      .from(collectionExternalLinks)
      .innerJoin(externalLinks, eq(collectionExternalLinks.externalLinkId, externalLinks.id))
      .innerJoin(collections, eq(collectionExternalLinks.collectionId, collections.id))
      .where(eq(collectionExternalLinks.id, collectionExternalLinkId))
      .limit(1);

    if (linkDetails.length === 0) {
      return { success: false, message: 'External link not found' };
    }

    const {
      collectionId,
      externalLinkId,
      externalLinkName,
      externalLinkUrl,
      externalLinkVisibility,
      collectionName
    } = linkDetails[0];

    // Check if external link itself is private
    if (externalLinkVisibility === 'private') {
      return { success: false, message: 'External link is private - no notification sent' };
    }

    // Get Slack configurations - prioritize external link level configs
    const configs = await db
      .select({
        config: slackChannelConfigs,
        workspace: slackWorkspaces,
      })
      .from(slackChannelConfigs)
      .innerJoin(
        slackWorkspaces,
        eq(slackChannelConfigs.slackWorkspaceId, slackWorkspaces.id)
      )
      .where(
        and(
          eq(slackChannelConfigs.externalLinkId, externalLinkId),
          eq(slackChannelConfigs.isActive, true),
          eq(slackChannelConfigs.notifyOnNewNotation, true),
          eq(slackWorkspaces.isActive, true)
        )
      );

    if (configs.length === 0) {
      return { success: false, message: 'No active Slack configuration found' };
    }

    // Get user details
    const [addedByUser] = await db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, addedByUserId))
      .limit(1);

    const notifications = [];
    for (const { config, workspace } of configs) {
      try {
        const client = createSlackClient(workspace.botAccessToken);

        // Build message
        const headerText = isUpdate ? '📓 Notation Updated' : '📓 New Notation Added';
        const actionText = isUpdate ? 'updated' : 'added';

        const message = {
          channel: config.channelId,
          text: `Notation ${actionText} in "${externalLinkName || 'Untitled Link'}"`,
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: headerText,
              },
            },
            {
              type: 'section',
              fields: [
                {
                  type: 'mrkdwn',
                  text: `*Collection:*\n${collectionName}`,
                },
                {
                  type: 'mrkdwn',
                  text: `*External Link:*\n${externalLinkName || 'Untitled'}`,
                },
              ],
            },
          ],
        };

        // Build combined fields for notation details (title, updated by, status, date)
        const notationFields = [
          {
            type: 'mrkdwn',
            text: `*Notation Title:*\n${notationData.title || 'Untitled'}`,
          },
          {
            type: 'mrkdwn',
            text: `*${isUpdate ? 'Updated' : 'Added'} by:*\n${addedByUser?.firstName || ''} ${addedByUser?.lastName || ''}${notationData.updatedAt ? '\n' + new Date(notationData.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}`,
          },
        ];

        // Add status to the same section if available
        if (notationData.status) {
          notationFields.push({
            type: 'mrkdwn',
            text: `*Status:*\n${notationData.status}`,
          });
        }

        // Add date to the same section if available
        if (notationData.date) {
          const formattedDate = new Date(notationData.date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
          notationFields.push({
            type: 'mrkdwn',
            text: `*Date:*\n${formattedDate}`,
          });
        }

        // Add the combined section
        message.blocks.push({
          type: 'section',
          fields: notationFields,
        });

        // Add tags if available
        if (notationData.tags && Array.isArray(notationData.tags) && notationData.tags.length > 0) {
          // Handle both tag objects and tag name strings
          const tagNames = notationData.tags.map(tag =>
            typeof tag === 'string' ? tag : tag.name
          );
          message.blocks.push({
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `⭐ *Tags:* ${tagNames.join(', ')}`,
              },
            ],
          });
        }

        // Add description (first line only) and category as context to keep compact
        const contextElements = [];

        // Use notes field and strip HTML tags
        const contentField = notationData.notes || notationData.description;
        if (contentField) {
          // Strip HTML tags
          const plainText = contentField.replace(/<[^>]*>/g, '').trim();
          // Get first line of content, truncate if too long
          const firstLine = plainText.split('\n')[0];
          const truncatedDesc = firstLine.length > 150
            ? firstLine.substring(0, 147) + '...'
            : firstLine;
          if (truncatedDesc) {
            contextElements.push({
              type: 'mrkdwn',
              text: truncatedDesc,
            });
          }
        }

        if (notationData.category) {
          contextElements.push({
            type: 'mrkdwn',
            text: `Category: ${notationData.category}`,
          });
        }

        if (contextElements.length > 0) {
          message.blocks.push({
            type: 'context',
            elements: contextElements,
          });
        }

        // Add view button
        const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        message.blocks.push({
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'View Notation',
              },
              url: `${baseUrl}/external-links/${externalLinkId}?highlightNotation=${notationData.id}`,
            },
          ],
        });

        const result = await client.chat.postMessage(message);

        // Log notification
        await db.insert(slackNotificationLogs).values({
          slackWorkspaceId: workspace.id,
          channelId: config.channelId,
          eventType: 'new_notation',
          entityType: 'notation',
          entityId: notationData.id,
          messageTs: result.ts,
          messageContent: message,
          success: result.ok,
          sentByUserId: addedByUserId,
        });

        notifications.push({ success: true, workspace: workspace.teamName });
      } catch (error) {
        console.error('Error sending Slack notification:', error);

        // Log failed notification
        await db.insert(slackNotificationLogs).values({
          slackWorkspaceId: workspace.id,
          channelId: config.channelId,
          eventType: 'new_notation',
          entityType: 'notation',
          entityId: notationData.id,
          success: false,
          errorMessage: error.message,
          sentByUserId: addedByUserId,
        });

        notifications.push({
          success: false,
          workspace: workspace.teamName,
          error: error.message
        });
      }
    }

    return { success: true, notifications };
  } catch (error) {
    console.error('Error in sendNewNotationNotification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Test Slack connection and send test message
 */
export async function testSlackConnection(workspaceId, channelId, userId) {
  try {
    const workspace = await db
      .select()
      .from(slackWorkspaces)
      .where(eq(slackWorkspaces.id, workspaceId))
      .limit(1);

    if (!workspace[0]) {
      throw new Error('Workspace not found');
    }

    const client = createSlackClient(workspace[0].botAccessToken);

    const [user] = await db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const result = await client.chat.postMessage({
      channel: channelId,
      text: 'Test message from your app',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎉 *Slack integration test successful!*\n\nThis is a test message from ${user?.firstName || ''} ${user?.lastName || 'your app'}.`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Workspace: *${workspace[0].teamName}* | Channel: <#${channelId}>`,
            },
          ],
        },
      ],
    });

    return { success: result.ok, messageTs: result.ts };
  } catch (error) {
    console.error('Error testing Slack connection:', error);
    throw new Error(`Failed to send test message: ${error.message}`);
  }
}

/**
 * Remove Slack workspace integration
 */
export async function removeSlackWorkspace(workspaceId, tenantId) {
  try {
    // Verify workspace belongs to tenant
    const workspace = await db
      .select()
      .from(slackWorkspaces)
      .where(
        and(
          eq(slackWorkspaces.id, workspaceId),
          eq(slackWorkspaces.tenantId, tenantId)
        )
      )
      .limit(1);

    if (!workspace[0]) {
      throw new Error('Workspace not found or unauthorized');
    }

    // Delete workspace (cascades to configs and logs)
    await db
      .delete(slackWorkspaces)
      .where(eq(slackWorkspaces.id, workspaceId));

    return { success: true, message: 'Slack workspace removed successfully' };
  } catch (error) {
    console.error('Error removing Slack workspace:', error);
    throw new Error(`Failed to remove workspace: ${error.message}`);
  }
}