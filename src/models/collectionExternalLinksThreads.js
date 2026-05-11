import { pgTable, uuid, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { collectionExternalLinksNotations } from './collectionExternalLinksNotations.js';

export const collectionExternalLinksThreads = pgTable(
  'collection_external_links_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    collectionExternalLinkNotationId: uuid(
      'collection_external_link_notation_id'
    )
      .notNull()
      .references(() => collectionExternalLinksNotations.id),
    visibility: varchar('visibility', { length: 50 })
      .default('private')
      .notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
  }
);

export const collectionExternalLinksThreadsRelations = relations(
  collectionExternalLinksThreads,
  ({ one }) => ({
    user: one(users, {
      fields: [collectionExternalLinksThreads.userId],
      references: [users.id],
    }),
    notation: one(collectionExternalLinksNotations, {
      fields: [collectionExternalLinksThreads.collectionExternalLinkNotationId],
      references: [collectionExternalLinksNotations.id],
    }),
  })
);
