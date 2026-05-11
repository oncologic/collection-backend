import {
  pgTable,
  uuid,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { attachments } from './attachments.js';
import { externalLinks } from './external_links.js';
import { relations } from 'drizzle-orm';

export const externalLinkAttachments = pgTable(
  'external_link_attachments',
  {
    externalLinkId: uuid('external_link_id')
      .notNull()
      .references(() => externalLinks.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    highlighted: boolean('highlighted').default(false),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    unq: uniqueIndex('external_link_attachments_external_attachment_unique').on(
      table.externalLinkId,
      table.attachmentId
    ),
  })
);

export const externalLinkAttachmentsRelations = relations(
  externalLinkAttachments,
  ({ one }) => ({
    externalLink: one(externalLinks, {
      fields: [externalLinkAttachments.externalLinkId],
      references: [externalLinks.id],
    }),
    attachment: one(attachments, {
      fields: [externalLinkAttachments.attachmentId],
      references: [attachments.id],
    }),
  })
);
