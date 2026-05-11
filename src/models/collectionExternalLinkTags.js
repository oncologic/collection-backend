import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { collectionExternalLinks } from './external_links.js';
import { users } from './users.js';
import { tenants } from './tenants.js';

// Dedicated tags table for collections and external links
export const collectionExternalLinkTagDefinitions = pgTable(
  'collection_external_link_tag_definitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 136 }).notNull(),
    description: text('description'),
    color: varchar('color', { length: 7 }), // hex color code
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  }
);

// Junction table linking collection external links to tags
export const collectionExternalLinkTags = pgTable(
  'collection_external_link_tags',
  {
    collectionExternalLinkId: uuid('collection_external_link_id')
      .notNull()
      .references(() => collectionExternalLinks.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => collectionExternalLinkTagDefinitions.id, {
        onDelete: 'cascade',
      }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.collectionExternalLinkId, table.tagId] }),
  })
);

// Relations
export const collectionExternalLinkTagDefinitionsRelations = relations(
  collectionExternalLinkTagDefinitions,
  ({ many, one }) => ({
    collectionExternalLinkTags: many(collectionExternalLinkTags),
    notationTags: many('collectionExternalLinkNotationTags'),
    createdBy: one(users, {
      fields: [collectionExternalLinkTagDefinitions.createdByUserId],
      references: [users.id],
    }),
    tenant: one(tenants, {
      fields: [collectionExternalLinkTagDefinitions.tenantId],
      references: [tenants.id],
    }),
  })
);

export const collectionExternalLinkTagsRelations = relations(
  collectionExternalLinkTags,
  ({ one }) => ({
    collectionExternalLink: one(collectionExternalLinks, {
      fields: [collectionExternalLinkTags.collectionExternalLinkId],
      references: [collectionExternalLinks.id],
    }),
    tag: one(collectionExternalLinkTagDefinitions, {
      fields: [collectionExternalLinkTags.tagId],
      references: [collectionExternalLinkTagDefinitions.id],
    }),
  })
);
