import { pgTable, uuid, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { userTypes } from './userTypes.js';

export const userTypeMap = pgTable(
  'user_type_map',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    userTypeId: integer('user_type_id')
      .notNull()
      .references(() => userTypes.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.userTypeId] }),
  })
);

export const userTypeMapRelations = relations(userTypeMap, ({ one }) => ({
  user: one(users, {
    fields: [userTypeMap.userId],
    references: [users.id],
  }),
  userType: one(userTypes, {
    fields: [userTypeMap.userTypeId],
    references: [userTypes.id],
  }),
}));
