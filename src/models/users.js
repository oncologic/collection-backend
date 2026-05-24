import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  text,
  integer,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { surveys } from './surveys.js';
import { pinnedItems } from './pinnedItems.js';
import { userTypes } from './userTypes.js';
import { userRoles } from './userRoles.js';
import { usersTenants } from './usersTenants.js';
import { subscriptionPlans } from './subscriptionPlans.js';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  firstName: varchar('first_name', { length: 255 }),
  lastName: varchar('last_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  userRole: varchar('user_role', { length: 50 }),
  cancerType: varchar('cancer_type', { length: 100 }),
  yearOfBirth: integer('year_of_birth'),
  designation: varchar('designation', { length: 100 }),
  clerkUserId: varchar('clerk_user_id', { length: 255 }).notNull().unique(),
  promptContext: text('prompt_context'),
  includeUpdatedSince: boolean('include_updated_since').default(false),
  hasOnboarded: boolean('has_onboarded').notNull().default(false),
  subscriptionPlan: varchar('subscription_plan', { length: 50 })
    .notNull()
    .default('basic'),
  subscriptionStatus: varchar('subscription_status', { length: 20 })
    .notNull()
    .default('active'), // active, cancelled, expired
  subscriptionStartDate: timestamp('subscription_start_date').defaultNow(),
  subscriptionEndDate: timestamp('subscription_end_date'),
  superuser: boolean('superuser').notNull().default(false),
});

export const usersRelations = relations(users, ({ many, one }) => ({
  tenants: many(usersTenants),
  createdSurveys: many(surveys, { relationName: 'createdBy' }),
  publishedSurveys: many(surveys, { relationName: 'publishedBy' }),
  lastUpdatedSurveys: many(surveys, { relationName: 'lastUpdatedBy' }),
  pinnedItems: many(pinnedItems),
  userType: one(userTypes, {
    fields: [users.userTypeId],
    references: [userTypes.id],
  }),
  roles: many(userRoles),
  subscription: one(subscriptionPlans, {
    fields: [users.subscriptionPlan],
    references: [subscriptionPlans.name],
  }),
}));
