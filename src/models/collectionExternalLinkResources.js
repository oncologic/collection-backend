import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  primaryKey,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import { resources } from './resources.js';
import { users } from './users.js';
import { organizations } from './organizations.js';
import { collectionExternalLinks } from './external_links.js';

export const collectionExternalLinkResources = pgTable(
  'collection_external_link_resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id').notNull(),
    externalLinkId: uuid('external_link_id').notNull(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    notes: text('notes'),
    orderPosition: integer('order_position').default(0),
    userAddedById: uuid('user_added_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    organizationAddedById: uuid('organization_added_by_id').references(
      () => organizations.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    // Foreign key to collection_external_links composite key
    collectionExternalLinkFk: foreignKey({
      columns: [table.collectionId, table.externalLinkId],
      foreignColumns: [
        collectionExternalLinks.collectionId,
        collectionExternalLinks.externalLinkId,
      ],
    }).onDelete('cascade'),

    // Unique constraint
    uniqueCollectionExternalLinkResource: uniqueIndex(
      'unique_collection_external_link_resource'
    ).on(table.collectionId, table.externalLinkId, table.resourceId),

    // Performance indexes
    idxCollectionExternalLink: index(
      'idx_collection_external_link_resources_collection_external_link'
    ).on(table.collectionId, table.externalLinkId),
    idxResource: index('idx_collection_external_link_resources_resource').on(
      table.resourceId
    ),
    idxUserAdded: index('idx_collection_external_link_resources_user_added').on(
      table.userAddedById
    ),
    idxOrgAdded: index('idx_collection_external_link_resources_org_added').on(
      table.organizationAddedById
    ),
    idxCreatedAt: index('idx_collection_external_link_resources_created_at').on(
      table.createdAt
    ),
    idxOrder: index('idx_collection_external_link_resources_order').on(
      table.orderPosition
    ),
  })
);
