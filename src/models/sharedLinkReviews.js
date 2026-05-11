import { pgTable, uuid, varchar, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sharedLinks } from './sharedLinks.js';
import { users } from './users.js';

export const sharedLinkReviews = pgTable('shared_link_reviews', {
  id: uuid('id').defaultRandom().primaryKey(),
  sharedLinkId: uuid('shared_link_id').references(() => sharedLinks.id),
  userId: uuid('user_id').references(() => users.id),
  type: varchar('type', { length: 50 }).notNull(),
  itemId: uuid('item_id'),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const sharedLinkReviewsRelations = relations(
  sharedLinkReviews,
  ({ one }) => ({
    sharedLink: one(sharedLinks, {
      fields: [sharedLinkReviews.sharedLinkId],
      references: [sharedLinks.id],
    }),
    user: one(users, {
      fields: [sharedLinkReviews.userId],
      references: [users.id],
    }),
  })
);
