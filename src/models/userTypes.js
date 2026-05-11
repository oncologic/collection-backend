import { pgTable, serial, varchar, text, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';

export const userTypes = pgTable('user_types', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const userTypesRelations = relations(userTypes, ({ many }) => ({
  users: many(users),
}));
