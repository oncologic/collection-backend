import { db } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { collections } from '../models/collections.js';
import { collectionCollaborators } from '../models/collectionCollaborators.js';
import { externalLinks } from '../models/external_links.js';
import { collectionExternalLinks } from '../models/external_links.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import { pendingInvitations } from '../models/pendingInvitations.js';
import { sql } from 'drizzle-orm';

/**
 * Find collections where user is a direct collaborator
 */
export async function findUserDirectCollaborations(userId) {
  try {
    // Use raw SQL to avoid complex Drizzle joins that cause stack overflow
    const userCollectionResults = await db.execute(sql`
      SELECT DISTINCT 
        c.id,
        c.name,
        'collection' as type
      FROM collections c
      INNER JOIN collection_collaborators cc ON c.id = cc.collection_id
      WHERE cc.user_id = ${userId}
      LIMIT 1000
    `);

    return userCollectionResults.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
    }));
  } catch (error) {
    console.error('Error finding user direct collaborations:', error);
    return [];
  }
}

/**
 * Find external links where user is a collaborator
 */
export async function findUserExternalLinkCollaborations(userId) {
  try {
    // Use raw SQL to avoid complex Drizzle joins that cause stack overflow
    const userExternalLinkResults = await db.execute(sql`
      SELECT DISTINCT 
        el.id,
        el.name,
        'external_link' as type
      FROM external_links el
      INNER JOIN collection_external_links cel ON el.id = cel.external_link_id
      INNER JOIN collection_external_links_collaborators celc ON cel.id = celc.collection_external_link_id
      WHERE celc.user_id = ${userId}
      LIMIT 1000
    `);

    return userExternalLinkResults.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
    }));
  } catch (error) {
    console.error('Error finding user external link collaborations:', error);
    return [];
  }
}

/**
 * Find collections from accepted pending invitations
 */
export async function findUserAcceptedInvitationCollections(userEmail, userId) {
  try {
    // Use raw SQL to avoid complex Drizzle joins that cause stack overflow
    const invitationCollectionResults = await db.execute(sql`
      SELECT DISTINCT 
        c.id,
        c.name,
        'collection' as type
      FROM collections c
      INNER JOIN pending_invitations pi ON c.id = pi.collection_id
      WHERE pi.email = ${userEmail}
        AND pi.status = 'accepted'
        AND pi.accepted_by_user_id = ${userId}
      LIMIT 1000
    `);

    return invitationCollectionResults.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
    }));
  } catch (error) {
    console.error('Error finding user accepted invitation collections:', error);
    return [];
  }
}

/**
 * Find external links from accepted pending invitations
 */
export async function findUserAcceptedInvitationExternalLinks(
  userEmail,
  userId
) {
  try {
    // Use raw SQL to avoid complex Drizzle joins that cause stack overflow
    const invitationExternalLinkResults = await db.execute(sql`
      SELECT DISTINCT 
        el.id,
        el.name,
        'external_link' as type
      FROM external_links el
      INNER JOIN collection_external_links cel ON el.id = cel.external_link_id
      INNER JOIN pending_invitations pi ON cel.id = pi.collection_external_link_id
      WHERE pi.email = ${userEmail}
        AND pi.status = 'accepted'
        AND pi.accepted_by_user_id = ${userId}
      LIMIT 1000
    `);

    return invitationExternalLinkResults.rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
    }));
  } catch (error) {
    console.error(
      'Error finding user accepted invitation external links:',
      error
    );
    return [];
  }
}

/**
 * Remove duplicate items from the list
 */
export function removeDuplicateItems(items) {
  return items.filter(
    (item, index, self) =>
      index === self.findIndex((i) => i.id === item.id && i.type === item.type)
  );
}

/**
 * Main function to find all user collaborations for pinning
 */
export async function findUserCollaborationsForPinning(userEmail, userId) {
  try {
    // Get all collaboration items in parallel
    const [
      directCollaborations,
      externalLinkCollaborations,
      acceptedInvitationCollections,
      acceptedInvitationExternalLinks,
    ] = await Promise.all([
      findUserDirectCollaborations(userId),
      findUserExternalLinkCollaborations(userId),
      findUserAcceptedInvitationCollections(userEmail, userId),
      findUserAcceptedInvitationExternalLinks(userEmail, userId),
    ]);

    // Combine all items
    const allItems = [
      ...directCollaborations,
      ...externalLinkCollaborations,
      ...acceptedInvitationCollections,
      ...acceptedInvitationExternalLinks,
    ];

    // Remove duplicates and return
    return removeDuplicateItems(allItems);
  } catch (error) {
    console.error('Error finding user collaborations for pinning:', error);
    throw new Error('Failed to find user collaborations for pinning');
  }
}

/**
 * Add a collaborator to a collection with optional cascade to external links
 */
export async function addCollectionCollaboratorWithCascade(
  collectionId,
  collaboratorData,
  cascadeToExternalLinks = false
) {
  try {
    // Start a transaction
    return await db.transaction(async (tx) => {
      // Prepare collaborator data with only the fields that exist in the database
      const collaboratorDataForInsert = {
        collectionId,
        userId: collaboratorData.userId,
        organizationId: collaboratorData.organizationId,
        role: collaboratorData.role || 'editor',
      };

      // Remove undefined fields
      Object.keys(collaboratorDataForInsert).forEach((key) => {
        if (collaboratorDataForInsert[key] === undefined) {
          delete collaboratorDataForInsert[key];
        }
      });

      // First, add the collaborator to the collection
      const [collaborator] = await tx
        .insert(collectionCollaborators)
        .values(collaboratorDataForInsert)
        .returning();

      // If cascade is requested, add to external links
      if (cascadeToExternalLinks) {
        await cascadeCollaboratorToExternalLinks(
          collectionId,
          collaboratorData.userId || collaboratorData.organizationId,
          ['public', 'unlisted'],
          tx
        );
      }

      return collaborator;
    });
  } catch (error) {
    console.error('Error adding collection collaborator with cascade:', error);
    throw error;
  }
}

/**
 * Cascade collaborator permissions to all public/unlisted external links in a collection
 */
export async function cascadeCollaboratorToExternalLinks(
  collectionId,
  collaboratorId,
  filterVisibility = ['public', 'unlisted'],
  transaction = null
) {
  try {
    const dbContext = transaction || db;

    // Get all external links in the collection with specified visibility
    const externalLinksResult = await dbContext.execute(sql`
      SELECT 
        cel.id as collection_external_link_id,
        el.id as external_link_id,
        el.visibility
      FROM collection_external_links cel
      INNER JOIN external_links el ON cel.external_link_id = el.id
      WHERE cel.collection_id = ${collectionId}
        AND el.visibility IN (${sql.join(filterVisibility, sql`, `)})
    `);

    // Add collaborator to each external link
    const insertPromises = externalLinksResult.rows.map((link) => {
      const collaboratorData = {
        collectionExternalLinkId: link.collection_external_link_id,
        role: 'editor',
      };

      // Check if userId or organizationId
      if (
        typeof collaboratorId === 'string' &&
        collaboratorId.startsWith('org_')
      ) {
        collaboratorData.organizationId = collaboratorId;
      } else {
        collaboratorData.userId = collaboratorId;
      }

      return dbContext
        .insert(collectionExternalLinkCollaborators)
        .values(collaboratorData)
        .onConflictDoNothing();
    });

    await Promise.all(insertPromises);

    return externalLinksResult.rows.length;
  } catch (error) {
    console.error('Error cascading collaborator to external links:', error);
    throw error;
  }
}

/**
 * Remove a collaborator from a collection with cascade removal from external links
 */
export async function removeCollectionCollaboratorWithCascade(
  collectionId,
  collaboratorId
) {
  try {
    return await db.transaction(async (tx) => {
      // First, remove from all external links in the collection
      const deleteExternalLinkCollaboratorsQuery = sql`
        DELETE FROM collection_external_links_collaborators
        WHERE collection_external_link_id IN (
          SELECT id FROM collection_external_links 
          WHERE collection_id = ${collectionId}
        )
        AND ${
          typeof collaboratorId === 'string' &&
          collaboratorId.startsWith('org_')
            ? sql`organization_id = ${collaboratorId}`
            : sql`user_id = ${collaboratorId}`
        }
      `;

      await tx.execute(deleteExternalLinkCollaboratorsQuery);

      // Then remove from the collection itself
      const deleteCollectionCollaboratorQuery = sql`
        DELETE FROM collection_collaborators
        WHERE collection_id = ${collectionId}
        AND ${
          typeof collaboratorId === 'string' &&
          collaboratorId.startsWith('org_')
            ? sql`organization_id = ${collaboratorId}`
            : sql`user_id = ${collaboratorId}`
        }
      `;

      const result = await tx.execute(deleteCollectionCollaboratorQuery);

      return result.rowsAffected;
    });
  } catch (error) {
    console.error(
      'Error removing collection collaborator with cascade:',
      error
    );
    throw error;
  }
}

/**
 * Sync collection collaborators to a newly added external link
 * @param {number} collectionId - The collection ID
 * @param {number} externalLinkId - The external link ID
 * @param {object} tx - Optional transaction object
 */
export async function syncCollaboratorsToNewExternalLink(
  collectionId,
  externalLinkId,
  tx = null
) {
  try {
    // Use transaction if provided, otherwise use db
    const dbOrTx = tx || db;

    // Get the external link visibility
    const [externalLink] = await dbOrTx
      .select({ visibility: externalLinks.visibility })
      .from(externalLinks)
      .where(eq(externalLinks.id, externalLinkId));

    // Only sync if the external link is public or unlisted
    if (
      !externalLink ||
      !['public', 'unlisted'].includes(externalLink.visibility)
    ) {
      return 0;
    }

    // Get the collection_external_link record
    const [collectionExternalLink] = await dbOrTx
      .select({ id: collectionExternalLinks.id })
      .from(collectionExternalLinks)
      .where(
        and(
          eq(collectionExternalLinks.collectionId, collectionId),
          eq(collectionExternalLinks.externalLinkId, externalLinkId)
        )
      );

    if (!collectionExternalLink) {
      throw new Error('Collection external link relationship not found');
    }

    // Get all collection collaborators
    const collaborators = await dbOrTx
      .select()
      .from(collectionCollaborators)
      .where(eq(collectionCollaborators.collectionId, collectionId));

    // Add each collaborator to the external link
    const insertPromises = collaborators.map((collaborator) => {
      const collaboratorData = {
        collectionExternalLinkId: collectionExternalLink.id,
        role: collaborator.role || 'editor',
      };

      if (collaborator.userId) {
        collaboratorData.userId = collaborator.userId;
      } else if (collaborator.organizationId) {
        collaboratorData.organizationId = collaborator.organizationId;
      }

      return dbOrTx
        .insert(collectionExternalLinkCollaborators)
        .values(collaboratorData)
        .onConflictDoNothing();
    });

    await Promise.all(insertPromises);

    return collaborators.length;
  } catch (error) {
    console.error('Error syncing collaborators to new external link:', error);
    throw error;
  }
}
