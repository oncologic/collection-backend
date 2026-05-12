-- Baseline schema snapshot from the current production DDL.
--
-- Notes:
-- - pgvector objects such as vector/halfvec/sparsevec functions, operators,
--   operator classes, and access methods are owned by the extension and must
--   not be hand-created from an IDE-generated DDL dump.
-- - This file is intended to make a fresh database structurally usable at the
--   current application schema level. Existing data is not seeded here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sensitivity_levels (
    id serial PRIMARY KEY,
    name varchar(136),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expertise_levels (
    id serial PRIMARY KEY,
    name varchar(136),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    first_name varchar(136),
    last_name varchar(136),
    email varchar(136),
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    clerk_user_id varchar(255),
    user_role varchar(50),
    cancer_type varchar(100),
    year_of_birth integer,
    designation varchar(100),
    prompt_context text,
    include_updated_since boolean,
    subscription_plan varchar(50) DEFAULT 'basic'::varchar NOT NULL,
    subscription_status varchar(20) DEFAULT 'active'::varchar NOT NULL,
    subscription_start_date timestamp DEFAULT now(),
    subscription_end_date timestamp,
    stripe_customer_id varchar(100),
    stripe_subscription_id varchar(100),
    has_onboarded boolean DEFAULT false NOT NULL,
    phone_number varchar(20),
    superuser boolean DEFAULT false NOT NULL
);

COMMENT ON COLUMN users.phone_number IS 'User phone number for SMS notifications and commands';
COMMENT ON COLUMN users.superuser IS 'Database-managed privilege flag. Only set manually at the database level; never writable through public API update calls.';

CREATE TABLE IF NOT EXISTS survey_types (
    id serial PRIMARY KEY,
    name varchar(136),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    question text NOT NULL,
    report_header varchar(50),
    question_type varchar(136) NOT NULL,
    question_options jsonb,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_types (
    id serial PRIMARY KEY,
    name varchar(136),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_type_map (
    user_id uuid NOT NULL REFERENCES users,
    user_type_id integer NOT NULL REFERENCES user_types,
    PRIMARY KEY (user_id, user_type_id)
);

CREATE TABLE IF NOT EXISTS sponsorship_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136),
    description text,
    highlight boolean DEFAULT false,
    image_key text,
    image_url text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    price numeric(10, 2),
    order_position integer,
    type varchar(25)
);

CREATE TABLE IF NOT EXISTS sponsorship_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136),
    description text,
    link text,
    image_key text,
    image_url text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    type varchar(25)
);

CREATE TABLE IF NOT EXISTS credit_transactions (
    id serial PRIMARY KEY,
    user_id uuid REFERENCES users,
    transaction_type varchar(50) NOT NULL,
    amount integer NOT NULL,
    reference_id integer,
    description text,
    stripe_transaction_id varchar(255),
    created_at timestamp with time zone DEFAULT now(),
    receipt_url text,
    payment_status varchar(50),
    payment_amount integer,
    currency varchar(3) DEFAULT 'usd'::varchar
);

CREATE TABLE IF NOT EXISTS reviewers (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    first_name varchar(255) NOT NULL,
    last_name varchar(255) NOT NULL,
    email varchar(255) NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(255) NOT NULL,
    domain varchar(255),
    settings jsonb,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    access varchar(255) DEFAULT 'private'::varchar
);

COMMENT ON COLUMN tenants.settings IS 'JSONB field storing tenant configuration. publicAccess.resources and publicAccess.events control public visibility. true = public access allowed, false = requires authentication.';
COMMENT ON COLUMN tenants.access IS 'Tenant access mode. private = authenticated-only; public = can expose resources/events when settings.publicAccess allows it.';

CREATE TABLE IF NOT EXISTS event_types (
    id serial PRIMARY KEY,
    name varchar(136),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid REFERENCES tenants,
    added_by_user_id uuid REFERENCES users,
    visibility varchar(20) DEFAULT 'private'::varchar,
    CONSTRAINT event_types_visibility_check CHECK (visibility::text = ANY (ARRAY['private', 'tenant', 'public']))
);

CREATE TABLE IF NOT EXISTS tags (
    id serial PRIMARY KEY,
    name varchar(136),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid REFERENCES tenants,
    added_by_user_id uuid REFERENCES users,
    visibility varchar(20) DEFAULT 'private'::varchar,
    color varchar(7),
    CONSTRAINT tags_visibility_check CHECK (visibility::text = ANY (ARRAY['private', 'tenant', 'public']))
);

CREATE TABLE IF NOT EXISTS target_audiences (
    id serial PRIMARY KEY,
    name varchar(136),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid REFERENCES tenants
);

CREATE TABLE IF NOT EXISTS organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136),
    acronym varchar(136),
    description text,
    website text,
    email varchar(136),
    phone varchar(136),
    address text,
    city varchar(136),
    state char(2),
    postal varchar(136),
    country char(3),
    category varchar(136),
    image_url text,
    image_key text,
    primary_contact_name varchar(136),
    primary_contact_email varchar(136),
    primary_contact_phone varchar(136),
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    clerk_organization_id varchar(255),
    industry boolean DEFAULT false,
    professional boolean DEFAULT false,
    tenant_id uuid REFERENCES tenants,
    user_id uuid REFERENCES users,
    name_embedding vector(1536),
    description_embedding vector(1536),
    category_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at timestamp
);

CREATE TABLE IF NOT EXISTS events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    title varchar(136),
    description text,
    registration_link text,
    require_registration boolean DEFAULT false,
    virtual_event boolean DEFAULT false,
    in_person_event boolean DEFAULT false,
    type_id integer NOT NULL REFERENCES event_types,
    target_audience_id integer REFERENCES target_audiences,
    sensitivity_level_id integer REFERENCES sensitivity_levels,
    expertise_level_id integer REFERENCES expertise_levels,
    video_url text,
    video_key text,
    video_metadata jsonb,
    image_url text,
    image_key text,
    image_metadata jsonb,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    contact_name varchar(136),
    contact_email varchar(136),
    contact_phone varchar(136),
    contact_address text,
    contact_city varchar(136),
    contact_state char(2),
    contact_postal varchar(136),
    contact_country char(3),
    added_by_user_id uuid NOT NULL REFERENCES users,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    location_name text,
    location_address text,
    location_city varchar(136),
    location_state char(2),
    location_postal varchar(136),
    location_country char(3),
    timezone text DEFAULT 'America/Chicago'::text,
    has_sponsorship boolean DEFAULT false,
    visibility varchar(50) DEFAULT 'public'::varchar NOT NULL,
    tenant_id uuid REFERENCES tenants,
    professional boolean DEFAULT false,
    is_google_calendar_event boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS resource_types (
    id serial PRIMARY KEY,
    name varchar(136),
    description text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid REFERENCES tenants,
    added_by_user_id uuid,
    visibility varchar(20) DEFAULT 'tenant'::varchar
);

CREATE TABLE IF NOT EXISTS resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    type_id integer NOT NULL REFERENCES resource_types,
    url text,
    description text,
    resource_date date,
    sensitivity_level_id integer REFERENCES sensitivity_levels,
    expertise_level_id integer REFERENCES expertise_levels,
    target_audience_id integer REFERENCES target_audiences,
    video_url text,
    video_key text,
    video_metadata jsonb,
    image_key text,
    image_metadata jsonb,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    name text,
    button_name varchar(255),
    requires_registration boolean,
    resource_updated_date date,
    added_by_user_id uuid DEFAULT '15c0a878-d199-4c95-8cef-e9597ada1b29'::uuid NOT NULL REFERENCES users,
    featured boolean DEFAULT false,
    list_order integer,
    timestamps text,
    full_text text,
    tenant_id uuid REFERENCES tenants,
    name_embedding vector(1536),
    description_embedding vector(1536),
    full_text_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at timestamp,
    timestamps_embedding vector(1536),
    status varchar(50) DEFAULT 'approved'::varchar NOT NULL,
    suggested_by_email varchar(255),
    CONSTRAINT chk_resource_status CHECK (status::text = ANY (ARRAY['pending', 'approved', 'rejected']))
);

CREATE TABLE IF NOT EXISTS resource_tags (
    resource_id uuid NOT NULL REFERENCES resources,
    tag_id integer NOT NULL REFERENCES tags,
    PRIMARY KEY (resource_id, tag_id)
);

CREATE TABLE IF NOT EXISTS event_tags (
    event_id uuid NOT NULL REFERENCES events,
    tag_id integer NOT NULL REFERENCES tags,
    PRIMARY KEY (event_id, tag_id)
);

CREATE TABLE IF NOT EXISTS organization_members (
    user_id uuid NOT NULL CONSTRAINT user_organizations_user_id_fkey REFERENCES users,
    organization_id uuid NOT NULL CONSTRAINT user_organizations_organization_id_fkey REFERENCES organizations,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    role varchar(136),
    CONSTRAINT user_organizations_pkey PRIMARY KEY (user_id, organization_id)
);

CREATE TABLE IF NOT EXISTS organization_events (
    organization_id uuid NOT NULL REFERENCES organizations,
    event_id uuid NOT NULL REFERENCES events,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    "primary" boolean DEFAULT false,
    PRIMARY KEY (organization_id, event_id)
);

CREATE TABLE IF NOT EXISTS organization_resources (
    organization_id uuid NOT NULL REFERENCES organizations,
    resource_id uuid NOT NULL REFERENCES resources,
    PRIMARY KEY (organization_id, resource_id)
);

CREATE TABLE IF NOT EXISTS event_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES events,
    approved_by_user_id uuid NOT NULL REFERENCES users,
    approved_by_organization_id uuid NOT NULL REFERENCES organizations,
    approval_status varchar(136),
    approval_notes text,
    approved_at timestamp DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES events,
    rating integer,
    rating_notes text,
    rating_by_user_id uuid NOT NULL REFERENCES users,
    rating_type varchar(136),
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS resource_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    resource_id uuid NOT NULL REFERENCES resources,
    rating integer,
    rating_notes text,
    rating_by_user_id uuid NOT NULL REFERENCES users,
    rating_type varchar(136),
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_resources (
    event_id uuid NOT NULL REFERENCES events,
    resource_id uuid NOT NULL REFERENCES resources,
    PRIMARY KEY (event_id, resource_id)
);

CREATE TABLE IF NOT EXISTS fundraisers (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES events,
    name varchar(136),
    description text,
    url text,
    status varchar(136),
    start_date date,
    end_date date,
    goal integer,
    amount_raised integer,
    match_amount integer,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS surveys (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136),
    description text,
    open_date timestamp with time zone,
    close_date timestamp with time zone,
    survey_type_id integer NOT NULL REFERENCES survey_types,
    published boolean DEFAULT false,
    created_by_user_id uuid NOT NULL REFERENCES users,
    published_by_user_id uuid REFERENCES users,
    last_updated_by_user_id uuid NOT NULL REFERENCES users,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    link text,
    tenant_id uuid REFERENCES tenants
);

CREATE TABLE IF NOT EXISTS organization_surveys (
    organization_id uuid NOT NULL REFERENCES organizations,
    survey_id uuid NOT NULL REFERENCES surveys,
    PRIMARY KEY (organization_id, survey_id)
);

CREATE TABLE IF NOT EXISTS organization_tags (
    organization_id uuid NOT NULL REFERENCES organizations,
    tag_id integer NOT NULL REFERENCES tags,
    PRIMARY KEY (organization_id, tag_id)
);

CREATE TABLE IF NOT EXISTS survey_questions_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    survey_id uuid NOT NULL REFERENCES surveys ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
    position integer,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (survey_id, question_id)
);

CREATE TABLE IF NOT EXISTS survey_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    survey_id uuid NOT NULL REFERENCES surveys ON DELETE CASCADE,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    user_id uuid REFERENCES users
);

CREATE TABLE IF NOT EXISTS survey_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    response_id uuid NOT NULL REFERENCES survey_responses ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES questions ON DELETE CASCADE,
    answer text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_response_question UNIQUE (response_id, question_id)
);

CREATE TABLE IF NOT EXISTS survey_answers_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    response_id uuid NOT NULL REFERENCES survey_responses,
    question_id uuid NOT NULL REFERENCES questions,
    old_answer text,
    new_answer text,
    changed_by uuid NOT NULL REFERENCES users,
    change_type text NOT NULL,
    changed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT survey_answers_audit_change_type_check CHECK (change_type = ANY (ARRAY['INSERT'::text, 'UPDATE'::text]))
);

CREATE TABLE IF NOT EXISTS survey_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    survey_id uuid NOT NULL REFERENCES surveys,
    updated_by_user_id uuid NOT NULL REFERENCES users,
    description text,
    has_link boolean DEFAULT false,
    link_url text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collections (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136),
    description text,
    user_id uuid REFERENCES users,
    organization_id uuid REFERENCES organizations,
    visibility varchar(50) DEFAULT 'private'::varchar NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    color varchar(136),
    type varchar(25),
    event_id uuid REFERENCES events,
    icon varchar(136),
    pinned boolean DEFAULT false,
    status varchar(50),
    tenant_id uuid REFERENCES tenants,
    hashtags text,
    public_json_enabled boolean DEFAULT false NOT NULL,
    name_embedding vector(1536),
    description_embedding vector(1536),
    hashtags_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at timestamp,
    start_date date,
    end_date date
);

COMMENT ON COLUMN collections.public_json_enabled IS 'When true, allows public JSON API access to this collection and its non-private external links';
COMMENT ON COLUMN collections.start_date IS 'Start date for collection calendar display';
COMMENT ON COLUMN collections.end_date IS 'End date for collection calendar display';

CREATE TABLE IF NOT EXISTS collection_resources (
    collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
    resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
    order_position integer,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    user_added_by_id uuid REFERENCES users,
    organization_added_by_id uuid REFERENCES organizations,
    notes text,
    status varchar(50),
    PRIMARY KEY (collection_id, resource_id)
);

CREATE TABLE IF NOT EXISTS collection_bookmarks (
    collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
    user_id uuid REFERENCES users,
    organization_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_bookmark_owner CHECK (((organization_id IS NOT NULL) AND (user_id IS NULL)) OR ((user_id IS NOT NULL) AND (organization_id IS NULL)))
);

CREATE TABLE IF NOT EXISTS sponsorship_features (
    sponsorship_tier_id uuid NOT NULL REFERENCES sponsorship_tiers ON DELETE CASCADE,
    sponsorship_item_id uuid NOT NULL REFERENCES sponsorship_items ON DELETE CASCADE,
    order_position integer,
    qty integer,
    organization_added_by_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    event_id uuid NOT NULL REFERENCES events ON DELETE CASCADE,
    PRIMARY KEY (sponsorship_tier_id, sponsorship_item_id, event_id),
    CONSTRAINT sponsorship_features_tier_item_event_unique UNIQUE (sponsorship_tier_id, sponsorship_item_id, event_id)
);

CREATE TABLE IF NOT EXISTS collection_sponsorship_tiers (
    collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
    sponsorship_tier_id uuid NOT NULL REFERENCES sponsorship_tiers ON DELETE CASCADE,
    order_position integer,
    user_added_by_id uuid REFERENCES users,
    organization_added_by_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    metadata jsonb,
    PRIMARY KEY (collection_id, sponsorship_tier_id)
);

CREATE TABLE IF NOT EXISTS event_sponsorship_tiers (
    event_id uuid NOT NULL REFERENCES events ON DELETE CASCADE,
    sponsorship_tier_id uuid NOT NULL REFERENCES sponsorship_tiers ON DELETE CASCADE,
    order_position integer,
    user_added_by_id uuid REFERENCES users,
    organization_added_by_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, sponsorship_tier_id)
);

CREATE TABLE IF NOT EXISTS event_collections (
    event_id uuid NOT NULL REFERENCES events ON DELETE CASCADE,
    collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
    order_position integer,
    user_added_by_id uuid REFERENCES users,
    organization_added_by_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_id, collection_id)
);

CREATE TABLE IF NOT EXISTS external_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    url text,
    name text,
    description text,
    notes text,
    date_added date,
    added_by_user_id uuid REFERENCES users,
    visibility varchar(50) DEFAULT 'private'::varchar NOT NULL,
    type varchar(50) DEFAULT 'link'::varchar NOT NULL,
    image_key text,
    image_metadata jsonb,
    image_url text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    timestamps text,
    full_text text,
    tenant_id uuid REFERENCES tenants,
    start_time time,
    end_time time,
    timezone varchar(100),
    public_json_enabled boolean DEFAULT false NOT NULL,
    name_embedding vector(1536),
    description_embedding vector(1536),
    notes_embedding vector(1536),
    full_text_embedding vector(1536),
    timestamps_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at timestamp,
    is_google_calendar_event boolean DEFAULT false,
    hashtags text,
    allow_public_notations boolean DEFAULT false,
    whiteboard_data jsonb
);

COMMENT ON COLUMN external_links.public_json_enabled IS 'When true, allows public JSON API access to this external link when visibility is not private';
COMMENT ON COLUMN external_links.hashtags IS 'Comma-separated list of hashtags for social media tracking';
COMMENT ON COLUMN external_links.allow_public_notations IS 'When true, allows public users to submit notations via public forms/templates for this external link';
COMMENT ON COLUMN external_links.whiteboard_data IS 'Persisted Excalidraw scene data for the external link whiteboard';

CREATE TABLE IF NOT EXISTS collection_external_links (
    collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
    external_link_id uuid NOT NULL REFERENCES external_links ON DELETE CASCADE,
    user_id uuid REFERENCES users,
    organization_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    notes text,
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    status varchar(50),
    event_id uuid REFERENCES events,
    date date,
    sort_order integer,
    start_date date,
    end_date date,
    CONSTRAINT collection_external_links_collection_link_unique UNIQUE (collection_id, external_link_id)
);

COMMENT ON COLUMN collection_external_links.sort_order IS 'Custom sort order for external links within their collection';
COMMENT ON COLUMN collection_external_links.start_date IS 'Start date for collection-specific external link calendar display';
COMMENT ON COLUMN collection_external_links.end_date IS 'End date for collection-specific external link calendar display';

CREATE TABLE IF NOT EXISTS attachments (
    id uuid NOT NULL PRIMARY KEY,
    title varchar,
    description varchar(500),
    type varchar(100),
    image_key varchar,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    list_order integer,
    visibility varchar(50) DEFAULT 'private'::varchar NOT NULL,
    user_id uuid REFERENCES users,
    tenant_id uuid REFERENCES tenants,
    title_embedding vector(1536),
    description_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at timestamp
);

CREATE TABLE IF NOT EXISTS external_link_attachments (
    external_link_id uuid NOT NULL REFERENCES external_links,
    attachment_id uuid NOT NULL REFERENCES attachments,
    highlighted boolean DEFAULT false,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (external_link_id, attachment_id)
);

CREATE TABLE IF NOT EXISTS shared_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    link_id uuid NOT NULL,
    link_type varchar(50) NOT NULL,
    created_by_user_id uuid NOT NULL REFERENCES users,
    created_by_organization_id uuid REFERENCES organizations,
    shared_with_email text,
    description text,
    expires_at timestamp,
    requires_code boolean DEFAULT false,
    code text,
    is_active boolean DEFAULT true,
    view_count integer DEFAULT 0,
    last_viewed_at timestamp,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    access_token text,
    tenant_id uuid REFERENCES tenants
);

CREATE TABLE IF NOT EXISTS shared_link_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    shared_link_id uuid REFERENCES shared_links,
    type varchar(50) NOT NULL,
    item_id uuid,
    metadata jsonb NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    user_id uuid REFERENCES users,
    reviewer_id uuid REFERENCES reviewers
);

CREATE TABLE IF NOT EXISTS shared_link_approved_users (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    shared_link_id uuid REFERENCES shared_links,
    user_id uuid REFERENCES users,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS folders (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136) NOT NULL,
    description text,
    user_id uuid REFERENCES users,
    organization_id uuid REFERENCES organizations,
    visibility varchar(50) DEFAULT 'private'::varchar NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid REFERENCES tenants,
    CONSTRAINT folders_visibility_check CHECK (visibility::text = ANY (ARRAY['private', 'public', 'verified']))
);

CREATE TABLE IF NOT EXISTS folder_collections (
    folder_id uuid NOT NULL REFERENCES folders ON DELETE CASCADE,
    collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
    order_position integer,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (folder_id, collection_id)
);

CREATE TABLE IF NOT EXISTS collection_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    collection_id uuid NOT NULL REFERENCES collections,
    event_id uuid NOT NULL REFERENCES events,
    user_id uuid REFERENCES users,
    status varchar(50),
    organization_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users,
    event_id uuid NOT NULL REFERENCES events,
    status varchar(50),
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users,
    resource_id uuid NOT NULL REFERENCES resources,
    status varchar(50),
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136) NOT NULL,
    description text,
    verified boolean DEFAULT false,
    license_number text,
    license_state char(2),
    user_id uuid REFERENCES users,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    value varchar(100),
    tenant_id uuid REFERENCES tenants
);

CREATE TABLE IF NOT EXISTS link_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    date date,
    name varchar(136) NOT NULL,
    description text,
    url text,
    category varchar(136) NOT NULL,
    linking_id uuid,
    linking_type varchar(136) NOT NULL,
    visibility varchar(50) DEFAULT 'private'::varchar NOT NULL,
    user_id uuid REFERENCES users,
    organization_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    tenant_id uuid REFERENCES tenants,
    name_embedding vector(1536),
    description_embedding vector(1536),
    category_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at timestamp
);

CREATE TABLE IF NOT EXISTS starter_packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136) NOT NULL,
    description text,
    type varchar(136) NOT NULL,
    user_id uuid REFERENCES users,
    organization_id uuid REFERENCES organizations,
    items jsonb,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    "limit" integer,
    tenant_id uuid REFERENCES tenants
);

CREATE TABLE IF NOT EXISTS users_tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users,
    tenant_id uuid NOT NULL REFERENCES tenants,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pinned_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    item_id uuid NOT NULL,
    item_type varchar(50) NOT NULL,
    order_position integer NOT NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS social_media_platforms (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(100) NOT NULL,
    icon varchar(100) NOT NULL,
    url_pattern varchar(255),
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    tenant_id uuid REFERENCES tenants
);

CREATE TABLE IF NOT EXISTS collection_collaborators (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
    user_id uuid REFERENCES users,
    organization_id uuid REFERENCES organizations,
    role varchar(50) DEFAULT 'editor'::varchar,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    can_add_resources boolean DEFAULT true,
    can_add_links boolean DEFAULT true,
    can_add_notes boolean DEFAULT true,
    can_add_attachments boolean DEFAULT true,
    can_manage_collaborators boolean DEFAULT false,
    created_by_user_id uuid REFERENCES users
);

COMMENT ON COLUMN collection_collaborators.can_add_resources IS 'Whether the collaborator can add resources to the collection';
COMMENT ON COLUMN collection_collaborators.can_add_links IS 'Whether the collaborator can add external links to the collection';
COMMENT ON COLUMN collection_collaborators.can_add_notes IS 'Whether the collaborator can add notes to items in the collection';
COMMENT ON COLUMN collection_collaborators.can_add_attachments IS 'Whether the collaborator can add attachments to items in the collection';
COMMENT ON COLUMN collection_collaborators.can_manage_collaborators IS 'Whether the collaborator can invite/remove other collaborators';
COMMENT ON COLUMN collection_collaborators.created_by_user_id IS 'User who added this collaborator';

CREATE TABLE IF NOT EXISTS collection_external_links_collaborators (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    collection_external_link_id uuid NOT NULL CONSTRAINT collection_external_links_coll_collection_external_link_id_fkey REFERENCES collection_external_links ON DELETE CASCADE,
    user_id uuid REFERENCES users,
    organization_id uuid REFERENCES organizations,
    role varchar(50) DEFAULT 'editor'::varchar,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscription_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(50) NOT NULL UNIQUE,
    display_name varchar(100) NOT NULL,
    description text,
    price numeric(10, 2) NOT NULL,
    billing_interval varchar(20) DEFAULT 'monthly'::varchar NOT NULL,
    max_external_collections integer DEFAULT '-1'::integer,
    max_regular_collections integer DEFAULT '-1'::integer,
    can_add_collaborators boolean DEFAULT false,
    max_collaborators_per_collection integer DEFAULT 0,
    max_attachments integer DEFAULT '-1'::integer,
    max_attachment_size_mb integer DEFAULT 10,
    can_create_folders boolean DEFAULT true,
    can_export_data boolean DEFAULT false,
    priority_support boolean DEFAULT false,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    stripe_product_id varchar(100),
    stripe_price_id varchar(100)
);

CREATE TABLE IF NOT EXISTS pending_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    email varchar(255) NOT NULL,
    invitee_name varchar(255),
    inviter_user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    collection_id uuid REFERENCES collections ON DELETE CASCADE,
    collection_external_link_id uuid REFERENCES collection_external_links ON DELETE CASCADE,
    role varchar(50) DEFAULT 'editor'::varchar NOT NULL,
    message text,
    invite_token varchar(255) NOT NULL UNIQUE,
    status varchar(50) DEFAULT 'pending'::varchar NOT NULL,
    expires_at timestamp NOT NULL,
    accepted_at timestamp,
    accepted_by_user_id uuid REFERENCES users ON DELETE SET NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    metadata jsonb,
    CONSTRAINT chk_invitation_role CHECK (role::text = ANY (ARRAY['editor', 'admin'])),
    CONSTRAINT chk_invitation_status CHECK (status::text = ANY (ARRAY['pending', 'accepted', 'expired'])),
    CONSTRAINT chk_invitation_expires_future CHECK (expires_at > created_at)
);

COMMENT ON COLUMN pending_invitations.metadata IS 'Additional metadata for the invitation, such as cascade settings for collection invitations';

CREATE TABLE IF NOT EXISTS collection_external_link_tag_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(136) NOT NULL,
    description text,
    color varchar(7),
    created_by_user_id uuid CONSTRAINT collection_external_link_tag_definition_created_by_user_id_fkey REFERENCES users ON DELETE SET NULL,
    tenant_id uuid REFERENCES tenants ON DELETE CASCADE,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE collection_external_link_tag_definitions IS 'Tag definitions specifically for collections and external links, separate from other tags';
COMMENT ON COLUMN collection_external_link_tag_definitions.color IS 'Hex color code for tag display (e.g., #FF5733)';

CREATE TABLE IF NOT EXISTS collection_external_link_tags (
    collection_external_link_id uuid NOT NULL REFERENCES collection_external_links ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES collection_external_link_tag_definitions ON DELETE CASCADE,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_external_link_id, tag_id)
);

COMMENT ON TABLE collection_external_link_tags IS 'Junction table linking collection external links to their tags';

CREATE TABLE IF NOT EXISTS collection_type_ordering (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
    type varchar(50) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

COMMENT ON TABLE collection_type_ordering IS 'Stores custom sort order for external link types within collections';

CREATE TABLE IF NOT EXISTS google_calendar_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE REFERENCES users,
    google_account_email varchar(255) NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    token_expires_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true,
    sync_enabled boolean DEFAULT true,
    primary_calendar_id varchar(255),
    selected_calendar_ids jsonb DEFAULT '[]'::jsonb,
    last_synced_at timestamp with time zone,
    sync_direction varchar(20) DEFAULT 'both'::varchar,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS google_calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    entity_type varchar(50) NOT NULL,
    entity_id uuid NOT NULL,
    google_event_id varchar(255) NOT NULL,
    google_calendar_id varchar(255) NOT NULL,
    integration_id uuid NOT NULL REFERENCES google_calendar_integrations,
    sync_status varchar(20) DEFAULT 'synced'::varchar,
    last_synced_at timestamp with time zone DEFAULT now(),
    google_event_data jsonb,
    sync_direction varchar(20) NOT NULL,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    UNIQUE (entity_type, entity_id, integration_id),
    CONSTRAINT unique_google_event_per_integration UNIQUE (google_event_id, integration_id, entity_type)
);

CREATE TABLE IF NOT EXISTS google_calendar_sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    integration_id uuid NOT NULL REFERENCES google_calendar_integrations,
    sync_type varchar(20) NOT NULL,
    status varchar(20) NOT NULL,
    events_processed jsonb DEFAULT '{"deleted": 0, "updated": 0, "exported": 0, "imported": 0}'::jsonb,
    errors jsonb DEFAULT '[]'::jsonb,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_merges (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    source_collection_id uuid NOT NULL,
    target_collection_id uuid NOT NULL REFERENCES collections,
    merge_type varchar(50) DEFAULT 'full'::varchar NOT NULL,
    source_deleted boolean DEFAULT false NOT NULL,
    merge_metadata jsonb,
    merged_by_user_id uuid REFERENCES users,
    merged_by_organization_id uuid REFERENCES organizations,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE collection_merges IS 'Tracks collection merge operations for audit trail';

CREATE TABLE IF NOT EXISTS collection_external_link_resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    collection_id uuid NOT NULL,
    external_link_id uuid NOT NULL,
    resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
    notes text,
    order_position integer DEFAULT 0,
    user_added_by_id uuid REFERENCES users ON DELETE SET NULL,
    organization_added_by_id uuid CONSTRAINT collection_external_link_resource_organization_added_by_id_fkey REFERENCES organizations ON DELETE SET NULL,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_collection_external_link_resource UNIQUE (collection_id, external_link_id, resource_id),
    CONSTRAINT collection_external_link_reso_collection_id_external_link__fkey FOREIGN KEY (collection_id, external_link_id) REFERENCES collection_external_links (collection_id, external_link_id) ON DELETE CASCADE
);

COMMENT ON TABLE collection_external_link_resources IS 'Junction table linking resources to specific external links within collections';
COMMENT ON COLUMN collection_external_link_resources.notes IS 'Optional notes about why this resource is relevant to this external link';
COMMENT ON COLUMN collection_external_link_resources.order_position IS 'Display order of resources for a given external link (lower numbers appear first)';
COMMENT ON COLUMN collection_external_link_resources.user_added_by_id IS 'User who added this resource to the external link';
COMMENT ON COLUMN collection_external_link_resources.organization_added_by_id IS 'Organization context when the resource was added';

CREATE TABLE IF NOT EXISTS social_media_account_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    name varchar(255) NOT NULL,
    description text,
    color varchar(7),
    icon varchar(50),
    visibility varchar(50) DEFAULT 'private'::varchar,
    added_by_user_id uuid REFERENCES users,
    tenant_id uuid REFERENCES tenants,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS social_media_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    platform_id uuid REFERENCES social_media_platforms ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    handle varchar(255),
    url varchar(1000) NOT NULL,
    description text,
    title varchar(255),
    organization_id uuid REFERENCES organizations ON DELETE SET NULL,
    user_id uuid REFERENCES users,
    visibility varchar(50) DEFAULT 'public'::varchar NOT NULL,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    tenant_id uuid REFERENCES tenants,
    account_type_id uuid REFERENCES social_media_account_types
);

CREATE TABLE IF NOT EXISTS social_media_associations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    social_media_account_id uuid NOT NULL REFERENCES social_media_accounts ON DELETE CASCADE,
    associated_id uuid NOT NULL,
    associated_type varchar(50) NOT NULL,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    tenant_id uuid REFERENCES tenants,
    CONSTRAINT check_associated_type CHECK (associated_type::text = ANY (ARRAY['organization', 'resource', 'collection', 'collection_external_link'])),
    CONSTRAINT social_media_associations_unique UNIQUE (social_media_account_id, associated_id, associated_type)
);

CREATE TABLE IF NOT EXISTS notation_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    collection_external_link_id uuid REFERENCES collection_external_links ON DELETE CASCADE,
    name varchar(255) NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    is_public_submission_template boolean DEFAULT false,
    created_by_user_id uuid REFERENCES users,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE notation_templates IS 'Stores notation templates that define the structure and fields for notations';
COMMENT ON COLUMN notation_templates.is_public_submission_template IS 'Whether this template can be used for public submissions from external sources';

CREATE TABLE IF NOT EXISTS collection_external_links_notations (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    collection_external_link_id uuid CONSTRAINT collection_external_links_nota_collection_external_link_id_fkey REFERENCES collection_external_links,
    title varchar,
    description varchar(500),
    notes text,
    category varchar(250),
    status varchar(250),
    highlighted boolean,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    list_order integer,
    visibility varchar(50) DEFAULT 'private'::varchar NOT NULL,
    user_id uuid REFERENCES users,
    date date,
    start_time time,
    end_time time,
    timezone varchar(100),
    type varchar(100),
    title_embedding vector(1536),
    description_embedding vector(1536),
    notes_embedding vector(1536),
    category_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at timestamp,
    is_google_calendar_event boolean DEFAULT false,
    template_id uuid REFERENCES notation_templates ON DELETE SET NULL,
    custom_fields jsonb DEFAULT '{}'::jsonb,
    submission_metadata jsonb DEFAULT '{}'::jsonb,
    is_template boolean DEFAULT false,
    draft_content text,
    last_auto_saved_at timestamp,
    is_draft boolean DEFAULT false,
    start_date date,
    end_date date
);

COMMENT ON COLUMN collection_external_links_notations.custom_fields IS 'JSON object storing custom field values as key-value pairs';
COMMENT ON COLUMN collection_external_links_notations.submission_metadata IS 'Additional metadata about how the notation was submitted';
COMMENT ON COLUMN collection_external_links_notations.is_template IS 'Boolean flag to mark a notation as a template';
COMMENT ON COLUMN collection_external_links_notations.draft_content IS 'Auto-saved draft version of the notation';
COMMENT ON COLUMN collection_external_links_notations.last_auto_saved_at IS 'Timestamp of last auto-save';
COMMENT ON COLUMN collection_external_links_notations.start_date IS 'Start date for notation calendar display';
COMMENT ON COLUMN collection_external_links_notations.end_date IS 'End date for notation calendar display';

CREATE TABLE IF NOT EXISTS collection_external_links_threads (
    id uuid NOT NULL PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users,
    collection_external_link_notation_id uuid NOT NULL CONSTRAINT collection_external_links_thr_collection_external_link_not_fkey REFERENCES collection_external_links_notations,
    visibility varchar(50) DEFAULT 'private'::varchar NOT NULL,
    comment text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collection_external_links_notation_tags (
    collection_external_link_notation_id uuid NOT NULL CONSTRAINT collection_external_links_not_collection_external_link_not_fkey REFERENCES collection_external_links_notations ON DELETE CASCADE,
    tag_id uuid NOT NULL REFERENCES collection_external_link_tag_definitions ON DELETE CASCADE,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_external_link_notation_id, tag_id)
);

CREATE TABLE IF NOT EXISTS notation_template_fields (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    template_id uuid REFERENCES notation_templates ON DELETE CASCADE,
    field_key varchar(255) NOT NULL,
    field_label varchar(255) NOT NULL,
    field_type varchar(50) NOT NULL,
    field_options jsonb,
    is_required boolean DEFAULT false,
    validation_rules jsonb,
    placeholder_text varchar(500),
    help_text text,
    display_order integer DEFAULT 0,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notation_template_fields_field_type_check CHECK (field_type::text = ANY (ARRAY['text', 'textarea', 'select', 'multiselect', 'date', 'number', 'boolean', 'url', 'email']))
);

COMMENT ON TABLE notation_template_fields IS 'Defines the custom fields for each notation template';
COMMENT ON COLUMN notation_template_fields.field_type IS 'Type of input field: text, textarea, select, multiselect, date, number, boolean, url, email';
COMMENT ON COLUMN notation_template_fields.field_options IS 'JSON array of options for select/multiselect fields';
COMMENT ON COLUMN notation_template_fields.validation_rules IS 'JSON object containing validation rules for the field';

CREATE TABLE IF NOT EXISTS external_notation_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    notation_id uuid UNIQUE REFERENCES collection_external_links_notations ON DELETE CASCADE,
    template_id uuid REFERENCES notation_templates,
    submitter_email varchar(255),
    submitter_name varchar(255),
    submission_source varchar(50) DEFAULT 'external'::varchar,
    submission_ip varchar(45),
    submission_user_agent text,
    submission_referrer text,
    approval_status varchar(50) DEFAULT 'pending'::varchar,
    reviewed_by_user_id uuid REFERENCES users,
    reviewed_at timestamp,
    review_notes text,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT external_notation_submissions_approval_status_check CHECK (approval_status::text = ANY (ARRAY['pending', 'approved', 'rejected']))
);

COMMENT ON TABLE external_notation_submissions IS 'Tracks external submissions of notations for auditing, approval workflow, and analytics';
COMMENT ON COLUMN external_notation_submissions.approval_status IS 'Approval status: pending (awaiting review), approved (visible), or rejected (hidden)';
COMMENT ON COLUMN external_notation_submissions.reviewed_by_user_id IS 'User who reviewed and approved/rejected the submission';
COMMENT ON COLUMN external_notation_submissions.reviewed_at IS 'Timestamp when the submission was reviewed';
COMMENT ON COLUMN external_notation_submissions.review_notes IS 'Optional notes from the reviewer about the approval decision';

CREATE TABLE IF NOT EXISTS notation_attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    notation_id uuid NOT NULL REFERENCES collection_external_links_notations ON DELETE CASCADE,
    attachment_id uuid NOT NULL REFERENCES attachments ON DELETE CASCADE,
    position integer,
    inline_metadata jsonb DEFAULT '{}'::jsonb,
    is_inline boolean DEFAULT true,
    ocr_text text,
    ocr_processed_at timestamp,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (notation_id, attachment_id)
);

COMMENT ON TABLE notation_attachments IS 'Links notations to their attachments, supporting inline images with OCR';
COMMENT ON COLUMN notation_attachments.position IS 'Order of attachment in the notation content';
COMMENT ON COLUMN notation_attachments.inline_metadata IS 'Stores display properties like width, height, alignment';
COMMENT ON COLUMN notation_attachments.ocr_text IS 'Extracted text from image OCR processing';

CREATE TABLE IF NOT EXISTS slack_workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
    team_id varchar(255) NOT NULL,
    team_name varchar(255),
    bot_user_id varchar(255),
    bot_access_token text NOT NULL,
    app_id varchar(255),
    scope text,
    is_active boolean DEFAULT true,
    default_channel_id varchar(255),
    default_channel_name varchar(255),
    notify_on_new_external_link boolean DEFAULT true,
    notify_on_new_notation boolean DEFAULT true,
    notify_on_new_collaborator boolean DEFAULT false,
    installed_by_user_id uuid REFERENCES users,
    installed_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    available_channels jsonb DEFAULT '[]'::jsonb,
    UNIQUE (team_id, tenant_id)
);

COMMENT ON TABLE slack_workspaces IS 'Stores Slack workspace integrations for each tenant';
COMMENT ON COLUMN slack_workspaces.bot_access_token IS 'Encrypted Slack bot token - must be encrypted in production';
COMMENT ON COLUMN slack_workspaces.available_channels IS 'Cached list of channels the bot can access';

CREATE TABLE IF NOT EXISTS slack_channel_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    slack_workspace_id uuid NOT NULL REFERENCES slack_workspaces ON DELETE CASCADE,
    collection_id uuid REFERENCES collections ON DELETE CASCADE,
    external_link_id uuid REFERENCES external_links ON DELETE CASCADE,
    channel_id varchar(255) NOT NULL,
    channel_name varchar(255),
    notify_on_new_external_link boolean DEFAULT true,
    notify_on_new_notation boolean DEFAULT true,
    notify_on_new_attachment boolean DEFAULT false,
    notify_on_status_change boolean DEFAULT false,
    custom_message_template jsonb,
    is_active boolean DEFAULT true,
    created_by_user_id uuid REFERENCES users,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    UNIQUE (collection_id, slack_workspace_id),
    UNIQUE (external_link_id, slack_workspace_id),
    CONSTRAINT slack_channel_configs_check CHECK ((collection_id IS NOT NULL) OR (external_link_id IS NOT NULL))
);

COMMENT ON TABLE slack_channel_configs IS 'Maps collections and external links to Slack channels for notifications';
COMMENT ON COLUMN slack_channel_configs.custom_message_template IS 'Optional custom formatting for notification messages';

CREATE TABLE IF NOT EXISTS slack_notification_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    slack_workspace_id uuid REFERENCES slack_workspaces ON DELETE SET NULL,
    channel_id varchar(255),
    event_type varchar(50) NOT NULL,
    entity_type varchar(50),
    entity_id uuid,
    message_ts varchar(255),
    message_content jsonb,
    success boolean DEFAULT true,
    error_message text,
    sent_at timestamp DEFAULT now(),
    sent_by_user_id uuid REFERENCES users
);

COMMENT ON TABLE slack_notification_logs IS 'Audit log of all Slack notifications sent';
COMMENT ON COLUMN slack_notification_logs.message_ts IS 'Slack message timestamp for threading/updates';

CREATE TABLE IF NOT EXISTS tenant_invites (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
    invite_token varchar(255) NOT NULL UNIQUE,
    created_by_user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    role varchar(50) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    max_uses varchar(50),
    use_count varchar(50) DEFAULT '0'::varchar,
    metadata jsonb,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    revoked_at timestamp
);

CREATE TABLE IF NOT EXISTS tenant_invite_uses (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    invite_id uuid NOT NULL REFERENCES tenant_invites ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    tenant_id uuid NOT NULL REFERENCES tenants ON DELETE CASCADE,
    created_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    title text NOT NULL,
    description text NOT NULL,
    requirements text,
    responsibilities text,
    is_volunteer boolean DEFAULT true NOT NULL,
    compensation_type varchar(50),
    compensation_amount numeric(10, 2),
    compensation_currency varchar(3) DEFAULT 'USD'::varchar,
    time_commitment varchar(100),
    frequency varchar(50),
    estimated_hours integer,
    duration varchar(100),
    spots_available integer DEFAULT 1 NOT NULL,
    spots_filled integer DEFAULT 0 NOT NULL,
    is_remote boolean DEFAULT true,
    location text,
    application_deadline timestamp with time zone,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    status varchar(50) DEFAULT 'draft'::varchar NOT NULL,
    visibility varchar(50) DEFAULT 'private'::varchar NOT NULL,
    required_skills jsonb,
    preferred_skills jsonb,
    contact_email varchar(255),
    application_url text,
    application_instructions text,
    created_by_user_id uuid NOT NULL REFERENCES users,
    tenant_id uuid REFERENCES tenants,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    name_embedding vector(1536),
    description_embedding vector(1536),
    combined_embedding vector(1536),
    vector_updated_at timestamp
);

COMMENT ON TABLE opportunities IS 'Job board opportunities including volunteer and paid positions';

CREATE TABLE IF NOT EXISTS organization_opportunities (
    organization_id uuid NOT NULL REFERENCES organizations ON DELETE CASCADE,
    opportunity_id uuid NOT NULL REFERENCES opportunities ON DELETE CASCADE,
    is_primary boolean DEFAULT false,
    PRIMARY KEY (organization_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS opportunity_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    opportunity_id uuid NOT NULL REFERENCES opportunities ON DELETE CASCADE,
    user_id uuid REFERENCES users,
    status varchar(50) DEFAULT 'pending'::varchar NOT NULL,
    cover_letter text,
    resume_url text,
    additional_info jsonb,
    applied_at timestamp DEFAULT now(),
    reviewed_at timestamp,
    reviewed_by_user_id uuid REFERENCES users,
    review_notes text,
    assigned_at timestamp,
    completed_at timestamp,
    completion_notes text,
    hours_completed integer,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now(),
    instructions text,
    instructions_link text,
    applicant_email varchar(255),
    applicant_name varchar(255),
    CONSTRAINT check_user_or_email CHECK ((user_id IS NOT NULL) OR (applicant_email IS NOT NULL))
);

COMMENT ON TABLE opportunity_applications IS 'Applications submitted by users for opportunities';
COMMENT ON COLUMN opportunity_applications.instructions IS 'Instructions or notes provided to the applicant when their application is approved';
COMMENT ON COLUMN opportunity_applications.instructions_link IS 'Link (URL) provided to the applicant with instructions when their application is approved';

CREATE TABLE IF NOT EXISTS opportunity_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    opportunity_id uuid NOT NULL REFERENCES opportunities ON DELETE CASCADE,
    application_id uuid REFERENCES opportunity_applications ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users,
    recipient_id uuid REFERENCES users,
    message text NOT NULL,
    attachments jsonb,
    is_read boolean DEFAULT false,
    read_at timestamp,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

COMMENT ON TABLE opportunity_messages IS 'Messages between advocates and applicants about opportunities';

CREATE TABLE IF NOT EXISTS opportunity_tags (
    opportunity_id uuid NOT NULL REFERENCES opportunities ON DELETE CASCADE,
    tag_id integer NOT NULL,
    PRIMARY KEY (opportunity_id, tag_id)
);

CREATE TABLE IF NOT EXISTS user_saved_opportunities (
    user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
    opportunity_id uuid NOT NULL REFERENCES opportunities ON DELETE CASCADE,
    saved_at timestamp DEFAULT now(),
    PRIMARY KEY (user_id, opportunity_id)
);

COMMENT ON TABLE user_saved_opportunities IS 'Bookmarked/saved opportunities for users';

CREATE TABLE IF NOT EXISTS resource_attachments (
    resource_id uuid NOT NULL REFERENCES resources ON DELETE CASCADE,
    attachment_id uuid NOT NULL REFERENCES attachments ON DELETE CASCADE,
    highlighted boolean DEFAULT false,
    sort_order integer DEFAULT 0,
    created_at timestamp DEFAULT now(),
    updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_attachments_resource_attachment_unique ON resource_attachments (resource_id, attachment_id);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_names ON users (last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_users_subscription_plan ON users (subscription_plan);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users (phone_number);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions (user_id);
CREATE INDEX IF NOT EXISTS idx_event_types_tenant_id ON event_types (tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_types_added_by_user_id ON event_types (added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_event_types_visibility ON event_types (visibility);
CREATE INDEX IF NOT EXISTS idx_tags_tenant ON tags (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tags_added_by_user_id ON tags (added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tags_visibility ON tags (visibility);
CREATE INDEX IF NOT EXISTS idx_target_audiences_tenant ON target_audiences (tenant_id);
CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations (name);
CREATE INDEX IF NOT EXISTS idx_organizations_category ON organizations (category);
CREATE INDEX IF NOT EXISTS idx_organizations_location ON organizations (state, city);
CREATE INDEX IF NOT EXISTS idx_organizations_text_search ON organizations USING gin (to_tsvector('english'::regconfig, (name::text || ' '::text) || COALESCE(description, ''::text)));
CREATE INDEX IF NOT EXISTS idx_organizations_tenant ON organizations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_organizations_user ON organizations (user_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type_id);
CREATE INDEX IF NOT EXISTS idx_events_added_by ON events (added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_events_sensitivity ON events (sensitivity_level_id);
CREATE INDEX IF NOT EXISTS idx_events_expertise ON events (expertise_level_id);
CREATE INDEX IF NOT EXISTS idx_events_text_search ON events USING gin (to_tsvector('english'::regconfig, (title::text || ' '::text) || COALESCE(description, ''::text)));
CREATE INDEX IF NOT EXISTS idx_events_dates ON events (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_events_type_dates ON events (type_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events (tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_tenant_date ON events (tenant_id, start_date);
CREATE INDEX IF NOT EXISTS idx_resource_types_tenant_id ON resource_types (tenant_id);
CREATE INDEX IF NOT EXISTS idx_resource_types_visibility ON resource_types (visibility);
CREATE INDEX IF NOT EXISTS idx_resource_types_added_by_user_id ON resource_types (added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_resource_types_tenant_name ON resource_types (tenant_id, lower(name::text));
CREATE INDEX IF NOT EXISTS idx_resources_type ON resources (type_id);
CREATE INDEX IF NOT EXISTS idx_resources_sensitivity ON resources (sensitivity_level_id);
CREATE INDEX IF NOT EXISTS idx_resources_expertise ON resources (expertise_level_id);
CREATE INDEX IF NOT EXISTS idx_resources_target ON resources (target_audience_id);
CREATE INDEX IF NOT EXISTS idx_resources_created_date ON resources (resource_date);
CREATE INDEX IF NOT EXISTS idx_resources_text_search ON resources USING gin (to_tsvector('english'::regconfig, COALESCE(description, ''::text)));
CREATE INDEX IF NOT EXISTS idx_resources_sensitivity_expertise ON resources (sensitivity_level_id, expertise_level_id);
CREATE INDEX IF NOT EXISTS idx_resources_timestamps ON resources (timestamps);
CREATE INDEX IF NOT EXISTS idx_resources_tenant ON resources (tenant_id);
CREATE INDEX IF NOT EXISTS idx_resources_tenant_type ON resources (tenant_id, type_id);
CREATE INDEX IF NOT EXISTS idx_resources_name_embedding_hnsw ON resources USING hnsw (name_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_resources_description_embedding_hnsw ON resources USING hnsw (description_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_resources_full_text_embedding_hnsw ON resources USING hnsw (full_text_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_resources_combined_embedding_hnsw ON resources USING hnsw (combined_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_resources_vector_updated_at ON resources (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_resources_timestamps_embedding_hnsw ON resources USING hnsw (timestamps_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources (status);
CREATE INDEX IF NOT EXISTS idx_resources_status_tenant ON resources (status, tenant_id);
CREATE INDEX IF NOT EXISTS idx_resources_suggested_by_email ON resources (suggested_by_email);
CREATE INDEX IF NOT EXISTS idx_resource_tags_tag ON resource_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_event_tags_tag ON event_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_event_ratings_event ON event_ratings (event_id, rating);
CREATE INDEX IF NOT EXISTS idx_resource_ratings_resource ON resource_ratings (resource_id, rating);
CREATE INDEX IF NOT EXISTS idx_fundraisers_event ON fundraisers (event_id);
CREATE INDEX IF NOT EXISTS idx_fundraisers_dates ON fundraisers (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_fundraisers_status ON fundraisers (status);
CREATE INDEX IF NOT EXISTS idx_surveys_published ON surveys (published);
CREATE INDEX IF NOT EXISTS idx_surveys_dates ON surveys (open_date, close_date);
CREATE INDEX IF NOT EXISTS idx_surveys_tenant ON surveys (tenant_id);
CREATE INDEX IF NOT EXISTS idx_survey_questions_map_survey ON survey_questions_map (survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_questions_map_question ON survey_questions_map (question_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses (survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_response ON survey_answers (response_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_question ON survey_answers (question_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_audit_response_id ON survey_answers_audit (response_id);
CREATE INDEX IF NOT EXISTS idx_survey_answers_audit_changed_at ON survey_answers_audit (changed_at);
CREATE INDEX IF NOT EXISTS idx_survey_answers_audit_changed_by ON survey_answers_audit (changed_by);
CREATE INDEX IF NOT EXISTS idx_collections_tenant ON collections (tenant_id);
CREATE INDEX IF NOT EXISTS idx_collections_tenant_visibility ON collections (tenant_id, visibility);
CREATE INDEX IF NOT EXISTS idx_collections_public_json_enabled ON collections (public_json_enabled) WHERE public_json_enabled = true;
CREATE INDEX IF NOT EXISTS idx_collections_name_embedding_hnsw ON collections USING hnsw (name_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_collections_description_embedding_hnsw ON collections USING hnsw (description_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_collections_hashtags_embedding_hnsw ON collections USING hnsw (hashtags_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_collections_combined_embedding_hnsw ON collections USING hnsw (combined_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_collections_vector_updated_at ON collections (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_collections_visibility_user ON collections (visibility, user_id);
CREATE INDEX IF NOT EXISTS idx_collections_start_end_date ON collections (start_date, end_date);
CREATE UNIQUE INDEX IF NOT EXISTS collection_bookmarks_user_idx ON collection_bookmarks (collection_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS collection_bookmarks_org_idx ON collection_bookmarks (collection_id, organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_collection_bookmarks_user ON collection_bookmarks (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_collection_bookmarks_org ON collection_bookmarks (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_links_timestamps ON external_links (timestamps);
CREATE INDEX IF NOT EXISTS idx_external_links_tenant ON external_links (tenant_id);
CREATE INDEX IF NOT EXISTS idx_external_links_public_json_enabled ON external_links (public_json_enabled) WHERE public_json_enabled = true;
CREATE INDEX IF NOT EXISTS idx_external_links_name_embedding_hnsw ON external_links USING hnsw (name_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_external_links_description_embedding_hnsw ON external_links USING hnsw (description_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_external_links_notes_embedding_hnsw ON external_links USING hnsw (notes_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_external_links_full_text_embedding_hnsw ON external_links USING hnsw (full_text_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_external_links_timestamps_embedding_hnsw ON external_links USING hnsw (timestamps_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_external_links_combined_embedding_hnsw ON external_links USING hnsw (combined_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_external_links_vector_updated_at ON external_links (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_external_links_visibility_user ON external_links (visibility, added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_external_links_allow_public_notations ON external_links (allow_public_notations) WHERE allow_public_notations = true;
CREATE INDEX IF NOT EXISTS idx_collection_external_links_start_end_date ON collection_external_links (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_attachments_type ON attachments (type);
CREATE INDEX IF NOT EXISTS idx_attachments_visibility ON attachments (visibility);
CREATE INDEX IF NOT EXISTS idx_attachments_tenant ON attachments (tenant_id);
CREATE INDEX IF NOT EXISTS idx_attachments_title_embedding_hnsw ON attachments USING hnsw (title_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_attachments_description_embedding_hnsw ON attachments USING hnsw (description_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_attachments_combined_embedding_hnsw ON attachments USING hnsw (combined_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_attachments_vector_updated_at ON attachments (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_external_link_attachments_external_link ON external_link_attachments (external_link_id);
CREATE INDEX IF NOT EXISTS idx_external_link_attachments_attachment ON external_link_attachments (attachment_id);
CREATE INDEX IF NOT EXISTS idx_shared_links_tenant ON shared_links (tenant_id);
CREATE INDEX IF NOT EXISTS idx_shared_link_reviews_shared_link_id ON shared_link_reviews (shared_link_id);
CREATE INDEX IF NOT EXISTS idx_shared_link_reviews_reviewer_id ON shared_link_reviews (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_shared_link_reviews_shared_link_reviewer ON shared_link_reviews (shared_link_id, reviewer_id);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_folders_organization ON folders (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_folders_visibility ON folders (visibility);
CREATE INDEX IF NOT EXISTS idx_folders_text_search ON folders USING gin (to_tsvector('english'::regconfig, (name::text || ' '::text) || COALESCE(description, ''::text)));
CREATE INDEX IF NOT EXISTS idx_folders_tenant ON folders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_folder_collections_folder ON folder_collections (folder_id);
CREATE INDEX IF NOT EXISTS idx_collection_events_collection ON collection_events (collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_events_event ON collection_events (event_id);
CREATE INDEX IF NOT EXISTS idx_collection_events_user ON collection_events (user_id);
CREATE INDEX IF NOT EXISTS idx_collection_events_organization ON collection_events (organization_id);
CREATE INDEX IF NOT EXISTS idx_user_events_user ON user_events (user_id);
CREATE INDEX IF NOT EXISTS idx_user_events_event ON user_events (event_id);
CREATE INDEX IF NOT EXISTS idx_user_events_status ON user_events (status);
CREATE INDEX IF NOT EXISTS idx_user_resources_user ON user_resources (user_id);
CREATE INDEX IF NOT EXISTS idx_user_resources_resource ON user_resources (resource_id);
CREATE INDEX IF NOT EXISTS idx_user_resources_status ON user_resources (status);
CREATE INDEX IF NOT EXISTS idx_link_groups_user ON link_groups (user_id);
CREATE INDEX IF NOT EXISTS idx_link_groups_organization ON link_groups (organization_id);
CREATE INDEX IF NOT EXISTS idx_link_groups_visibility ON link_groups (visibility);
CREATE INDEX IF NOT EXISTS idx_link_groups_category ON link_groups (category);
CREATE INDEX IF NOT EXISTS idx_link_groups_linking_id ON link_groups (linking_id);
CREATE INDEX IF NOT EXISTS idx_link_groups_linking_type ON link_groups (linking_type);
CREATE INDEX IF NOT EXISTS idx_link_groups_tenant ON link_groups (tenant_id);
CREATE INDEX IF NOT EXISTS idx_link_groups_name_embedding_hnsw ON link_groups USING hnsw (name_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_link_groups_description_embedding_hnsw ON link_groups USING hnsw (description_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_link_groups_category_embedding_hnsw ON link_groups USING hnsw (category_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_link_groups_combined_embedding_hnsw ON link_groups USING hnsw (combined_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_link_groups_vector_updated_at ON link_groups (vector_updated_at);
CREATE INDEX IF NOT EXISTS link_groups_tenant_linking_idx ON link_groups (tenant_id, linking_type, linking_id);
CREATE INDEX IF NOT EXISTS idx_starter_packs_tenant ON starter_packs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants (domain);
CREATE INDEX IF NOT EXISTS idx_users_tenants_user ON users_tenants (user_id);
CREATE INDEX IF NOT EXISTS idx_users_tenants_tenant ON users_tenants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users_tenants (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS pinned_items_user_item_unique ON pinned_items (user_id, item_id, item_type);
CREATE INDEX IF NOT EXISTS idx_pinned_items_user ON pinned_items (user_id);
CREATE INDEX IF NOT EXISTS idx_pinned_items_type ON pinned_items (item_type);
CREATE INDEX IF NOT EXISTS idx_pinned_items_order ON pinned_items (order_position);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_name ON subscription_plans (name);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_active_sort ON subscription_plans (is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_stripe_product ON subscription_plans (stripe_product_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plans_stripe_price ON subscription_plans (stripe_price_id);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_email ON pending_invitations (email);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_token ON pending_invitations (invite_token);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_status ON pending_invitations (status);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_expires_at ON pending_invitations (expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_external_link ON pending_invitations (collection_external_link_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tag_definitions_name ON collection_external_link_tag_definitions (name);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tag_definitions_tenant ON collection_external_link_tag_definitions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tag_definitions_created_by ON collection_external_link_tag_definitions (created_by_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_external_link_tag_definitions_unique_name_tenant ON collection_external_link_tag_definitions (lower(name::text), tenant_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tags_link_id ON collection_external_link_tags (collection_external_link_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tags_tag_id ON collection_external_link_tags (tag_id);
CREATE UNIQUE INDEX IF NOT EXISTS collection_type_ordering_collection_type_unique ON collection_type_ordering (collection_id, type);
CREATE INDEX IF NOT EXISTS idx_google_calendar_integrations_user_id ON google_calendar_integrations (user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_entity ON google_calendar_events (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_integration_id ON google_calendar_events (integration_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_lookup ON google_calendar_events (google_event_id, integration_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_google_calendar_sync_logs_integration_id ON google_calendar_sync_logs (integration_id);
CREATE INDEX IF NOT EXISTS idx_collection_merges_target ON collection_merges (target_collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_merges_source ON collection_merges (source_collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_merges_user ON collection_merges (merged_by_user_id);
CREATE INDEX IF NOT EXISTS idx_collection_merges_created_at ON collection_merges (created_at);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_collection_external_link ON collection_external_link_resources (collection_id, external_link_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_resource ON collection_external_link_resources (resource_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_user_added ON collection_external_link_resources (user_added_by_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_org_added ON collection_external_link_resources (organization_added_by_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_created_at ON collection_external_link_resources (created_at);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_order ON collection_external_link_resources (order_position);
CREATE INDEX IF NOT EXISTS idx_social_media_accounts_account_type_id ON social_media_accounts (account_type_id);
CREATE INDEX IF NOT EXISTS idx_social_media_associations_associated ON social_media_associations (associated_id, associated_type);
CREATE INDEX IF NOT EXISTS idx_social_media_associations_social_media ON social_media_associations (social_media_account_id);
CREATE INDEX IF NOT EXISTS idx_social_media_associations_type ON social_media_associations (associated_type);
CREATE INDEX IF NOT EXISTS idx_social_media_associations_tenant ON social_media_associations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_media_account_types_tenant_id ON social_media_account_types (tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_media_account_types_visibility ON social_media_account_types (visibility);
CREATE INDEX IF NOT EXISTS idx_social_media_account_types_added_by ON social_media_account_types (added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_cel_notations_title_embedding_hnsw ON collection_external_links_notations USING hnsw (title_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_cel_notations_description_embedding_hnsw ON collection_external_links_notations USING hnsw (description_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_cel_notations_notes_embedding_hnsw ON collection_external_links_notations USING hnsw (notes_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_cel_notations_category_embedding_hnsw ON collection_external_links_notations USING hnsw (category_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_cel_notations_combined_embedding_hnsw ON collection_external_links_notations USING hnsw (combined_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_cel_notations_vector_updated_at ON collection_external_links_notations (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_notations_template_id ON collection_external_links_notations (template_id);
CREATE INDEX IF NOT EXISTS idx_notations_custom_fields ON collection_external_links_notations USING gin (custom_fields);
CREATE INDEX IF NOT EXISTS idx_collection_external_links_notations_start_end_date ON collection_external_links_notations (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_collection_external_links_threads_user ON collection_external_links_threads (user_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_links_threads_collection_external_link_ ON collection_external_links_threads (collection_external_link_notation_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_links_notation_tags_notation_id ON collection_external_links_notation_tags (collection_external_link_notation_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_links_notation_tags_tag_id ON collection_external_links_notation_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_notation_templates_collection_external_link_id ON notation_templates (collection_external_link_id);
CREATE INDEX IF NOT EXISTS idx_notation_templates_is_public_submission ON notation_templates (is_public_submission_template) WHERE is_public_submission_template = true;
CREATE INDEX IF NOT EXISTS idx_notation_template_fields_template_id ON notation_template_fields (template_id);
CREATE INDEX IF NOT EXISTS idx_external_notation_submissions_template_id ON external_notation_submissions (template_id);
CREATE INDEX IF NOT EXISTS idx_external_notation_submissions_approval_status ON external_notation_submissions (approval_status);
CREATE INDEX IF NOT EXISTS idx_external_notation_submissions_notation_id ON external_notation_submissions (notation_id);
CREATE INDEX IF NOT EXISTS idx_notation_attachments_notation_id ON notation_attachments (notation_id);
CREATE INDEX IF NOT EXISTS idx_notation_attachments_attachment_id ON notation_attachments (attachment_id);
CREATE INDEX IF NOT EXISTS idx_notation_attachments_position ON notation_attachments (notation_id, position);
CREATE INDEX IF NOT EXISTS idx_slack_workspaces_tenant ON slack_workspaces (tenant_id);
CREATE INDEX IF NOT EXISTS idx_slack_workspaces_team ON slack_workspaces (team_id);
CREATE INDEX IF NOT EXISTS idx_slack_channel_configs_collection ON slack_channel_configs (collection_id);
CREATE INDEX IF NOT EXISTS idx_slack_channel_configs_external_link ON slack_channel_configs (external_link_id);
CREATE INDEX IF NOT EXISTS idx_slack_channel_configs_workspace ON slack_channel_configs (slack_workspace_id);
CREATE INDEX IF NOT EXISTS idx_slack_logs_workspace ON slack_notification_logs (slack_workspace_id);
CREATE INDEX IF NOT EXISTS idx_slack_logs_sent_at ON slack_notification_logs (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_slack_logs_entity ON slack_notification_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant_id ON tenant_invites (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_invite_token ON tenant_invites (invite_token);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_is_active ON tenant_invites (is_active);
CREATE INDEX IF NOT EXISTS idx_tenant_invite_uses_invite_id ON tenant_invite_uses (invite_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invite_uses_user_id ON tenant_invite_uses (user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invite_uses_tenant_id ON tenant_invite_uses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities (status);
CREATE INDEX IF NOT EXISTS idx_opportunities_tenant_id ON opportunities (tenant_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_created_by_user_id ON opportunities (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_visibility ON opportunities (visibility);
CREATE INDEX IF NOT EXISTS idx_opportunities_is_volunteer ON opportunities (is_volunteer);
CREATE INDEX IF NOT EXISTS idx_opportunities_is_remote ON opportunities (is_remote);
CREATE INDEX IF NOT EXISTS idx_opportunities_application_deadline ON opportunities (application_deadline);
CREATE INDEX IF NOT EXISTS idx_opportunities_start_date ON opportunities (start_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_name_embedding ON opportunities USING ivfflat (name_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_opportunities_description_embedding ON opportunities USING ivfflat (description_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_opportunities_combined_embedding ON opportunities USING ivfflat (combined_embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_opportunity_applications_opportunity_id ON opportunity_applications (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_applications_user_id ON opportunity_applications (user_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_applications_status ON opportunity_applications (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_applications_user_unique ON opportunity_applications (opportunity_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_applications_email_unique ON opportunity_applications (opportunity_id, applicant_email) WHERE applicant_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunity_messages_opportunity_id ON opportunity_messages (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_messages_application_id ON opportunity_messages (application_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_messages_sender_id ON opportunity_messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_messages_recipient_id ON opportunity_messages (recipient_id);
CREATE INDEX IF NOT EXISTS resource_attachments_resource_idx ON resource_attachments (resource_id);
CREATE INDEX IF NOT EXISTS resource_attachments_attachment_idx ON resource_attachments (attachment_id);

CREATE OR REPLACE FUNCTION trigger_set_timestamp() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_pending_invitations_updated_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_collection_external_link_resources_updated_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_social_media_associations_updated_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_slack_updated_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_opportunity_updated_at() RETURNS trigger
    LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    trigger_spec record;
BEGIN
    FOR trigger_spec IN
        SELECT * FROM (VALUES
            ('update_organizations_timestamp', 'organizations', 'trigger_set_timestamp'),
            ('update_events_timestamp', 'events', 'trigger_set_timestamp'),
            ('update_resources_timestamp', 'resources', 'trigger_set_timestamp'),
            ('update_user_organizations_timestamp', 'organization_members', 'trigger_set_timestamp'),
            ('update_organization_events_timestamp', 'organization_events', 'trigger_set_timestamp'),
            ('update_event_approvals_timestamp', 'event_approvals', 'trigger_set_timestamp'),
            ('update_event_ratings_timestamp', 'event_ratings', 'trigger_set_timestamp'),
            ('update_resource_ratings_timestamp', 'resource_ratings', 'trigger_set_timestamp'),
            ('update_fundraisers_timestamp', 'fundraisers', 'trigger_set_timestamp'),
            ('update_surveys_timestamp', 'surveys', 'trigger_set_timestamp'),
            ('update_collection_bookmarks_timestamp', 'collection_bookmarks', 'trigger_set_timestamp'),
            ('update_folders_timestamp', 'folders', 'trigger_set_timestamp'),
            ('update_folder_collections_timestamp', 'folder_collections', 'trigger_set_timestamp'),
            ('update_tenants_timestamp', 'tenants', 'trigger_set_timestamp'),
            ('update_pinned_items_timestamp', 'pinned_items', 'trigger_set_timestamp'),
            ('trigger_update_pending_invitations_updated_at', 'pending_invitations', 'update_pending_invitations_updated_at'),
            ('trigger_update_collection_external_link_resources_updated_at', 'collection_external_link_resources', 'update_collection_external_link_resources_updated_at'),
            ('update_social_media_associations_updated_at', 'social_media_associations', 'update_social_media_associations_updated_at'),
            ('update_social_media_account_types_updated_at', 'social_media_account_types', 'update_updated_at_column'),
            ('update_slack_workspaces_updated_at', 'slack_workspaces', 'update_slack_updated_at'),
            ('update_slack_channel_configs_updated_at', 'slack_channel_configs', 'update_slack_updated_at'),
            ('update_opportunities_updated_at', 'opportunities', 'update_opportunity_updated_at'),
            ('update_opportunity_applications_updated_at', 'opportunity_applications', 'update_opportunity_updated_at'),
            ('update_opportunity_messages_updated_at', 'opportunity_messages', 'update_opportunity_updated_at')
        ) AS v(trigger_name, table_name, function_name)
    LOOP
        IF to_regclass(trigger_spec.table_name) IS NOT NULL
           AND EXISTS (
               SELECT 1
               FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = trigger_spec.table_name
                 AND column_name = 'updated_at'
           )
           AND NOT EXISTS (
               SELECT 1
               FROM pg_trigger
               WHERE tgname = trigger_spec.trigger_name
                 AND tgrelid = to_regclass(trigger_spec.table_name)
           ) THEN
            EXECUTE format(
                'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE PROCEDURE %I()',
                trigger_spec.trigger_name,
                trigger_spec.table_name,
                trigger_spec.function_name
            );
        END IF;
    END LOOP;
END $$;
