import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  text,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';

export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  transactionType: varchar('transaction_type', { length: 50 }).notNull(),
  amount: integer('amount').notNull(),
  stripeTransactionId: varchar('stripe_transaction_id', { length: 255 }),
  referenceId: uuid('reference_id'),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const creditTransactionsRelations = relations(
  creditTransactions,
  ({ one }) => ({
    user: one(users, {
      fields: [creditTransactions.userId],
      references: [users.id],
    }),
  })
);
