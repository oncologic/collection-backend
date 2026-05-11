import { db } from '../db/index.js';
import {
  eq,
  and,
  sql,
  inArray,
  or,
  ilike,
  isNull,
  isNotNull,
} from 'drizzle-orm';
import { attachments } from '../models/attachments.js';
import { externalLinkAttachments } from '../models/externalLinkAttachments.js';
import { notationAttachments } from '../models/notationAttachments.js';
import { resourceAttachments } from '../models/resourceAttachments.js';
import {
  externalLinks,
  collectionExternalLinks,
} from '../models/external_links.js';
import { collections } from '../models/collections.js';
import { resources } from '../models/resources.js';
import { collectionCollaborators } from '../models/collectionCollaborators.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import { generateUUID } from '../utils/general.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { autoUpdateAttachmentEmbedding } from './vectorService.js';
import e from 'express';
import { getNotationsByIdsService } from './notationService.js';
import {
  buildResourceAccessCondition,
  buildResourceChildVisibilityCondition,
  RESOURCE_ACCESS_MODES,
} from './resourceAccessService.js';

export const createAttachmentService = async ({
  title,
  description,
  type,
  imageKey,
  highlighted,
  externalLinkId,
  resourceId,
  userId,
  tenantId,
  visibility,
}) => {
  try {
    // Default to private if no visibility specified
    if (!visibility) {
      visibility = 'private';
    }
    // Use a transaction to ensure both operations succeed or fail together
    const result = await db.transaction(async (tx) => {
      const id = generateUUID();
      // Create the attachment first
      const [attachment] = await tx
        .insert(attachments)
        .values({
          id,
          title,
          description,
          type,
          imageKey,
          userId,
          tenantId,
          visibility,
        })
        .returning();

      // If externalLinkId is provided, create the association
      if (externalLinkId) {
        await tx.insert(externalLinkAttachments).values({
          externalLinkId,
          attachmentId: attachment.id,
          highlighted: highlighted || false,
        });
      }

      if (resourceId) {
        await tx.insert(resourceAttachments).values({
          resourceId,
          attachmentId: attachment.id,
          highlighted: highlighted || false,
        });
      }

      return { id, ...attachment };
    });

    // Auto-update embeddings for the new attachment (async, don't wait)
    autoUpdateAttachmentEmbedding(result.id).catch((error) => {
      console.error(
        `Failed to update embeddings for attachment ${result.id}:`,
        error
      );
    });

    return result;
  } catch (error) {
    console.error('Error in createAttachmentService:', error);
    throw new Error(`Failed to create attachment: ${error.message}`);
  }
};

export const deleteAttachmentService = async (id) => {
  //first delete from externalLinkAttachments
  await db
    .delete(externalLinkAttachments)
    .where(eq(externalLinkAttachments.attachmentId, id));

  await db
    .delete(resourceAttachments)
    .where(eq(resourceAttachments.attachmentId, id));

  //then delete from attachments
  await db.delete(attachments).where(eq(attachments.id, id));
};

export const findAttachmentByUserById = async (id, userId) => {
  const result = await db.execute(
    sql`SELECT * FROM attachments WHERE id = ${id} AND user_id = ${userId} LIMIT 1`
  );

  return result.rows[0] || null;
};

export async function getAttachmentsByIds(
  attachmentIds,
  userId = null,
  tenants
) {
  try {
    // Convert to array if single ID
    const idsArray = Array.isArray(attachmentIds)
      ? attachmentIds
      : [attachmentIds];
    let tenantsArray;

    // Handle the case where tenants might be passed as a number
    if (typeof tenants === 'number' || typeof tenants === 'string') {
      tenantsArray = [tenants];
    } else {
      tenantsArray = Array.isArray(tenants) ? tenants : [tenants];
    }

    // Filter out any null/undefined values
    const validIds = idsArray.filter((id) => id != null);
    // Don't try to parse UUIDs as integers - just filter nulls
    const validTenants = tenantsArray.filter((t) => t != null);

    // Return empty array if no IDs provided
    if (!validIds.length || !validTenants.length) {
      return [];
    }

    // Convert arrays to PostgreSQL array format for the SQL query
    const idsForQuery = sql`ARRAY[${sql.join(validIds.map(id => sql`${id}`), sql`, `)}]::uuid[]`;
    const tenantsForQuery = sql`ARRAY[${sql.join(validTenants.map(t => sql`${t}`), sql`, `)}]::uuid[]`;

    const accessMode = userId
      ? RESOURCE_ACCESS_MODES.AUTHENTICATED
      : RESOURCE_ACCESS_MODES.PUBLIC;

    // Use raw SQL for complex hierarchical permission checks
    const attachmentsData = await db.execute(sql`
      SELECT DISTINCT
        a.id,
        a.title,
        a.description,
        a.type,
        a.image_key as "imageKey",
        a.created_at as "createdAt",
        a.updated_at as "updatedAt",
        a.list_order as "listOrder",
        a.visibility,
        a.user_id as "userId",
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'externalLinkId', ela.external_link_id,
              'highlighted', ela.highlighted
            )
          ) FILTER (WHERE ela.external_link_id IS NOT NULL),
          '[]'::jsonb
        ) as "externalLinks"
      FROM attachments a
      LEFT JOIN external_link_attachments ela ON a.id = ela.attachment_id
      LEFT JOIN external_links el ON ela.external_link_id = el.id
      LEFT JOIN collection_external_links cel ON el.id = cel.external_link_id
      LEFT JOIN collections c ON cel.collection_id = c.id
      LEFT JOIN collection_collaborators cc ON c.id = cc.collection_id AND cc.user_id = ${userId}
      LEFT JOIN collection_external_links_collaborators celc ON cel.id = celc.collection_external_link_id AND celc.user_id = ${userId}
      WHERE
        a.id = ANY(${idsForQuery})
        AND a.tenant_id = ANY(${tenantsForQuery})
        AND (
          -- Case 1: Standalone attachment (not linked to any external link)
          (
            NOT EXISTS (
              SELECT 1 FROM external_link_attachments ela2 
              WHERE ela2.attachment_id = a.id
            )
            AND (a.visibility IN ('public', 'unlisted') OR a.user_id = ${userId})
          )
          -- Case 2: Attachment linked to external link - check full hierarchy
          OR (
            EXISTS (
              SELECT 1 FROM external_link_attachments ela2 
              WHERE ela2.attachment_id = a.id
            )
            AND (
              -- Parent collection must be accessible
              c.visibility IN ('public', 'unlisted')
              OR c.user_id = ${userId}
              OR (c.visibility IN ('unlisted', 'public') AND cc.id IS NOT NULL)
            )
            AND (
              -- Parent external link must be accessible
              el.visibility IN ('public', 'unlisted')
              OR el.added_by_user_id = ${userId}
              OR (el.visibility IN ('unlisted', 'public') AND celc.id IS NOT NULL)
            )
            AND (
              -- Attachment permissions
              a.visibility IN ('public', 'unlisted')
              OR el.added_by_user_id = ${userId}  -- Owner of external link can see all attachments
              OR (celc.id IS NOT NULL AND (a.visibility IN ('public', 'unlisted') OR a.user_id = ${userId}))
            )
          )
        )
      GROUP BY a.id
    `);

    const resourceAttachmentRows = await db
      .select({
        id: attachments.id,
        title: attachments.title,
        description: attachments.description,
        type: attachments.type,
        imageKey: attachments.imageKey,
        createdAt: attachments.createdAt,
        updatedAt: attachments.updatedAt,
        listOrder: attachments.listOrder,
        visibility: attachments.visibility,
        userId: attachments.userId,
        resourceId: resourceAttachments.resourceId,
        highlighted: resourceAttachments.highlighted,
        sortOrder: resourceAttachments.sortOrder,
      })
      .from(attachments)
      .innerJoin(
        resourceAttachments,
        eq(attachments.id, resourceAttachments.attachmentId)
      )
      .innerJoin(resources, eq(resourceAttachments.resourceId, resources.id))
      .where(
        and(
          inArray(attachments.id, validIds),
          inArray(attachments.tenantId, validTenants),
          inArray(resources.tenantId, validTenants),
          eq(resources.status, 'approved'),
          buildResourceAccessCondition({
            accessMode,
            userId,
            tenantIds: validTenants,
            resourceTable: resources,
          }),
          buildResourceChildVisibilityCondition({
            childVisibilityField: attachments.visibility,
            childOwnerField: attachments.userId,
            parentOwnerField: resources.addedByUserId,
            viewerUserId: userId,
            accessMode,
          })
        )
      );

    const mergedAttachments = new Map(
      attachmentsData.rows.map((attachment) => [
        attachment.id,
        {
          ...attachment,
          resources: [],
        },
      ])
    );

    resourceAttachmentRows.forEach((row) => {
      const existing = mergedAttachments.get(row.id);
      const resourceLink = {
        resourceId: row.resourceId,
        highlighted: row.highlighted,
        sortOrder: row.sortOrder,
      };

      if (existing) {
        existing.resources = existing.resources || [];
        existing.resources.push(resourceLink);
        return;
      }

      mergedAttachments.set(row.id, {
        id: row.id,
        title: row.title,
        description: row.description,
        type: row.type,
        imageKey: row.imageKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        listOrder: row.listOrder,
        visibility: row.visibility,
        userId: row.userId,
        externalLinks: [],
        resources: [resourceLink],
      });
    });

    // Add presigned URLs for attachments that have imageKeys
    return Array.from(mergedAttachments.values()).map((attachment) => ({
      ...attachment,
      presignedUrl: attachment.imageKey
        ? generatePresignedCloudFrontUrl(attachment.imageKey)
        : null,
    }));
  } catch (error) {
    console.error('Error in getAttachmentsByIds:', error);
    throw new Error('Failed to fetch attachments');
  }
}

export async function findAccessibleAttachmentByImageKey(
  imageKey,
  userId = null,
  tenants = []
) {
  const [attachment] = await db
    .select({
      id: attachments.id,
      imageKey: attachments.imageKey,
      type: attachments.type,
      visibility: attachments.visibility,
    })
    .from(attachments)
    .where(eq(attachments.imageKey, imageKey))
    .limit(1);

  if (!attachment) {
    return null;
  }

  const directlyAccessible = await getAttachmentsByIds(
    [attachment.id],
    userId,
    tenants
  );

  if (directlyAccessible.length > 0) {
    return directlyAccessible[0];
  }

  const notationLinks = await db
    .select({
      notationId: notationAttachments.notationId,
    })
    .from(notationAttachments)
    .where(eq(notationAttachments.attachmentId, attachment.id));

  if (!notationLinks.length) {
    return null;
  }

  const visibleNotations = await getNotationsByIdsService(
    notationLinks.map((link) => link.notationId),
    userId,
    tenants
  );

  if (!visibleNotations.length) {
    return null;
  }

  return attachment;
}

export const searchAttachments = async ({
  q: query,
  userId,
  tenantIds = [],
}) => {
  try {
    const normalizedTenantIds = Array.isArray(tenantIds)
      ? tenantIds.filter(Boolean)
      : tenantIds
        ? [tenantIds]
        : [];

    if (!query?.trim() || !userId || normalizedTenantIds.length === 0) {
      return [];
    }

    const attachmentsData = await db
      .select({
        id: attachments.id,
        title: attachments.title,
        description: attachments.description,
        type: attachments.type,
        imageKey: attachments.imageKey,
        createdAt: attachments.createdAt,
        updatedAt: attachments.updatedAt,
        listOrder: attachments.listOrder,
        visibility: attachments.visibility,
        userId: attachments.userId,
        externalLinks: sql`
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'externalLinkId', ${externalLinkAttachments.externalLinkId},
                'highlighted', ${externalLinkAttachments.highlighted}
              )
            ) FILTER (WHERE ${externalLinkAttachments.externalLinkId} IS NOT NULL),
            '[]'::jsonb
          )
        `,
        resources: sql`
          COALESCE(
            jsonb_agg(
              DISTINCT jsonb_build_object(
                'resourceId', ${resourceAttachments.resourceId},
                'highlighted', ${resourceAttachments.highlighted}
              )
            ) FILTER (WHERE ${resourceAttachments.resourceId} IS NOT NULL),
            '[]'::jsonb
          )
        `,
      })
      .from(attachments)
      .leftJoin(
        externalLinkAttachments,
        eq(attachments.id, externalLinkAttachments.attachmentId)
      )
      .leftJoin(
        resourceAttachments,
        eq(attachments.id, resourceAttachments.attachmentId)
      )
      .where(
        and(
          eq(attachments.userId, userId),
          inArray(attachments.tenantId, normalizedTenantIds),
          or(
            ilike(attachments.title, `%${query}%`),
            ilike(attachments.description, `%${query}%`)
          )
        )
      )
      .groupBy(attachments.id);

    return attachmentsData;
  } catch (error) {
    console.error('Error in searchAttachments:', error);
    throw new Error('Failed to search attachments');
  }
};

export const addExistingAttachmentToExternalLink = async ({
  attachmentId,
  externalLinkId,
  highlighted = false,
  tenantId,
}) => {
  try {
    await db.insert(externalLinkAttachments).values({
      externalLinkId,
      attachmentId,
      highlighted,
    });

    // Return a simple success response with the attachment ID instead of fetching the full attachment
    // This avoids the complex parameter requirements of getAttachmentsByIds
    return {
      id: attachmentId,
      externalLinkId,
      highlighted,
      success: true,
    };
  } catch (error) {
    console.error('Error in addExistingAttachmentToExternalLink:', error);
    throw new Error(`Failed to link attachment: ${error.message}`);
  }
};

export const addExistingAttachmentToResource = async ({
  attachmentId,
  resourceId,
  highlighted = false,
}) => {
  try {
    await db.insert(resourceAttachments).values({
      resourceId,
      attachmentId,
      highlighted,
    });

    return {
      id: attachmentId,
      resourceId,
      highlighted,
      success: true,
    };
  } catch (error) {
    console.error('Error in addExistingAttachmentToResource:', error);
    throw new Error(`Failed to link attachment to resource: ${error.message}`);
  }
};

export const removeAttachmentFromExternalLink = async ({
  attachmentId,
  externalLinkId,
}) => {
  try {
    await db
      .delete(externalLinkAttachments)
      .where(
        and(
          eq(externalLinkAttachments.attachmentId, attachmentId),
          eq(externalLinkAttachments.externalLinkId, externalLinkId)
        )
      );

    return { success: true };
  } catch (error) {
    console.error('Error in removeAttachmentFromExternalLink:', error);
    throw new Error(
      `Failed to remove attachment from external link: ${error.message}`
    );
  }
};

export const removeAttachmentFromResource = async ({
  attachmentId,
  resourceId,
}) => {
  try {
    await db
      .delete(resourceAttachments)
      .where(
        and(
          eq(resourceAttachments.attachmentId, attachmentId),
          eq(resourceAttachments.resourceId, resourceId)
        )
      );

    return { success: true };
  } catch (error) {
    console.error('Error in removeAttachmentFromResource:', error);
    throw new Error(
      `Failed to remove attachment from resource: ${error.message}`
    );
  }
};

export const checkAttachmentReferences = async (attachmentId) => {
  try {
    // Check if attachment has any references in externalLinkAttachments
    const externalLinkRefs = await db
      .select({ count: sql`count(*)` })
      .from(externalLinkAttachments)
      .where(eq(externalLinkAttachments.attachmentId, attachmentId));

    const resourceRefs = await db
      .select({ count: sql`count(*)` })
      .from(resourceAttachments)
      .where(eq(resourceAttachments.attachmentId, attachmentId));

    const externalLinkCount = parseInt(externalLinkRefs[0].count);
    const resourceCount = parseInt(resourceRefs[0].count);
    const hasReferences = externalLinkCount > 0 || resourceCount > 0;

    return {
      hasReferences,
      externalLinkCount,
      resourceCount,
    };
  } catch (error) {
    console.error('Error in checkAttachmentReferences:', error);
    throw new Error(`Failed to check attachment references: ${error.message}`);
  }
};

export const getAttachmentsForExternalLinks = async (
  externalLinkIds,
  userId
) => {
  try {
    // Note: This function assumes the caller has already verified access to the external links
    // The permission check here is only for the attachments themselves
    const attachmentsData = await db
      .select({
        id: attachments.id,
        title: attachments.title,
        description: attachments.description,
        type: attachments.type,
        imageKey: attachments.imageKey,
        createdAt: attachments.createdAt,
        updatedAt: attachments.updatedAt,
        listOrder: attachments.listOrder,
        visibility: attachments.visibility,
        userId: attachments.userId,
        externalLinkId: externalLinkAttachments.externalLinkId,
        highlighted: externalLinkAttachments.highlighted,
      })
      .from(attachments)
      .innerJoin(
        externalLinkAttachments,
        eq(attachments.id, externalLinkAttachments.attachmentId)
      )
      .where(
        and(
          inArray(
            externalLinkAttachments.externalLinkId,
            Array.isArray(externalLinkIds) ? externalLinkIds : [externalLinkIds]
          ),
          or(
            eq(attachments.visibility, 'public'),
            eq(attachments.visibility, 'unlisted'),
            eq(attachments.userId, userId)
          )
        )
      );

    // Return the array directly instead of grouping
    return attachmentsData;
  } catch (error) {
    console.error('Error in getAttachmentsForExternalLinks:', error);
    throw new Error('Failed to fetch attachments for external links');
  }
};

export const getBasicAttachmentsByIdsService = async (
  attachmentIds,
  userId,
  tenants
) => {
  try {
    // Ensure attachmentIds and tenants are arrays
    const idsArray = Array.isArray(attachmentIds)
      ? attachmentIds
      : [attachmentIds];
    let tenantsArray;

    // Handle the case where tenants might be passed as a number
    if (typeof tenants === 'number' || typeof tenants === 'string') {
      tenantsArray = [tenants];
    } else {
      tenantsArray = Array.isArray(tenants) ? tenants : [tenants];
    }

    // Filter out any null/undefined values
    const validIds = idsArray.filter((id) => id != null);
    // Don't try to parse UUIDs as integers - just filter nulls
    const validTenants = tenantsArray.filter((t) => t != null);

    // Return empty array if no IDs provided
    if (!validIds.length || !validTenants.length) {
      return [];
    }

    // Use Drizzle query builder instead of raw SQL to avoid array issues
    const baseQuery = db
      .select({
        id: attachments.id,
        title: attachments.title,
        type: attachments.type,
        imageKey: attachments.imageKey,
        visibility: attachments.visibility,
        userId: attachments.userId,
        externalLinkId: externalLinkAttachments.externalLinkId,
      })
      .from(attachments)
      .leftJoin(
        externalLinkAttachments,
        eq(attachments.id, externalLinkAttachments.attachmentId)
      )
      .leftJoin(
        externalLinks,
        eq(externalLinkAttachments.externalLinkId, externalLinks.id)
      )
      .leftJoin(
        collectionExternalLinks,
        eq(externalLinks.id, collectionExternalLinks.externalLinkId)
      )
      .leftJoin(
        collections,
        eq(collectionExternalLinks.collectionId, collections.id)
      )
      .leftJoin(
        collectionCollaborators,
        and(
          eq(collections.id, collectionCollaborators.collectionId),
          eq(collectionCollaborators.userId, userId)
        )
      )
      .leftJoin(
        collectionExternalLinkCollaborators,
        and(
          eq(
            collectionExternalLinks.id,
            collectionExternalLinkCollaborators.collectionExternalLinkId
          ),
          eq(collectionExternalLinkCollaborators.userId, userId)
        )
      )
      .where(
        and(
          inArray(attachments.id, validIds),
          inArray(attachments.tenantId, validTenants),
          or(
            // Case 1: Standalone attachment
            and(
              isNull(externalLinkAttachments.externalLinkId),
              or(
                eq(attachments.visibility, 'public'),
                eq(attachments.userId, userId)
              )
            ),
            // Case 2: Attachment linked to external link - check hierarchy
            and(
              isNotNull(externalLinkAttachments.externalLinkId),
              // Parent collection must be accessible
              or(
                eq(collections.visibility, 'public'),
                eq(collections.userId, userId),
                and(
                  inArray(collections.visibility, ['unlisted', 'public']),
                  isNotNull(collectionCollaborators.id)
                )
              ),
              // Parent external link must be accessible
              or(
                eq(externalLinks.visibility, 'public'),
                eq(externalLinks.addedByUserId, userId),
                and(
                  inArray(externalLinks.visibility, ['unlisted', 'public']),
                  isNotNull(collectionExternalLinkCollaborators.id)
                )
              ),
              // Attachment permissions
              or(
                eq(attachments.visibility, 'public'),
                eq(externalLinks.addedByUserId, userId),
                and(
                  isNotNull(collectionExternalLinkCollaborators.id),
                  or(
                    inArray(attachments.visibility, ['public', 'unlisted']),
                    eq(attachments.userId, userId)
                  )
                )
              )
            )
          )
        )
      );

    const results = await baseQuery;
    const accessMode = userId
      ? RESOURCE_ACCESS_MODES.AUTHENTICATED
      : RESOURCE_ACCESS_MODES.PUBLIC;

    const resourceLinkedResults = await db
      .select({
        id: attachments.id,
        title: attachments.title,
        type: attachments.type,
        imageKey: attachments.imageKey,
        visibility: attachments.visibility,
        userId: attachments.userId,
        resourceId: resourceAttachments.resourceId,
      })
      .from(attachments)
      .innerJoin(
        resourceAttachments,
        eq(attachments.id, resourceAttachments.attachmentId)
      )
      .innerJoin(resources, eq(resourceAttachments.resourceId, resources.id))
      .where(
        and(
          inArray(attachments.id, validIds),
          inArray(attachments.tenantId, validTenants),
          inArray(resources.tenantId, validTenants),
          eq(resources.status, 'approved'),
          buildResourceAccessCondition({
            accessMode,
            userId,
            tenantIds: validTenants,
            resourceTable: resources,
          }),
          buildResourceChildVisibilityCondition({
            childVisibilityField: attachments.visibility,
            childOwnerField: attachments.userId,
            parentOwnerField: resources.addedByUserId,
            viewerUserId: userId,
            accessMode,
          })
        )
      );

    const mergedResults = new Map(
      results.map((result) => [
        result.id,
        {
          ...result,
          resourceId: null,
        },
      ])
    );

    resourceLinkedResults.forEach((result) => {
      if (mergedResults.has(result.id)) {
        return;
      }

      mergedResults.set(result.id, {
        ...result,
        externalLinkId: null,
      });
    });

    //add presigned url to imageKey
    const processedResults = Array.from(mergedResults.values()).map((result) => ({
      ...result,
      presignedUrl: result.imageKey
        ? generatePresignedCloudFrontUrl(result.imageKey)
        : null,
    }));

    return processedResults;
  } catch (error) {
    console.error('Error in getBasicAttachmentsByIdsService:', error);
    throw new Error('Failed to fetch attachments');
  }
};

export const updateAttachmentService = async ({
  id,
  title,
  description,
  visibility,
  highlighted,
  userId,
}) => {
  try {
    // Prepare update data
    const updateData = {};

    // Only include fields that are provided
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (visibility !== undefined) {
      // Handle visibility transformation if needed
      updateData.visibility =
        visibility === 'collaborators' ? 'unlisted' : visibility;
    }

    // Update the attachment
    const [updatedAttachment] = await db
      .update(attachments)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
      .returning();

    if (!updatedAttachment) {
      throw new Error('Failed to update attachment');
    }

    // Auto-update embeddings for the updated attachment (async, don't wait)
    autoUpdateAttachmentEmbedding(id).catch((error) => {
      console.error(`Failed to update embeddings for attachment ${id}:`, error);
    });

    // Get the updated attachment with external links
    const result = updatedAttachment;
    return result[0];
  } catch (error) {
    console.error('Error in updateAttachmentService:', error);
    throw new Error(`Failed to update attachment: ${error.message}`);
  }
};

export const attachmentService = {
  createAttachmentService,
  deleteAttachmentService,
  findAttachmentByUserById,
  getAttachmentsByIds,
  searchAttachments,
  addExistingAttachmentToExternalLink,
  addExistingAttachmentToResource,
  removeAttachmentFromExternalLink,
  removeAttachmentFromResource,
  checkAttachmentReferences,
  getAttachmentsForExternalLinks,
  getBasicAttachmentsByIdsService,
  updateAttachmentService,
};
