-- Add phone number field to users table for SMS integration
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);

-- Create index for phone number lookups
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);

-- Add comment
COMMENT ON COLUMN users.phone_number IS 'User phone number for SMS notifications and commands';
