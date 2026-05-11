import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { tenants } from './tenants.js';
import { resourceAttachments } from './resourceAttachments.js';

// Define custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

export const attachments = pgTable('attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 255 }),
  description: varchar('description', { length: 500 }),
  type: varchar('type', { length: 100 }),
  imageKey: varchar('image_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  listOrder: integer('list_order'),
  visibility: varchar('visibility', { length: 50 })
    .notNull()
    .default('private'),
  userId: uuid('user_id').references(() => users.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  // Vector columns for semantic search
  titleEmbedding: vector('title_embedding'),
  descriptionEmbedding: vector('description_embedding'),
  combinedEmbedding: vector('combined_embedding'),
  vectorUpdatedAt: timestamp('vector_updated_at'),
});

import { externalLinkAttachments } from './externalLinkAttachments.js';

export const attachmentsRelations = relations(attachments, ({ many }) => ({
  externalLinkAttachments: many(externalLinkAttachments),
  resourceAttachments: many(resourceAttachments),
}));
