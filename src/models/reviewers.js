import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sharedLinkReviews } from './sharedLinkReviews.js';

export const reviewers = pgTable('reviewers', {
  id: uuid('id').defaultRandom().primaryKey(),
  firstName: varchar('first_name', { length: 255 }).notNull(),
  lastName: varchar('last_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const reviewersRelations = relations(reviewers, ({ many }) => ({
  reviews: many(sharedLinkReviews),
}));
