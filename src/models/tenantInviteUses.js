import { pgTable, uuid, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { tenantInvites } from './tenantInvites.js';
import { users } from './users.js';
import { tenants } from './tenants.js';

export const tenantInviteUses = pgTable('tenant_invite_uses', {
  id: uuid('id').defaultRandom().primaryKey(),
  inviteId: uuid('invite_id')
    .notNull()
    .references(() => tenantInvites.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  createdAt: timestamp('created_at').defaultNow(),
});

export const tenantInviteUsesRelations = relations(
  tenantInviteUses,
  ({ one }) => ({
    invite: one(tenantInvites, {
      fields: [tenantInviteUses.inviteId],
      references: [tenantInvites.id],
    }),
    user: one(users, {
      fields: [tenantInviteUses.userId],
      references: [users.id],
    }),
    tenant: one(tenants, {
      fields: [tenantInviteUses.tenantId],
      references: [tenants.id],
    }),
  })
);
