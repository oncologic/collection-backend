import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const { Pool } = pg;

const DEFAULT_IDS = {
  kidneyTenant: '00000000-0000-4000-8000-000000000001',
  communityTenant: '00000000-0000-4000-8000-000000000002',
  adminUser: '00000000-0000-4000-8000-000000000010',
  advocateUser: '00000000-0000-4000-8000-000000000011',
  personalUser: '00000000-0000-4000-8000-000000000012',
  demoOrganization: '00000000-0000-4000-8000-000000000020',
  demoEvent: '00000000-0000-4000-8000-000000000030',
  kidneyResourceCollection: '00000000-0000-4000-8000-000000000040',
  kidneyExternalCollection: '00000000-0000-4000-8000-000000000041',
  personalCollection: '00000000-0000-4000-8000-000000000042',
  resourceGuide: '00000000-0000-4000-8000-000000000050',
  resourceArticle: '00000000-0000-4000-8000-000000000051',
  resourcePersonal: '00000000-0000-4000-8000-000000000052',
  externalLinkNci: '00000000-0000-4000-8000-000000000060',
  externalLinkNotes: '00000000-0000-4000-8000-000000000061',
  collectionExternalLinkNci: '00000000-0000-4000-8000-000000000070',
  collectionExternalLinkNotes: '00000000-0000-4000-8000-000000000071',
  gettingStartedFolder: '00000000-0000-4000-8000-000000000080',
  pinnedKidneyCollection: '00000000-0000-4000-8000-000000000090',
  pinnedKidneyResource: '00000000-0000-4000-8000-000000000091',
  pinnedKidneyLink: '00000000-0000-4000-8000-000000000092',
  basicPlan: '00000000-0000-4000-8000-000000000101',
  premiumPlan: '00000000-0000-4000-8000-000000000102',
  professionalPlan: '00000000-0000-4000-8000-000000000103',
  enterprisePlan: '00000000-0000-4000-8000-000000000104',
  socialTypeOrganization: '00000000-0000-4000-8000-000000000201',
  socialTypeHealthcareProfessional: '00000000-0000-4000-8000-000000000202',
  socialTypePatientAdvocate: '00000000-0000-4000-8000-000000000203',
  socialTypePersonal: '00000000-0000-4000-8000-000000000204',
  socialTypeCompany: '00000000-0000-4000-8000-000000000205',
  socialTypeCommunity: '00000000-0000-4000-8000-000000000206',
};

const ids = {
  ...DEFAULT_IDS,
  kidneyTenant: process.env.KIDNEY_TENANT_ID || DEFAULT_IDS.kidneyTenant,
  communityTenant: process.env.COMMUNITY_TENANT || DEFAULT_IDS.communityTenant,
  adminUser: process.env.SEED_ADMIN_USER_ID || DEFAULT_IDS.adminUser,
};

const seedAdmin = {
  email: process.env.SEED_ADMIN_EMAIL || 'admin@collections.local',
  firstName: process.env.SEED_ADMIN_FIRST_NAME || 'Seed',
  lastName: process.env.SEED_ADMIN_LAST_NAME || 'Admin',
  clerkUserId: process.env.SEED_ADMIN_CLERK_USER_ID || 'seed_admin_local',
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const assertUuid = (name, value) => {
  if (!uuidPattern.test(value)) {
    throw new Error(`${name} must be a UUID. Received: ${value}`);
  }
};

for (const [name, value] of Object.entries(ids)) {
  assertUuid(name, value);
}

const createPool = () =>
  new Pool(
    process.env.DATABASE_URL
      ? {
          connectionString: process.env.DATABASE_URL,
          ssl:
            process.env.DB_SSL === 'false'
              ? false
              : {
                  rejectUnauthorized: false,
                },
        }
      : {
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: process.env.DB_NAME || 'postgres',
        }
  );

const resetSerialSequence = async (client, tableName) => {
  await client.query(`
    SELECT setval(
      pg_get_serial_sequence('${tableName}', 'id'),
      GREATEST((SELECT COALESCE(MAX(id), 1) FROM ${tableName}), 1),
      true
    );
  `);
};

const seedTenants = async (client) => {
  await client.query(
    `
      INSERT INTO tenants (id, name, domain, settings, access)
      VALUES
        ($1, 'Kidney Cancer Community', 'kidney.local', $2::jsonb, 'public'),
        ($3, 'Personal Workspace', 'personal.local', $4::jsonb, 'public')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        domain = EXCLUDED.domain,
        settings = EXCLUDED.settings,
        access = EXCLUDED.access,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.kidneyTenant,
      JSON.stringify({
        tenantType: 'kidney',
        publicAccess: { resources: true, events: true },
        seeded: true,
      }),
      ids.communityTenant,
      JSON.stringify({
        tenantType: 'personal',
        publicAccess: { resources: true, events: true },
        seeded: true,
      }),
    ]
  );
};

const seedSubscriptionPlans = async (client) => {
  await client.query(
    `
      INSERT INTO subscription_plans (
        id, name, display_name, description, price, billing_interval,
        max_external_collections, max_regular_collections,
        can_add_collaborators, max_collaborators_per_collection,
        max_attachments, max_attachment_size_mb,
        can_create_folders, can_export_data, priority_support,
        is_active, sort_order
      )
      VALUES
        ($1, 'basic', 'Basic', 'Good for local development and individual collection management.', 0.00, 'monthly', 5, -1, false, 0, 25, 10, true, false, false, true, 1),
        ($2, 'premium', 'Premium', 'Unlimited collections and export support for active users.', 9.99, 'monthly', -1, -1, false, 0, -1, 50, true, true, false, true, 2),
        ($3, 'professional', 'Professional', 'Collaboration features for teams and advocates.', 19.99, 'monthly', -1, -1, true, 10, -1, 100, true, true, true, true, 3),
        ($4, 'enterprise', 'Enterprise', 'Full-featured plan for organizations and programs.', 49.99, 'monthly', -1, -1, true, -1, -1, 500, true, true, true, true, 4)
      ON CONFLICT (name) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        price = EXCLUDED.price,
        billing_interval = EXCLUDED.billing_interval,
        max_external_collections = EXCLUDED.max_external_collections,
        max_regular_collections = EXCLUDED.max_regular_collections,
        can_add_collaborators = EXCLUDED.can_add_collaborators,
        max_collaborators_per_collection = EXCLUDED.max_collaborators_per_collection,
        max_attachments = EXCLUDED.max_attachments,
        max_attachment_size_mb = EXCLUDED.max_attachment_size_mb,
        can_create_folders = EXCLUDED.can_create_folders,
        can_export_data = EXCLUDED.can_export_data,
        priority_support = EXCLUDED.priority_support,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [ids.basicPlan, ids.premiumPlan, ids.professionalPlan, ids.enterprisePlan]
  );
};

const seedUsers = async (client) => {
  await client.query(
    `
      INSERT INTO users (
        id, email, first_name, last_name, clerk_user_id, user_role,
        cancer_type, designation, has_onboarded, subscription_plan,
        subscription_status, superuser
      )
      VALUES
        ($1, $2, $3, $4, $5, 'admin', NULL, 'Administrator', true, 'enterprise', 'active', true),
        ($6, 'advocate@collections.local', 'Seed', 'Advocate', 'seed_advocate_local', 'advocate', 'Kidney Cancer', 'Patient Advocate', true, 'professional', 'active', false),
        ($7, 'personal@collections.local', 'Seed', 'Personal', 'seed_personal_local', 'personal', NULL, 'Individual', true, 'basic', 'active', false)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        clerk_user_id = EXCLUDED.clerk_user_id,
        user_role = EXCLUDED.user_role,
        cancer_type = EXCLUDED.cancer_type,
        designation = EXCLUDED.designation,
        has_onboarded = EXCLUDED.has_onboarded,
        subscription_plan = EXCLUDED.subscription_plan,
        subscription_status = EXCLUDED.subscription_status,
        superuser = EXCLUDED.superuser,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.adminUser,
      seedAdmin.email,
      seedAdmin.firstName,
      seedAdmin.lastName,
      seedAdmin.clerkUserId,
      ids.advocateUser,
      ids.personalUser,
    ]
  );

  await client.query(
    `
      INSERT INTO users_tenants (id, user_id, tenant_id)
      VALUES
        ('00000000-0000-4000-8000-000000000301', $1, $2),
        ('00000000-0000-4000-8000-000000000302', $1, $3),
        ('00000000-0000-4000-8000-000000000303', $4, $2),
        ('00000000-0000-4000-8000-000000000304', $5, $3)
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        tenant_id = EXCLUDED.tenant_id,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.adminUser,
      ids.kidneyTenant,
      ids.communityTenant,
      ids.advocateUser,
      ids.personalUser,
    ]
  );

  await client.query(
    `
      INSERT INTO user_roles (id, name, value, description, verified, user_id, tenant_id)
      VALUES
        ('00000000-0000-4000-8000-000000000311', 'admin', 'admin', 'Global administrator for local seed data.', true, $1, NULL),
        ('00000000-0000-4000-8000-000000000312', 'admin', 'admin', 'Tenant administrator for kidney tenant.', true, $1, $2),
        ('00000000-0000-4000-8000-000000000313', 'admin', 'admin', 'Tenant administrator for personal tenant.', true, $1, $3),
        ('00000000-0000-4000-8000-000000000314', 'advocate', 'advocate', 'Verified advocate for kidney tenant workflows.', true, $4, $2),
        ('00000000-0000-4000-8000-000000000315', 'personal', 'personal', 'Personal workspace role.', true, $5, $3)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        value = EXCLUDED.value,
        description = EXCLUDED.description,
        verified = EXCLUDED.verified,
        user_id = EXCLUDED.user_id,
        tenant_id = EXCLUDED.tenant_id,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.adminUser,
      ids.kidneyTenant,
      ids.communityTenant,
      ids.advocateUser,
      ids.personalUser,
    ]
  );
};

const seedMetadata = async (client) => {
  await client.query(`
    INSERT INTO user_types (id, name, description)
    VALUES
      (10001, 'Patient', 'Patient or survivor user profile.'),
      (10002, 'Caregiver', 'Caregiver or family support user profile.'),
      (10003, 'Clinician', 'Clinical or care team user profile.'),
      (10004, 'Advocate', 'Patient advocate or community leader profile.'),
      (10005, 'Administrator', 'Administrative user profile.')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at = CURRENT_TIMESTAMP;

    INSERT INTO sensitivity_levels (id, name, description)
    VALUES
      (10001, 'General', 'Suitable for broad public audiences.'),
      (10002, 'Sensitive', 'May include personal, clinical, or emotionally sensitive content.'),
      (10003, 'Highly Sensitive', 'Requires careful handling and restricted visibility.')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at = CURRENT_TIMESTAMP;

    INSERT INTO expertise_levels (id, name, description)
    VALUES
      (10001, 'Beginner', 'Introductory content for users who are new to the topic.'),
      (10002, 'Intermediate', 'Moderate-detail content for users with some familiarity.'),
      (10003, 'Advanced', 'Technical or detailed content for experienced users.')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      updated_at = CURRENT_TIMESTAMP;

    INSERT INTO target_audiences (id, name, description, tenant_id)
    VALUES
      (10001, 'Patients', 'Patients and survivors.', NULL),
      (10002, 'Caregivers', 'Caregivers and family members.', NULL),
      (10003, 'Clinicians', 'Clinicians and care teams.', NULL),
      (10004, 'Advocates', 'Patient advocates and community leaders.', NULL)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      tenant_id = EXCLUDED.tenant_id,
      updated_at = CURRENT_TIMESTAMP;

    INSERT INTO resource_types (id, name, description, tenant_id, added_by_user_id, visibility)
    VALUES
      (10001, 'Article', 'Written article or web page.', NULL, NULL, 'public'),
      (10002, 'Video', 'Video, webinar recording, or multimedia resource.', NULL, NULL, 'public'),
      (10003, 'Guide', 'Step-by-step guide or curated reference.', NULL, NULL, 'public'),
      (10004, 'Clinical Trial', 'Clinical trial listing or trial education resource.', NULL, NULL, 'public'),
      (10005, 'Tool', 'Interactive tool, calculator, or worksheet.', NULL, NULL, 'public')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      tenant_id = EXCLUDED.tenant_id,
      added_by_user_id = EXCLUDED.added_by_user_id,
      visibility = EXCLUDED.visibility,
      updated_at = CURRENT_TIMESTAMP;

    INSERT INTO event_types (id, name, description, tenant_id, added_by_user_id, visibility)
    VALUES
      (10001, 'Webinar', 'Online educational event.', NULL, NULL, 'public'),
      (10002, 'Support Group', 'Community support or peer gathering.', NULL, NULL, 'public'),
      (10003, 'Workshop', 'Hands-on learning session.', NULL, NULL, 'public'),
      (10004, 'Conference', 'Conference, symposium, or multi-session event.', NULL, NULL, 'public')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      tenant_id = EXCLUDED.tenant_id,
      added_by_user_id = EXCLUDED.added_by_user_id,
      visibility = EXCLUDED.visibility,
      updated_at = CURRENT_TIMESTAMP;
  `);

  await client.query(
    `
      INSERT INTO tags (id, name, description, tenant_id, added_by_user_id, visibility, color)
      VALUES
        (11001, 'Getting Started', 'Introductory items for new users.', $1, $3, 'tenant', '#2563EB'),
        (11002, 'Treatment', 'Treatment-related content.', $1, $3, 'tenant', '#059669'),
        (11003, 'Clinical Trials', 'Clinical trial and research content.', $1, $3, 'tenant', '#7C3AED'),
        (11004, 'Support', 'Supportive care and community content.', $1, $3, 'tenant', '#F59E0B'),
        (12001, 'Personal Notes', 'Personal workspace notes and references.', $2, $3, 'tenant', '#0EA5E9'),
        (12002, 'Research', 'Personal research and saved links.', $2, $3, 'tenant', '#DB2777')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        tenant_id = EXCLUDED.tenant_id,
        added_by_user_id = EXCLUDED.added_by_user_id,
        visibility = EXCLUDED.visibility,
        color = EXCLUDED.color,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [ids.kidneyTenant, ids.communityTenant, ids.adminUser]
  );

  await client.query(
    `
      INSERT INTO social_media_account_types (
        id, name, description, color, icon, visibility, is_default
      )
      VALUES
        ($1, 'Foundation/Organization', 'Official foundation or organization account.', '#4B5563', 'FaBuilding', 'public', true),
        ($2, 'Healthcare Professional', 'Medical professional or healthcare provider.', '#059669', 'FaUserMd', 'public', true),
        ($3, 'Patient Advocate', 'Patient advocate or survivor.', '#DC2626', 'FaHandHoldingHeart', 'public', true),
        ($4, 'Personal', 'Personal account.', '#3B82F6', 'FaUser', 'public', true),
        ($5, 'Company', 'Company or business account.', '#7C3AED', 'FaBriefcase', 'public', true),
        ($6, 'Community', 'Community or support group.', '#F59E0B', 'FaUsers', 'public', true)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        color = EXCLUDED.color,
        icon = EXCLUDED.icon,
        visibility = EXCLUDED.visibility,
        is_default = EXCLUDED.is_default,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.socialTypeOrganization,
      ids.socialTypeHealthcareProfessional,
      ids.socialTypePatientAdvocate,
      ids.socialTypePersonal,
      ids.socialTypeCompany,
      ids.socialTypeCommunity,
    ]
  );

  for (const tableName of [
    'user_types',
    'sensitivity_levels',
    'expertise_levels',
    'target_audiences',
    'resource_types',
    'event_types',
    'tags',
  ]) {
    await resetSerialSequence(client, tableName);
  }
};

const seedSampleContent = async (client) => {
  await client.query(
    `
      INSERT INTO organizations (
        id, name, acronym, description, website, email, category,
        city, state, country, tenant_id, user_id, professional
      )
      VALUES (
        $1,
        'Collections Demo Organization',
        'CDO',
        'Local seed organization used for development data.',
        'https://example.org',
        'hello@example.org',
        'Community',
        'New York',
        'NY',
        'USA',
        $2,
        $3,
        true
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        acronym = EXCLUDED.acronym,
        description = EXCLUDED.description,
        website = EXCLUDED.website,
        email = EXCLUDED.email,
        category = EXCLUDED.category,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        country = EXCLUDED.country,
        tenant_id = EXCLUDED.tenant_id,
        user_id = EXCLUDED.user_id,
        professional = EXCLUDED.professional,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [ids.demoOrganization, ids.kidneyTenant, ids.adminUser]
  );

  await client.query(
    `
      INSERT INTO events (
        id, title, description, registration_link, virtual_event, in_person_event,
        type_id, target_audience_id, sensitivity_level_id, expertise_level_id,
        start_date, end_date, contact_name, contact_email, added_by_user_id,
        timezone, visibility, tenant_id, professional
      )
      VALUES (
        $1,
        'Seed Webinar: Getting Started with Collections',
        'Demo event for validating tenant, event, and metadata workflows.',
        'https://example.org/events/getting-started',
        true,
        false,
        10001,
        10001,
        10001,
        10001,
        CURRENT_TIMESTAMP + INTERVAL '14 days',
        CURRENT_TIMESTAMP + INTERVAL '14 days 1 hour',
        'Seed Admin',
        $2,
        $3,
        'America/New_York',
        'public',
        $4,
        false
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        registration_link = EXCLUDED.registration_link,
        virtual_event = EXCLUDED.virtual_event,
        in_person_event = EXCLUDED.in_person_event,
        type_id = EXCLUDED.type_id,
        target_audience_id = EXCLUDED.target_audience_id,
        sensitivity_level_id = EXCLUDED.sensitivity_level_id,
        expertise_level_id = EXCLUDED.expertise_level_id,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        contact_name = EXCLUDED.contact_name,
        contact_email = EXCLUDED.contact_email,
        added_by_user_id = EXCLUDED.added_by_user_id,
        timezone = EXCLUDED.timezone,
        visibility = EXCLUDED.visibility,
        tenant_id = EXCLUDED.tenant_id,
        professional = EXCLUDED.professional,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [ids.demoEvent, seedAdmin.email, ids.adminUser, ids.kidneyTenant]
  );

  await client.query(
    `
      INSERT INTO organization_events (organization_id, event_id, "primary")
      VALUES ($1, $2, true)
      ON CONFLICT (organization_id, event_id) DO UPDATE SET
        "primary" = EXCLUDED."primary",
        updated_at = CURRENT_TIMESTAMP;
    `,
    [ids.demoOrganization, ids.demoEvent]
  );

  await client.query(
    `
      INSERT INTO resources (
        id, type_id, url, name, description, resource_date,
        resource_updated_date, button_name, sensitivity_level_id,
        expertise_level_id, target_audience_id, requires_registration,
        added_by_user_id, featured, list_order, full_text, tenant_id, status
      )
      VALUES
        ($1, 10003, 'https://www.cancer.gov/types/kidney', 'Kidney Cancer Overview', 'Introductory kidney cancer information from the National Cancer Institute.', CURRENT_DATE, CURRENT_DATE, 'Open Guide', 10001, 10001, 10001, false, $4, true, 1, 'Seeded overview resource for kidney cancer education.', $5, 'approved'),
        ($2, 10001, 'https://www.cancer.gov/types/kidney/patient/kidney-treatment-pdq', 'Kidney Cancer Treatment Options', 'Treatment information suitable for patient education and local development testing.', CURRENT_DATE, CURRENT_DATE, 'Read Article', 10001, 10002, 10001, false, $4, true, 2, 'Seeded treatment resource for local development.', $5, 'approved'),
        ($3, 10005, 'https://example.org/personal-research-notes', 'Personal Research Starter', 'Starter item for validating personal tenant collections and private visibility.', CURRENT_DATE, CURRENT_DATE, 'Open Tool', 10001, 10001, 10001, false, $4, false, 1, 'Seeded personal tenant resource.', $6, 'approved')
      ON CONFLICT (id) DO UPDATE SET
        type_id = EXCLUDED.type_id,
        url = EXCLUDED.url,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        resource_date = EXCLUDED.resource_date,
        resource_updated_date = EXCLUDED.resource_updated_date,
        button_name = EXCLUDED.button_name,
        sensitivity_level_id = EXCLUDED.sensitivity_level_id,
        expertise_level_id = EXCLUDED.expertise_level_id,
        target_audience_id = EXCLUDED.target_audience_id,
        requires_registration = EXCLUDED.requires_registration,
        added_by_user_id = EXCLUDED.added_by_user_id,
        featured = EXCLUDED.featured,
        list_order = EXCLUDED.list_order,
        full_text = EXCLUDED.full_text,
        tenant_id = EXCLUDED.tenant_id,
        status = EXCLUDED.status,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.resourceGuide,
      ids.resourceArticle,
      ids.resourcePersonal,
      ids.adminUser,
      ids.kidneyTenant,
      ids.communityTenant,
    ]
  );

  await client.query(
    `
      INSERT INTO resource_tags (resource_id, tag_id)
      VALUES
        ($1, 11001),
        ($1, 11002),
        ($2, 11002),
        ($2, 11003),
        ($3, 12001),
        ($3, 12002)
      ON CONFLICT (resource_id, tag_id) DO NOTHING;
    `,
    [ids.resourceGuide, ids.resourceArticle, ids.resourcePersonal]
  );

  await client.query(
    `
      INSERT INTO collections (
        id, name, description, user_id, visibility, color, type,
        icon, status, tenant_id, hashtags, public_json_enabled
      )
      VALUES
        ($1, 'Kidney Cancer Resource Starter', 'Seeded public resource collection for validating local setup.', $4, 'public', '#2563EB', 'resource', 'BookOpen', 'active', $5, 'kidney-cancer,resources', true),
        ($2, 'Kidney Cancer Link Starter', 'Seeded public external-link collection for validating external links.', $4, 'public', '#059669', 'external', 'Link', 'active', $5, 'kidney-cancer,links', true),
        ($3, 'Personal Research Workspace', 'Private seeded collection for personal tenant workflows.', $4, 'private', '#0EA5E9', 'external', 'Notebook', 'active', $6, 'personal-notes,research', false)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        user_id = EXCLUDED.user_id,
        visibility = EXCLUDED.visibility,
        color = EXCLUDED.color,
        type = EXCLUDED.type,
        icon = EXCLUDED.icon,
        status = EXCLUDED.status,
        tenant_id = EXCLUDED.tenant_id,
        hashtags = EXCLUDED.hashtags,
        public_json_enabled = EXCLUDED.public_json_enabled,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.kidneyResourceCollection,
      ids.kidneyExternalCollection,
      ids.personalCollection,
      ids.adminUser,
      ids.kidneyTenant,
      ids.communityTenant,
    ]
  );

  await client.query(
    `
      INSERT INTO collection_resources (
        collection_id, resource_id, order_position, user_added_by_id, notes, status
      )
      VALUES
        ($1, $2, 1, $5, 'Seeded guide resource.', 'active'),
        ($1, $3, 2, $5, 'Seeded treatment overview resource.', 'active'),
        ($4, $6, 1, $5, 'Seeded personal workspace resource.', 'active')
      ON CONFLICT (collection_id, resource_id) DO UPDATE SET
        order_position = EXCLUDED.order_position,
        user_added_by_id = EXCLUDED.user_added_by_id,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.kidneyResourceCollection,
      ids.resourceGuide,
      ids.resourceArticle,
      ids.personalCollection,
      ids.adminUser,
      ids.resourcePersonal,
    ]
  );

  await client.query(
    `
      INSERT INTO external_links (
        id, url, name, description, notes, date_added, added_by_user_id,
        visibility, type, tenant_id, public_json_enabled, allow_public_notations,
        hashtags
      )
      VALUES
        ($1, 'https://www.cancer.gov/types/kidney', 'National Cancer Institute Kidney Cancer', 'Reference link for public kidney cancer information.', 'Seed link for external-link collection testing.', CURRENT_DATE, $3, 'public', 'link', $4, true, false, 'kidney-cancer,nci'),
        ($2, 'https://example.org/local-notes', 'Personal Notes Placeholder', 'Private placeholder link for personal tenant testing.', 'Seed link for personal collection testing.', CURRENT_DATE, $3, 'private', 'link', $5, false, false, 'personal-notes')
      ON CONFLICT (id) DO UPDATE SET
        url = EXCLUDED.url,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        notes = EXCLUDED.notes,
        date_added = EXCLUDED.date_added,
        added_by_user_id = EXCLUDED.added_by_user_id,
        visibility = EXCLUDED.visibility,
        type = EXCLUDED.type,
        tenant_id = EXCLUDED.tenant_id,
        public_json_enabled = EXCLUDED.public_json_enabled,
        allow_public_notations = EXCLUDED.allow_public_notations,
        hashtags = EXCLUDED.hashtags,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.externalLinkNci,
      ids.externalLinkNotes,
      ids.adminUser,
      ids.kidneyTenant,
      ids.communityTenant,
    ]
  );

  await client.query(
    `
      INSERT INTO collection_external_links (
        id, collection_id, external_link_id, user_id, notes, status, sort_order
      )
      VALUES
        ($1, $3, $4, $7, 'Seeded NCI link.', 'active', 1),
        ($2, $5, $6, $7, 'Seeded personal note link.', 'active', 1)
      ON CONFLICT (collection_id, external_link_id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.collectionExternalLinkNci,
      ids.collectionExternalLinkNotes,
      ids.kidneyExternalCollection,
      ids.externalLinkNci,
      ids.personalCollection,
      ids.externalLinkNotes,
      ids.adminUser,
    ]
  );

  await client.query(
    `
      INSERT INTO folders (
        id, name, description, user_id, visibility, tenant_id
      )
      VALUES (
        $1,
        'Getting Started',
        'Seeded folder for local development collections.',
        $2,
        'private',
        $3
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        user_id = EXCLUDED.user_id,
        visibility = EXCLUDED.visibility,
        tenant_id = EXCLUDED.tenant_id,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [ids.gettingStartedFolder, ids.adminUser, ids.kidneyTenant]
  );

  await client.query(
    `
      INSERT INTO folder_collections (folder_id, collection_id, order_position)
      VALUES
        ($1, $2, 1),
        ($1, $3, 2)
      ON CONFLICT (folder_id, collection_id) DO UPDATE SET
        order_position = EXCLUDED.order_position,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.gettingStartedFolder,
      ids.kidneyResourceCollection,
      ids.kidneyExternalCollection,
    ]
  );

  await client.query(
    `
      INSERT INTO pinned_items (id, user_id, item_id, item_type, order_position)
      VALUES
        ($1, $4, $5, 'collection', 1),
        ($2, $4, $6, 'resource', 2),
        ($3, $4, $7, 'external_link', 3)
      ON CONFLICT (user_id, item_id, item_type) DO UPDATE SET
        order_position = EXCLUDED.order_position,
        updated_at = CURRENT_TIMESTAMP;
    `,
    [
      ids.pinnedKidneyCollection,
      ids.pinnedKidneyResource,
      ids.pinnedKidneyLink,
      ids.adminUser,
      ids.kidneyResourceCollection,
      ids.resourceGuide,
      ids.externalLinkNci,
    ]
  );
};

const main = async () => {
  if (process.argv.includes('--dry-run')) {
    console.info('Seed configuration is valid.');
    console.info(`KIDNEY_TENANT_ID=${ids.kidneyTenant}`);
    console.info(`COMMUNITY_TENANT=${ids.communityTenant}`);
    console.info(`SEED_ADMIN_EMAIL=${seedAdmin.email}`);
    console.info(`SEED_ADMIN_CLERK_USER_ID=${seedAdmin.clerkUserId}`);
    return;
  }

  const pool = createPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await seedTenants(client);
    await seedSubscriptionPlans(client);
    await seedUsers(client);
    await seedMetadata(client);
    await seedSampleContent(client);
    await client.query('COMMIT');

    console.info('Seed data completed.');
    console.info(`KIDNEY_TENANT_ID=${ids.kidneyTenant}`);
    console.info(`COMMUNITY_TENANT=${ids.communityTenant}`);
    console.info(`Seed admin: ${seedAdmin.email} (${seedAdmin.clerkUserId})`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed data failed:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Seed data failed:', error);
  process.exitCode = 1;
});
