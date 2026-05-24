import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  decimal,
} from 'drizzle-orm/pg-core';

export const subscriptionPlans = pgTable('subscription_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  displayName: varchar('display_name', { length: 100 }).notNull(),
  description: text('description'),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  billingInterval: varchar('billing_interval', { length: 20 })
    .notNull()
    .default('monthly'), // monthly, yearly

  // Collection limits
  maxExternalCollections: integer('max_external_collections').default(-1), // -1 means unlimited
  maxRegularCollections: integer('max_regular_collections').default(-1), // -1 means unlimited

  // Collaboration features
  canAddCollaborators: boolean('can_add_collaborators').default(false),
  maxCollaboratorsPerCollection: integer(
    'max_collaborators_per_collection'
  ).default(0),

  // Attachment limits
  maxAttachments: integer('max_attachments').default(-1), // -1 means unlimited
  maxAttachmentSizeMB: integer('max_attachment_size_mb').default(10),

  // Other features
  canCreateFolders: boolean('can_create_folders').default(true),
  canExportData: boolean('can_export_data').default(false),
  prioritySupport: boolean('priority_support').default(false),

  // Metadata
  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Seed data for the subscription plans
export const defaultSubscriptionPlans = [
  {
    name: 'basic',
    displayName: 'Basic',
    description: 'Perfect for getting started with basic collection management',
    price: 0.0,
    billingInterval: 'monthly',
    maxExternalCollections: 5,
    maxRegularCollections: -1, // unlimited regular collections
    canAddCollaborators: false,
    maxCollaboratorsPerCollection: 0,
    maxAttachments: 25,
    maxAttachmentSizeMB: 10,
    canCreateFolders: true,
    canExportData: false,
    prioritySupport: false,
    sortOrder: 1,
  },
  {
    name: 'premium',
    displayName: 'Premium',
    description: 'Enhanced features with unlimited collections',
    price: 19.0,
    billingInterval: 'monthly',
    maxExternalCollections: -1, // unlimited
    maxRegularCollections: -1, // unlimited
    canAddCollaborators: false,
    maxCollaboratorsPerCollection: 0,
    maxAttachments: -1, // unlimited
    maxAttachmentSizeMB: 50,
    canCreateFolders: true,
    canExportData: true,
    prioritySupport: false,
    sortOrder: 2,
  },
  {
    name: 'professional',
    displayName: 'Professional',
    description: 'Advanced collaboration features for teams',
    price: 49.0,
    billingInterval: 'monthly',
    maxExternalCollections: -1, // unlimited
    maxRegularCollections: -1, // unlimited
    canAddCollaborators: true,
    maxCollaboratorsPerCollection: 10,
    maxAttachments: -1, // unlimited
    maxAttachmentSizeMB: 100,
    canCreateFolders: true,
    canExportData: true,
    prioritySupport: true,
    sortOrder: 3,
  },
  {
    name: 'enterprise',
    displayName: 'Enterprise',
    description: 'Full-featured plan for large organizations',
    price: 99.99,
    billingInterval: 'monthly',
    maxExternalCollections: -1, // unlimited
    maxRegularCollections: -1, // unlimited
    canAddCollaborators: true,
    maxCollaboratorsPerCollection: -1, // unlimited
    maxAttachments: -1, // unlimited
    maxAttachmentSizeMB: 500,
    canCreateFolders: true,
    canExportData: true,
    prioritySupport: true,
    sortOrder: 4,
  },
];
