import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  date,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { organizations } from './organizations.js';
import { tenants } from './tenants.js';

// Define custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

export const linkGroups = pgTable('link_groups', {
  id: uuid('id').defaultRandom().primaryKey(),
  date: date('date'),
  name: varchar('name', { length: 136 }).notNull(),
  description: text('description'),
  url: text('url'),
  category: varchar('category', { length: 136 }).notNull(),
  linkingId: uuid('linking_id'),
  linkingType: varchar('linking_type', { length: 136 }).notNull(),
  visibility: varchar('visibility', { length: 50 })
    .notNull()
    .default('private'),
  userId: uuid('user_id').references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  // Vector columns for semantic search
  nameEmbedding: vector('name_embedding'),
  descriptionEmbedding: vector('description_embedding'),
  categoryEmbedding: vector('category_embedding'),
  combinedEmbedding: vector('combined_embedding'),
  vectorUpdatedAt: timestamp('vector_updated_at'),
});

export const linkGroupsRelations = relations(linkGroups, ({ one }) => ({
  user: one(users, {
    fields: [linkGroups.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [linkGroups.organizationId],
    references: [organizations.id],
  }),
}));
