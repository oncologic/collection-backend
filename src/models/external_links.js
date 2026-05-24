import {
  pgTable,
  uuid,
  text,
  date,
  varchar,
  timestamp,
  jsonb,
  uniqueIndex,
  time,
  boolean,
  integer,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { collections } from './collections.js';
import { externalLinkAttachments } from './externalLinkAttachments.js';
import { tenants } from './tenants.js';
import { events } from './events.js';
import { organizations } from './organizations.js';
import { socialMediaAssociations } from './socialMedia.js';

// Define custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

export const externalLinks = pgTable('external_links', {
  id: uuid('id').defaultRandom().primaryKey(),
  url: text('url'),
  name: text('name'),
  description: text('description'),
  notes: text('notes'),
  dateAdded: date('date_added'),
  addedByUserId: uuid('added_by_user_id').references(() => users.id),
  visibility: varchar('visibility', { length: 50 })
    .notNull()
    .default('private'),
  type: varchar('type', { length: 50 }).notNull().default('link'),
  imageKey: text('image_key'),
  imageMetadata: jsonb('image_metadata'),
  imageUrl: text('image_url'),
  whiteboardData: jsonb('whiteboard_data'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  timestamps: text('timestamps'),
  startTime: time('start_time'),
  endTime: time('end_time'),
  timezone: varchar('timezone', { length: 100 }),
  fullText: text('full_text'),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  publicJsonEnabled: boolean('public_json_enabled').notNull().default(false),
  allowPublicNotations: boolean('allow_public_notations').notNull().default(false),
  // Vector columns for semantic search
  nameEmbedding: vector('name_embedding'),
  descriptionEmbedding: vector('description_embedding'),
  notesEmbedding: vector('notes_embedding'),
  fullTextEmbedding: vector('full_text_embedding'),
  timestampsEmbedding: vector('timestamps_embedding'),
  combinedEmbedding: vector('combined_embedding'),
  vectorUpdatedAt: timestamp('vector_updated_at'),
  hashtags: text('hashtags'),
});

export const collectionExternalLinks = pgTable(
  'collection_external_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    externalLinkId: uuid('external_link_id')
      .notNull()
      .references(() => externalLinks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    date: date('date'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: varchar('status', { length: 50 }),
    eventId: uuid('event_id').references(() => events.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    notes: text('notes'),
    sortOrder: integer('sort_order'),
    workflowMetadata: jsonb('workflow_metadata').notNull().default({}),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    unq: uniqueIndex('collection_external_links_collection_link_unique').on(
      table.collectionId,
      table.externalLinkId
    ),
  })
);

export const collectionTypeOrdering = pgTable(
  'collection_type_ordering',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    unq: uniqueIndex('collection_type_ordering_collection_type_unique').on(
      table.collectionId,
      table.type
    ),
  })
);

export const externalLinksRelations = relations(externalLinks, ({ many }) => ({
  collectionExternalLinks: many(collectionExternalLinks),
  attachments: many(externalLinkAttachments),
}));

export const collectionExternalLinksRelations = relations(
  collectionExternalLinks,
  ({ one, many }) => ({
    externalLink: one(externalLinks, {
      fields: [collectionExternalLinks.externalLinkId],
      references: [externalLinks.id],
    }),
    collection: one(collections, {
      fields: [collectionExternalLinks.collectionId],
      references: [collections.id],
    }),
    socialMediaAccounts: many(socialMediaAssociations, {
      relationName: 'collection_external_link_social_media',
    }),
  })
);

export const collectionTypeOrderingRelations = relations(
  collectionTypeOrdering,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionTypeOrdering.collectionId],
      references: [collections.id],
    }),
  })
);
