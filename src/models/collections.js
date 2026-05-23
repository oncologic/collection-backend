import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  char,
  boolean,
  integer,
  date,
  jsonb,
  primaryKey,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { pinnedItems } from './pinnedItems.js';
import { folderCollections } from './folderCollections.js';
import { externalLinks } from './external_links.js';

// Define custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

export const collections = pgTable('collections', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  userId: uuid('user_id').references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  visibility: varchar('visibility', { length: 50 })
    .notNull()
    .default('private'),
  status: varchar('status', { length: 50 }),
  icon: varchar('icon', { length: 136 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  color: varchar('color', { length: 136 }),
  type: varchar('type', { length: 25 }),
  startDate: date('start_date'),
  endDate: date('end_date'),
  sourceTemplateId: uuid('source_template_id'),
  eventId: uuid('event_id').references(() => events.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  hashtags: text('hashtags'),
  publicJsonEnabled: boolean('public_json_enabled').notNull().default(false),
  whiteboardData: jsonb('whiteboard_data'),
  workflowMetadata: jsonb('workflow_metadata').notNull().default({}),
  // Vector columns for semantic search
  nameEmbedding: vector('name_embedding'),
  descriptionEmbedding: vector('description_embedding'),
  hashtagsEmbedding: vector('hashtags_embedding'),
  combinedEmbedding: vector('combined_embedding'),
  vectorUpdatedAt: timestamp('vector_updated_at'),
});

export const collectionCollaborators = pgTable('collection_collaborators', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id),
  userId: uuid('user_id').references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  role: varchar('role', { length: 50 }).notNull().default('editor'),
  canAddResources: boolean('can_add_resources').default(true),
  canAddLinks: boolean('can_add_links').default(true),
  canAddNotes: boolean('can_add_notes').default(true),
  canAddAttachments: boolean('can_add_attachments').default(true),
  canManageCollaborators: boolean('can_manage_collaborators').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
});

export const collectionResources = pgTable('collection_resources', {
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id),
  status: varchar('status', { length: 50 }),
  resourceId: uuid('resource_id')
    .notNull()
    .references(() => resources.id),
  notes: text('notes'),
  orderPosition: integer('order_position').notNull(),
  userAddedById: uuid('user_added_by_id').references(() => users.id),
  organizationAddedById: uuid('organization_added_by_id').references(
    () => organizations.id
  ),
});

export const collectionBookmarks = pgTable('collection_bookmarks', {
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id),
  userId: uuid('user_id').references(() => users.id),
});

export const collectionBookmarksRelations = relations(
  collectionBookmarks,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionBookmarks.collectionId],
      references: [collections.id],
    }),
  })
);

export const collectionsRelations = relations(collections, ({ many, one }) => ({
  pinnedItems: many(pinnedItems, {
    relationName: 'collection_pins',
    foreignKey: [pinnedItems.itemId],
    filterFn: (pinnedItems) => eq(pinnedItems.itemType, 'collection'),
  }),
  folderCollections: many(folderCollections),
  collaborators: many(collectionCollaborators),
  owner: one(users, {
    fields: [collections.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [collections.organizationId],
    references: [organizations.id],
  }),
}));

export const collectionCollaboratorsRelations = relations(
  collectionCollaborators,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionCollaborators.collectionId],
      references: [collections.id],
    }),
    user: one(users, {
      fields: [collectionCollaborators.userId],
      references: [users.id],
    }),
    organization: one(organizations, {
      fields: [collectionCollaborators.organizationId],
      references: [organizations.id],
    }),
    createdBy: one(users, {
      fields: [collectionCollaborators.createdByUserId],
      references: [users.id],
    }),
  })
);

export const collectionExternalLinks = pgTable('collection_external_links', {
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id),
  externalLinkId: uuid('external_link_id')
    .notNull()
    .references(() => externalLinks.id),
  notes: text('notes'),
  userId: uuid('user_id').references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const collectionExternalLinkPermissions = pgTable(
  'collection_external_link_permissions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionExternalLinkId: uuid('collection_external_link_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    externalLinkId: uuid('external_link_id').notNull(),
    userId: uuid('user_id').references(() => users.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    canEdit: boolean('can_edit').default(false),
    canAddNotes: boolean('can_add_notes').default(false),
    canAddAttachments: boolean('can_add_attachments').default(false),
    canDelete: boolean('can_delete').default(false),
    canManagePermissions: boolean('can_manage_permissions').default(false),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
  }
);

export const collectionExternalLinksRelations = relations(
  collectionExternalLinks,
  ({ one, many }) => ({
    collection: one(collections, {
      fields: [collectionExternalLinks.collectionId],
      references: [collections.id],
    }),
    externalLink: one(externalLinks, {
      fields: [collectionExternalLinks.externalLinkId],
      references: [externalLinks.id],
    }),
    user: one(users, {
      fields: [collectionExternalLinks.userId],
      references: [users.id],
    }),
    organization: one(organizations, {
      fields: [collectionExternalLinks.organizationId],
      references: [organizations.id],
    }),
    permissions: many(collectionExternalLinkPermissions),
  })
);

export const collectionExternalLinkPermissionsRelations = relations(
  collectionExternalLinkPermissions,
  ({ one }) => ({
    collectionExternalLink: one(collectionExternalLinks, {
      fields: [
        collectionExternalLinkPermissions.collectionId,
        collectionExternalLinkPermissions.externalLinkId,
      ],
      references: [
        collectionExternalLinks.collectionId,
        collectionExternalLinks.externalLinkId,
      ],
    }),
    user: one(users, {
      fields: [collectionExternalLinkPermissions.userId],
      references: [users.id],
    }),
    organization: one(organizations, {
      fields: [collectionExternalLinkPermissions.organizationId],
      references: [organizations.id],
    }),
    createdBy: one(users, {
      fields: [collectionExternalLinkPermissions.createdByUserId],
      references: [users.id],
    }),
  })
);
