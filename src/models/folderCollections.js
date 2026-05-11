import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { folders } from './folders.js';
import { collections } from './collections.js';

export const folderCollections = pgTable('folder_collections', {
  folderId: uuid('folder_id')
    .notNull()
    .references(() => folders.id, { onDelete: 'cascade' }),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
  orderPosition: integer('order_position'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const folderCollectionsRelations = relations(
  folderCollections,
  ({ one }) => ({
    folder: one(folders, {
      fields: [folderCollections.folderId],
      references: [folders.id],
    }),
    collection: one(collections, {
      fields: [folderCollections.collectionId],
      references: [collections.id],
    }),
  })
);
