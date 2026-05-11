import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  integer,
  text,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { attachments } from './attachments.js';
import { collectionExternalLinksNotations } from './collectionExternalLinksNotations.js';
import { relations } from 'drizzle-orm';

export const notationAttachments = pgTable(
  'notation_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    notationId: uuid('notation_id')
      .notNull()
      .references(() => collectionExternalLinksNotations.id, {
        onDelete: 'cascade',
      }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    position: integer('position'),
    inlineMetadata: jsonb('inline_metadata').default({}),
    isInline: boolean('is_inline').default(true),
    ocrText: text('ocr_text'),
    ocrProcessedAt: timestamp('ocr_processed_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    unq: uniqueIndex('notation_attachments_notation_attachment_unique').on(
      table.notationId,
      table.attachmentId
    ),
  })
);

export const notationAttachmentsRelations = relations(
  notationAttachments,
  ({ one }) => ({
    notation: one(collectionExternalLinksNotations, {
      fields: [notationAttachments.notationId],
      references: [collectionExternalLinksNotations.id],
    }),
    attachment: one(attachments, {
      fields: [notationAttachments.attachmentId],
      references: [attachments.id],
    }),
  })
);