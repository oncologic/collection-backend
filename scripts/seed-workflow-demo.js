import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const pool = new Pool(
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

const IDS = {
  templateCollection: '10000000-0000-4000-8000-000000000100',
  projectCollection: '10000000-0000-4000-8000-000000000101',
};

const steps = [
  {
    key: 'submit_process_request',
    externalLinkId: '10000000-0000-4000-8000-000000000201',
    templateAssociationId: '10000000-0000-4000-8000-000000000301',
    projectAssociationId: '10000000-0000-4000-8000-000000000401',
    name: 'Submit process improvement or invention request',
    url: 'https://example.internal/forms/process-improvement-request',
    description:
      'Start the application request by submitting the formal intake request with the problem, proposed app, requester, and business context.',
    relativeStartDay: 0,
    estimatedDurationDays: 2,
    ownerRole: 'Requestor',
    ownerName: 'Project sponsor',
    ownerEmail: 'project.sponsor@example.org',
    completionCriteria: 'Intake request submitted and ticket number captured.',
    status: 'completed',
    sortOrder: 0,
    resources: ['it_request_form', 'written_request_docs', 'it_contact_card'],
  },
  {
    key: 'it_approval',
    externalLinkId: '10000000-0000-4000-8000-000000000202',
    templateAssociationId: '10000000-0000-4000-8000-000000000302',
    projectAssociationId: '10000000-0000-4000-8000-000000000402',
    name: 'Request IT approval for VM and Codex setup',
    url: 'mailto:it-requests@example.org?subject=VM%20and%20Codex%20setup%20request',
    description:
      'Send the IT request with app purpose, user access needs, data sensitivity, and environment requirements.',
    relativeStartDay: 2,
    estimatedDurationDays: 5,
    ownerRole: 'IT intake',
    ownerName: 'IT Service Desk',
    ownerEmail: 'it-requests@example.org',
    completionCriteria: 'IT approves development environment setup.',
    dependsOn: ['submit_process_request'],
    status: 'completed',
    sortOrder: 1,
    resources: ['it_contact_card', 'written_request_docs', 'request_video'],
  },
  {
    key: 'purchase_approval',
    externalLinkId: '10000000-0000-4000-8000-000000000203',
    templateAssociationId: '10000000-0000-4000-8000-000000000303',
    projectAssociationId: '10000000-0000-4000-8000-000000000403',
    name: 'Complete purchase approval',
    url: 'https://example.internal/forms/purchase-approval',
    description:
      'Complete any purchasing or cost-center approval needed for tools, accounts, or infrastructure.',
    relativeStartDay: 7,
    estimatedDurationDays: 5,
    ownerRole: 'Operations',
    ownerName: 'Operations approver',
    ownerEmail: 'ops-approvals@example.org',
    completionCriteria: 'Purchase or cost-center approval completed.',
    dependsOn: ['it_approval'],
    status: 'completed',
    sortOrder: 2,
    resources: ['purchase_approval_guide'],
  },
  {
    key: 'devops_vm',
    externalLinkId: '10000000-0000-4000-8000-000000000204',
    templateAssociationId: '10000000-0000-4000-8000-000000000304',
    projectAssociationId: '10000000-0000-4000-8000-000000000404',
    name: 'Request DevOps VM setup',
    url: 'https://example.internal/forms/devops-vm-request',
    description:
      'Request the development VM, repository access, networking, environment variables, and local database access.',
    relativeStartDay: 12,
    estimatedDurationDays: 5,
    ownerRole: 'DevOps',
    ownerName: 'DevOps queue',
    ownerEmail: 'devops@example.org',
    completionCriteria: 'VM provisioned, access confirmed, and environment checklist complete.',
    dependsOn: ['purchase_approval'],
    status: 'active',
    sortOrder: 3,
    resources: ['devops_vm_request', 'dev_env_video'],
  },
  {
    key: 'complete_training',
    externalLinkId: '10000000-0000-4000-8000-000000000205',
    templateAssociationId: '10000000-0000-4000-8000-000000000305',
    projectAssociationId: '10000000-0000-4000-8000-000000000405',
    name: 'Complete required Codex training',
    url: 'https://example.internal/training/codex-basics',
    description:
      'Complete onboarding for secure Codex usage, code review expectations, and development environment basics.',
    relativeStartDay: 7,
    estimatedDurationDays: 1,
    ownerRole: 'Developer',
    ownerName: 'Assigned builder',
    ownerEmail: 'developer@example.org',
    completionCriteria: 'Training completed and acknowledged.',
    dependsOn: ['it_approval'],
    status: 'waiting',
    sortOrder: 4,
    resources: ['training_video', 'codex_account_guide'],
  },
  {
    key: 'codex_account',
    externalLinkId: '10000000-0000-4000-8000-000000000206',
    templateAssociationId: '10000000-0000-4000-8000-000000000306',
    projectAssociationId: '10000000-0000-4000-8000-000000000406',
    name: 'Sign up for Codex account',
    url: 'https://example.internal/forms/codex-account-request',
    description:
      'Create or request the Codex account and verify access to the project workspace.',
    relativeStartDay: 17,
    estimatedDurationDays: 2,
    ownerRole: 'Developer',
    ownerName: 'Assigned builder',
    ownerEmail: 'developer@example.org',
    completionCriteria: 'Codex account active and access validated.',
    dependsOn: ['devops_vm', 'complete_training'],
    status: 'pending',
    sortOrder: 5,
    resources: ['codex_account_guide'],
  },
  {
    key: 'begin_development',
    externalLinkId: '10000000-0000-4000-8000-000000000207',
    templateAssociationId: '10000000-0000-4000-8000-000000000307',
    projectAssociationId: '10000000-0000-4000-8000-000000000407',
    name: 'Begin development',
    url: 'https://example.internal/docs/dev-environment-overview',
    description:
      'Build the prototype, connect services, document setup decisions, and capture implementation notes.',
    relativeStartDay: 19,
    estimatedDurationDays: 10,
    ownerRole: 'Developer',
    ownerName: 'Assigned builder',
    ownerEmail: 'developer@example.org',
    completionCriteria: 'Prototype is working in the development environment.',
    dependsOn: ['codex_account'],
    status: 'pending',
    sortOrder: 6,
    resources: ['dev_env_video', 'prototype_checklist'],
  },
  {
    key: 'invention_disclosure',
    externalLinkId: '10000000-0000-4000-8000-000000000208',
    templateAssociationId: '10000000-0000-4000-8000-000000000308',
    projectAssociationId: '10000000-0000-4000-8000-000000000408',
    name: 'Complete invention disclosure',
    url: 'https://example.internal/forms/invention-disclosure',
    description:
      'Document what was built, who contributed, relevant IP questions, and any publication or disclosure constraints.',
    relativeStartDay: 29,
    estimatedDurationDays: 15,
    ownerRole: 'Project sponsor',
    ownerName: 'Project sponsor',
    ownerEmail: 'project.sponsor@example.org',
    completionCriteria: 'Disclosure submitted or confirmed not required.',
    dependsOn: ['begin_development'],
    status: 'pending',
    sortOrder: 7,
    resources: ['invention_disclosure_guide'],
  },
  {
    key: 'stakeholder_review',
    externalLinkId: '10000000-0000-4000-8000-000000000209',
    templateAssociationId: '10000000-0000-4000-8000-000000000309',
    projectAssociationId: '10000000-0000-4000-8000-000000000409',
    name: 'Review and test with stakeholders',
    url: 'https://example.internal/docs/stakeholder-review-checklist',
    description:
      'Run review sessions, send stakeholder emails, complete testing, and summarize findings.',
    relativeStartDay: 44,
    estimatedDurationDays: 15,
    ownerRole: 'Project lead',
    ownerName: 'Project lead',
    ownerEmail: 'project.lead@example.org',
    completionCriteria: 'Stakeholder feedback summarized and required fixes identified.',
    dependsOn: ['invention_disclosure'],
    status: 'pending',
    sortOrder: 8,
    resources: ['stakeholder_review_checklist', 'testing_summary_template'],
  },
  {
    key: 'agent_review',
    externalLinkId: '10000000-0000-4000-8000-000000000210',
    templateAssociationId: '10000000-0000-4000-8000-000000000310',
    projectAssociationId: '10000000-0000-4000-8000-000000000410',
    name: 'Trigger agent review',
    url: 'https://example.internal/agents/review-request',
    description:
      'Ask the dashboard agent to check for missing steps, business plan items, security review gaps, and code quality concerns.',
    relativeStartDay: 59,
    estimatedDurationDays: 1,
    ownerRole: 'Project lead',
    ownerName: 'Project lead',
    ownerEmail: 'project.lead@example.org',
    completionCriteria: 'Agent review completed and action list reviewed.',
    dependsOn: ['stakeholder_review'],
    status: 'pending',
    sortOrder: 9,
    resources: ['agent_review_prompt', 'security_review_checklist'],
  },
  {
    key: 'submit_pr',
    externalLinkId: '10000000-0000-4000-8000-000000000211',
    templateAssociationId: '10000000-0000-4000-8000-000000000311',
    projectAssociationId: '10000000-0000-4000-8000-000000000411',
    name: 'Submit PR',
    url: 'https://example.internal/docs/submit-pr',
    description:
      'Open a PR with implementation notes, setup changes, testing evidence, and deployment considerations.',
    relativeStartDay: 60,
    estimatedDurationDays: 2,
    ownerRole: 'Developer',
    ownerName: 'Assigned builder',
    ownerEmail: 'developer@example.org',
    completionCriteria: 'PR submitted with test results and reviewer context.',
    dependsOn: ['agent_review'],
    status: 'pending',
    sortOrder: 10,
    resources: ['pr_checklist', 'testing_summary_template'],
  },
  {
    key: 'code_review_deployment',
    externalLinkId: '10000000-0000-4000-8000-000000000212',
    templateAssociationId: '10000000-0000-4000-8000-000000000312',
    projectAssociationId: '10000000-0000-4000-8000-000000000412',
    name: 'Code review and deployment maintenance plan',
    url: 'https://example.internal/docs/deployment-maintenance-plan',
    description:
      'Complete review, capture cost/deployment/maintenance plan, and document handoff.',
    relativeStartDay: 62,
    estimatedDurationDays: 5,
    ownerRole: 'Engineering reviewer',
    ownerName: 'Engineering reviewer',
    ownerEmail: 'eng-review@example.org',
    completionCriteria: 'Code reviewed, deployment path approved, and maintenance plan captured.',
    dependsOn: ['submit_pr'],
    status: 'pending',
    sortOrder: 11,
    resources: ['security_review_checklist', 'deployment_plan_template'],
  },
];

const resources = [
  {
    key: 'it_request_form',
    id: '10000000-0000-4000-8000-000000000501',
    typeId: 10005,
    name: 'IT request form link',
    url: 'https://example.internal/forms/process-improvement-request',
    buttonName: 'Open Form',
    description: 'Formal intake form for new application, VM, and Codex setup requests.',
  },
  {
    key: 'request_video',
    id: '10000000-0000-4000-8000-000000000502',
    typeId: 10002,
    name: 'Video walkthrough: submit the request',
    url: 'https://example.internal/videos/submit-request',
    videoUrl: 'https://example.internal/videos/submit-request',
    buttonName: 'Watch Video',
    description: 'Short video showing exactly how to submit the IT request.',
  },
  {
    key: 'written_request_docs',
    id: '10000000-0000-4000-8000-000000000503',
    typeId: 10003,
    name: 'Written request documentation',
    url: 'https://example.internal/docs/request-process',
    buttonName: 'Read Guide',
    description: 'Written instructions for request fields, required details, and routing.',
  },
  {
    key: 'it_contact_card',
    id: '10000000-0000-4000-8000-000000000504',
    typeId: 10003,
    name: 'IT contact card and email instructions',
    url: 'mailto:it-requests@example.org',
    buttonName: 'Email IT',
    description: 'Contact name, email address, and sample email for the IT request.',
  },
  {
    key: 'devops_vm_request',
    id: '10000000-0000-4000-8000-000000000505',
    typeId: 10005,
    name: 'DevOps VM request resource',
    url: 'https://example.internal/forms/devops-vm-request',
    buttonName: 'Request VM',
    description: 'Request form for VM provisioning and environment access.',
  },
  {
    key: 'dev_env_video',
    id: '10000000-0000-4000-8000-000000000506',
    typeId: 10002,
    name: 'Development environment overview video',
    url: 'https://example.internal/videos/development-environment',
    videoUrl: 'https://example.internal/videos/development-environment',
    buttonName: 'Watch Overview',
    description: 'Explains what the development environment includes and how to access it.',
  },
  {
    key: 'purchase_approval_guide',
    id: '10000000-0000-4000-8000-000000000507',
    typeId: 10003,
    name: 'Purchase approval guide',
    url: 'https://example.internal/docs/purchase-approval',
    buttonName: 'Read Guide',
    description: 'Checklist for tool, account, and infrastructure purchase approvals.',
  },
  {
    key: 'training_video',
    id: '10000000-0000-4000-8000-000000000508',
    typeId: 10002,
    name: 'Codex training video',
    url: 'https://example.internal/videos/codex-training',
    videoUrl: 'https://example.internal/videos/codex-training',
    buttonName: 'Watch Training',
    description: 'Required onboarding video for secure Codex usage.',
  },
  {
    key: 'codex_account_guide',
    id: '10000000-0000-4000-8000-000000000509',
    typeId: 10003,
    name: 'Codex account setup guide',
    url: 'https://example.internal/docs/codex-account-setup',
    buttonName: 'Setup Account',
    description: 'Instructions to request and verify Codex workspace access.',
  },
  {
    key: 'prototype_checklist',
    id: '10000000-0000-4000-8000-000000000510',
    typeId: 10003,
    name: 'Prototype readiness checklist',
    url: 'https://example.internal/docs/prototype-readiness',
    buttonName: 'Open Checklist',
    description: 'Checklist for confirming the first working prototype is ready for review.',
  },
  {
    key: 'invention_disclosure_guide',
    id: '10000000-0000-4000-8000-000000000511',
    typeId: 10003,
    name: 'Invention disclosure guide',
    url: 'https://example.internal/docs/invention-disclosure',
    buttonName: 'Read Guide',
    description: 'Guidance for documenting invention and IP review needs.',
  },
  {
    key: 'stakeholder_review_checklist',
    id: '10000000-0000-4000-8000-000000000512',
    typeId: 10003,
    name: 'Stakeholder review checklist',
    url: 'https://example.internal/docs/stakeholder-review-checklist',
    buttonName: 'Open Checklist',
    description: 'Checklist for stakeholder review, feedback, and signoff.',
  },
  {
    key: 'testing_summary_template',
    id: '10000000-0000-4000-8000-000000000513',
    typeId: 10003,
    name: 'Testing summary template',
    url: 'https://example.internal/templates/testing-summary',
    buttonName: 'Open Template',
    description: 'Template for documenting test results and unresolved issues.',
  },
  {
    key: 'agent_review_prompt',
    id: '10000000-0000-4000-8000-000000000514',
    typeId: 10003,
    name: 'Agent review prompt',
    url: 'https://example.internal/prompts/project-readiness-review',
    buttonName: 'Open Prompt',
    description: 'Prompt for checking missing workflow steps, business plan, security, and code quality.',
  },
  {
    key: 'security_review_checklist',
    id: '10000000-0000-4000-8000-000000000515',
    typeId: 10003,
    name: 'Security review checklist',
    url: 'https://example.internal/docs/security-review',
    buttonName: 'Open Checklist',
    description: 'Security review checklist for app, data, access, and deployment risks.',
  },
  {
    key: 'pr_checklist',
    id: '10000000-0000-4000-8000-000000000516',
    typeId: 10003,
    name: 'PR submission checklist',
    url: 'https://example.internal/docs/pr-checklist',
    buttonName: 'Open Checklist',
    description: 'PR checklist for implementation notes, testing evidence, and reviewer context.',
  },
  {
    key: 'deployment_plan_template',
    id: '10000000-0000-4000-8000-000000000517',
    typeId: 10003,
    name: 'Cost, deployment, and maintenance plan template',
    url: 'https://example.internal/templates/deployment-maintenance-plan',
    buttonName: 'Open Template',
    description: 'Template for documenting deployment ownership, cost, maintenance, and monitoring.',
  },
];

const projectStartDate = '2026-05-06';

const dateFromOffset = (offset, duration) => {
  const start = new Date(`${projectStartDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() + offset);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + duration - 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
};

const resourceByKey = new Map(resources.map((resource) => [resource.key, resource]));
const stepByKey = new Map(steps.map((step) => [step.key, step]));

const getTenant = async (client) => {
  const personalTenant = await client.query(
    "SELECT id FROM tenants WHERE name = 'Personal Workspace' LIMIT 1"
  );
  if (personalTenant.rows[0]?.id) return personalTenant.rows[0].id;

  const firstTenant = await client.query('SELECT id FROM tenants ORDER BY name LIMIT 1');
  return firstTenant.rows[0]?.id || null;
};

const getUser = async (client) => {
  const katie = await client.query(
    "SELECT id FROM users WHERE email = 'katie.coleman.ut@gmail.com' LIMIT 1"
  );
  if (katie.rows[0]?.id) return katie.rows[0].id;

  const firstUser = await client.query('SELECT id FROM users ORDER BY created_at DESC LIMIT 1');
  return firstUser.rows[0]?.id || null;
};

const ensurePrerequisites = async (client) => {
  const missing = [];

  const tables = [
    ['resource_types', 10003],
    ['sensitivity_levels', 10001],
    ['expertise_levels', 10001],
    ['target_audiences', 10004],
  ];

  for (const [table, id] of tables) {
    const result = await client.query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
    if (!result.rows[0]) missing.push(`${table}.${id}`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing seed metadata: ${missing.join(', ')}. Run npm run seed first.`
    );
  }
};

const buildStepMetadata = (step, useProjectDependencies = false) => ({
  kind: 'workflow_step',
  relativeStartDay: step.relativeStartDay,
  estimatedDurationDays: step.estimatedDurationDays,
  minDurationDays: Math.max(1, step.estimatedDurationDays - 1),
  maxDurationDays: step.estimatedDurationDays + 3,
  ownerRole: step.ownerRole,
  ownerName: step.ownerName,
  ownerEmail: step.ownerEmail,
  completionCriteria: step.completionCriteria,
  dependsOnStepIds: (step.dependsOn || []).map((key) =>
    useProjectDependencies
      ? stepByKey.get(key).projectAssociationId
      : stepByKey.get(key).templateAssociationId
  ),
  automationHints: {
    suggestedAgentAction: `Check whether "${step.name}" is complete and summarize blockers.`,
  },
});

const upsertCollection = async (client, collection) => {
  await client.query(
    `
      INSERT INTO collections (
        id, name, description, user_id, visibility, status, icon, color, type,
        start_date, end_date, tenant_id, hashtags, workflow_metadata,
        source_template_id, whiteboard_data, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 'external',
        $9, $10, $11, $12, $13::jsonb, $14, $15::jsonb, CURRENT_TIMESTAMP
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        user_id = EXCLUDED.user_id,
        visibility = EXCLUDED.visibility,
        status = EXCLUDED.status,
        icon = EXCLUDED.icon,
        color = EXCLUDED.color,
        type = EXCLUDED.type,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        tenant_id = EXCLUDED.tenant_id,
        hashtags = EXCLUDED.hashtags,
        workflow_metadata = EXCLUDED.workflow_metadata,
        source_template_id = EXCLUDED.source_template_id,
        whiteboard_data = EXCLUDED.whiteboard_data,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      collection.id,
      collection.name,
      collection.description,
      collection.userId,
      collection.visibility,
      collection.status,
      collection.icon,
      collection.color,
      collection.startDate,
      collection.endDate,
      collection.tenantId,
      collection.hashtags,
      JSON.stringify(collection.workflowMetadata),
      collection.sourceTemplateId,
      JSON.stringify(collection.whiteboardData || {}),
    ]
  );
};

const upsertResource = async (client, resource, userId, tenantId) => {
  await client.query(
    `
      INSERT INTO resources (
        id, type_id, url, name, description, resource_date, button_name,
        sensitivity_level_id, expertise_level_id, target_audience_id,
        requires_registration, video_url, added_by_user_id, tenant_id,
        status, full_text, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, CURRENT_DATE, $6,
        10001, 10001, 10004,
        false, $7, $8, $9, 'approved', $10, CURRENT_TIMESTAMP
      )
      ON CONFLICT (id) DO UPDATE SET
        type_id = EXCLUDED.type_id,
        url = EXCLUDED.url,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        button_name = EXCLUDED.button_name,
        video_url = EXCLUDED.video_url,
        added_by_user_id = EXCLUDED.added_by_user_id,
        tenant_id = EXCLUDED.tenant_id,
        status = EXCLUDED.status,
        full_text = EXCLUDED.full_text,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      resource.id,
      resource.typeId,
      resource.url,
      resource.name,
      resource.description,
      resource.buttonName,
      resource.videoUrl || null,
      userId,
      tenantId,
      `${resource.name}\n\n${resource.description}`,
    ]
  );
};

const upsertExternalLink = async (client, step, userId, tenantId) => {
  await client.query(
    `
      INSERT INTO external_links (
        id, url, name, description, notes, date_added, added_by_user_id,
        visibility, type, tenant_id, public_json_enabled, allow_public_notations,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, CURRENT_DATE, $6,
        'private', 'workflow_step', $7, false, false, CURRENT_TIMESTAMP
      )
      ON CONFLICT (id) DO UPDATE SET
        url = EXCLUDED.url,
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        notes = EXCLUDED.notes,
        added_by_user_id = EXCLUDED.added_by_user_id,
        visibility = EXCLUDED.visibility,
        type = EXCLUDED.type,
        tenant_id = EXCLUDED.tenant_id,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      step.externalLinkId,
      step.url,
      step.name,
      step.description,
      step.completionCriteria,
      userId,
      tenantId,
    ]
  );
};

const upsertCollectionExternalLink = async (
  client,
  collectionId,
  step,
  associationId,
  userId,
  metadata,
  status,
  dates
) => {
  await client.query(
    `
      INSERT INTO collection_external_links (
        id, collection_id, external_link_id, user_id, date, start_date, end_date,
        status, notes, sort_order, workflow_metadata, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $5, $6,
        $7, $8, $9, $10::jsonb, CURRENT_TIMESTAMP
      )
      ON CONFLICT (collection_id, external_link_id) DO UPDATE SET
        id = EXCLUDED.id,
        user_id = EXCLUDED.user_id,
        date = EXCLUDED.date,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        sort_order = EXCLUDED.sort_order,
        workflow_metadata = EXCLUDED.workflow_metadata,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      associationId,
      collectionId,
      step.externalLinkId,
      userId,
      dates.startDate,
      dates.endDate,
      status,
      step.completionCriteria,
      step.sortOrder,
      JSON.stringify(metadata),
    ]
  );
};

const upsertStepResources = async (client, collectionId, step, userId) => {
  for (const [index, resourceKey] of step.resources.entries()) {
    const resource = resourceByKey.get(resourceKey);
    if (!resource) continue;

    await client.query(
      `
        INSERT INTO collection_external_link_resources (
          collection_id, external_link_id, resource_id, notes, order_position,
          user_added_by_id, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
        ON CONFLICT (collection_id, external_link_id, resource_id) DO UPDATE SET
          notes = EXCLUDED.notes,
          order_position = EXCLUDED.order_position,
          user_added_by_id = EXCLUDED.user_added_by_id,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        collectionId,
        step.externalLinkId,
        resource.id,
        `Supports workflow step: ${step.name}`,
        index,
        userId,
      ]
    );
  }
};

const upsertNotation = async (
  client,
  id,
  associationId,
  title,
  notes,
  status,
  date,
  userId
) => {
  await client.query(
    `
      INSERT INTO collection_external_links_notations (
        id, collection_external_link_id, title, notes, status, date,
        start_date, end_date, user_id, visibility, list_order, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $6, $6, $7, 'private', 0, CURRENT_TIMESTAMP
      )
      ON CONFLICT (id) DO UPDATE SET
        collection_external_link_id = EXCLUDED.collection_external_link_id,
        title = EXCLUDED.title,
        notes = EXCLUDED.notes,
        status = EXCLUDED.status,
        date = EXCLUDED.date,
        start_date = EXCLUDED.start_date,
        end_date = EXCLUDED.end_date,
        user_id = EXCLUDED.user_id,
        visibility = EXCLUDED.visibility,
        updated_at = CURRENT_TIMESTAMP
    `,
    [id, associationId, title, notes, status, date, userId]
  );
};

async function seedWorkflowDemo() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await ensurePrerequisites(client);

    const tenantId = await getTenant(client);
    const userId = await getUser(client);

    if (!tenantId || !userId) {
      throw new Error('Need at least one tenant and one user before seeding workflow demo data.');
    }

    const projectEndDate = dateFromOffset(62, 5).endDate;

    await upsertCollection(client, {
      id: IDS.templateCollection,
      name: 'Workflow Template: Build a New Application with Codex',
      description:
        'Reusable workflow blueprint for requesting IT setup, creating a development environment, building with Codex, reviewing, and submitting a PR.',
      userId,
      visibility: 'private',
      status: 'active',
      icon: 'code',
      color: 'indigo',
      startDate: null,
      endDate: null,
      tenantId,
      hashtags: 'workflow-template,codex,new-app',
      sourceTemplateId: null,
      workflowMetadata: {
        kind: 'template',
        templateVersion: 1,
        planningViews: ['list', 'calendar', 'timeline'],
        intendedUse:
          'Use this as a reusable blueprint, then instantiate it into a real project with concrete dates.',
      },
      whiteboardData: {
        nodes: steps.map((step) => ({
          id: step.templateAssociationId,
          label: step.name,
          sortOrder: step.sortOrder,
        })),
        edges: steps.flatMap((step) =>
          (step.dependsOn || []).map((dependency) => ({
            from: stepByKey.get(dependency).templateAssociationId,
            to: step.templateAssociationId,
          }))
        ),
      },
    });

    await upsertCollection(client, {
      id: IDS.projectCollection,
      name: 'Demo Project: Trial Finder App Build',
      description:
        'Project instance seeded from the Codex application template with real dates, progress, and attached resources.',
      userId,
      visibility: 'private',
      status: 'active',
      icon: 'code',
      color: 'indigo',
      startDate: projectStartDate,
      endDate: projectEndDate,
      tenantId,
      hashtags: 'workflow-instance,codex,trial-finder',
      sourceTemplateId: IDS.templateCollection,
      workflowMetadata: {
        kind: 'instance',
        sourceTemplateId: IDS.templateCollection,
        sourceTemplateName: 'Workflow Template: Build a New Application with Codex',
        projectStartDate,
        planningViews: ['list', 'calendar', 'timeline'],
        demo: true,
      },
      whiteboardData: {
        nodes: steps.map((step) => ({
          id: step.projectAssociationId,
          label: step.name,
          sortOrder: step.sortOrder,
          status: step.status,
        })),
        edges: steps.flatMap((step) =>
          (step.dependsOn || []).map((dependency) => ({
            from: stepByKey.get(dependency).projectAssociationId,
            to: step.projectAssociationId,
          }))
        ),
      },
    });

    for (const resource of resources) {
      await upsertResource(client, resource, userId, tenantId);
    }

    for (const step of steps) {
      await upsertExternalLink(client, step, userId, tenantId);

      await upsertCollectionExternalLink(
        client,
        IDS.templateCollection,
        step,
        step.templateAssociationId,
        userId,
        buildStepMetadata(step),
        'pending',
        { startDate: null, endDate: null }
      );

      await upsertCollectionExternalLink(
        client,
        IDS.projectCollection,
        step,
        step.projectAssociationId,
        userId,
        {
          ...buildStepMetadata(step, true),
          sourceTemplateStepId: step.templateAssociationId,
        },
        step.status,
        dateFromOffset(step.relativeStartDay, step.estimatedDurationDays)
      );

      await upsertStepResources(client, IDS.templateCollection, step, userId);
      await upsertStepResources(client, IDS.projectCollection, step, userId);
    }

    await upsertNotation(
      client,
      '10000000-0000-4000-8000-000000000601',
      stepByKey.get('submit_process_request').projectAssociationId,
      'Request submitted',
      'Demo ticket APP-1001 submitted with app purpose, sponsor, and requested environment.',
      'completed',
      '2026-05-07',
      userId
    );
    await upsertNotation(
      client,
      '10000000-0000-4000-8000-000000000602',
      stepByKey.get('it_approval').projectAssociationId,
      'IT approval received',
      'IT approved VM and Codex setup request. DevOps can begin provisioning once purchase approval is recorded.',
      'completed',
      '2026-05-12',
      userId
    );
    await upsertNotation(
      client,
      '10000000-0000-4000-8000-000000000603',
      stepByKey.get('devops_vm').projectAssociationId,
      'VM setup in progress',
      'DevOps is waiting on the final image and access group confirmation. This is the active demo blocker.',
      'active',
      '2026-05-22',
      userId
    );
    await upsertNotation(
      client,
      '10000000-0000-4000-8000-000000000604',
      stepByKey.get('codex_account').projectAssociationId,
      'Next action',
      'After VM access is confirmed, request and validate Codex workspace access.',
      'pending',
      '2026-05-23',
      userId
    );

    await client.query('COMMIT');

    console.log('Workflow demo seeded successfully.');
    console.log(
      JSON.stringify(
        {
          tenantId,
          userId,
          templateCollectionId: IDS.templateCollection,
          projectCollectionId: IDS.projectCollection,
          stepCount: steps.length,
          resourceCount: resources.length,
          projectStartDate,
          projectEndDate,
        },
        null,
        2
      )
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to seed workflow demo:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seedWorkflowDemo();
