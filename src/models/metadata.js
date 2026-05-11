import {
  pgTable,
  uuid,
  serial,
  varchar,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

// Define the metadata tables
export const resourceTypes = pgTable('resource_types', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  addedByUserId: uuid('added_by_user_id'),
  visibility: varchar('visibility', { length: 20 }).default('tenant'),
});

export const eventTypes = pgTable('event_types', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  addedByUserId: uuid('added_by_user_id'),
  visibility: varchar('visibility', { length: 20 }).default('private'),
});

export const sensitivityLevels = pgTable('sensitivity_levels', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const expertiseLevels = pgTable('expertise_levels', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const targetAudiences = pgTable('target_audiences', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').references(() => tenants.id),
});
