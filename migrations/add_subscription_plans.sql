-- Create subscription_plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL,
  billing_interval VARCHAR(20) NOT NULL DEFAULT 'monthly',
  
  -- Collection limits
  max_external_collections INTEGER DEFAULT -1, -- -1 means unlimited
  max_regular_collections INTEGER DEFAULT -1, -- -1 means unlimited
  
  -- Collaboration features
  can_add_collaborators BOOLEAN DEFAULT false,
  max_collaborators_per_collection INTEGER DEFAULT 0,
  
  -- Attachment limits
  max_attachments INTEGER DEFAULT -1, -- -1 means unlimited
  max_attachment_size_mb INTEGER DEFAULT 10,
  
  -- Other features
  can_create_folders BOOLEAN DEFAULT true,
  can_export_data BOOLEAN DEFAULT false,
  priority_support BOOLEAN DEFAULT false,
  
  -- Metadata
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add subscription fields to users table
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50) NOT NULL DEFAULT 'basic',
ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP;

-- Insert default subscription plans
INSERT INTO subscription_plans (
  name, display_name, description, price, billing_interval,
  max_external_collections, max_regular_collections,
  can_add_collaborators, max_collaborators_per_collection,
  max_attachments, max_attachment_size_mb,
  can_create_folders, can_export_data, priority_support,
  sort_order
) VALUES 
(
  'basic', 'Basic', 'Perfect for getting started with basic collection management',
  0.00, 'monthly',
  5, -1, -- 5 external collections, unlimited regular collections
  false, 0, -- no collaborators
  25, 10, -- 25 attachments, 10MB max size
  true, false, false, -- can create folders, no export, no priority support
  1
),
(
  'premium', 'Premium', 'Enhanced features with unlimited collections',
  9.99, 'monthly',
  -1, -1, -- unlimited collections
  false, 0, -- no collaborators
  -1, 50, -- unlimited attachments, 50MB max size
  true, true, false, -- can create folders, can export, no priority support
  2
),
(
  'professional', 'Professional', 'Advanced collaboration features for teams',
  19.99, 'monthly',
  -1, -1, -- unlimited collections
  true, 10, -- can add collaborators, max 10 per collection
  -1, 100, -- unlimited attachments, 100MB max size
  true, true, true, -- can create folders, can export, priority support
  3
),
(
  'enterprise', 'Enterprise', 'Full-featured plan for large organizations',
  49.99, 'monthly',
  -1, -1, -- unlimited collections
  true, -1, -- can add collaborators, unlimited per collection
  -1, 500, -- unlimited attachments, 500MB max size
  true, true, true, -- can create folders, can export, priority support
  4
)
ON CONFLICT (name) DO NOTHING;

-- Create index on subscription_plan for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_subscription_plan ON users(subscription_plan);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_name ON subscription_plans(name);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_active_sort ON subscription_plans(is_active, sort_order);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMP,
ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP;
