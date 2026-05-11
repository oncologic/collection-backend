import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  char,
  integer,
  primaryKey,
  boolean,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { socialMediaAssociations } from './socialMedia.js';

// Define custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

export const organizationTags = pgTable('organization_tags', {
  organizationId: uuid('organization_id').references(() => organizations.id),
  tagId: integer('tag_id').references(() => tags.id),
});

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 136 }),
  acronym: varchar('acronym', { length: 136 }),
  description: text('description'),
  website: text('website'),
  email: varchar('email', { length: 136 }),
  phone: varchar('phone', { length: 136 }),
  address: text('address'),
  city: varchar('city', { length: 136 }),
  state: char('state', { length: 2 }),
  postal: varchar('postal', { length: 136 }),
  country: char('country', { length: 3 }),
  category: varchar('category', { length: 136 }),
  imageUrl: text('image_url'),
  imageKey: text('image_key'),
  primaryContactName: varchar('primary_contact_name', { length: 136 }),
  primaryContactEmail: varchar('primary_contact_email', { length: 136 }),
  primaryContactPhone: varchar('primary_contact_phone', { length: 136 }),
  clerkOrganizationId: varchar('clerk_organization_id', { length: 256 }),
  professional: boolean('professional').default(false),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  userId: uuid('user_id').references(() => users.id),
  // Vector columns for semantic search
  nameEmbedding: vector('name_embedding'),
  descriptionEmbedding: vector('description_embedding'),
  categoryEmbedding: vector('category_embedding'),
  combinedEmbedding: vector('combined_embedding'),
  vectorUpdatedAt: timestamp('vector_updated_at'),
});

export const organizationsRelations = relations(organizations, ({ many }) => ({
  tags: many(organizationTags),
  members: many(organizationMembers),
  socialMediaAccounts: many(socialMediaAssociations, {
    relationName: 'organization_social_media',
  }),
}));

export const organizationResources = pgTable('organization_resources', {
  organizationId: uuid('organization_id').references(() => organizations.id),
  resourceId: uuid('resource_id').references(() => resources.id),
});

export const organizationEvents = pgTable('organization_events', {
  organizationId: uuid('organization_id').references(() => organizations.id),
  eventId: uuid('event_id').references(() => events.id),
});

export const organizationResourcesRelations = relations(
  organizationResources,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationResources.organizationId],
      references: [organizations.id],
    }),
  })
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    userId: uuid('user_id').notNull(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id)
      .notNull(),
    updatedAt: timestamp('updated_at').defaultNow(),
    role: varchar('role', { length: 136 }),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.userId, table.organizationId] }),
    };
  }
);

export const organizationMembersRelations = relations(
  organizationMembers,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationMembers.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [organizationMembers.userId],
      references: [users.id],
    }),
  })
);
