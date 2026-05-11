import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  decimal,
  customType,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations } from './organizations.js';
import { users } from './users.js';
import { tenants } from './tenants.js';

// Define custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

// Opportunities table
export const opportunities = pgTable('opportunities', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  requirements: text('requirements'),
  responsibilities: text('responsibilities'),

  // Opportunity type and compensation
  isVolunteer: boolean('is_volunteer').default(true).notNull(),
  compensationType: varchar('compensation_type', { length: 50 }), // 'paid', 'travel_reimbursement', 'stipend', null
  compensationAmount: decimal('compensation_amount', {
    precision: 10,
    scale: 2,
  }),
  compensationCurrency: varchar('compensation_currency', { length: 3 }).default(
    'USD'
  ),

  // Time commitment
  timeCommitment: varchar('time_commitment', { length: 100 }), // e.g., "2 hours per week"
  frequency: varchar('frequency', { length: 50 }), // 'once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'as_needed'
  estimatedHours: integer('estimated_hours'), // Total estimated hours
  duration: varchar('duration', { length: 100 }), // e.g., "3 months", "ongoing"

  // Availability and location
  spotsAvailable: integer('spots_available').default(1).notNull(),
  spotsFilled: integer('spots_filled').default(0).notNull(),
  isRemote: boolean('is_remote').default(true),
  location: text('location'),

  // Dates
  applicationDeadline: timestamp('application_deadline', {
    withTimezone: true,
  }),
  startDate: timestamp('start_date', { withTimezone: true }),
  endDate: timestamp('end_date', { withTimezone: true }),

  // Status and visibility
  status: varchar('status', { length: 50 }).default('draft').notNull(), // 'draft', 'active', 'filled', 'closed', 'completed'
  visibility: varchar('visibility', { length: 50 })
    .default('private')
    .notNull(),

  // Skills and tags
  requiredSkills: jsonb('required_skills'), // Array of skill strings
  preferredSkills: jsonb('preferred_skills'), // Array of skill strings

  // Contact and application
  contactEmail: varchar('contact_email', { length: 255 }),
  applicationUrl: text('application_url'),
  applicationInstructions: text('application_instructions'),

  // Metadata
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id),
  tenantId: uuid('tenant_id').references(() => tenants.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),

  // AI and search
  nameEmbedding: vector('name_embedding'),
  descriptionEmbedding: vector('description_embedding'),
  combinedEmbedding: vector('combined_embedding'),
  vectorUpdatedAt: timestamp('vector_updated_at'),
});

// Organization Opportunities junction table (many organizations can post same opportunity)
export const organizationOpportunities = pgTable(
  'organization_opportunities',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id),
    isPrimary: boolean('is_primary').default(false), // Primary posting organization
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.opportunityId] }),
  })
);

// Opportunity Applications table
export const opportunityApplications = pgTable('opportunity_applications', {
  id: uuid('id').defaultRandom().primaryKey(),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => opportunities.id),
  userId: uuid('user_id').references(() => users.id), // Nullable for anonymous applications
  status: varchar('status', { length: 50 }).default('pending').notNull(), // 'pending', 'reviewing', 'approved', 'rejected', 'withdrawn'

  // Anonymous applicant info (when userId is null)
  applicantEmail: varchar('applicant_email', { length: 255 }),
  applicantName: varchar('applicant_name', { length: 255 }),

  // Application details
  coverLetter: text('cover_letter'),
  resumeUrl: text('resume_url'),
  additionalInfo: jsonb('additional_info'),

  // Tracking
  appliedAt: timestamp('applied_at').defaultNow(),
  reviewedAt: timestamp('reviewed_at'),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
  reviewNotes: text('review_notes'),

  // Assignment details (if approved)
  assignedAt: timestamp('assigned_at'),
  completedAt: timestamp('completed_at'),
  completionNotes: text('completion_notes'),
  hoursCompleted: integer('hours_completed'),

  // Instructions for approved applicants
  instructions: text('instructions'),
  instructionsLink: text('instructions_link'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Opportunity Messages/Chat table
export const opportunityMessages = pgTable('opportunity_messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  opportunityId: uuid('opportunity_id')
    .notNull()
    .references(() => opportunities.id),
  applicationId: uuid('application_id').references(
    () => opportunityApplications.id
  ),
  senderId: uuid('sender_id')
    .notNull()
    .references(() => users.id),
  recipientId: uuid('recipient_id').references(() => users.id),

  message: text('message').notNull(),
  attachments: jsonb('attachments'), // Array of attachment URLs/metadata

  isRead: boolean('is_read').default(false),
  readAt: timestamp('read_at'),

  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Opportunity Tags junction table
export const opportunityTags = pgTable(
  'opportunity_tags',
  {
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id),
    tagId: integer('tag_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.opportunityId, table.tagId] }),
  })
);

// User Saved Opportunities table (for bookmarking)
export const userSavedOpportunities = pgTable(
  'user_saved_opportunities',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id),
    savedAt: timestamp('saved_at').defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.opportunityId] }),
  })
);

// Relations
export const opportunitiesRelations = relations(
  opportunities,
  ({ one, many }) => ({
    creator: one(users, {
      fields: [opportunities.createdByUserId],
      references: [users.id],
    }),
    tenant: one(tenants, {
      fields: [opportunities.tenantId],
      references: [tenants.id],
    }),
    organizationOpportunities: many(organizationOpportunities),
    applications: many(opportunityApplications),
    messages: many(opportunityMessages),
    tags: many(opportunityTags),
    savedByUsers: many(userSavedOpportunities),
  })
);

export const organizationOpportunitiesRelations = relations(
  organizationOpportunities,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationOpportunities.organizationId],
      references: [organizations.id],
    }),
    opportunity: one(opportunities, {
      fields: [organizationOpportunities.opportunityId],
      references: [opportunities.id],
    }),
  })
);

export const opportunityApplicationsRelations = relations(
  opportunityApplications,
  ({ one, many }) => ({
    opportunity: one(opportunities, {
      fields: [opportunityApplications.opportunityId],
      references: [opportunities.id],
    }),
    user: one(users, {
      fields: [opportunityApplications.userId],
      references: [users.id],
    }),
    reviewer: one(users, {
      fields: [opportunityApplications.reviewedByUserId],
      references: [users.id],
    }),
    messages: many(opportunityMessages),
  })
);

export const opportunityMessagesRelations = relations(
  opportunityMessages,
  ({ one }) => ({
    opportunity: one(opportunities, {
      fields: [opportunityMessages.opportunityId],
      references: [opportunities.id],
    }),
    application: one(opportunityApplications, {
      fields: [opportunityMessages.applicationId],
      references: [opportunityApplications.id],
    }),
    sender: one(users, {
      fields: [opportunityMessages.senderId],
      references: [users.id],
    }),
    recipient: one(users, {
      fields: [opportunityMessages.recipientId],
      references: [users.id],
    }),
  })
);

export const userSavedOpportunitiesRelations = relations(
  userSavedOpportunities,
  ({ one }) => ({
    user: one(users, {
      fields: [userSavedOpportunities.userId],
      references: [users.id],
    }),
    opportunity: one(opportunities, {
      fields: [userSavedOpportunities.opportunityId],
      references: [opportunities.id],
    }),
  })
);
