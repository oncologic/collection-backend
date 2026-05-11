import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { collectionExternalLinks } from './external_links.js';
import { users } from './users.js';
import { organizations } from './organizations.js';

export const collectionExternalLinkCollaborators = pgTable(
  'collection_external_links_collaborators',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    collectionExternalLinkId: uuid('collection_external_link_id')
      .notNull()
      .references(() => collectionExternalLinks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    role: varchar('role', { length: 50 }).notNull().default('editor'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  }
);

// export const collectionExternalLinkCollaboratorsRelations = relations(
//   collectionExternalLinkCollaborators,
//   ({ one }) => ({
//     collectionExternalLink: one(collectionExternalLinks, {
//       fields: [collectionExternalLinkCollaborators.collectionExternalLinkId],
//       references: [collectionExternalLinks.id],
//     }),
//     user: one(users, {
//       fields: [collectionExternalLinkCollaborators.userId],
//       references: [users.id],
//     }),
//     organization: one(organizations, {
//       fields: [collectionExternalLinkCollaborators.organizationId],
//       references: [organizations.id],
//     }),
//   })
// );
