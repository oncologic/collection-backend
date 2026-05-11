import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  decimal,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { events } from './events.js';
import { users } from './users.js';
import { organizations } from './organizations.js';

// Sponsorship Tiers table
export const sponsorshipTiers = pgTable('sponsorship_tiers', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  highlight: boolean('highlight').default(false),
  price: decimal('price', { precision: 10, scale: 2 }),
  type: varchar('type', { length: 136 }),
  orderPosition: integer('order_position'),
  imageKey: text('image_key'),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Sponsorship Items table
export const sponsorshipItems = pgTable('sponsorship_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  link: text('link'),
  type: varchar('type', { length: 136 }),
  imageKey: text('image_key'),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Event Sponsorship Tiers junction table
export const eventSponsorshipTiers = pgTable(
  'event_sponsorship_tiers',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    sponsorshipTierId: uuid('sponsorship_tier_id')
      .notNull()
      .references(() => sponsorshipTiers.id, { onDelete: 'cascade' }),
    orderPosition: integer('order_position'),
    userAddedById: uuid('user_added_by_id').references(() => users.id),
    organizationAddedById: uuid('organization_added_by_id').references(
      () => organizations.id
    ),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.eventId, table.sponsorshipTierId] }),
  })
);

// Sponsorship Features junction table
export const sponsorshipFeatures = pgTable(
  'sponsorship_features',
  {
    sponsorshipTierId: uuid('sponsorship_tier_id')
      .notNull()
      .references(() => sponsorshipTiers.id, { onDelete: 'cascade' }),
    sponsorshipItemId: uuid('sponsorship_item_id')
      .notNull()
      .references(() => sponsorshipItems.id, { onDelete: 'cascade' }),
    orderPosition: integer('order_position'),
    qty: integer('qty'),
    organizationAddedById: uuid('organization_added_by_id').references(
      () => organizations.id
    ),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.sponsorshipTierId, table.sponsorshipItemId],
    }),
  })
);

// Relations
export const sponsorshipTiersRelations = relations(
  sponsorshipTiers,
  ({ many }) => ({
    eventSponsorshipTiers: many(eventSponsorshipTiers),
    sponsorshipFeatures: many(sponsorshipFeatures),
  })
);

export const sponsorshipItemsRelations = relations(
  sponsorshipItems,
  ({ many }) => ({
    sponsorshipFeatures: many(sponsorshipFeatures),
  })
);

export const eventSponsorshipTiersRelations = relations(
  eventSponsorshipTiers,
  ({ one }) => ({
    event: one(events, {
      fields: [eventSponsorshipTiers.eventId],
      references: [events.id],
    }),
    sponsorshipTier: one(sponsorshipTiers, {
      fields: [eventSponsorshipTiers.sponsorshipTierId],
      references: [sponsorshipTiers.id],
    }),
    addedByUser: one(users, {
      fields: [eventSponsorshipTiers.userAddedById],
      references: [users.id],
    }),
    addedByOrganization: one(organizations, {
      fields: [eventSponsorshipTiers.organizationAddedById],
      references: [organizations.id],
    }),
  })
);

export const sponsorshipFeaturesRelations = relations(
  sponsorshipFeatures,
  ({ one }) => ({
    sponsorshipTier: one(sponsorshipTiers, {
      fields: [sponsorshipFeatures.sponsorshipTierId],
      references: [sponsorshipTiers.id],
    }),
    sponsorshipItem: one(sponsorshipItems, {
      fields: [sponsorshipFeatures.sponsorshipItemId],
      references: [sponsorshipItems.id],
    }),
    addedByOrganization: one(organizations, {
      fields: [sponsorshipFeatures.organizationAddedById],
      references: [organizations.id],
    }),
  })
);
