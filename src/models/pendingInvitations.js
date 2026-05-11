import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { collectionExternalLinks } from './external_links.js';
import { users } from './users.js';
import { collections } from './collections.js';

export const pendingInvitations = pgTable('pending_invitations', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  inviteeName: varchar('invitee_name', { length: 255 }),
  inviterUserId: uuid('inviter_user_id')
    .notNull()
    .references(() => users.id),

  // What they're being invited to
  collectionId: uuid('collection_id').references(() => collections.id),
  collectionExternalLinkId: uuid('collection_external_link_id').references(
    () => collectionExternalLinks.id
  ),

  // Invitation details
  role: varchar('role', { length: 50 }).notNull().default('editor'),
  message: text('message'),
  inviteToken: varchar('invite_token', { length: 255 }).notNull().unique(),
  metadata: jsonb('metadata'), // Additional data like cascadeToExternalLinks

  // Status tracking
  status: varchar('status', { length: 50 }).notNull().default('pending'), // pending, accepted, expired
  expiresAt: timestamp('expires_at').notNull(),
  acceptedAt: timestamp('accepted_at'),
  acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const pendingInvitationsRelations = relations(
  pendingInvitations,
  ({ one }) => ({
    inviter: one(users, {
      fields: [pendingInvitations.inviterUserId],
      references: [users.id],
    }),
    collection: one(collections, {
      fields: [pendingInvitations.collectionId],
      references: [collections.id],
    }),
    collectionExternalLink: one(collectionExternalLinks, {
      fields: [pendingInvitations.collectionExternalLinkId],
      references: [collectionExternalLinks.id],
    }),
    acceptedBy: one(users, {
      fields: [pendingInvitations.acceptedByUserId],
      references: [users.id],
    }),
  })
);
