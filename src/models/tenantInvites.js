import { pgTable, uuid, varchar, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenants } from './tenants.js';
import { users } from './users.js';

export const tenantInvites = pgTable('tenant_invites', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  inviteToken: varchar('invite_token', { length: 255 }).notNull().unique(),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id),
  role: varchar('role', { length: 50 }).notNull(), // 'advocate' or 'patient'
  isActive: boolean('is_active').default(true).notNull(),
  maxUses: varchar('max_uses', { length: 50 }), // null for unlimited
  useCount: varchar('use_count', { length: 50 }).default('0'),
  metadata: jsonb('metadata'), // For any additional settings
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  revokedAt: timestamp('revoked_at'),
});

export const tenantInvitesRelations = relations(tenantInvites, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantInvites.tenantId],
    references: [tenants.id],
  }),
  createdBy: one(users, {
    fields: [tenantInvites.createdByUserId],
    references: [users.id],
  }),
}));
