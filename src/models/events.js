import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  char,
  boolean,
  integer,
  date,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { expertiseLevels, eventTypes } from './metadata.js';
// import { targetAudiences } from "./metadata.js";
import { organizations } from './organizations.js';
import { users } from './users.js';

// Events table
export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  typeId: integer('type_id')
    .notNull()
    .references(() => eventTypes.id),
  title: text('title'),
  description: text('description'),
  registrationLink: text('registration_link'),
  visibility: varchar('visibility', { length: 50 }).default('private'),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),
  virtualEvent: boolean('virtual_event').default(false),
  inPersonEvent: boolean('in_person_event').default(false),
  locationName: text('location_name'),
  locationAddress: text('location_address'),
  locationCity: varchar('location_city', { length: 136 }),
  locationState: char('location_state', { length: 2 }),
  locationPostal: varchar('location_postal', { length: 136 }),
  locationCountry: char('location_country', { length: 3 }),
  professional: boolean('professional').default(false),
  expertiseLevelId: integer('expertise_level_id').references(
    () => expertiseLevels.id
  ),
  // requiresRegistration: boolean("require_registration").default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  addedByUserId: uuid('added_by_user_id')
    .notNull()
    .references(() => users.id),
  timezone: varchar('timezone', { length: 136 }),
  hasSponsorship: boolean('has_sponsorship').default(false),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  isGoogleCalendarEvent: boolean('is_google_calendar_event').default(false),
});

// Event Tags junction table
export const eventTags = pgTable(
  'event_tags',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    tagId: integer('tag_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.eventId, table.tagId] }),
  })
);

// Add the organization_events junction table
export const organizationEvents = pgTable(
  'organization_events',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.eventId] }),
  })
);

// Relations
export const eventsRelations = relations(events, ({ one, many }) => ({
  eventType: one(eventTypes, {
    fields: [events.typeId],
    references: [eventTypes.id],
  }),
  eventTags: many(eventTags),
  expertiseLevel: one(expertiseLevels, {
    fields: [events.expertiseLevelId],
    references: [expertiseLevels.id],
  }),
  organizationEvents: many(organizationEvents),
}));

export const eventTypesRelations = relations(eventTypes, ({ many }) => ({
  events: many(events),
}));

export const eventTagsRelations = relations(eventTags, ({ one }) => ({
  event: one(events, {
    fields: [eventTags.eventId],
    references: [events.id],
  }),
}));

// Add organizationEventsRelations
export const organizationEventsRelations = relations(
  organizationEvents,
  ({ one }) => ({
    event: one(events, {
      fields: [organizationEvents.eventId],
      references: [events.id],
    }),
    organization: one(organizations, {
      fields: [organizationEvents.organizationId],
      references: [organizations.id],
    }),
  })
);
