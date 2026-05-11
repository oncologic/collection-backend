import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { organizations } from './organizations.js';
import { folderCollections } from './folderCollections.js';

export const folders = pgTable('folders', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 136 }).notNull(),
  description: text('description'),
  userId: uuid('user_id').references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  visibility: varchar('visibility', { length: 50 })
    .notNull()
    .default('private'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
});

export const foldersRelations = relations(folders, ({ one, many }) => ({
  user: one(users, {
    fields: [folders.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [folders.organizationId],
    references: [organizations.id],
  }),
  folderCollections: many(folderCollections),
}));
