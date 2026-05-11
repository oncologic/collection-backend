// src/models/sharedLinks.js
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  text,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { tenants } from './tenants.js';
export const sharedLinks = pgTable('shared_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  linkId: uuid('link_id').notNull(),
  linkType: varchar('link_type', { length: 50 }).notNull(),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id),
  expiresAt: timestamp('expires_at'),
  accessToken: varchar('access_token', { length: 255 }),
  isActive: boolean('is_active').default(true),
  viewCount: integer('view_count').default(0),
  sharedWithEmail: text('shared_with_email'),
  description: text('description'),
  lastViewedAt: timestamp('last_viewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
});

export const sharedLinksRelations = relations(sharedLinks, ({ one }) => ({
  creator: one(users, {
    fields: [sharedLinks.createdByUserId],
    references: [users.id],
  }),
}));
