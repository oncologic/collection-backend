import {
  pgTable,
  uuid,
  varchar,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { collections } from './collections.js';
import { users } from './users.js';
import { organizations } from './organizations.js';

export const collectionCollaborators = pgTable('collection_collaborators', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionId: uuid('collection_id')
    .notNull()
    .references(() => collections.id, { onDelete: 'cascade' }),
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
