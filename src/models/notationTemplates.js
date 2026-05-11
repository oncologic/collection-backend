import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  check,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { collectionExternalLinks } from './external_links.js';
import { users } from './users.js';
import { collectionExternalLinksNotations } from './collectionExternalLinksNotations.js';

// Notation Templates table
export const notationTemplates = pgTable('notation_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  collectionExternalLinkId: uuid('collection_external_link_id').references(
    () => collectionExternalLinks.id,
    { onDelete: 'cascade' }
  ),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isActive: boolean('is_active').default(true),
  isPublicSubmissionTemplate: boolean('is_public_submission_template').default(false),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Template Field Definitions table
export const notationTemplateFields = pgTable(
  'notation_template_fields',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .references(() => notationTemplates.id, { onDelete: 'cascade' })
      .notNull(),
    fieldKey: varchar('field_key', { length: 255 }).notNull(),
    fieldLabel: varchar('field_label', { length: 255 }).notNull(),
    fieldType: varchar('field_type', { length: 50 }).notNull(),
    fieldOptions: jsonb('field_options'), // For select/multiselect options
    isRequired: boolean('is_required').default(false),
    validationRules: jsonb('validation_rules'),
    placeholderText: varchar('placeholder_text', { length: 500 }),
    helpText: text('help_text'),
    displayOrder: integer('display_order').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    fieldTypeCheck: check(
      'field_type_check',
      `${table.fieldType} IN ('text', 'textarea', 'select', 'multiselect', 'date', 'number', 'boolean', 'url', 'email')`
    ),
  })
);

// External Notation Submissions table
export const externalNotationSubmissions = pgTable('external_notation_submissions', {
  id: uuid('id').defaultRandom().primaryKey(),
  notationId: uuid('notation_id')
    .references(() => collectionExternalLinksNotations.id, { onDelete: 'cascade' })
    .unique()
    .notNull(),
  templateId: uuid('template_id').references(() => notationTemplates.id),
  submitterEmail: varchar('submitter_email', { length: 255 }),
  submitterName: varchar('submitter_name', { length: 255 }),
  submissionSource: varchar('submission_source', { length: 50 }).default('external'),
  submissionIp: varchar('submission_ip', { length: 45 }),
  submissionUserAgent: text('submission_user_agent'),
  submissionReferrer: text('submission_referrer'),
  approvalStatus: varchar('approval_status', { length: 50 }).default('pending'),
  reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  reviewNotes: text('review_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const notationTemplatesRelations = relations(
  notationTemplates,
  ({ one, many }) => ({
    collectionExternalLink: one(collectionExternalLinks, {
      fields: [notationTemplates.collectionExternalLinkId],
      references: [collectionExternalLinks.id],
    }),
    createdByUser: one(users, {
      fields: [notationTemplates.createdByUserId],
      references: [users.id],
    }),
    fields: many(notationTemplateFields),
    notations: many(collectionExternalLinksNotations),
    submissions: many(externalNotationSubmissions),
  })
);

export const notationTemplateFieldsRelations = relations(
  notationTemplateFields,
  ({ one }) => ({
    template: one(notationTemplates, {
      fields: [notationTemplateFields.templateId],
      references: [notationTemplates.id],
    }),
  })
);

export const externalNotationSubmissionsRelations = relations(
  externalNotationSubmissions,
  ({ one }) => ({
    notation: one(collectionExternalLinksNotations, {
      fields: [externalNotationSubmissions.notationId],
      references: [collectionExternalLinksNotations.id],
    }),
    template: one(notationTemplates, {
      fields: [externalNotationSubmissions.templateId],
      references: [notationTemplates.id],
    }),
  })
);