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
import { resourceTypes } from './metadata.js';
import { sensitivityLevels } from './metadata.js';
import { expertiseLevels } from './metadata.js';
import { resourceRatings } from './resourceRatings.js';
import { targetAudiences } from './metadata.js';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { tenants } from './tenants.js';
import { resourceAttachments } from './resourceAttachments.js';

// Define custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

// Resources table
export const resources = pgTable('resources', {
  id: uuid('id').defaultRandom().primaryKey(),
  typeId: integer('type_id')
    .notNull()
    .references(() => resourceTypes.id),
  url: text('url'),
  name: text('name'),
  description: text('description'),
  resourceDate: date('resource_date'),
  resourceUpdatedDate: date('resource_updated_date'),
  buttonName: text('button_name'),
  sensitivityLevelId: integer('sensitivity_level_id')
    .notNull()
    .references(() => sensitivityLevels.id),
  expertiseLevelId: integer('expertise_level_id')
    .notNull()
    .references(() => expertiseLevels.id),
  targetAudienceId: integer('target_audience_id')
    .notNull()
    .references(() => targetAudiences.id),
  requiresRegistration: boolean('requires_registration').default(false),
  videoUrl: text('video_url'),
  videoKey: text('video_key'),
  videoMetadata: jsonb('video_metadata'),
  imageKey: text('image_key'),
  imageMetadata: jsonb('image_metadata'),
  addedByUserId: uuid('added_by_user_id')
    .notNull()
    .references(() => users.id),
  featured: boolean('featured').default(false),
  listOrder: integer('list_order'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  timestamps: text('timestamps'),
  fullText: text('full_text'),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  status: varchar('status', { length: 50 }).default('approved').notNull(), // pending, approved, rejected
  suggestedByEmail: varchar('suggested_by_email', { length: 255 }), // Email of person who suggested (for pending resources)
  // Vector columns for semantic search
  nameEmbedding: vector('name_embedding'),
  descriptionEmbedding: vector('description_embedding'),
  fullTextEmbedding: vector('full_text_embedding'),
  timestampsEmbedding: vector('timestamps_embedding'),
  combinedEmbedding: vector('combined_embedding'),
  vectorUpdatedAt: timestamp('vector_updated_at'),
});

// Resource Tags junction table
export const resourceTags = pgTable(
  'resource_tags',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id),
    tagId: integer('tag_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.resourceId, table.tagId] }),
  })
);

// Add the organization_resources junction table
export const organizationResources = pgTable(
  'organization_resources',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.resourceId] }),
  })
);

// Relations
export const resourcesRelations = relations(resources, ({ one, many }) => ({
  resourceType: one(resourceTypes, {
    fields: [resources.typeId],
    references: [resourceTypes.id],
    relationName: 'resourceType',
  }),
  resourceTags: many(resourceTags),
  resourceRatings: many(resourceRatings),
  sensitivityLevel: one(sensitivityLevels, {
    fields: [resources.sensitivityLevelId],
    references: [sensitivityLevels.id],
  }),
  expertiseLevel: one(expertiseLevels, {
    fields: [resources.expertiseLevelId],
    references: [expertiseLevels.id],
  }),
  organizationResources: many(organizationResources),
  attachments: many(resourceAttachments),
}));

export const resourceTypesRelations = relations(resourceTypes, ({ many }) => ({
  resources: many(resources, {
    fields: [resourceTypes.id],
    references: [resources.typeId],
    relationName: 'resourceType',
  }),
}));

export const resourceTagsRelations = relations(resourceTags, ({ one }) => ({
  resource: one(resources, {
    fields: [resourceTags.resourceId],
    references: [resources.id],
  }),
}));

// Add organizationResourcesRelations
export const organizationResourcesRelations = relations(
  organizationResources,
  ({ one }) => ({
    resource: one(resources, {
      fields: [organizationResources.resourceId],
      references: [resources.id],
    }),
    organization: one(organizations, {
      fields: [organizationResources.organizationId],
      references: [organizations.id],
    }),
  })
);

// Add resource ratings relations
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
