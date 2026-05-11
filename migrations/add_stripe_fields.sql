-- Add Stripe fields to subscription_plans table
ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS stripe_product_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(100);

-- Add Stripe fields to users table  
ALTER TABLE users
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(100);

-- Create indexes for Stripe fields
CREATE INDEX IF NOT EXISTS idx_subscription_plans_stripe_product ON subscription_plans(stripe_product_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_stripe_price ON subscription_plans(stripe_price_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription_id); 