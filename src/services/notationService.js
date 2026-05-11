import { db } from '../db/index.js';
import { eq, and, sql, inArray, or } from 'drizzle-orm';
import {
  collectionExternalLinksNotations,
  collectionExternalLinkNotationTags,
} from '../models/collectionExternalLinksNotations.js';
import { notationAttachments } from '../models/notationAttachments.js';
import { attachments } from '../models/attachments.js';
import {
  collectionExternalLinks,
  externalLinks,
} from '../models/external_links.js';
import { collections } from '../models/collections.js';
import { collectionExternalLinkTagDefinitions } from '../models/collectionExternalLinkTags.js';
import { collectionCollaborators } from '../models/collectionCollaborators.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import { refreshImageUrlsInHtml } from '../utils/refreshImageUrls.js';

export async function getNotationAttachmentsMap(notationIds = []) {
  if (!notationIds.length) {
    return new Map();
  }

  const notationAttachmentRows = await db
    .select({
      notationId: notationAttachments.notationId,
      attachment: {
        id: attachments.id,
        title: attachments.title,
        description: attachments.description,
        type: attachments.type,
        imageKey: attachments.imageKey,
        visibility: attachments.visibility,
        createdAt: attachments.createdAt,
        updatedAt: attachments.updatedAt,
      },
    })
    .from(notationAttachments)
    .innerJoin(
      attachments,
      eq(notationAttachments.attachmentId, attachments.id)
    )
    .where(inArray(notationAttachments.notationId, notationIds));

  const attachmentsByNotationId = new Map();

  notationAttachmentRows.forEach(({ notationId, attachment }) => {
    if (!attachmentsByNotationId.has(notationId)) {
      attachmentsByNotationId.set(notationId, []);
    }

    attachmentsByNotationId.get(notationId).push(attachment);
  });

  return attachmentsByNotationId;
}

export async function hydrateNotationMediaService(
  notations = [],
  options = {}
) {
  if (!notations.length) {
    return notations;
  }

  const {
    accessMode = 'signed',
    expiresInSeconds = 86400,
    allowedAttachmentVisibilities = null,
  } = options;
  const attachmentsByNotationId = await getNotationAttachmentsMap(
    notations.map((notation) => notation.id)
  );

  return Promise.all(
    notations.map(async (notation) => {
      const linkedAttachments = (attachmentsByNotationId.get(notation.id) || [])
        .filter((attachment) =>
          !allowedAttachmentVisibilities?.length
            ? true
            : allowedAttachmentVisibilities.includes(attachment.visibility)
        );
      const refreshedNotes = notation.notes
        ? await refreshImageUrlsInHtml(notation.notes, linkedAttachments, {
            accessMode,
            expiresInSeconds,
          })
        : notation.notes;

      return {
        ...notation,
        attachments: linkedAttachments,
        notes: refreshedNotes,
      };
    })
  );
}

export async function getNotationsByIdsService(
  notationIds,
  userId = null,
  tenants
) {
  try {
    const result = await db
      .select({
        id: collectionExternalLinksNotations.id,
        title: collectionExternalLinksNotations.title,
        description: collectionExternalLinksNotations.description,
        notes: collectionExternalLinksNotations.notes,
        category: collectionExternalLinksNotations.category,
        status: collectionExternalLinksNotations.status,
        highlighted: collectionExternalLinksNotations.highlighted,
        createdAt: collectionExternalLinksNotations.createdAt,
        updatedAt: collectionExternalLinksNotations.updatedAt,
        listOrder: collectionExternalLinksNotations.listOrder,
        visibility: collectionExternalLinksNotations.visibility,
        userId: collectionExternalLinks.userId,
        date: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        startDate: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        endDate: sql`COALESCE(${collectionExternalLinksNotations.endDate}, ${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        startTime: collectionExternalLinksNotations.startTime,
        endTime: collectionExternalLinksNotations.endTime,
        timezone: collectionExternalLinksNotations.timezone,
        type: collectionExternalLinksNotations.type,
        templateId: collectionExternalLinksNotations.templateId,
        customFields: collectionExternalLinksNotations.customFields,
        submissionMetadata: collectionExternalLinksNotations.submissionMetadata,
        // externalLinkId:
        //   collectionExternalLinksNotations.collectionExternalLinkId,
        // collectionExternalLinkName: collectionExternalLinks.name,
      })
      .from(collectionExternalLinksNotations)
      .innerJoin(
        collectionExternalLinks,
        eq(
          collectionExternalLinksNotations.collectionExternalLinkId,
          collectionExternalLinks.id
        )
      )
      .innerJoin(
        collections,
        eq(collectionExternalLinks.collectionId, collections.id)
      )
      .innerJoin(
        externalLinks,
        eq(collectionExternalLinks.externalLinkId, externalLinks.id)
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
          inArray(collectionExternalLinksNotations.id, notationIds),
          // FIRST: Check collection access (parent permission)
          or(
            eq(collections.visibility, 'public'),
            eq(collections.visibility, 'unlisted'), // Unlisted collections can be accessed by ID
            eq(collections.userId, userId),
            // User is a collaborator on the collection (for unlisted/public collections)
            and(
              inArray(collections.visibility, ['unlisted', 'public']),
              eq(collectionCollaborators.userId, userId)
            )
          ),
          // THEN: Check external link access
          or(
            eq(externalLinks.visibility, 'public'),
            eq(externalLinks.addedByUserId, userId),
            // External links in unlisted/public collections can be accessed if visible
            and(
              inArray(externalLinks.visibility, ['unlisted', 'public']),
              inArray(collections.visibility, ['unlisted', 'public'])
            ),
            // User is a collaborator on the external link
            and(
              inArray(externalLinks.visibility, ['unlisted', 'public']),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          ),
          // FINALLY: Check notation access
          or(
            eq(collectionExternalLinksNotations.visibility, 'public'),
            eq(collectionExternalLinksNotations.visibility, 'unlisted'),
            eq(collectionExternalLinksNotations.userId, userId),
            eq(externalLinks.addedByUserId, userId), // Owner of external link can see all notations
            eq(collections.userId, userId)
          ),
          inArray(collections.tenantId, tenants)
        )
      );

    // Get tags for all notations
    const notationTagsData = await db
      .select({
        notationId:
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
        tag: {
          id: collectionExternalLinkTagDefinitions.id,
          name: collectionExternalLinkTagDefinitions.name,
          description: collectionExternalLinkTagDefinitions.description,
          color: collectionExternalLinkTagDefinitions.color,
        },
      })
      .from(collectionExternalLinkNotationTags)
      .innerJoin(
        collectionExternalLinkTagDefinitions,
        eq(
          collectionExternalLinkNotationTags.tagId,
          collectionExternalLinkTagDefinitions.id
        )
      )
      .where(
        inArray(
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
          notationIds
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

    const resultWithTags = result.map((notation) => {
      const notationTags = notationTagsData
        .filter((tagData) => tagData.notationId === notation.id)
        .map(({ tag }) => tag);

      return {
        ...notation,
        tags: notationTags,
      };
    });

    return hydrateNotationMediaService(resultWithTags, {
      accessMode: 'signed',
      expiresInSeconds: 86400,
    });
  } catch (error) {
    console.error('Error in getNotationsByIdsService:', error);
    throw new Error(`Failed to fetch notations: ${error.message}`);
  }
}

export const getBasicNotationsByIdsService = async (
  notationIds,
  userId,
  tenants
) => {
  try {
    const results = await db
      .select({
        id: collectionExternalLinksNotations.id,
        title: collectionExternalLinksNotations.title,
        externalLinkId: externalLinks.id,
        category: collectionExternalLinksNotations.category,
        visibility: collectionExternalLinksNotations.visibility,
        status: collectionExternalLinksNotations.status,
        createdAt: collectionExternalLinksNotations.createdAt,
        updatedAt: collectionExternalLinksNotations.updatedAt,
        date: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        startDate: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        endDate: sql`COALESCE(${collectionExternalLinksNotations.endDate}, ${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        startTime: collectionExternalLinksNotations.startTime,
        endTime: collectionExternalLinksNotations.endTime,
        timezone: collectionExternalLinksNotations.timezone,
        type: collectionExternalLinksNotations.type,
      })
      .from(collectionExternalLinksNotations)
      .leftJoin(
        collectionExternalLinks,
        eq(
          collectionExternalLinksNotations.collectionExternalLinkId,
          collectionExternalLinks.id
        )
      )
      .leftJoin(
        externalLinks,
        eq(collectionExternalLinks.externalLinkId, externalLinks.id)
      )
      .leftJoin(
        collections,
        eq(collectionExternalLinks.collectionId, collections.id)
      )
      .where(
        and(
          inArray(collectionExternalLinksNotations.id, notationIds),
          or(
            eq(collectionExternalLinksNotations.visibility, 'public'),
            eq(collectionExternalLinksNotations.visibility, 'unlisted'),
            eq(collectionExternalLinks.userId, userId)
          ),
          inArray(collections.tenantId, tenants)
        )
      );

    // Get tags for all notations
    const notationTagsData = await db
      .select({
        notationId:
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
        tag: {
          id: collectionExternalLinkTagDefinitions.id,
          name: collectionExternalLinkTagDefinitions.name,
          description: collectionExternalLinkTagDefinitions.description,
          color: collectionExternalLinkTagDefinitions.color,
        },
      })
      .from(collectionExternalLinkNotationTags)
      .innerJoin(
        collectionExternalLinkTagDefinitions,
        eq(
          collectionExternalLinkNotationTags.tagId,
          collectionExternalLinkTagDefinitions.id
        )
      )
      .where(
        inArray(
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
          notationIds
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

    // Add tags to each notation
    const resultsWithTags = results.map((notation) => {
      const notationTags = notationTagsData
        .filter((tagData) => tagData.notationId === notation.id)
        .map(({ tag }) => tag);

      return {
        ...notation,
        tags: notationTags,
      };
    });

    return resultsWithTags;
  } catch (error) {
    console.error('Error in getBasicNotationsByIdsService:', error);
    throw new Error('Failed to fetch notations');
  }
};

export const notationService = {
  getNotationsByIdsService,
  getBasicNotationsByIdsService,
};

/**
 * Add tags to a notation
 */
export const addTagsToNotationService = async (notationId, tagIds) => {
  try {
    if (!tagIds || tagIds.length === 0) {
      return { message: 'No tags to add' };
    }

    // Remove duplicates
    const uniqueTagIds = [...new Set(tagIds)];

    // Get existing tags to avoid duplicates
    const existingTags = await db
      .select({ tagId: collectionExternalLinkNotationTags.tagId })
      .from(collectionExternalLinkNotationTags)
      .where(
        eq(
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
          notationId
        )
      );

    const existingTagIds = existingTags.map((tag) => tag.tagId);
    const newTagIds = uniqueTagIds.filter(
      (tagId) => !existingTagIds.includes(tagId)
    );

    if (newTagIds.length === 0) {
      return { message: 'All tags already exist for this notation' };
    }

    // Create the tag associations
    const tagAssociations = newTagIds.map((tagId) => ({
      collectionExternalLinkNotationId: notationId,
      tagId: tagId,
    }));

    const result = await db
      .insert(collectionExternalLinkNotationTags)
      .values(tagAssociations)
      .returning();

    return {
      message: `Successfully added ${result.length} tags to notation`,
      addedTags: result,
    };
  } catch (error) {
    console.error('Error adding tags to notation:', error);
    throw new Error('Failed to add tags to notation');
  }
};

/**
 * Remove tags from a notation
 */
export const removeTagsFromNotationService = async (notationId, tagIds) => {
  try {
    if (!tagIds || tagIds.length === 0) {
      return { message: 'No tags to remove' };
    }

    const result = await db
      .delete(collectionExternalLinkNotationTags)
      .where(
        and(
          eq(
            collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
            notationId
          ),
          inArray(collectionExternalLinkNotationTags.tagId, tagIds)
        )
      )
      .returning();

    return {
      message: `Successfully removed ${result.length} tags from notation`,
      removedTags: result,
    };
  } catch (error) {
    console.error('Error removing tags from notation:', error);
    throw new Error('Failed to remove tags from notation');
  }
};

/**
 * Update tags for a notation (replace all existing tags)
 */
export const updateNotationTagsService = async (notationId, tagIds) => {
  try {
    return await db.transaction(async (tx) => {
      // First, remove all existing tags for this notation
      await tx
        .delete(collectionExternalLinkNotationTags)
        .where(
          eq(
            collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
            notationId
          )
        );

      // If no new tags provided, we're done
      if (!tagIds || tagIds.length === 0) {
        return { message: 'All tags removed from notation' };
      }

      // Remove duplicates
      const uniqueTagIds = [...new Set(tagIds)];

      // Create the new tag associations
      const tagAssociations = uniqueTagIds.map((tagId) => ({
        collectionExternalLinkNotationId: notationId,
        tagId: tagId,
      }));

      const result = await tx
        .insert(collectionExternalLinkNotationTags)
        .values(tagAssociations)
        .returning();

      return {
        message: `Successfully updated notation tags (${result.length} tags)`,
        tags: result,
      };
    });
  } catch (error) {
    console.error('Error updating notation tags:', error);
    throw new Error('Failed to update notation tags');
  }
};

export const getTagsForNotation = async (notationId) => {
  return await db
    .select({
      id: collectionExternalLinkTagDefinitions.id,
      name: collectionExternalLinkTagDefinitions.name,
      description: collectionExternalLinkTagDefinitions.description,
      color: collectionExternalLinkTagDefinitions.color,
    })
    .from(collectionExternalLinkNotationTags)
    .innerJoin(
      collectionExternalLinkTagDefinitions,
      eq(
        collectionExternalLinkNotationTags.tagId,
        collectionExternalLinkTagDefinitions.id
      )
    )
    .where(
      eq(
        collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
        notationId
      )
    );
};
