import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { tenants } from './tenants.js';

export const socialMediaAccountTypes = pgTable('social_media_account_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  color: varchar('color', { length: 7 }),
  icon: varchar('icon', { length: 50 }),
  visibility: varchar('visibility', { length: 50 }).default('private'),
  addedByUserId: uuid('added_by_user_id').references(() => users.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  isDefault: boolean('is_default').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
