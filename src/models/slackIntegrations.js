import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  boolean,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';
import { collections } from './collections.js';
import { externalLinks } from './external_links.js';

// Slack workspace integrations for tenants
export const slackWorkspaces = pgTable('slack_workspaces', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  // Slack OAuth data
  teamId: varchar('team_id', { length: 255 }).notNull(),
  teamName: varchar('team_name', { length: 255 }),
  botUserId: varchar('bot_user_id', { length: 255 }),
  botAccessToken: text('bot_access_token').notNull(), // Encrypted in production

  // App installation info
  appId: varchar('app_id', { length: 255 }),
  scope: text('scope'),

  // Configuration
  isActive: boolean('is_active').default(true),
  defaultChannelId: varchar('default_channel_id', { length: 255 }),
  defaultChannelName: varchar('default_channel_name', { length: 255 }),

  // Notification settings
  notifyOnNewExternalLink: boolean('notify_on_new_external_link').default(true),
  notifyOnNewNotation: boolean('notify_on_new_notation').default(true),
  notifyOnNewCollaborator: boolean('notify_on_new_collaborator').default(false),

  // Metadata
  installedByUserId: uuid('installed_by_user_id').references(() => users.id),
  installedAt: timestamp('installed_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),

  // Store available channels for quick access
  availableChannels: jsonb('available_channels').default([]),
}, (table) => ({
  uniqueTeamTenant: uniqueIndex('unique_team_tenant').on(table.teamId, table.tenantId),
}));

// Channel configurations for collections
export const slackChannelConfigs = pgTable('slack_channel_configs', {
  id: uuid('id').defaultRandom().primaryKey(),
  slackWorkspaceId: uuid('slack_workspace_id')
    .notNull()
    .references(() => slackWorkspaces.id, { onDelete: 'cascade' }),

  // Link to either collection or external link (one must be set)
  collectionId: uuid('collection_id')
    .references(() => collections.id, { onDelete: 'cascade' }),
  externalLinkId: uuid('external_link_id')
    .references(() => externalLinks.id, { onDelete: 'cascade' }),

  // Slack channel configuration
  channelId: varchar('channel_id', { length: 255 }).notNull(),
  channelName: varchar('channel_name', { length: 255 }),

  // Notification preferences
  notifyOnNewExternalLink: boolean('notify_on_new_external_link').default(true),
  notifyOnNewNotation: boolean('notify_on_new_notation').default(true),
  notifyOnNewAttachment: boolean('notify_on_new_attachment').default(false),
  notifyOnStatusChange: boolean('notify_on_status_change').default(false),

  // Custom message templates (optional)
  customMessageTemplate: jsonb('custom_message_template'),

  // Metadata
  isActive: boolean('is_active').default(true),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  // Ensure only one config per collection/external link and workspace
  uniqueCollectionWorkspace: uniqueIndex('unique_collection_workspace')
    .on(table.collectionId, table.slackWorkspaceId),
  uniqueExternalLinkWorkspace: uniqueIndex('unique_external_link_workspace')
    .on(table.externalLinkId, table.slackWorkspaceId),
}));

// Notification log for tracking sent notifications
export const slackNotificationLogs = pgTable('slack_notification_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  slackWorkspaceId: uuid('slack_workspace_id')
    .references(() => slackWorkspaces.id, { onDelete: 'set null' }),
  channelId: varchar('channel_id', { length: 255 }),

  // What triggered this notification
  eventType: varchar('event_type', { length: 50 }).notNull(), // 'new_external_link', 'new_notation', etc
  entityType: varchar('entity_type', { length: 50 }), // 'collection', 'external_link', 'notation'
  entityId: uuid('entity_id'),

  // Notification details
  messageTs: varchar('message_ts', { length: 255 }), // Slack message timestamp
  messageContent: jsonb('message_content'),
  success: boolean('success').default(true),
  errorMessage: text('error_message'),

  // Metadata
  sentAt: timestamp('sent_at').defaultNow(),
  sentByUserId: uuid('sent_by_user_id').references(() => users.id),
});

// Relations
export const slackWorkspacesRelations = relations(slackWorkspaces, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [slackWorkspaces.tenantId],
    references: [tenants.id],
  }),
  installedBy: one(users, {
    fields: [slackWorkspaces.installedByUserId],
    references: [users.id],
  }),
  channelConfigs: many(slackChannelConfigs),
  notificationLogs: many(slackNotificationLogs),
}));

export const slackChannelConfigsRelations = relations(slackChannelConfigs, ({ one }) => ({
  workspace: one(slackWorkspaces, {
    fields: [slackChannelConfigs.slackWorkspaceId],
    references: [slackWorkspaces.id],
  }),
  collection: one(collections, {
    fields: [slackChannelConfigs.collectionId],
    references: [collections.id],
  }),
  externalLink: one(externalLinks, {
    fields: [slackChannelConfigs.externalLinkId],
    references: [externalLinks.id],
  }),
  createdBy: one(users, {
    fields: [slackChannelConfigs.createdByUserId],
    references: [users.id],
  }),
}));

export const slackNotificationLogsRelations = relations(slackNotificationLogs, ({ one }) => ({
  workspace: one(slackWorkspaces, {
    fields: [slackNotificationLogs.slackWorkspaceId],
    references: [slackWorkspaces.id],
  }),
  sentBy: one(users, {
    fields: [slackNotificationLogs.sentByUserId],
    references: [users.id],
  }),
}));