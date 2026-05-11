import {
  pgTable,
  uuid,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { attachments } from './attachments.js';
import { resources } from './resources.js';
import { relations } from 'drizzle-orm';

export const resourceAttachments = pgTable(
  'resource_attachments',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    highlighted: boolean('highlighted').default(false),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    unq: uniqueIndex('resource_attachments_resource_attachment_unique').on(
      table.resourceId,
      table.attachmentId
    ),
    resourceIdx: index('resource_attachments_resource_idx').on(table.resourceId),
    attachmentIdx: index('resource_attachments_attachment_idx').on(
      table.attachmentId
    ),
  })
);

export const resourceAttachmentsRelations = relations(
  resourceAttachments,
  ({ one }) => ({
    resource: one(resources, {
      fields: [resourceAttachments.resourceId],
      references: [resources.id],
    }),
    attachment: one(attachments, {
      fields: [resourceAttachments.attachmentId],
      references: [attachments.id],
    }),
  })
);
