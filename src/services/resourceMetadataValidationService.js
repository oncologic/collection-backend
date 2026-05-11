import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { resourceTypes } from '../models/metadata.js';
import { tags } from '../models/tags.js';

const normalizeNumericIds = (values = []) =>
  [...new Set((Array.isArray(values) ? values : [values])
    .map((value) => (typeof value === 'object' ? value?.id : value))
    .filter((value) => value !== null && value !== undefined)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value)))];

const buildTenantScopedVisibilityCondition = (table, tenantId, userId) =>
  or(
    and(eq(table.visibility, 'public'), eq(table.tenantId, tenantId)),
    and(eq(table.visibility, 'tenant'), eq(table.tenantId, tenantId)),
    and(
      eq(table.visibility, 'private'),
      eq(table.tenantId, tenantId),
      eq(table.addedByUserId, userId)
    )
  );

export async function assertResourceTypeAccessibleForTenant({
  tenantId,
  typeId,
  userId,
}) {
  if (!typeId) {
    return;
  }

  const normalizedTypeId = Number(typeId);
  if (!Number.isFinite(normalizedTypeId)) {
    throw new Error('Resource type is invalid');
  }

  const [matchedType] = await db
    .select({
      id: resourceTypes.id,
    })
    .from(resourceTypes)
    .where(
      and(
        eq(resourceTypes.id, normalizedTypeId),
        or(
          sql`${resourceTypes.tenantId} IS NULL`,
          buildTenantScopedVisibilityCondition(resourceTypes, tenantId, userId)
        )
      )
    )
    .limit(1);

  if (!matchedType) {
    throw new Error(
      'Resource type must belong to the selected tenant or be a global type'
    );
  }
}

export async function assertTagsAccessibleForTenant({
  tenantId,
  tagIds = [],
  userId,
}) {
  const normalizedTagIds = normalizeNumericIds(tagIds);
  if (normalizedTagIds.length === 0) {
    return;
  }

  const matchedTags = await db
    .select({
      id: tags.id,
    })
    .from(tags)
    .where(
      and(
        inArray(tags.id, normalizedTagIds),
        buildTenantScopedVisibilityCondition(tags, tenantId, userId)
      )
    );

  if (matchedTags.length !== normalizedTagIds.length) {
    throw new Error(
      'Tags must belong to the selected tenant and be visible to the current user'
    );
  }
}

export async function assertResourceMetadataSelectionsForTenant({
  tenantId,
  typeId,
  tagIds = [],
  userId,
}) {
  if (!tenantId) {
    throw new Error('Tenant ID is required for resource metadata validation');
  }

  await assertResourceTypeAccessibleForTenant({
    tenantId,
    typeId,
    userId,
  });

  await assertTagsAccessibleForTenant({
    tenantId,
    tagIds,
    userId,
  });
}
