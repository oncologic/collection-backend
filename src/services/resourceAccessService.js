import { inArray, eq, or, sql } from 'drizzle-orm';
import { resources } from '../models/resources.js';

export const RESOURCE_ACCESS_MODES = {
  AUTHENTICATED: 'authenticated',
  SHARED: 'shared',
  PUBLIC: 'public',
};

const COMMUNITY_TENANT_ID = process.env.COMMUNITY_TENANT;
const buildUuidArraySql = (ids = []) =>
  sql`ARRAY[${sql.join(
    ids.filter(Boolean).map((id) => sql`${id}::uuid`),
    sql`, `
  )}]::uuid[]`;

export const buildResourceTenantCondition = (
  tenantIds = [],
  resourceTable = resources
) => {
  if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
    return sql`1 = 0`;
  }

  return sql`${resourceTable.tenantId} = ANY(${buildUuidArraySql(tenantIds)})`;
};

export const buildAuthenticatedResourceAccessCondition = ({
  userId,
  tenantIds = [],
  resourceTable = resources,
}) => {
  if (!userId || !Array.isArray(tenantIds) || tenantIds.length === 0) {
    return sql`1 = 0`;
  }

  return sql`
    ${buildResourceTenantCondition(tenantIds, resourceTable)}
    AND (
      CASE
        WHEN ${resourceTable.tenantId} = ${COMMUNITY_TENANT_ID}::uuid THEN ${resourceTable.addedByUserId} = ${userId}
        ELSE 1 = 1
      END
    )
  `;
};

export const buildPublicResourceAccessCondition = ({
  tenantIds = [],
  resourceTable = resources,
}) => buildResourceTenantCondition(tenantIds, resourceTable);

export const buildResourceAccessCondition = ({
  accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
  userId = null,
  tenantIds = [],
  resourceTable = resources,
}) => {
  if (accessMode === RESOURCE_ACCESS_MODES.PUBLIC) {
    return buildPublicResourceAccessCondition({ tenantIds, resourceTable });
  }

  return buildAuthenticatedResourceAccessCondition({
    userId,
    tenantIds,
    resourceTable,
  });
};

export const canUserAccessResource = ({
  resource,
  userId = null,
  tenantIds = [],
  accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
}) => {
  if (!resource || !resource.tenantId) {
    return false;
  }

  if (!Array.isArray(tenantIds) || !tenantIds.includes(resource.tenantId)) {
    return false;
  }

  if (accessMode === RESOURCE_ACCESS_MODES.PUBLIC) {
    return true;
  }

  if (!userId) {
    return false;
  }

  return (
    resource.tenantId !== COMMUNITY_TENANT_ID ||
    resource.addedByUserId === userId
  );
};

export const getAllowedResourceChildVisibilities = ({
  accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
  parentOwnerId = null,
  childOwnerId = null,
  viewerUserId = null,
}) => {
  if (accessMode === RESOURCE_ACCESS_MODES.PUBLIC) {
    return ['public'];
  }

  if (accessMode === RESOURCE_ACCESS_MODES.SHARED) {
    return ['public', 'unlisted'];
  }

  if (
    viewerUserId &&
    (viewerUserId === parentOwnerId || viewerUserId === childOwnerId)
  ) {
    return ['public', 'unlisted', 'private'];
  }

  return ['public', 'unlisted'];
};

export const filterResourceChildItemsByVisibility = (
  items = [],
  {
    accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
    parentOwnerId = null,
    viewerUserId = null,
    childOwnerKey = 'userId',
  } = {}
) =>
  items.filter((item) =>
    getAllowedResourceChildVisibilities({
      accessMode,
      parentOwnerId,
      childOwnerId: item?.[childOwnerKey] || null,
      viewerUserId,
    }).includes(item?.visibility || 'private')
  );

export const buildResourceChildVisibilityCondition = ({
  childVisibilityField,
  childOwnerField = null,
  parentOwnerField = null,
  viewerUserId = null,
  accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
}) => {
  if (accessMode === RESOURCE_ACCESS_MODES.PUBLIC) {
    return eq(childVisibilityField, 'public');
  }

  if (accessMode === RESOURCE_ACCESS_MODES.SHARED) {
    return inArray(childVisibilityField, ['public', 'unlisted']);
  }

  const clauses = [inArray(childVisibilityField, ['public', 'unlisted'])];

  if (viewerUserId && parentOwnerField) {
    clauses.push(eq(parentOwnerField, viewerUserId));
  }

  if (viewerUserId && childOwnerField) {
    clauses.push(eq(childOwnerField, viewerUserId));
  }

  return or(...clauses);
};
