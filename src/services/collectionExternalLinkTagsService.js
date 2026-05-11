import { db } from '../db/index.js';
import { eq, and, inArray, sql, ilike, or } from 'drizzle-orm';
import {
  collectionExternalLinkTagDefinitions,
  collectionExternalLinkTags,
} from '../models/collectionExternalLinkTags.js';
import { collectionExternalLinks } from '../models/external_links.js';

/**
 * Get all available tags for a user within their tenants
 */
export const getUserTagsService = async (userId, tenants) => {
  try {
    const tags = await db
      .select({
        id: collectionExternalLinkTagDefinitions.id,
        name: collectionExternalLinkTagDefinitions.name,
        description: collectionExternalLinkTagDefinitions.description,
        color: collectionExternalLinkTagDefinitions.color,
        createdAt: collectionExternalLinkTagDefinitions.createdAt,
        usageCount: sql`COUNT(${collectionExternalLinkTags.tagId})::int`.as(
          'usageCount'
        ),
      })
      .from(collectionExternalLinkTagDefinitions)
      .leftJoin(
        collectionExternalLinkTags,
        eq(
          collectionExternalLinkTagDefinitions.id,
          collectionExternalLinkTags.tagId
        )
      )
      .where(
        and(
          inArray(collectionExternalLinkTagDefinitions.tenantId, tenants),
          eq(collectionExternalLinkTagDefinitions.createdByUserId, userId)
        )
      )
      .groupBy(
        collectionExternalLinkTagDefinitions.id,
        collectionExternalLinkTagDefinitions.name,
        collectionExternalLinkTagDefinitions.description,
        collectionExternalLinkTagDefinitions.color,
        collectionExternalLinkTagDefinitions.createdAt
      )
      .orderBy(
        sql`"usageCount" DESC, ${collectionExternalLinkTagDefinitions.name} ASC`
      );

    return tags;
  } catch (error) {
    console.error('Error fetching user tags:', error);
    throw new Error('Failed to fetch user tags');
  }
};

/**
 * Create a new tag or get existing one by name
 */
export const createOrGetTagService = async (tagData, userId, tenantId) => {
  try {
    // First check if tag already exists (case-insensitive)
    const existingTag = await db
      .select()
      .from(collectionExternalLinkTagDefinitions)
      .where(
        and(
          sql`LOWER(${collectionExternalLinkTagDefinitions.name}) = LOWER(${tagData.name})`,
          eq(collectionExternalLinkTagDefinitions.tenantId, tenantId)
        )
      )
      .limit(1);

    if (existingTag.length > 0) {
      return existingTag[0];
    }

    // Create new tag
    const newTag = await db
      .insert(collectionExternalLinkTagDefinitions)
      .values({
        name: tagData.name.trim(),
        description: tagData.description,
        color: tagData.color,
        createdByUserId: userId,
        tenantId: tenantId,
      })
      .returning();

    return newTag[0];
  } catch (error) {
    console.error('Error creating/getting tag:', error);
    throw new Error('Failed to create or get tag');
  }
};

/**
 * Add tags to a collection external link
 */
export const addTagsToCollectionExternalLinkService = async (
  collectionExternalLinkId,
  tagIds
) => {
  try {
    // Remove duplicates
    const uniqueTagIds = [...new Set(tagIds)];

    // Get existing tags to avoid duplicates
    const existingTags = await db
      .select({ tagId: collectionExternalLinkTags.tagId })
      .from(collectionExternalLinkTags)
      .where(
        eq(
          collectionExternalLinkTags.collectionExternalLinkId,
          collectionExternalLinkId
        )
      );

    const existingTagIds = existingTags.map((tag) => tag.tagId);
    const newTagIds = uniqueTagIds.filter(
      (tagId) => !existingTagIds.includes(tagId)
    );

    if (newTagIds.length === 0) {
      return { message: 'No new tags to add' };
    }

    // Insert new tag associations
    const tagAssociations = newTagIds.map((tagId) => ({
      collectionExternalLinkId,
      tagId,
    }));

    const result = await db
      .insert(collectionExternalLinkTags)
      .values(tagAssociations)
      .returning();

    return { message: `Added ${newTagIds.length} tags`, insertedTags: result };
  } catch (error) {
    console.error('Error adding tags to collection external link:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      collectionExternalLinkId,
      tagIds,
    });
    throw new Error('Failed to add tags to collection external link');
  }
};

/**
 * Remove tags from a collection external link
 */
export const removeTagsFromCollectionExternalLinkService = async (
  collectionExternalLinkId,
  tagIds
) => {
  try {
    await db
      .delete(collectionExternalLinkTags)
      .where(
        and(
          eq(
            collectionExternalLinkTags.collectionExternalLinkId,
            collectionExternalLinkId
          ),
          inArray(collectionExternalLinkTags.tagId, tagIds)
        )
      );

    return { message: `Removed ${tagIds.length} tags` };
  } catch (error) {
    console.error('Error removing tags from collection external link:', error);
    throw new Error('Failed to remove tags from collection external link');
  }
};

/**
 * Get tags for a collection external link
 */
export const getTagsForCollectionExternalLinkService = async (
  collectionExternalLinkId
) => {
  try {
    const tags = await db
      .select({
        id: collectionExternalLinkTagDefinitions.id,
        name: collectionExternalLinkTagDefinitions.name,
        description: collectionExternalLinkTagDefinitions.description,
        color: collectionExternalLinkTagDefinitions.color,
        createdAt: collectionExternalLinkTags.createdAt,
      })
      .from(collectionExternalLinkTags)
      .innerJoin(
        collectionExternalLinkTagDefinitions,
        eq(
          collectionExternalLinkTags.tagId,
          collectionExternalLinkTagDefinitions.id
        )
      )
      .where(
        eq(
          collectionExternalLinkTags.collectionExternalLinkId,
          collectionExternalLinkId
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

    return tags;
  } catch (error) {
    console.error('Error fetching tags for collection external link:', error);
    throw new Error('Failed to fetch tags for collection external link');
  }
};

/**
 * Search tags by name
 */
export const searchTagsService = async (searchTerm, userId, tenants) => {
  try {
    const tags = await db
      .select({
        id: collectionExternalLinkTagDefinitions.id,
        name: collectionExternalLinkTagDefinitions.name,
        description: collectionExternalLinkTagDefinitions.description,
        color: collectionExternalLinkTagDefinitions.color,
        usageCount: sql`COUNT(${collectionExternalLinkTags.tagId})::int`.as(
          'usageCount'
        ),
      })
      .from(collectionExternalLinkTagDefinitions)
      .leftJoin(
        collectionExternalLinkTags,
        eq(
          collectionExternalLinkTagDefinitions.id,
          collectionExternalLinkTags.tagId
        )
      )
      .where(
        and(
          ilike(collectionExternalLinkTagDefinitions.name, `%${searchTerm}%`),
          inArray(collectionExternalLinkTagDefinitions.tenantId, tenants),
          eq(collectionExternalLinkTagDefinitions.createdByUserId, userId)
        )
      )
      .groupBy(
        collectionExternalLinkTagDefinitions.id,
        collectionExternalLinkTagDefinitions.name,
        collectionExternalLinkTagDefinitions.description,
        collectionExternalLinkTagDefinitions.color
      )
      .orderBy(
        sql`"usageCount" DESC, ${collectionExternalLinkTagDefinitions.name} ASC`
      )
      .limit(20);

    return tags;
  } catch (error) {
    console.error('Error searching tags:', error);
    throw new Error('Failed to search tags');
  }
};

/**
 * Get collection external link ID from external link ID
 */
export const getCollectionExternalLinkIdService = async (externalLinkId) => {
  try {
    const result = await db
      .select({ id: collectionExternalLinks.id })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
      .limit(1);

    if (result.length === 0) {
      throw new Error('External link not found in any collection');
    }

    return result[0].id;
  } catch (error) {
    console.error('Error getting collection external link ID:', error);
    throw new Error('Failed to find collection external link');
  }
};

/**
 * Get tag IDs by names for AI notation processing
 * Takes an array of tag name arrays from AI responses and returns structured tag data
 */
export const getTagIdsByNamesService = async (tagArrays, userId, tenants) => {
  try {
    // Flatten all tag arrays and get unique tag names
    const allTagNames = tagArrays
      .flat()
      .filter((name) => name && typeof name === 'string')
      .map((name) => name.trim().toLowerCase());

    const uniqueTagNames = [...new Set(allTagNames)];

    if (uniqueTagNames.length === 0) {
      return new Map();
    }

    // Query for existing tags that match the names (case-insensitive)
    // Use OR conditions for each tag name to avoid PostgreSQL array issues
    const nameConditions = uniqueTagNames.map(
      (tagName) =>
        sql`LOWER(${collectionExternalLinkTagDefinitions.name}) = LOWER(${tagName})`
    );

    const matchingTags = await db
      .select({
        id: collectionExternalLinkTagDefinitions.id,
        name: collectionExternalLinkTagDefinitions.name,
        color: collectionExternalLinkTagDefinitions.color,
        description: collectionExternalLinkTagDefinitions.description,
      })
      .from(collectionExternalLinkTagDefinitions)
      .where(
        and(
          or(...nameConditions),
          inArray(collectionExternalLinkTagDefinitions.tenantId, tenants),
          eq(collectionExternalLinkTagDefinitions.createdByUserId, userId)
        )
      );

    // Create a map for quick lookup by lowercase name
    const tagMap = new Map();
    matchingTags.forEach((tag) => {
      tagMap.set(tag.name.toLowerCase(), tag);
    });

    return tagMap;
  } catch (error) {
    console.error('Error getting tag IDs by names:', error);
    throw new Error('Failed to get tag IDs by names');
  }
};
