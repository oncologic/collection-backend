import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sharedLinks } from './sharedLinks.js';
import { users } from './users.js';

export const sharedLinkApprovedUsers = pgTable('shared_link_approved_users', {
  id: uuid('id').defaultRandom().primaryKey(),
  sharedLinkId: uuid('shared_link_id').references(() => sharedLinks.id),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const sharedLinkApprovedUsersRelations = relations(
  sharedLinkApprovedUsers,
  ({ one }) => ({
    sharedLink: one(sharedLinks, {
      fields: [sharedLinkApprovedUsers.sharedLinkId],
      references: [sharedLinks.id],
    }),
    user: one(users, {
      fields: [sharedLinkApprovedUsers.userId],
      references: [users.id],
    }),
  })
);
