import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { collections } from './collections.js';

// export const userPinnedCollections = pgTable('user_pinned_collections', {
//   userId: uuid('user_id')
//     .notNull()
//     .references(() => users.id, { onDelete: 'cascade' }),
//   collectionId: uuid('collection_id')
//     .notNull()
//     .references(() => collections.id, { onDelete: 'cascade' }),
//   pinnedAt: timestamp('pinned_at').defaultNow(),
// });

// export const userPinnedCollectionsRelations = relations(
//   userPinnedCollections,
//   ({ one }) => ({
//     user: one(users, {
//       fields: [userPinnedCollections.userId],
//       references: [users.id],
//     }),
//     collection: one(collections, {
//       fields: [userPinnedCollections.collectionId],
//       references: [collections.id],
//     }),
//   })
// );
