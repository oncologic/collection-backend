import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  color: varchar('color', { length: 7 }),
  addedByUserId: uuid('added_by_user_id'),
  visibility: varchar('visibility', { length: 20 }).default('private'),
});
