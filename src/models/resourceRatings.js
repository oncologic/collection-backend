import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { resources } from './resources.js';
import { users } from './users.js';

// Resource Ratings table
export const resourceRatings = pgTable('resource_ratings', {
  id: uuid('id').defaultRandom().primaryKey(),
  resourceId: uuid('resource_id')
    .notNull()
    .references(() => resources.id),
  rating: integer('rating'),
  ratingNotes: text('rating_notes'),
  ratingByUserId: uuid('rating_by_user_id')
    .notNull()
    .references(() => users.id),
  ratingType: varchar('rating_type', { length: 136 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Relations
export const resourceRatingsRelations = relations(
  resourceRatings,
  ({ one }) => ({
    resource: one(resources, {
      fields: [resourceRatings.resourceId],
      references: [resources.id],
    }),
    user: one(users, {
      fields: [resourceRatings.ratingByUserId],
      references: [users.id],
    }),
  })
);
