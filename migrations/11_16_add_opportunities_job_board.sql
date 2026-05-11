-- Create opportunities table
CREATE TABLE IF NOT EXISTS opportunities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    requirements TEXT,
    responsibilities TEXT,

    -- Opportunity type and compensation
    is_volunteer BOOLEAN DEFAULT true NOT NULL,
    compensation_type VARCHAR(50), -- 'paid', 'travel_reimbursement', 'stipend', null
    compensation_amount DECIMAL(10, 2),
    compensation_currency VARCHAR(3) DEFAULT 'USD',

    -- Time commitment
    time_commitment VARCHAR(100),
    frequency VARCHAR(50), -- 'once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'as_needed'
    estimated_hours INTEGER,
    duration VARCHAR(100),

    -- Availability and location
    spots_available INTEGER DEFAULT 1 NOT NULL,
    spots_filled INTEGER DEFAULT 0 NOT NULL,
    is_remote BOOLEAN DEFAULT true,
    location TEXT,

    -- Dates
    application_deadline TIMESTAMPTZ,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,

    -- Status and visibility
    status VARCHAR(50) DEFAULT 'draft' NOT NULL, -- 'draft', 'active', 'filled', 'closed', 'completed'
    visibility VARCHAR(50) DEFAULT 'private' NOT NULL,

    -- Skills and tags
    required_skills JSONB,
    preferred_skills JSONB,

    -- Contact and application
    contact_email VARCHAR(255),
    application_url TEXT,
    application_instructions TEXT,

    -- Metadata
    created_by_user_id UUID NOT NULL REFERENCES users(id),
    tenant_id UUID REFERENCES tenants(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Vector embeddings for search
    name_embedding vector(1536),
    description_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at TIMESTAMP
);

-- Create organization_opportunities junction table
CREATE TABLE IF NOT EXISTS organization_opportunities (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    PRIMARY KEY (organization_id, opportunity_id)
);

-- Create opportunity_applications table
CREATE TABLE IF NOT EXISTS opportunity_applications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'pending' NOT NULL, -- 'pending', 'reviewing', 'approved', 'rejected', 'withdrawn'

    -- Application details
    cover_letter TEXT,
    resume_url TEXT,
    additional_info JSONB,

    -- Tracking
    applied_at TIMESTAMP DEFAULT NOW(),
    reviewed_at TIMESTAMP,
    reviewed_by_user_id UUID REFERENCES users(id),
    review_notes TEXT,

    -- Assignment details (if approved)
    assigned_at TIMESTAMP,
    completed_at TIMESTAMP,
    completion_notes TEXT,
    hours_completed INTEGER,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure one application per user per opportunity
    UNIQUE(opportunity_id, user_id)
);

-- Create opportunity_messages table for chat
CREATE TABLE IF NOT EXISTS opportunity_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    application_id UUID REFERENCES opportunity_applications(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id),
    recipient_id UUID REFERENCES users(id),

    message TEXT NOT NULL,
    attachments JSONB,

    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create opportunity_tags junction table
CREATE TABLE IF NOT EXISTS opportunity_tags (
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (opportunity_id, tag_id)
);

-- Create user_saved_opportunities table for bookmarking
CREATE TABLE IF NOT EXISTS user_saved_opportunities (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    saved_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, opportunity_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
CREATE INDEX IF NOT EXISTS idx_opportunities_tenant_id ON opportunities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_by_user_id ON opportunities(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_visibility ON opportunities(visibility);
CREATE INDEX IF NOT EXISTS idx_opportunities_is_volunteer ON opportunities(is_volunteer);
CREATE INDEX IF NOT EXISTS idx_opportunities_is_remote ON opportunities(is_remote);
CREATE INDEX IF NOT EXISTS idx_opportunities_application_deadline ON opportunities(application_deadline);
CREATE INDEX IF NOT EXISTS idx_opportunities_start_date ON opportunities(start_date);

CREATE INDEX IF NOT EXISTS idx_opportunity_applications_opportunity_id ON opportunity_applications(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_applications_user_id ON opportunity_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_applications_status ON opportunity_applications(status);

CREATE INDEX IF NOT EXISTS idx_opportunity_messages_opportunity_id ON opportunity_messages(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_messages_application_id ON opportunity_messages(application_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_messages_sender_id ON opportunity_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_messages_recipient_id ON opportunity_messages(recipient_id);

-- Vector search indexes (if pgvector is enabled)
CREATE INDEX IF NOT EXISTS idx_opportunities_name_embedding ON opportunities USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_opportunities_description_embedding ON opportunities USING ivfflat (description_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_opportunities_combined_embedding ON opportunities USING ivfflat (combined_embedding vector_cosine_ops) WITH (lists = 100);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_opportunity_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_opportunities_updated_at
    BEFORE UPDATE ON opportunities
    FOR EACH ROW
    EXECUTE FUNCTION update_opportunity_updated_at();

CREATE TRIGGER update_opportunity_applications_updated_at
    BEFORE UPDATE ON opportunity_applications
    FOR EACH ROW
    EXECUTE FUNCTION update_opportunity_updated_at();

CREATE TRIGGER update_opportunity_messages_updated_at
    BEFORE UPDATE ON opportunity_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_opportunity_updated_at();

-- Add helpful comments
COMMENT ON TABLE opportunities IS 'Job board opportunities including volunteer and paid positions';
COMMENT ON TABLE opportunity_applications IS 'Applications submitted by users for opportunities';
COMMENT ON TABLE opportunity_messages IS 'Messages between advocates and applicants about opportunities';
COMMENT ON TABLE user_saved_opportunities IS 'Bookmarked/saved opportunities for users';