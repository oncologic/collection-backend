import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  char,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { tenants } from './tenants.js';
export const userRoles = pgTable('user_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 136 }).notNull(),
  value: varchar('value', { length: 100 }).notNull(),
  description: text('description'),
  verified: boolean('verified').default(false),
  licenseNumber: text('license_number'),
  licenseState: char('license_state', { length: 2 }),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
});

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
}));
