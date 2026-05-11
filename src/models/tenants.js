import { pgTable, uuid, varchar, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { usersTenants } from './usersTenants.js';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  domain: varchar('domain', { length: 255 }),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  access: varchar('access', { length: 255 }),
});

export const tenantsRelations = relations(tenants, ({ many }) => ({
  usersTenants: many(usersTenants),
}));
