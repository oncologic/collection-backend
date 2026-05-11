import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { events } from './events.js';

// Google Calendar Integration table - stores OAuth tokens and sync settings
export const googleCalendarIntegrations = pgTable(
  'google_calendar_integrations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id)
      .unique(),
    googleAccountEmail: varchar('google_account_email', {
      length: 255,
    }).notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', {
      withTimezone: true,
    }).notNull(),
    isActive: boolean('is_active').default(true),
    syncEnabled: boolean('sync_enabled').default(true),
    primaryCalendarId: varchar('primary_calendar_id', { length: 255 }),
    selectedCalendarIds: jsonb('selected_calendar_ids').default('[]'), // Array of calendar IDs to sync
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    syncDirection: varchar('sync_direction', { length: 20 }).default('both'), // 'import', 'export', 'both'
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  }
);

// Google Calendar Events mapping table - tracks which entities are synced
export const googleCalendarEvents = pgTable('google_calendar_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  entityType: varchar('entity_type', { length: 50 }).notNull(), // 'event', 'external_link', 'notation'
  entityId: uuid('entity_id').notNull(), // ID of the event, external_link, or notation
  googleEventId: varchar('google_event_id', { length: 255 }).notNull(),
  googleCalendarId: varchar('google_calendar_id', { length: 255 }).notNull(),
  integrationId: uuid('integration_id')
    .notNull()
    .references(() => googleCalendarIntegrations.id),
  syncStatus: varchar('sync_status', { length: 20 }).default('synced'), // 'synced', 'pending', 'failed', 'conflict'
  lastSyncedAt: timestamp('last_synced_at', {
    withTimezone: true,
  }).defaultNow(),
  googleEventData: jsonb('google_event_data'), // Store raw Google event data for reference
  syncDirection: varchar('sync_direction', { length: 20 }).notNull(), // 'imported', 'exported'
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Sync log table for tracking sync operations and debugging
export const googleCalendarSyncLogs = pgTable('google_calendar_sync_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  integrationId: uuid('integration_id')
    .notNull()
    .references(() => googleCalendarIntegrations.id),
  syncType: varchar('sync_type', { length: 20 }).notNull(), // 'full', 'incremental', 'single_event'
  status: varchar('status', { length: 20 }).notNull(), // 'started', 'completed', 'failed'
  eventsProcessed: jsonb('events_processed').default(
    '{"imported": 0, "exported": 0, "updated": 0, "deleted": 0}'
  ),
  errors: jsonb('errors').default('[]'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at').defaultNow(),
});

// Relations
export const googleCalendarIntegrationsRelations = relations(
  googleCalendarIntegrations,
  ({ one, many }) => ({
    user: one(users, {
      fields: [googleCalendarIntegrations.userId],
      references: [users.id],
    }),
    googleCalendarEvents: many(googleCalendarEvents),
    syncLogs: many(googleCalendarSyncLogs),
  })
);

export const googleCalendarEventsRelations = relations(
  googleCalendarEvents,
  ({ one }) => ({
    integration: one(googleCalendarIntegrations, {
      fields: [googleCalendarEvents.integrationId],
      references: [googleCalendarIntegrations.id],
    }),
  })
);

export const googleCalendarSyncLogsRelations = relations(
  googleCalendarSyncLogs,
  ({ one }) => ({
    integration: one(googleCalendarIntegrations, {
      fields: [googleCalendarSyncLogs.integrationId],
      references: [googleCalendarIntegrations.id],
    }),
  })
);
