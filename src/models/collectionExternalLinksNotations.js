import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  date,
  time,
  customType,
  primaryKey,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { collectionExternalLinks } from './external_links.js';
import { users } from './users.js';
import { collectionExternalLinkTagDefinitions } from './collectionExternalLinkTags.js';

// Define custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

export const collectionExternalLinksNotations = pgTable(
  'collection_external_links_notations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionExternalLinkId: uuid('collection_external_link_id').references(
      () => collectionExternalLinks.id
    ),
    title: varchar('title', { length: 255 }),
    description: varchar('description', { length: 500 }),
    notes: text('notes'),
    category: varchar('category', { length: 250 }),
    status: varchar('status', { length: 250 }),
    highlighted: boolean('highlighted'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    draftContent: text('draft_content'),
    lastAutoSavedAt: timestamp('last_auto_saved_at'),
    isDraft: boolean('is_draft').default(false),
    listOrder: integer('list_order'),
    visibility: varchar('visibility', { length: 50 })
      .default('private')
      .notNull(),
    userId: uuid('user_id').references(() => users.id),
    date: date('date'),
    startDate: date('start_date'),
    endDate: date('end_date'),
    startTime: time('start_time'),
    endTime: time('end_time'),
    timezone: varchar('timezone', { length: 100 }),
    type: varchar('type', { length: 100 }),
    isGoogleCalendarEvent: boolean('is_google_calendar_event').default(false),
    // Template and custom fields support
    templateId: uuid('template_id'),
    customFields: jsonb('custom_fields').default({}),
    submissionMetadata: jsonb('submission_metadata').default({}),
    isTemplate: boolean('is_template').default(false),
    // Vector columns for semantic search
    titleEmbedding: vector('title_embedding'),
    descriptionEmbedding: vector('description_embedding'),
    notesEmbedding: vector('notes_embedding'),
    categoryEmbedding: vector('category_embedding'),
    combinedEmbedding: vector('combined_embedding'),
    vectorUpdatedAt: timestamp('vector_updated_at'),
  }
);

// Junction table for notation tags (reuses existing tag definitions)
export const collectionExternalLinkNotationTags = pgTable(
  'collection_external_links_notation_tags',
  {
    collectionExternalLinkNotationId: uuid(
      'collection_external_link_notation_id'
    )
      .references(() => collectionExternalLinksNotations.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    tagId: uuid('tag_id')
      .references(() => collectionExternalLinkTagDefinitions.id, {
        onDelete: 'cascade',
      })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.collectionExternalLinkNotationId, table.tagId],
    }),
  })
);

export const collectionExternalLinksNotationsRelations = relations(
  collectionExternalLinksNotations,
  ({ one, many }) => ({
    collectionExternalLink: one(collectionExternalLinks, {
      fields: [collectionExternalLinksNotations.collectionExternalLinkId],
      references: [collectionExternalLinks.id],
    }),
    user: one(users, {
      fields: [collectionExternalLinksNotations.userId],
      references: [users.id],
    }),
    tags: many(collectionExternalLinkNotationTags),
  })
);

export const collectionExternalLinkNotationTagsRelations = relations(
  collectionExternalLinkNotationTags,
  ({ one }) => ({
    notation: one(collectionExternalLinksNotations, {
      fields: [
        collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
      ],
      references: [collectionExternalLinksNotations.id],
    }),
    tag: one(collectionExternalLinkTagDefinitions, {
      fields: [collectionExternalLinkNotationTags.tagId],
      references: [collectionExternalLinkTagDefinitions.id],
    }),
  })
);
