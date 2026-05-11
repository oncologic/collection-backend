import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { organizations } from './organizations.js';

export const starterPacks = pgTable('starter_packs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 136 }).notNull(),
  description: text('description'),
  type: varchar('type', { length: 136 }).notNull(),
  userId: uuid('user_id').references(() => users.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  items: jsonb('items'),
  limit: integer('limit').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
