import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { tenants } from './tenants.js';

export const usersTenants = pgTable('users_tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const usersTenantsRelations = relations(usersTenants, ({ one }) => ({
  user: one(users, {
    fields: [usersTenants.userId],
    references: [users.id],
  }),
  tenant: one(tenants, {
    fields: [usersTenants.tenantId],
    references: [tenants.id],
  }),
}));
