import { pgTable, uuid, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { organizations } from './organizations.js';
import { tenants } from './tenants.js';
import { socialMediaAccountTypes } from './socialMediaAccountTypes.js';

// Social Media Platforms
export const socialMediaPlatforms = pgTable('social_media_platforms', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  icon: varchar('icon', { length: 100 }).notNull(),
  urlPattern: varchar('url_pattern', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
});

// Social Media Accounts
export const socialMediaAccounts = pgTable('social_media_accounts', {
  id: uuid('id').defaultRandom().primaryKey(),
  platformId: uuid('platform_id').references(() => socialMediaPlatforms.id, {
    onDelete: 'cascade',
  }),
  name: varchar('name', { length: 255 }).notNull(),
  handle: varchar('handle', { length: 255 }),
  url: varchar('url', { length: 1000 }).notNull(),
  description: text('description'),
  accountTypeId: uuid('account_type_id').references(
    () => socialMediaAccountTypes.id
  ),
  title: varchar('title', { length: 255 }),
  organizationId: uuid('organization_id').references(() => organizations.id, {
    onDelete: 'set null',
  }),
  userId: uuid('user_id').references(() => users.id),
  visibility: varchar('visibility', { length: 50 }).notNull().default('public'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
});

// Social Media Associations (Polymorphic)
export const socialMediaAssociations = pgTable('social_media_associations', {
  id: uuid('id').defaultRandom().primaryKey(),
  socialMediaAccountId: uuid('social_media_account_id')
    .notNull()
    .references(() => socialMediaAccounts.id, { onDelete: 'cascade' }),
  associatedId: uuid('associated_id').notNull(),
  associatedType: varchar('associated_type', { length: 50 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
});

// Relations
export const socialMediaPlatformsRelations = relations(
  socialMediaPlatforms,
  ({ many }) => ({
    accounts: many(socialMediaAccounts),
  })
);

export const socialMediaAccountsRelations = relations(
  socialMediaAccounts,
  ({ one, many }) => ({
    platform: one(socialMediaPlatforms, {
      fields: [socialMediaAccounts.platformId],
      references: [socialMediaPlatforms.id],
    }),
    accountType: one(socialMediaAccountTypes, {
      fields: [socialMediaAccounts.accountTypeId],
      references: [socialMediaAccountTypes.id],
    }),
    organization: one(organizations, {
      fields: [socialMediaAccounts.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [socialMediaAccounts.userId],
      references: [users.id],
    }),
    associations: many(socialMediaAssociations),
  })
);

export const socialMediaAssociationsRelations = relations(
  socialMediaAssociations,
  ({ one }) => ({
    socialMediaAccount: one(socialMediaAccounts, {
      fields: [socialMediaAssociations.socialMediaAccountId],
      references: [socialMediaAccounts.id],
    }),
  })
);
