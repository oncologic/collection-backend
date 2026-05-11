import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  primaryKey,
  integer,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { resources } from './resources.js';
import { events } from './events.js';
import { organizations } from './organizations.js';
import { collections } from './collections.js';
import { externalLinks } from './external_links.js';

export const pinnedItems = pgTable(
  'pinned_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    itemId: uuid('item_id').notNull(),
    itemType: varchar('item_type', { length: 50 }).notNull(), // 'resource', 'event', 'organization', 'collection', 'external_link'
    orderPosition: integer('order_position').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    unq: uniqueIndex('pinned_items_user_item_unique').on(
      table.userId,
      table.itemId,
      table.itemType
    ),
  })
);

export const pinnedItemsRelations = relations(pinnedItems, ({ one }) => ({
  user: one(users, {
    fields: [pinnedItems.userId],
    references: [users.id],
  }),
}));
