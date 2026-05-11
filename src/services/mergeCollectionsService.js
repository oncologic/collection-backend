import { db } from '../db/index.js';
import { eq, and, sql } from 'drizzle-orm';
import {
  collections,
  collectionExternalLinks,
  collectionResources,
  collectionCollaborators,
} from '../models/collections.js';
import { getUserTenants } from './userService.js';

/**
 * Merges two collections together
 * @param {Object} params - Merge parameters
 * @param {string} params.sourceCollectionId - Collection to merge from
 * @param {string} params.targetCollectionId - Collection to merge into
 * @param {Object} params.mergeOptions - Options for the merge
 * @param {boolean} params.mergeOptions.keepSourceCollection - Whether to keep source collection after merge
 * @param {string} params.mergeOptions.conflictResolution - How to handle conflicts ('target' or 'source')
 * @param {Object} params.user - User performing the merge
 * @returns {Object} Merge result with counts and status
 */
export async function mergeCollectionsService({
  sourceCollectionId,
  targetCollectionId,
  mergeOptions = { keepSourceCollection: false, conflictResolution: 'target' },
  user,
}) {
  try {
    // Validate user
    if (!user || !user.id) {
      throw new Error('User information is required');
    }

    // Start a transaction
    return await db.transaction(async (tx) => {
      // 1. Verify both collections exist and user has access
      const [sourceCollection] = await tx
        .select()
        .from(collections)
        .where(
          and(
            eq(collections.id, sourceCollectionId),
            eq(collections.userId, user.id)
          )
        );

      const [targetCollection] = await tx
        .select()
        .from(collections)
        .where(
          and(
            eq(collections.id, targetCollectionId),
            eq(collections.userId, user.id)
          )
        );

      if (!sourceCollection || !targetCollection) {
        throw new Error('One or both collections not found or access denied');
      }

      if (sourceCollectionId === targetCollectionId) {
        throw new Error('Cannot merge a collection with itself');
      }

      // 2. Merge external links
      const externalLinksMerged = await mergeExternalLinks(
        tx,
        sourceCollectionId,
        targetCollectionId,
        user.id,
        mergeOptions.conflictResolution
      );

      // 3. Merge resources
      const resourcesMerged = await mergeResources(
        tx,
        sourceCollectionId,
        targetCollectionId,
        user.id,
        mergeOptions.conflictResolution
      );

      // 4. Merge collaborators
      const collaboratorsMerged = await mergeCollaborators(
        tx,
        sourceCollectionId,
        targetCollectionId,
        mergeOptions.conflictResolution
      );

      // 5. Log the merge operation
      const mergeMetadata = {
        externalLinksMerged,
        resourcesMerged,
        collaboratorsMerged,
        sourceCollection: {
          id: sourceCollection.id,
          name: sourceCollection.name,
        },
        targetCollection: {
          id: targetCollection.id,
          name: targetCollection.name,
        },
        mergeOptions,
      };

      await tx.execute(sql`
        INSERT INTO collection_merges (
          source_collection_id,
          target_collection_id,
          merge_type,
          source_deleted,
          merge_metadata,
          merged_by_user_id,
          merged_by_organization_id,
          created_at
        ) VALUES (
          ${sourceCollectionId},
          ${targetCollectionId},
          'full',
          ${!mergeOptions.keepSourceCollection},
          ${JSON.stringify(mergeMetadata)}::jsonb,
          ${user.id},
          ${null},
          CURRENT_TIMESTAMP
        )
      `);

      // 6. Delete source collection if requested
      if (!mergeOptions.keepSourceCollection) {
        // First, we need to handle notations that reference the source collection's external links
        // Get all external link IDs from both collections
        const sourceExternalLinkIds = await tx.execute(sql`
          SELECT external_link_id 
          FROM collection_external_links 
          WHERE collection_id = ${sourceCollectionId}
        `);

        // For each external link that exists in both collections, update notations to point to target
        for (const row of sourceExternalLinkIds.rows) {
          const externalLinkId = row.external_link_id;

          // Check if this external link exists in target collection
          const targetLink = await tx.execute(sql`
            SELECT id FROM collection_external_links 
            WHERE collection_id = ${targetCollectionId} 
            AND external_link_id = ${externalLinkId}
          `);

          if (targetLink.rows.length > 0) {
            // Update notations to point to the target collection's external link
            await tx.execute(sql`
              UPDATE collection_external_links_notations 
              SET collection_external_link_id = ${targetLink.rows[0].id}
              WHERE collection_external_link_id IN (
                SELECT id FROM collection_external_links 
                WHERE collection_id = ${sourceCollectionId} 
                AND external_link_id = ${externalLinkId}
              )
            `);
          }
        }

        // Before deleting, update any merge records that reference this collection as a target
        await tx.execute(sql`
          UPDATE collection_merges 
          SET target_collection_id = ${targetCollectionId}
          WHERE target_collection_id = ${sourceCollectionId}
        `);

        // Now we can safely delete the source collection
        await tx
          .delete(collections)
          .where(eq(collections.id, sourceCollectionId));
      }

      // 7. Update target collection's updatedAt timestamp
      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, targetCollectionId));

      return {
        success: true,
        sourceCollectionId,
        targetCollectionId,
        sourceDeleted: !mergeOptions.keepSourceCollection,
        counts: {
          externalLinks: externalLinksMerged,
          resources: resourcesMerged,
          collaborators: collaboratorsMerged,
        },
      };
    });
  } catch (error) {
    console.error('Error merging collections:', error);
    throw error;
  }
}

/**
 * Merge external links from source to target collection
 */
async function mergeExternalLinks(
  tx,
  sourceCollectionId,
  targetCollectionId,
  userId,
  conflictResolution
) {
  // Get existing external links in target to check for duplicates
  const existingTargetLinks = await tx
    .select({ externalLinkId: collectionExternalLinks.externalLinkId })
    .from(collectionExternalLinks)
    .where(eq(collectionExternalLinks.collectionId, targetCollectionId));

  const existingLinkIds = new Set(
    existingTargetLinks.map((link) => link.externalLinkId)
  );

  // Get source external links
  const sourceLinks = await tx
    .select()
    .from(collectionExternalLinks)
    .where(eq(collectionExternalLinks.collectionId, sourceCollectionId));

  let mergedCount = 0;

  for (const sourceLink of sourceLinks) {
    if (existingLinkIds.has(sourceLink.externalLinkId)) {
      // Handle conflict based on resolution strategy
      if (conflictResolution === 'source') {
        // Update existing link with source data
        await tx
          .update(collectionExternalLinks)
          .set({
            notes: sourceLink.notes,
            userId: sourceLink.userId,
            organizationId: sourceLink.organizationId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(collectionExternalLinks.collectionId, targetCollectionId),
              eq(
                collectionExternalLinks.externalLinkId,
                sourceLink.externalLinkId
              )
            )
          );
      }
      // If 'target', we keep the existing target link data
    } else {
      // No conflict, insert the link
      await tx.insert(collectionExternalLinks).values({
        collectionId: targetCollectionId,
        externalLinkId: sourceLink.externalLinkId,
        notes: sourceLink.notes,
        userId: sourceLink.userId,
        organizationId: sourceLink.organizationId,
        createdAt: sourceLink.createdAt,
        updatedAt: new Date(),
      });
      mergedCount++;
    }

    // Skip merging permissions for now as the table might not exist
    // TODO: Uncomment when collection_external_link_permissions table is created
    // await mergeExternalLinkPermissions(
    //   tx,
    //   sourceLink.externalLinkId,
    //   sourceCollectionId,
    //   targetCollectionId
    // );
  }

  return mergedCount;
}

// TODO: Uncomment when collection_external_link_permissions table is created
// /**
//  * Merge external link permissions
//  */
// async function mergeExternalLinkPermissions(
//   tx,
//   externalLinkId,
//   sourceCollectionId,
//   targetCollectionId
// ) {
//   // Get source permissions
//   const sourcePermissions = await tx
//     .select()
//     .from(collectionExternalLinkPermissions)
//     .where(
//       and(
//         eq(collectionExternalLinkPermissions.collectionId, sourceCollectionId),
//         eq(collectionExternalLinkPermissions.externalLinkId, externalLinkId)
//       )
//     );

//   // Check if target permissions already exist
//   const existingTargetPermissions = await tx
//     .select()
//     .from(collectionExternalLinkPermissions)
//     .where(
//       and(
//         eq(collectionExternalLinkPermissions.collectionId, targetCollectionId),
//         eq(collectionExternalLinkPermissions.externalLinkId, externalLinkId)
//       )
//     );

//   const existingUserIds = new Set(
//     existingTargetPermissions.map((p) => p.userId || p.organizationId)
//   );

//   // Insert non-duplicate permissions
//   for (const permission of sourcePermissions) {
//     const identifier = permission.userId || permission.organizationId;
//     if (!existingUserIds.has(identifier)) {
//       await tx.insert(collectionExternalLinkPermissions).values({
//         ...permission,
//         id: undefined, // Let DB generate new ID
//         collectionId: targetCollectionId,
//         collectionExternalLinkId: undefined, // This will be set by the DB
//       });
//     }
//   }
// }

/**
 * Merge resources from source to target collection
 */
async function mergeResources(
  tx,
  sourceCollectionId,
  targetCollectionId,
  userId,
  conflictResolution
) {
  // Get existing resources in target
  const existingTargetResources = await tx
    .select({ resourceId: collectionResources.resourceId })
    .from(collectionResources)
    .where(eq(collectionResources.collectionId, targetCollectionId));

  const existingResourceIds = new Set(
    existingTargetResources.map((r) => r.resourceId)
  );

  // Get source resources
  const sourceResources = await tx
    .select()
    .from(collectionResources)
    .where(eq(collectionResources.collectionId, sourceCollectionId));

  // Get max order position in target
  const maxOrderResult = await tx.execute(sql`
    SELECT COALESCE(MAX(order_position), 0) as max_order
    FROM collection_resources
    WHERE collection_id = ${targetCollectionId}
  `);

  let currentMaxOrder = maxOrderResult.rows[0]?.max_order || 0;
  let mergedCount = 0;

  for (const sourceResource of sourceResources) {
    if (existingResourceIds.has(sourceResource.resourceId)) {
      // Handle conflict
      if (conflictResolution === 'source') {
        await tx
          .update(collectionResources)
          .set({
            notes: sourceResource.notes,
            status: sourceResource.status,
            userAddedById: sourceResource.userAddedById,
            organizationAddedById: sourceResource.organizationAddedById,
          })
          .where(
            and(
              eq(collectionResources.collectionId, targetCollectionId),
              eq(collectionResources.resourceId, sourceResource.resourceId)
            )
          );
      }
    } else {
      // No conflict, insert with new order position
      currentMaxOrder++;
      await tx.insert(collectionResources).values({
        collectionId: targetCollectionId,
        resourceId: sourceResource.resourceId,
        notes: sourceResource.notes,
        status: sourceResource.status,
        orderPosition: currentMaxOrder,
        userAddedById: sourceResource.userAddedById,
        organizationAddedById: sourceResource.organizationAddedById,
      });
      mergedCount++;
    }
  }

  return mergedCount;
}

/**
 * Merge collaborators from source to target collection
 */
async function mergeCollaborators(
  tx,
  sourceCollectionId,
  targetCollectionId,
  conflictResolution
) {
  // Get existing collaborators in target - select only basic columns
  const existingTargetCollaborators = await tx
    .select({
      id: collectionCollaborators.id,
      collectionId: collectionCollaborators.collectionId,
      userId: collectionCollaborators.userId,
      organizationId: collectionCollaborators.organizationId,
      role: collectionCollaborators.role,
    })
    .from(collectionCollaborators)
    .where(eq(collectionCollaborators.collectionId, targetCollectionId));

  const existingCollaboratorKeys = new Set(
    existingTargetCollaborators.map((c) =>
      c.userId ? `user_${c.userId}` : `org_${c.organizationId}`
    )
  );

  // Get source collaborators - select only basic columns
  const sourceCollaborators = await tx
    .select({
      id: collectionCollaborators.id,
      collectionId: collectionCollaborators.collectionId,
      userId: collectionCollaborators.userId,
      organizationId: collectionCollaborators.organizationId,
      role: collectionCollaborators.role,
    })
    .from(collectionCollaborators)
    .where(eq(collectionCollaborators.collectionId, sourceCollectionId));

  let mergedCount = 0;

  for (const sourceCollaborator of sourceCollaborators) {
    const collaboratorKey = sourceCollaborator.userId
      ? `user_${sourceCollaborator.userId}`
      : `org_${sourceCollaborator.organizationId}`;

    if (existingCollaboratorKeys.has(collaboratorKey)) {
      // Handle conflict
      if (conflictResolution === 'source') {
        // Update with source role only (other columns might not exist)
        await tx
          .update(collectionCollaborators)
          .set({
            role: sourceCollaborator.role,
          })
          .where(
            and(
              eq(collectionCollaborators.collectionId, targetCollectionId),
              sourceCollaborator.userId
                ? eq(collectionCollaborators.userId, sourceCollaborator.userId)
                : eq(
                    collectionCollaborators.organizationId,
                    sourceCollaborator.organizationId
                  )
            )
          );
      }
    } else {
      // No conflict, insert new collaborator with basic fields only
      await tx.insert(collectionCollaborators).values({
        collectionId: targetCollectionId,
        userId: sourceCollaborator.userId,
        organizationId: sourceCollaborator.organizationId,
        role: sourceCollaborator.role || 'editor',
      });
      mergedCount++;
    }
  }

  return mergedCount;
}
