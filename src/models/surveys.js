import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  integer,
  date,
  jsonb,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { organizations } from './organizations.js';

// Surveys table
export const surveys = pgTable('surveys', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 136 }),
  description: text('description'),
  openDate: date('open_date'),
  closeDate: date('close_date'),
  link: varchar('link', { length: 136 }),
  surveyTypeId: integer('survey_type_id').notNull(),
  published: boolean('published').default(false),
  createdByUserId: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id),
  publishedByUserId: uuid('published_by_user_id').references(() => users.id),
  lastUpdatedByUserId: uuid('last_updated_by_user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  tenantId: uuid('tenant_id').notNull(),
});

// Survey Questions table
export const surveyQuestions = pgTable('survey_questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id),
  question: text('question'),
  questionType: varchar('question_type', { length: 136 }),
  questionOptions: jsonb('question_options'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Survey Responses table
export const surveyResponses = pgTable('survey_responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Survey Answers table
export const surveyAnswers = pgTable('survey_answers', {
  id: uuid('id').defaultRandom().primaryKey(),
  surveyId: uuid('survey_id')
    .notNull()
    .references(() => surveys.id),
  questionId: uuid('question_id')
    .notNull()
    .references(() => surveyQuestions.id),
  responseId: uuid('response_id')
    .notNull()
    .references(() => surveyResponses.id),
  answer: text('answer'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Organization Surveys junction table
export const organizationSurveys = pgTable(
  'organization_surveys',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    surveyId: uuid('survey_id')
      .notNull()
      .references(() => surveys.id),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.organizationId, table.surveyId] }),
    };
  }
);

// Relations
export const surveysRelations = relations(surveys, ({ many }) => ({
  questions: many(surveyQuestions),
  responses: many(surveyResponses),
  organizationSurveys: many(organizationSurveys),
}));

export const surveyQuestionsRelations = relations(
  surveyQuestions,
  ({ one, many }) => ({
    survey: one(surveys, {
      fields: [surveyQuestions.surveyId],
      references: [surveys.id],
    }),
    answers: many(surveyAnswers),
  })
);

export const surveyResponsesRelations = relations(
  surveyResponses,
  ({ one, many }) => ({
    survey: one(surveys, {
      fields: [surveyResponses.surveyId],
      references: [surveys.id],
    }),
    answers: many(surveyAnswers),
  })
);

export const surveyAnswersRelations = relations(surveyAnswers, ({ one }) => ({
  survey: one(surveys, {
    fields: [surveyAnswers.surveyId],
    references: [surveys.id],
  }),
  question: one(surveyQuestions, {
    fields: [surveyAnswers.questionId],
    references: [surveyQuestions.id],
  }),
  response: one(surveyResponses, {
    fields: [surveyAnswers.responseId],
    references: [surveyResponses.id],
  }),
}));

// Add relations for organizationSurveys
export const organizationSurveysRelations = relations(
  organizationSurveys,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationSurveys.organizationId],
      references: [organizations.id],
    }),
    survey: one(surveys, {
      fields: [organizationSurveys.surveyId],
      references: [surveys.id],
    }),
  })
);
