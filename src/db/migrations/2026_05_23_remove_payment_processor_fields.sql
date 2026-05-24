DROP INDEX IF EXISTS idx_users_stripe_customer;
DROP INDEX IF EXISTS idx_users_stripe_subscription;
DROP INDEX IF EXISTS idx_subscription_plans_stripe_product;
DROP INDEX IF EXISTS idx_subscription_plans_stripe_price;

ALTER TABLE users
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;

ALTER TABLE subscription_plans
  DROP COLUMN IF EXISTS stripe_product_id,
  DROP COLUMN IF EXISTS stripe_price_id;

ALTER TABLE credit_transactions
  DROP COLUMN IF EXISTS stripe_transaction_id,
  DROP COLUMN IF EXISTS receipt_url,
  DROP COLUMN IF EXISTS payment_status,
  DROP COLUMN IF EXISTS payment_amount;
