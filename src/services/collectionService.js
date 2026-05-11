import { db } from '../db/index.js';

import {
  eq,
  and,
  or,
  desc,
  isNull,
  isNotNull,
  gt,
  inArray,
  ne,
} from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { organizationEvents } from '../models/organizations.js';
import { collections } from '../models/collections.js';
import { collectionResources } from '../models/collections.js';
import { resources } from '../models/resources.js';
import {
  externalLinks,
  collectionExternalLinks,
  collectionTypeOrdering,
} from '../models/external_links.js';
import {
  collectionExternalLinkNotationTags,
  collectionExternalLinksNotations,
} from '../models/collectionExternalLinksNotations.js';
import { collectionExternalLinksThreads } from '../models/collectionExternalLinksThreads.js';
import {
  collectionExternalLinkTagDefinitions,
  collectionExternalLinkTags,
} from '../models/collectionExternalLinkTags.js';
import { generateUUID } from '../utils/general.js';
import { externalLinkAttachments } from '../models/externalLinkAttachments.js';
import { attachments } from '../models/attachments.js';
import { parseTimestamps } from '../utils/general.js';
import { folders } from '../models/folders.js';
import { folderCollections } from '../models/folderCollections.js';
import { pinnedItems } from '../models/pinnedItems.js';
import { collectionCollaborators } from '../models/collectionCollaborators.js';
import { users } from '../models/users.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import { getTagsForCollectionExternalLinkService } from './collectionExternalLinkTagsService.js';
import {
  autoUpdateCollectionEmbedding,
  autoUpdateExternalLinkEmbedding,
  autoUpdateLinkGroupEmbedding,
  updateNotationEmbeddings,
} from './vectorService.js';
import {
  addTagsToNotationService,
  getTagsForNotation,
  updateNotationTagsService,
} from './notationService.js';
import { syncNotationAttachmentVisibility } from './notationAttachmentService.js';
import { syncCollaboratorsToNewExternalLink } from './collaborationService.js';
import {
  triggerNewExternalLinkNotification,
  triggerNewNotationNotification,
  triggerNotationUpdateNotification,
} from './slackNotificationHelper.js';
import {
  buildDateRangeCreateFields,
  buildDateRangeUpdateFields,
} from '../utils/dateRanges.js';

const PUBLIC_SHAREABLE_VISIBILITIES = ['public', 'unlisted'];
const DIRECT_SHAREABLE_COLLECTION_TYPES = ['resource', 'external'];

const isPubliclyShareableVisibility = (visibility) =>
  PUBLIC_SHAREABLE_VISIBILITIES.includes(visibility);

const canEnableDirectCollectionSharing = (type, visibility) =>
  DIRECT_SHAREABLE_COLLECTION_TYPES.includes(type) &&
  isPubliclyShareableVisibility(visibility);

function isYoutubeUrl(url) {
  return url && (url.includes('youtube.com') || url.includes('youtu.be'));
}

export async function getAllCollectionsService(userId, tenants) {
  try {
    // Use getEventsWithRelations instead of simple select
    const collectionsData = await getCollectionsWithRelations(
      db,
      userId,
      tenants
    );

    // Process external links for timestamps if they're YouTube videos
    const processedCollections = collectionsData.map((collection) => ({
      ...collection,
      externalLinks: collection.externalLinks?.map((link) => ({
        ...link,
        timestamps: isYoutubeUrl(link.url)
          ? parseTimestamps(link.description)
          : null,
      })),
    }));
    // Sort collections by updated_at date in descending order
    const sortedCollections = processedCollections.sort((a, b) => {
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    return sortedCollections;
  } catch (error) {
    console.error('Error fetching collections:', error);
    throw new Error('Failed to fetch collections');
  }
}

export async function getResourcesForAllCollectionsService(userId, tenants) {
  try {
    const resourcesData = await db.execute(sql`
WITH orgs AS (
  SELECT
    or_link.resource_id,
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'name', o.name,
        'image_url', o.image_url
      ) ORDER BY o.name
    ) AS organizations
  FROM organization_resources or_link
  JOIN organizations o ON or_link.organization_id = o.id
  GROUP BY or_link.resource_id
),
resources_with_orgs AS (
  SELECT
    r.id,
    r.name,
    r.description,
    r.resource_date,
    r.url,
    r.type_id,
    r.tenant_id,
    COALESCE(orgs.organizations, '[]'::jsonb) AS organizations
  FROM resources r
  LEFT JOIN orgs ON r.id = orgs.resource_id
),
collections_with_resources AS (
  SELECT
    c.id,
    c.name,
    c.type,
    c.visibility,
    c.color,
    c.icon,
    c.description,
    c.event_id,
    c.created_at,
    c.updated_at,
    c.tenant_id,
    c.hashtags,
    c.status,
    c.user_id,
    EXISTS (
      SELECT 1 FROM pinned_items 
      WHERE user_id = ${userId} 
      AND item_id = c.id
      AND item_type = 'collection'
    ) as is_pinned,
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'description', r.description,
        'notes', cr.notes,
        'tenant_id', c.tenant_id,
        'resource_date', r.resource_date,
        'url', r.url,
        'type_id', r.type_id,
        'organizations', r.organizations
      ) ORDER BY cr.order_position
    ) FILTER (WHERE r.id IS NOT NULL) AS resources
  FROM collections c
  LEFT JOIN collection_resources cr ON c.id = cr.collection_id
  LEFT JOIN resources_with_orgs r ON cr.resource_id = r.id
  WHERE c.type = 'resource'
    AND (c.visibility = 'public' OR c.user_id = ${userId})
  GROUP BY c.id, c.name, c.type, c.visibility, c.color, c.icon, c.description, c.created_at, c.updated_at, c.event_id, c.hashtags
)
SELECT jsonb_agg(
  jsonb_build_object(
    'id', id,
    'name', name,
    'type', type,
    'visibility', visibility,
    'color', color,
    'icon', icon,
    'description', description,
    'created_at', created_at,
    'updated_at', updated_at,
    'tenant_id', tenant_id,
    'is_pinned', is_pinned,
    'user_id', user_id,
    'status', status,
    'hashtags', CASE WHEN hashtags IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(hashtags) END,
    'resources', COALESCE(resources, '[]'::jsonb)
  )
) AS collections
FROM collections_with_resources
WHERE tenant_id IN ${tenants};
    `);

    // Parse hashtags for each collection
    const collections = resourcesData.rows[0].collections || [];
    return collections.map((collection) => {
      const hashtags =
        collection.hashtags && collection.hashtags.length > 0
          ? collection.hashtags[0].split(',')
          : [];
      return {
        ...collection,
        hashtags,
      };
    });
  } catch (error) {
    console.error('Error fetching resources for all collections:', error);
    throw new Error('Failed to fetch resources for all collections');
  }
}

const getCollectionsWithRelations = async (db, userId = null, tenants) => {
  // First, get collections with resource count, external links count, and pinned status
  const collectionsWithCount = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      userId: collections.userId,
      organizationId: collections.organizationId,
      visibility: collections.visibility,
      status: collections.status,
      icon: collections.icon,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      color: collections.color,
      type: collections.type,
      startDate: collections.startDate,
      endDate: collections.endDate,
      eventId: collections.eventId,
      tenantId: collections.tenantId,
      hashtags: collections.hashtags,
      publicJsonEnabled: collections.publicJsonEnabled,
      // Exclude embedding fields: nameEmbedding, descriptionEmbedding, hashtagsEmbedding, combinedEmbedding, vectorUpdatedAt
      resource_count:
        sql`COUNT(DISTINCT ${collectionResources.resourceId})`.mapWith(Number),
      externalLinksCount:
        sql`COUNT(DISTINCT ${collectionExternalLinks.externalLinkId})`.mapWith(
          Number
        ),
      is_pinned: sql`EXISTS (
        SELECT 1 FROM pinned_items 
        WHERE user_id = ${userId} 
        AND item_id = ${collections.id}
        AND item_type = 'collection'
      )`.mapWith(Boolean),
    })
    .from(collections)
    .leftJoin(
      collectionResources,
      eq(collections.id, collectionResources.collectionId)
    )
    .leftJoin(
      collectionExternalLinks,
      eq(collections.id, collectionExternalLinks.collectionId)
    )
    .leftJoin(
      collectionCollaborators,
      and(
        eq(collections.id, collectionCollaborators.collectionId),
        eq(collectionCollaborators.userId, userId)
      )
    )
    .where(
      and(
        inArray(collections.tenantId, tenants),
        or(
          eq(collections.visibility, 'public'),
          eq(collections.userId, userId),
          // Include collections where user is a collaborator (only for unlisted/public collections)
          and(
            inArray(collections.visibility, ['unlisted', 'public']),
            eq(collectionCollaborators.userId, userId)
          )
        )
      )
    )
    .groupBy(collections.id);

  // Parse hashtags string to array if not null
  return collectionsWithCount.map((collection) => ({
    ...collection,
    hashtags: collection.hashtags ? collection.hashtags.split(',') : [],
  }));
};

export async function updateCollectionService(
  id,
  data,
  userId = null,
  tenants,
  isAdmin = false
) {
  const dateRangeFields = buildDateRangeUpdateFields(data);
  // Construct the where condition based on whether the user is an admin
  let whereCondition;
  if (isAdmin) {
    // Admins can update any collection in their tenant
    whereCondition = and(
      eq(collections.id, id),
      inArray(collections.tenantId, tenants)
    );
  } else {
    // Regular users can only update their own collections
    whereCondition = and(
      eq(collections.id, id),
      eq(collections.userId, userId),
      inArray(collections.tenantId, tenants)
    );
  }

  const updateKeys = Object.keys(data).filter((key) => key !== 'id');
  if (
    updateKeys.length === 1 &&
    Object.prototype.hasOwnProperty.call(data, 'whiteboardData')
  ) {
    const [collection] = await db
      .update(collections)
      .set({
        whiteboardData: data.whiteboardData,
        updatedAt: new Date(),
      })
      .where(whereCondition)
      .returning();

    return collection;
  }

  const [existingCollection] = await db
    .select({
      type: collections.type,
      visibility: collections.visibility,
      publicJsonEnabled: collections.publicJsonEnabled,
    })
    .from(collections)
    .where(whereCondition)
    .limit(1);

  const finalType = data.type ?? existingCollection?.type ?? null;
  const finalVisibility =
    data.visibility ?? existingCollection?.visibility ?? 'private';
  const shouldKeepDirectSharing = canEnableDirectCollectionSharing(
    finalType,
    finalVisibility
  );

  const mappedData = {
    name: data.name,
    type: data.type,
    status: data.status,
    visibility: data.visibility,
    color: data.color,
    organizationId: data.organization_id || null,
    eventId: data.eventId || null,
    description: data.description,
    icon: data.icon,
    updatedAt: new Date(),
    hashtags: Array.isArray(data.hashtags)
      ? data.hashtags.join(',') || null
      : data.hashtags || null,
    publicJsonEnabled: shouldKeepDirectSharing
      ? finalType === 'resource'
        ? true
        : existingCollection?.publicJsonEnabled || false
      : false,
    isPinned: data.isPinned,
    ...dateRangeFields,
  };

  if (Object.prototype.hasOwnProperty.call(data, 'whiteboardData')) {
    mappedData.whiteboardData = data.whiteboardData;
  }

  const collection = await db
    .update(collections)
    .set(mappedData)
    .where(whereCondition)
    .returning();

  // if the collection isPinned true, check if it exists first before adding
  if (mappedData.isPinned === true) {
    const existingPin = await db
      .select()
      .from(pinnedItems)
      .where(
        and(
          eq(pinnedItems.userId, userId),
          eq(pinnedItems.itemId, id),
          eq(pinnedItems.itemType, 'collection')
        )
      )
      .limit(1);

    if (!existingPin.length) {
      // Get current max order position
      const maxOrderResult = await db
        .select({
          maxOrder: sql`COALESCE(MAX(order_position), -1)`.mapWith(Number),
        })
        .from(pinnedItems)
        .where(eq(pinnedItems.userId, userId));

      const newOrder = maxOrderResult[0].maxOrder + 1;

      await db.insert(pinnedItems).values({
        userId: userId,
        itemId: id,
        itemType: 'collection',
        orderPosition: newOrder,
      });
    }
  }
  // if the collection isPinned false, remove it from pinned items
  if (mappedData.isPinned === false) {
    await db
      .delete(pinnedItems)
      .where(
        and(
          eq(pinnedItems.userId, userId),
          eq(pinnedItems.itemId, id),
          eq(pinnedItems.itemType, 'collection')
        )
      );
  }

  return collection[0];
}

export async function getCollectionByIdService(id, userId = null, tenants) {
  // Handle null userId properly for SQL
  const userIdValue =
    userId && userId !== 'null' && userId !== 'undefined' ? userId : null;

  // Build where conditions
  const conditions = [eq(collections.id, id)];

  // Add tenant check if tenants are provided
  if (tenants && tenants.length > 0) {
    conditions.push(
      or(isNull(collections.tenantId), inArray(collections.tenantId, tenants))
    );
  }

  // Add visibility/ownership check
  conditions.push(
    or(
      eq(collections.visibility, 'public'),
      eq(collections.visibility, 'unlisted'),
      userIdValue ? eq(collections.userId, userIdValue) : sql`false`
    )
  );

  const collection = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      userId: collections.userId,
      organizationId: collections.organizationId,
      visibility: collections.visibility,
      status: collections.status,
      icon: collections.icon,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      color: collections.color,
      type: collections.type,
      eventId: collections.eventId,
      tenantId: collections.tenantId,
      hashtags: collections.hashtags,
      publicJsonEnabled: collections.publicJsonEnabled,
      whiteboardData: collections.whiteboardData,
      isPinned: sql`EXISTS (
        SELECT 1 FROM pinned_items 
        WHERE user_id = ${userIdValue}::uuid 
        AND item_id = ${collections.id}
        AND item_type = 'collection'
      )`.mapWith(Boolean),
    })
    .from(collections)
    .where(and(...conditions))
    .limit(1);

  // Convert hashtags from string to array
  if (collection[0]) {
    collection[0].hashtags = collection[0].hashtags
      ? collection[0].hashtags.split(',')
      : [];
  }

  return collection[0];
}

export async function getCollectionByIdServiceSharedLink(id, userId = null) {
  const collection = await db
    .select({
      ...collections,
      isPinned: sql`EXISTS (
        SELECT 1 FROM pinned_items 
        WHERE user_id = ${userId} 
        AND item_id = ${collections.id}
        AND item_type = 'collection'
      )`.mapWith(Boolean),
    })
    .from(collections)
    .where(
      and(
        eq(collections.id, id),
        or(eq(collections.visibility, 'public'), eq(collections.userId, userId))
      )
    )
    .limit(1);

  return collection[0];
}

export async function getCollectionByIdServiceWithResources(id, userId = null) {
  const collection = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.id, id),
        or(eq(collections.visibility, 'public'), eq(collections.userId, userId))
      )
    )
    .limit(1);
  return collection[0];
}

export async function getResourceByIdService(id, userId, tenants) {
  try {
    const result = await db
      .select()
      .from(resources)
      .where(
        and(
          eq(resources.id, id),
          inArray(resources.tenantId, tenants),
          // Apply tenant-specific access rules
          sql`(
            CASE 
              WHEN ${resources.tenantId} = ${process.env.COMMUNITY_TENANT}::uuid THEN ${resources.addedByUserId} = ${userId}
              WHEN ${resources.tenantId} = ${process.env.KIDNEY_TENANT_ID}::uuid THEN 1 = 1
              ELSE ${resources.addedByUserId} = ${userId}
            END
          )`
        )
      )
      .limit(1);

    return result[0];
  } catch (error) {
    console.error('Error fetching resource by ID:', error);
    throw new Error('Failed to fetch resource');
  }
}

export async function deleteResourceFromCollectionService(
  collectionId,
  resourceId
) {
  const result = await db
    .delete(collectionResources)
    .where(
      and(
        eq(collectionResources.collectionId, collectionId),
        eq(collectionResources.resourceId, resourceId)
      )
    )
    .returning();
  return result[0];
}

export async function deleteCollectionService(id, userId) {
  try {
    return await db.transaction(async (tx) => {
      // First check if the user owns the collection
      const collection = await tx
        .select()
        .from(collections)
        .where(and(eq(collections.id, id), eq(collections.userId, userId)));

      if (!collection[0]) {
        throw new Error(
          'Collection not found or you do not have permission to delete it'
        );
      }

      // First get all collection_external_links for this collection
      const collectionLinks = await tx
        .select()
        .from(collectionExternalLinks)
        .where(eq(collectionExternalLinks.collectionId, id));

      // For each collection_external_link, delete its notations and threads
      for (const link of collectionLinks) {
        // Delete threads first (they reference notations)
        await tx
          .delete(collectionExternalLinksThreads)
          .where(
            eq(
              collectionExternalLinksThreads.collectionExternalLinkNotationId,
              link.id
            )
          );

        // Then delete notations
        await tx
          .delete(collectionExternalLinksNotations)
          .where(
            eq(
              collectionExternalLinksNotations.collectionExternalLinkId,
              link.id
            )
          );
      }

      // Delete collection_external_links
      await tx
        .delete(collectionExternalLinks)
        .where(eq(collectionExternalLinks.collectionId, id));

      // Delete collection_resources
      await tx
        .delete(collectionResources)
        .where(eq(collectionResources.collectionId, id));

      // Delete from folder_collections
      await tx
        .delete(folderCollections)
        .where(eq(folderCollections.collectionId, id));

      // Delete from pinned_items
      await tx
        .delete(pinnedItems)
        .where(
          and(
            eq(pinnedItems.itemId, id),
            eq(pinnedItems.itemType, 'collection')
          )
        );

      // Finally delete the collection itself
      const result = await tx
        .delete(collections)
        .where(eq(collections.id, id))
        .returning();

      return result[0];
    });
  } catch (error) {
    console.error('Error in deleteCollectionService:', error);
    throw new Error('Failed to delete collection and its related data');
  }
}

export const updateResourceOrderService = async (
  collectionId,
  resourceId,
  newOrder
) => {
  try {
    // Validate inputs
    if (typeof newOrder !== 'number' || newOrder === undefined) {
      throw new Error('New order must be a valid number');
    }

    newOrder = Math.max(0, Math.floor(Number(newOrder)));

    // Get current state and validate
    const resources = await db
      .select()
      .from(collectionResources)
      .where(eq(collectionResources.collectionId, collectionId))
      .orderBy(collectionResources.orderPosition);

    if (resources.length === 0) {
      throw new Error('No resources found in this collection');
    }

    if (!resources.some((r) => r.resourceId === resourceId)) {
      throw new Error('Resource not found in collection');
    }

    // Clamp newOrder to valid range
    newOrder = Math.min(newOrder, resources.length - 1);

    // Single query to update all positions
    await db.execute(sql`
      UPDATE collection_resources
      SET order_position = CASE
        WHEN resource_id = ${resourceId} THEN ${newOrder}
        WHEN order_position >= ${newOrder} AND resource_id != ${resourceId} THEN order_position + 1
        ELSE order_position
      END
      WHERE collection_id = ${collectionId}
      AND order_position >= ${newOrder}
    `);

    return { success: true };
  } catch (error) {
    console.error('Error updating resource order:', error);
    throw error;
  }
};

export async function createCollectionService(collectionData, userId) {
  try {
    const dateRangeFields = buildDateRangeCreateFields(collectionData);
    const collectionVisibility = collectionData.visibility || 'private';
    const canShareCollectionDirectly = canEnableDirectCollectionSharing(
      collectionData.type,
      collectionVisibility
    );

    // Prepare insert data with proper null handling
    const insertData = {
      name: collectionData.name || null,
      description: collectionData.description || null,
      visibility: collectionVisibility,
      color: collectionData.color || null,
      type: collectionData.type || null,
      userId: userId,
      organizationId: null,
      hashtags: collectionData.hashtags || null,
      eventId: collectionData.eventId || null,
      icon: collectionData.icon || null,
      tenantId: collectionData.tenantId,
      whiteboardData: collectionData.whiteboardData || null,
      ...dateRangeFields,
      // Resource collections keep the existing auto-share behavior,
      // while private collections are always forced off.
      publicJsonEnabled:
        collectionData.type === 'resource' && canShareCollectionDirectly
          ? true
          : Boolean(collectionData.publicJsonEnabled) &&
            canShareCollectionDirectly,
    };

    // Handle owner constraint
    if (collectionData.collection_type === 'user') {
      insertData.userId = collectionData.createdByUserId;
    } else if (collectionData.collection_type === 'organizer') {
      insertData.organizationId = collectionData.id;
    } else {
      throw new Error("collection_type must be either 'user' or 'organizer'");
    }

    const result = await db.insert(collections).values(insertData).returning();

    // if the collection is pinned, then add it to pinned items
    if (collectionData.isPinned) {
      // Get current max order position
      const maxOrderResult = await db
        .select({
          maxOrder: sql`COALESCE(MAX(order_position), -1)`.mapWith(Number),
        })
        .from(pinnedItems)
        .where(eq(pinnedItems.userId, userId));

      const newOrder = maxOrderResult[0].maxOrder + 1;

      await db.insert(pinnedItems).values({
        userId: userId,
        itemId: result[0].id,
        itemType: 'collection',
        orderPosition: newOrder,
      });
    }

    // Auto-update embeddings for the new collection (async, don't wait)
    autoUpdateCollectionEmbedding(result[0].id).catch((error) => {
      console.error(
        `Failed to update embeddings for collection ${result[0].id}:`,
        error
      );
    });

    return result[0];
  } catch (error) {
    console.error('Error in createCollectionService:', error);
    throw error;
  }
}

export async function getExternalLinksForAllCollectionsService(
  userId,
  tenants
) {
  try {
    const collectionsData = await db.execute(sql`
      WITH collections_with_links AS (
        SELECT
          c.id,
          c.name,
          c.type,
          c.visibility,
          c.color,
          c.icon,
          c.description,
          c.created_at,
          c.updated_at,
          c.start_date,
          c.end_date,
          c.event_id,
          c.status,
          c.tenant_id,
          c.hashtags,
          c.user_id,
          EXISTS (
            SELECT 1 FROM pinned_items 
            WHERE user_id = ${userId} 
            AND item_id = c.id
            AND item_type = 'collection'
          ) as is_pinned,
          jsonb_agg(
            CASE WHEN el.id IS NOT NULL AND (
              el.visibility = 'public' 
              OR el.added_by_user_id = ${userId}
              OR (
                el.visibility IN ('unlisted', 'public') 
                AND EXISTS (
                  SELECT 1 FROM collection_external_links_collaborators celc 
                  WHERE celc.collection_external_link_id = cel.id 
                  AND celc.user_id = ${userId}
                )
              )
              OR (
                -- Allow unlisted external links when parent collection is public/unlisted
                el.visibility = 'unlisted' 
                AND c.visibility IN ('public', 'unlisted')
              )
            ) THEN
              jsonb_build_object(
                'id', el.id,
                'url', el.url,
                'name', el.name,
                'tenant_id', el.tenant_id,
                'description', el.description,
                'notes', el.notes,
                'date', COALESCE(cel.start_date, cel.date),
                'startDate', COALESCE(cel.start_date, cel.date),
                'endDate', COALESCE(cel.end_date, cel.start_date, cel.date),
                'date_added', el.date_added,
                'status', cel.status,
                'userId', cel.user_id,
                'visibility', el.visibility,
                'event_id', cel.event_id,
                'type', el.type,
                'image_url', el.image_url,
                'image_metadata', el.image_metadata,
                'whiteboardData', el.whiteboard_data,
                'attachments', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', a.id,
                        'title', a.title,
                        'description', a.description,
                        'type', a.type,
                        'imageKey', a.image_key,
                        'createdAt', a.created_at,
                        'updatedAt', a.updated_at,
                        'listOrder', a.list_order,
                        'visibility', a.visibility,
                        'highlighted', ela.highlighted
                      )
                    ),
                    '[]'::jsonb
                  )
                  FROM external_link_attachments ela
                  JOIN attachments a ON ela.attachment_id = a.id
                  WHERE ela.external_link_id = el.id
                  AND (
                    a.visibility = 'public' 
                    OR a.visibility = 'unlisted'
                    OR (
                      el.added_by_user_id = ${userId}
                    )
                    OR (
                      el.added_by_user_id != ${userId}
                      AND EXISTS (
                        SELECT 1 FROM collection_external_links_collaborators celc2 
                        WHERE celc2.collection_external_link_id = cel.id 
                        AND celc2.user_id = ${userId}
                      )
                      AND (a.visibility IN ('public', 'unlisted') OR a.user_id = ${userId})
                    )
                  )
                ),
                'collaborators', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', celc.id,
                        'userId', celc.user_id,
                        'role', celc.role,
                        'createdAt', celc.created_at,
                        'updatedAt', celc.updated_at,
                        'firstName', u.first_name,
                        'lastName', u.last_name,
                        'email', u.email
                      )
                    ),
                    '[]'::jsonb
                  )
                  FROM collection_external_links_collaborators celc
                  LEFT JOIN users u ON celc.user_id = u.id
                  WHERE celc.collection_external_link_id = cel.id
                ),
                'notations', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', celn.id,
                        'title', celn.title,
                        'description', celn.description,
                        'notes', celn.notes,
                        'category', celn.category,
                        'status', celn.status,
                        'highlighted', celn.highlighted,
                        'createdAt', celn.created_at,
                        'updatedAt', celn.updated_at,
                        'listOrder', celn.list_order,
                        'date', COALESCE(celn.start_date, celn.date),
                        'startDate', COALESCE(celn.start_date, celn.date),
                        'endDate', COALESCE(celn.end_date, celn.start_date, celn.date),
                        'visibility', celn.visibility,
                        'startTime', celn.start_time,
                        'endTime', celn.end_time,
                        'timezone', celn.timezone,
                        'templateId', celn.template_id,
                        'customFields', celn.custom_fields,
                        'isTemplate', celn.is_template
                      ) ORDER BY celn.list_order
                    ),
                    '[]'::jsonb
                  )
                  FROM collection_external_links_notations celn
                  WHERE celn.collection_external_link_id = cel.id
                  AND (
                    celn.visibility = 'public'
                    OR (
                      el.added_by_user_id = ${userId}
                    )
                    OR (
                      el.added_by_user_id != ${userId}
                      AND EXISTS (
                        SELECT 1 FROM collection_external_links_collaborators celc3 
                        WHERE celc3.collection_external_link_id = cel.id 
                        AND celc3.user_id = ${userId}
                      )
                      AND (celn.visibility IN ('public', 'unlisted') OR celn.user_id = ${userId})
                    )
                  )
                ),
                'tags', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', celtd.id,
                        'name', celtd.name,
                        'description', celtd.description,
                        'color', celtd.color
                      ) ORDER BY celtd.name
                    ),
                    '[]'::jsonb
                  )
                  FROM collection_external_link_tags celt
                  JOIN collection_external_link_tag_definitions celtd ON celt.tag_id = celtd.id
                  WHERE celt.collection_external_link_id = cel.id
                )
              )
            END
          ) FILTER (WHERE el.id IS NOT NULL AND (
            el.visibility = 'public' 
            OR el.added_by_user_id = ${userId}
            OR (
              el.visibility IN ('unlisted', 'public') 
              AND EXISTS (
                SELECT 1 FROM collection_external_links_collaborators celc 
                WHERE celc.collection_external_link_id = cel.id 
                AND celc.user_id = ${userId}
              )
            )
            OR (
              -- Allow unlisted external links when parent collection is public/unlisted
              el.visibility = 'unlisted' 
              AND c.visibility IN ('public', 'unlisted')
            )
          )) AS external_links
        FROM collections c
        LEFT JOIN collection_external_links cel ON c.id = cel.collection_id
        LEFT JOIN external_links el ON cel.external_link_id = el.id
        WHERE c.type = 'external'
          AND (
            c.visibility = 'public' 
            OR c.user_id = ${userId}
            OR EXISTS (
              SELECT 1 FROM collection_external_links cel_collab
              INNER JOIN collection_external_links_collaborators celc_collab 
                ON cel_collab.id = celc_collab.collection_external_link_id
              WHERE cel_collab.collection_id = c.id 
                AND celc_collab.user_id = ${userId}
            )
          )
        GROUP BY 
          c.id, c.name, c.type, c.visibility, 
          c.color, c.description, c.created_at, 
          c.icon, c.updated_at, c.event_id,
          c.status, c.hashtags
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name,
          'type', type,
          'visibility', visibility,
          'color', color,
          'description', description,
          'created_at', created_at,
          'updated_at', updated_at,
          'event_id', event_id,
          'icon', icon,
          'is_pinned', is_pinned,
          'status', status,
          'tenant_id', tenant_id,
          'user_id', user_id,
          'hashtags', CASE WHEN hashtags IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(hashtags) END,
          'external_links', COALESCE(external_links, '[]'::jsonb),
          'externalLinksCount', jsonb_array_length(COALESCE(external_links, '[]'::jsonb))
        )
      ) AS collections
      FROM collections_with_links
      WHERE tenant_id IN ${tenants};
    `);

    // Parse hashtags for each collection
    const collections = collectionsData.rows[0].collections || [];
    return collections.map((collection) => {
      const hashtags =
        collection.hashtags && collection.hashtags.length > 0
          ? collection.hashtags[0].split(',')
          : [];
      return {
        ...collection,
        hashtags,
      };
    });
  } catch (error) {
    console.error('Error fetching external links for collections:', error);
    throw new Error('Failed to fetch external links for collections');
  }
}

export async function getExternalLinksForCollectionByIdService(
  collectionId,
  userId = null
) {
  try {
    const collectionData = await db.execute(sql`
      WITH collection_with_links AS (
        SELECT
          c.id,
          c.name,
          c.type,
          c.visibility,
          c.color,
          c.icon,
          c.description,
          c.created_at,
          c.updated_at,
          c.start_date,
          c.end_date,
          c.event_id,
          c.status,
          c.tenant_id,
          c.hashtags,
          EXISTS (
            SELECT 1 FROM pinned_items 
            WHERE user_id = ${userId} 
            AND item_id = c.id
            AND item_type = 'collection'
          ) as is_pinned,
          jsonb_agg(
            CASE WHEN el.id IS NOT NULL AND (
              el.visibility = 'public' 
              OR el.added_by_user_id = ${userId}
              OR (
                el.visibility IN ('unlisted', 'public') 
                AND EXISTS (
                  SELECT 1 FROM collection_external_links_collaborators celc 
                  WHERE celc.collection_external_link_id = cel.id 
                  AND celc.user_id = ${userId}
                )
              )
              OR (
                -- Allow unlisted external links when parent collection is public/unlisted
                el.visibility = 'unlisted' 
                AND c.visibility IN ('public', 'unlisted')
              )
            ) THEN
              jsonb_build_object(
                'id', el.id,
                'url', el.url,
                'name', el.name,
                'description', el.description,
                'notes', el.notes,
                'date_added', el.date_added,
                'date', COALESCE(cel.start_date, cel.date),
                'startDate', COALESCE(cel.start_date, cel.date),
                'endDate', COALESCE(cel.end_date, cel.start_date, cel.date),
                'visibility', el.visibility,
                'type', el.type,
                'image_url', el.image_url,
                'event_id', cel.event_id,
                'status', cel.status,
                'tenantId', el.tenant_id,
                'userId', cel.user_id,
                'sortOrder', cel.sort_order,
                'image_metadata', el.image_metadata,
                'whiteboardData', el.whiteboard_data,
                'startTime', el.start_time,
                'endTime', el.end_time,
                'timezone', el.timezone,
                'allowPublicNotations', el.allow_public_notations,
                'attachments', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', a.id,
                        'title', a.title,
                        'description', a.description,
                        'type', a.type,
                        'imageKey', a.image_key,
                        'createdAt', a.created_at,
                        'updatedAt', a.updated_at,
                        'listOrder', a.list_order,
                        'visibility', a.visibility,
                        'highlighted', ela.highlighted
                      )
                    ),
                    '[]'::jsonb
                  )
                  FROM external_link_attachments ela
                  JOIN attachments a ON ela.attachment_id = a.id
                  WHERE ela.external_link_id = el.id
                  AND (
                    a.visibility = 'public' 
                    OR a.visibility = 'unlisted'
                    OR (
                      el.added_by_user_id = ${userId}
                    )
                    OR (
                      el.added_by_user_id != ${userId}
                      AND EXISTS (
                        SELECT 1 FROM collection_external_links_collaborators celc2 
                        WHERE celc2.collection_external_link_id = cel.id 
                        AND celc2.user_id = ${userId}
                      )
                      AND (a.visibility IN ('public', 'unlisted') OR a.user_id = ${userId})
                    )
                  )
                ),
                'notations', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', celn.id,
                        'title', celn.title,
                        'description', celn.description,
                        'notes', celn.notes,
                        'category', celn.category,
                        'status', celn.status,
                        'highlighted', celn.highlighted,
                        'createdAt', celn.created_at,
                        'updatedAt', celn.updated_at,
                        'listOrder', celn.list_order,
                        'date', COALESCE(celn.start_date, celn.date),
                        'startDate', COALESCE(celn.start_date, celn.date),
                        'endDate', COALESCE(celn.end_date, celn.start_date, celn.date),
                        'visibility', celn.visibility,
                        'startTime', celn.start_time,
                        'endTime', celn.end_time,
                        'timezone', celn.timezone,
                        'templateId', celn.template_id,
                        'customFields', celn.custom_fields,
                        'isTemplate', celn.is_template
                      ) ORDER BY celn.list_order
                    ),
                    '[]'::jsonb
                  )
                  FROM collection_external_links_notations celn
                  WHERE celn.collection_external_link_id = cel.id
                  AND (
                    celn.visibility = 'public'
                    OR (
                      el.added_by_user_id = ${userId}
                    )
                    OR (
                      el.added_by_user_id != ${userId}
                      AND EXISTS (
                        SELECT 1 FROM collection_external_links_collaborators celc3 
                        WHERE celc3.collection_external_link_id = cel.id 
                        AND celc3.user_id = ${userId}
                      )
                      AND (celn.visibility IN ('public', 'unlisted') OR celn.user_id = ${userId})
                    )
                  )
                ),
                'tags', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', celtd.id,
                        'name', celtd.name,
                        'description', celtd.description,
                        'color', celtd.color
                      ) ORDER BY celtd.name
                    ),
                    '[]'::jsonb
                  )
                  FROM collection_external_link_tags celt
                  JOIN collection_external_link_tag_definitions celtd ON celt.tag_id = celtd.id
                  WHERE celt.collection_external_link_id = cel.id
                )
              )
            END
          ) FILTER (WHERE el.id IS NOT NULL AND (
            el.visibility = 'public' 
            OR el.added_by_user_id = ${userId}
            OR (
              el.visibility IN ('unlisted', 'public') 
              AND EXISTS (
                SELECT 1 FROM collection_external_links_collaborators celc 
                WHERE celc.collection_external_link_id = cel.id 
                AND celc.user_id = ${userId}
              )
            )
            OR (
              -- Allow unlisted external links when parent collection is public/unlisted
              el.visibility = 'unlisted' 
              AND c.visibility IN ('public', 'unlisted')
            )
          )) AS external_links
        FROM collections c
        LEFT JOIN collection_external_links cel ON c.id = cel.collection_id
        LEFT JOIN external_links el ON cel.external_link_id = el.id
        WHERE c.type = 'external' AND c.id = ${collectionId}
        GROUP BY c.id, c.name, c.type, c.visibility, c.color, c.icon, c.description, c.created_at, c.updated_at, c.start_date, c.end_date, c.event_id, c.status, c.tenant_id, c.hashtags
      ),
      type_ordering AS (
        SELECT 
          cto.type,
          cto.sort_order
        FROM collection_type_ordering cto
        WHERE cto.collection_id = ${collectionId}
      )
      SELECT 
        cw.id,
        cw.name,
        cw.type,
        cw.visibility,
        cw.color,
        cw.description,
        cw.created_at,
        cw.updated_at,
        cw.start_date,
        cw.end_date,
        cw.event_id,
        cw.status,
        cw.icon,
        cw.tenant_id,
        cw.is_pinned,
        cw.hashtags,
        COALESCE(cw.external_links, '[]'::jsonb) as external_links,
        COALESCE(
          (SELECT jsonb_object_agg(type, sort_order) FROM type_ordering),
          '{}'::jsonb
        ) as type_ordering
      FROM collection_with_links cw;
    `);

    // Convert hashtags from string to array
    const collection = collectionData.rows[0];
    if (collection) {
      collection.hashtags = collection.hashtags
        ? collection.hashtags.split(',')
        : [];
    }
    // Add tags to each notation if external links exist
    if (collection.external_links && collection.external_links.length > 0) {
      // Process each external link and its notations
      collection.external_links = await Promise.all(
        collection.external_links.map(async (link) => {
          if (link.notations && link.notations.length > 0) {
            // Add tags to each notation
            link.notations = await Promise.all(
              link.notations.map(async (notation) => {
                try {
                  const tags = await getTagsForNotation(notation.id);
                  return {
                    ...notation,
                    tags: tags || [],
                  };
                } catch (error) {
                  console.error(
                    `Error fetching tags for notation ${notation.id}:`,
                    error
                  );
                  return {
                    ...notation,
                    tags: [],
                  };
                }
              })
            );
          }
          return link;
        })
      );
    }

    return collection;
  } catch (error) {
    console.error('Error fetching external links for collection:', error);
    throw new Error('Failed to fetch external links for collection');
  }
}

export async function getExternalLinksWithNotationsByUserId(
  userId,
  filterDate = null
) {
  try {
    let queryConditions = [
      and(
        or(
          eq(collections.visibility, 'public'),
          eq(collections.userId, userId)
        ),
        eq(collections.type, 'external')
      ),
    ];

    // Add date filter if filterDate is provided
    if (filterDate) {
      queryConditions.push(sql`${collections.updatedAt} >= ${filterDate}`);
    }

    // First, get the collections with their basic info
    const collectionsResult = await db
      .select({
        id: collections.id,
        name: collections.name,
        type: collections.type,
        visibility: collections.visibility,
        color: collections.color,
        status: collections.status,
        description: collections.description,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        startDate: collections.startDate,
        endDate: collections.endDate,
        eventId: collections.eventId,
      })
      .from(collections)
      .where(and(...queryConditions));

    // Process collections to include external links, notations, and tags
    const processedResults = await Promise.all(
      collectionsResult.map(async (collection) => {
        // Get external links for this collection with collaborator visibility check
        const externalLinksResult = await db
          .select({
            externalLink: {
              id: externalLinks.id,
              url: externalLinks.url,
              name: externalLinks.name,
              description: externalLinks.description,
              notes: externalLinks.notes,
              dateAdded: externalLinks.dateAdded,
              visibility: externalLinks.visibility,
              type: externalLinks.type,
              imageUrl: externalLinks.imageUrl,
              imageMetadata: externalLinks.imageMetadata,
              whiteboardData: externalLinks.whiteboardData,
              timestamps: externalLinks.timestamps,
              fullText: externalLinks.fullText,
              startTime: externalLinks.startTime,
              endTime: externalLinks.endTime,
              timezone: externalLinks.timezone,
              addedByUserId: externalLinks.addedByUserId,
            },
            collectionExternalLinkId: collectionExternalLinks.id,
            status: collectionExternalLinks.status,
            date: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
            startDate: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
            endDate: sql`COALESCE(${collectionExternalLinks.endDate}, ${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
          })
          .from(collectionExternalLinks)
          .innerJoin(
            externalLinks,
            eq(collectionExternalLinks.externalLinkId, externalLinks.id)
          )
          .leftJoin(
            collectionExternalLinkCollaborators,
            eq(
              collectionExternalLinks.id,
              collectionExternalLinkCollaborators.collectionExternalLinkId
            )
          )
          .where(
            and(
              eq(collectionExternalLinks.collectionId, collection.id),
              or(
                eq(externalLinks.visibility, 'public'),
                eq(externalLinks.addedByUserId, userId),
                and(
                  inArray(externalLinks.visibility, ['unlisted', 'public']),
                  eq(collectionExternalLinkCollaborators.userId, userId)
                )
              )
            )
          );

        // For each external link, get its notations and tags with proper filtering
        const externalLinksWithNotationsAndTags = await Promise.all(
          externalLinksResult.map(async (link) => {
            // Check if user is owner or collaborator for this specific link
            const isOwner = link.externalLink.addedByUserId === userId;
            const isCollaborator =
              !isOwner &&
              externalLinksResult.some(
                (el) =>
                  el.externalLink.id === link.externalLink.id &&
                  el.collectionExternalLinkId === link.collectionExternalLinkId
              );

            const notations = await db
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
                date: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
                startDate: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
                endDate: sql`COALESCE(${collectionExternalLinksNotations.endDate}, ${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
                visibility: collectionExternalLinksNotations.visibility,
                startTime: collectionExternalLinksNotations.startTime,
                endTime: collectionExternalLinksNotations.endTime,
                timezone: collectionExternalLinksNotations.timezone,
                userId: collectionExternalLinksNotations.userId,
              })
              .from(collectionExternalLinksNotations)
              .where(
                and(
                  eq(
                    collectionExternalLinksNotations.collectionExternalLinkId,
                    link.collectionExternalLinkId
                  ),
                  or(
                    eq(collectionExternalLinksNotations.visibility, 'public'),
                    isOwner ? sql`true` : sql`false`,
                    and(
                      sql`${!isOwner}`,
                      isCollaborator ? sql`true` : sql`false`,
                      or(
                        inArray(collectionExternalLinksNotations.visibility, [
                          'public',
                          'unlisted',
                        ]),
                        eq(collectionExternalLinksNotations.userId, userId)
                      )
                    )
                  )
                )
              )
              .orderBy(collectionExternalLinksNotations.listOrder);

            // Get notation tags for all notations in this external link
            let notationsWithTags = notations;
            if (notations.length > 0) {
              const notationIds = notations.map((notation) => notation.id);

              const notationTagsData = await db
                .select({
                  notationId:
                    collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
                  tag: {
                    id: collectionExternalLinkTagDefinitions.id,
                    name: collectionExternalLinkTagDefinitions.name,
                    description:
                      collectionExternalLinkTagDefinitions.description,
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
              notationsWithTags = notations.map((notation) => {
                const notationTags = notationTagsData
                  .filter((tagData) => tagData.notationId === notation.id)
                  .map(({ tag }) => tag);

                return {
                  ...notation,
                  tags: notationTags,
                };
              });
            }

            // Get tags for this external link
            const tags = await db
              .select({
                id: collectionExternalLinkTagDefinitions.id,
                name: collectionExternalLinkTagDefinitions.name,
                description: collectionExternalLinkTagDefinitions.description,
                color: collectionExternalLinkTagDefinitions.color,
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
                  link.collectionExternalLinkId
                )
              )
              .orderBy(collectionExternalLinkTagDefinitions.name);

            // Remove the collectionExternalLinkId from the final result
            const { collectionExternalLinkId, ...linkWithoutId } = link;

            return {
              ...linkWithoutId,
              notations: notationsWithTags || [],
              tags: tags || [],
            };
          })
        );

        return {
          ...collection,
          externalLinks: externalLinksWithNotationsAndTags,
        };
      })
    );

    return processedResults;
  } catch (error) {
    console.error(
      'Error fetching external links with notations and tags:',
      error
    );
    throw new Error('Failed to fetch external links with notations and tags');
  }
}

export const externalLinksService = {
  getExternalLinksWithNotationsByUserId,
};

export async function getResourcesForCollectionByIdService(collectionId) {
  try {
    const collectionData = await db.execute(sql`
      WITH orgs AS (
        SELECT
          or_link.resource_id,
          jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'name', o.name,
              'image_url', o.image_url,
              'imageKey', o.image_key
            ) ORDER BY o.name
          ) AS organizations
        FROM organization_resources or_link
        JOIN organizations o ON or_link.organization_id = o.id
        GROUP BY or_link.resource_id
      ),
      collection_with_resources AS (
        SELECT
          c.id,
          c.name,
          c.type,
          c.visibility,
          c.color,
          c.status,
          c.icon,
          c.description,
          c.created_at,
          c.updated_at,
          c.event_id,
          c.hashtags,
          jsonb_agg(
            jsonb_build_object(
              'id', r.id,
              'name', r.name,
              'description', r.description,
              'notes', cr.notes,
              'status', cr.status,
              'resource_date', r.resource_date,
              'url', r.url,
              'video_url', r.video_url,
              'type_id', r.type_id,
              'type_name', rt.name,
              'organizations', COALESCE(orgs.organizations, '[]'::jsonb),
              'timestamps', r.timestamps,
              'fullText', r.full_text
            ) ORDER BY cr.order_position
          ) FILTER (WHERE r.id IS NOT NULL) AS resources
        FROM collections c
        LEFT JOIN collection_resources cr ON c.id = cr.collection_id
        LEFT JOIN resources r ON cr.resource_id = r.id
        LEFT JOIN resource_types rt ON r.type_id = rt.id
        LEFT JOIN orgs ON r.id = orgs.resource_id
        WHERE c.type = 'resource' AND c.id = ${collectionId}
          GROUP BY c.id, c.name, c.type, c.visibility, c.color, c.status, c.icon, c.description, c.created_at, c.updated_at, c.event_id, c.hashtags
      )
      SELECT 
        id,
        name,
        type,
        visibility,
        color,
        description,
        created_at,
        updated_at,
        status,
        icon,
        hashtags,
        COALESCE(resources, '[]'::jsonb) as resources
      FROM collection_with_resources;
    `);

    // Convert hashtags from string to array
    const collection = collectionData.rows[0];
    if (collection) {
      collection.hashtags = collection.hashtags
        ? collection.hashtags.split(',')
        : [];
    }

    return collection;
  } catch (error) {
    console.error('Error fetching resources for collection:', error);
    throw new Error('Failed to fetch resources for collection');
  }
}

export async function addExternalLinkToCollectionService(
  collectionId,
  externalLinkData
) {
  try {
    const dateRangeFields = buildDateRangeCreateFields(externalLinkData);
    // Start a transaction
    const result = await db.transaction(async (tx) => {
      //first update the collection to set the updated_at date to now
      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, collectionId));

      // Create the external link
      const externalLink = await tx
        .insert(externalLinks)
        .values({
          url: externalLinkData.url,
          name: externalLinkData.name,
          description: externalLinkData.description,
          notes: externalLinkData.notes,
          dateAdded: new Date(),
          addedByUserId: externalLinkData.userId,
          visibility: externalLinkData.visibility || 'private',
          type: externalLinkData.type || 'link',
          imageKey: externalLinkData.imageKey,
          imageMetadata: externalLinkData.imageMetadata,
          imageUrl: externalLinkData.imageUrl,
          whiteboardData: externalLinkData.whiteboardData || null,
          tenantId: externalLinkData.tenantId,
          startTime: externalLinkData.startTime,
          endTime: externalLinkData.endTime,
          timezone: externalLinkData.timezone,
          hashtags: externalLinkData.hashtags,
          allowPublicNotations: externalLinkData.allowPublicNotations || false,
          publicJsonEnabled:
            Boolean(externalLinkData.publicJsonEnabled) &&
            isPubliclyShareableVisibility(
              externalLinkData.visibility || 'private'
            ),
        })
        .returning();

      // Create the association with userId
      const linkAssociation = await tx
        .insert(collectionExternalLinks)
        .values({
          collectionId: collectionId,
          externalLinkId: externalLink[0].id,
          eventId: externalLinkData.eventId,
          ...dateRangeFields,
          status: externalLinkData.status || 'pending',
          userId: externalLinkData.userId, // Store the user who created the link
          sortOrder: externalLinkData.sortOrder,
        })
        .returning();

      return {
        ...externalLink[0],
        collectionExternalLinkId: linkAssociation[0].id,
      };
    });

    // Auto-update embeddings for the new external link (async, don't wait)
    autoUpdateExternalLinkEmbedding(result.id).catch((error) => {
      console.error(
        `Failed to update embeddings for external link ${result.id}:`,
        error
      );
    });

    // Trigger Slack notification for new external link (async, don't wait)
    triggerNewExternalLinkNotification(
      collectionId,
      result,
      externalLinkData.userId
    );

    // Sync collaborators if external link is public or unlisted
    if (result.visibility === 'public' || result.visibility === 'unlisted') {
      // Import and call the sync function asynchronously
      import('./collaborationService.js')
        .then(({ syncCollaboratorsToNewExternalLink }) => {
          return syncCollaboratorsToNewExternalLink(collectionId, result.id);
        })
        .then((syncedCount) => {
          if (syncedCount > 0) {
            console.log(
              `Synced ${syncedCount} collaborators to external link ${result.id}`
            );
          }
        })
        .catch((error) => {
          console.error(
            `Failed to sync collaborators to external link ${result.id}:`,
            error
          );
        });
    }

    return result;
  } catch (error) {
    console.error('Error in addExternalLinkToCollectionService:', error);
    throw error;
  }
}

export async function deleteExternalLinkFromCollectionService(
  collectionId,
  externalLinkId,
  userId
) {
  try {
    return await db.transaction(async (tx) => {
      // First check if the user owns the external link
      const externalLink = await tx
        .select()
        .from(externalLinks)
        .where(
          and(
            eq(externalLinks.id, externalLinkId),
            eq(externalLinks.addedByUserId, userId)
          )
        );

      if (!externalLink[0]) {
        throw new Error(
          'External link not found or you do not have permission to delete it'
        );
      }

      // Get the specific collection_external_link for this collection and external link
      const collectionExternalLink = await tx
        .select()
        .from(collectionExternalLinks)
        .where(
          and(
            eq(collectionExternalLinks.collectionId, collectionId),
            eq(collectionExternalLinks.externalLinkId, externalLinkId)
          )
        );

      if (!collectionExternalLink[0]) {
        throw new Error('External link not found in this collection');
      }

      // Get all notations for this specific collection_external_link
      const notations = await tx
        .select()
        .from(collectionExternalLinksNotations)
        .where(
          eq(
            collectionExternalLinksNotations.collectionExternalLinkId,
            collectionExternalLink[0].id
          )
        );

      // For each notation, delete its threads
      for (const notation of notations) {
        await tx
          .delete(collectionExternalLinksThreads)
          .where(
            eq(
              collectionExternalLinksThreads.collectionExternalLinkNotationId,
              notation.id
            )
          );
      }

      // Delete the notations for this collection_external_link
      await tx
        .delete(collectionExternalLinksNotations)
        .where(
          eq(
            collectionExternalLinksNotations.collectionExternalLinkId,
            collectionExternalLink[0].id
          )
        );

      // Delete the collection_external_link entry
      await tx
        .delete(collectionExternalLinks)
        .where(
          and(
            eq(collectionExternalLinks.collectionId, collectionId),
            eq(collectionExternalLinks.externalLinkId, externalLinkId)
          )
        );

      // Check if this external link is used in any other collections
      const otherCollectionLinks = await tx
        .select()
        .from(collectionExternalLinks)
        .where(eq(collectionExternalLinks.externalLinkId, externalLinkId));

      // If this was the only collection using this external link, delete the external link itself
      // This will automatically cascade to delete external_link_attachments due to the ON DELETE CASCADE
      if (otherCollectionLinks.length === 0) {
        await tx
          .delete(externalLinks)
          .where(eq(externalLinks.id, externalLinkId));
      }

      return { success: true };
    });
  } catch (error) {
    console.error('Error deleting external link from collection:', error);
    throw new Error('Failed to delete external link from collection');
  }
}

export async function updateExternalLinkInCollectionService(
  collectionId,
  externalLinkId,
  updateData
) {
  try {
    const dateRangeFields = buildDateRangeUpdateFields(updateData);
    // Wrap both operations in a transaction
    return await db.transaction(async (tx) => {
      // First, get the current visibility of the external link
      const [currentExternalLink] = await tx
        .select({
          visibility: externalLinks.visibility,
          publicJsonEnabled: externalLinks.publicJsonEnabled,
        })
        .from(externalLinks)
        .where(eq(externalLinks.id, externalLinkId));

      const previousVisibility = currentExternalLink?.visibility;
      const nextVisibility =
        updateData.visibility ?? currentExternalLink?.visibility ?? 'private';

      // Update the collection's updated_at date
      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, collectionId));

      // Update the external link
      const result = await tx
        .update(externalLinks)
        .set({
          url: updateData.url,
          name: updateData.name,
          description: updateData.description,
          notes: updateData.notes,
          startTime: updateData.startTime,
          endTime: updateData.endTime,
          timezone: updateData.timezone,
          visibility: updateData.visibility,
          type: updateData.type,
          imageKey: updateData.imageKey,
          imageMetadata: updateData.imageMetadata,
          imageUrl: updateData.imageUrl,
          whiteboardData: updateData.whiteboardData,
          hashtags: updateData.hashtags,
          allowPublicNotations: updateData.allowPublicNotations,
          publicJsonEnabled: isPubliclyShareableVisibility(nextVisibility)
            ? currentExternalLink?.publicJsonEnabled || false
            : false,
          updatedAt: new Date(),
        })
        .where(eq(externalLinks.id, externalLinkId))
        .returning();

      //update the collectionExternalLink status
      await tx
        .update(collectionExternalLinks)
        .set({
          collectionId: collectionId,
          status: updateData.status,
          eventId: updateData.eventId,
          ...dateRangeFields,
        })
        .where(
          and(
            eq(collectionExternalLinks.externalLinkId, externalLinkId),
            eq(collectionExternalLinks.collectionId, collectionId)
          )
        );

      // Check if visibility changed from private to public/unlisted
      if (
        previousVisibility === 'private' &&
        updateData.visibility &&
        ['public', 'unlisted'].includes(updateData.visibility)
      ) {
        // Sync collection collaborators to the external link
        try {
          await syncCollaboratorsToNewExternalLink(
            collectionId,
            externalLinkId,
            tx
          );
          console.log(
            `Synced collaborators to external link ${externalLinkId} after visibility change`
          );
        } catch (syncError) {
          console.error(
            `Failed to sync collaborators to external link ${externalLinkId}:`,
            syncError
          );
          // Don't throw here - the update was successful, just log the sync error
        }
      }

      // Auto-update embeddings for the updated external link (async, don't wait)
      autoUpdateExternalLinkEmbedding(externalLinkId).catch((error) => {
        console.error(
          `Failed to update embeddings for external link ${externalLinkId}:`,
          error
        );
      });

      return result[0];
    });
  } catch (error) {
    console.error('Error in updateExternalLinkInCollectionService:', error);
    throw error;
  }
}

export async function getExternalLinksForCollectionService(collectionId) {
  try {
    const result = await db
      .select({
        id: externalLinks.id,
        url: externalLinks.url,
        name: externalLinks.name,
        description: externalLinks.description,
        notes: externalLinks.notes,
        dateAdded: externalLinks.dateAdded,
        visibility: externalLinks.visibility,
        type: externalLinks.type,
        imageUrl: externalLinks.imageUrl,
        imageMetadata: externalLinks.imageMetadata,
        whiteboardData: externalLinks.whiteboardData,
        status: collectionExternalLinks.status,
        startDate: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        endDate: sql`COALESCE(${collectionExternalLinks.endDate}, ${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        date: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        startTime: externalLinks.startTime,
        endTime: externalLinks.endTime,
        timezone: externalLinks.timezone,
        hashtags: externalLinks.hashtags,
      })
      .from(collectionExternalLinks)
      .innerJoin(
        externalLinks,
        eq(collectionExternalLinks.externalLinkId, externalLinks.id)
      )
      .where(eq(collectionExternalLinks.collectionId, collectionId));

    return result;
  } catch (error) {
    console.error('Error fetching external links:', error);
    throw new Error('Failed to fetch external links');
  }
}

export async function getExternalLinkByIdService(
  externalLinkId,
  userId = null
) {
  try {
    // Handle null/undefined/string "null" userId properly for SQL queries
    const userIdValue =
      userId && userId !== 'null' && userId !== 'undefined' ? userId : null;
    const userIdParam = userIdValue
      ? sql`${userIdValue}::uuid`
      : sql`NULL::uuid`;

    // Check if user is a collaborator on this external link OR on the parent collection
    const isCollaborator = userIdValue
      ? await db
          .select({ id: sql`1` })
          .from(collectionExternalLinks)
          .leftJoin(
            collectionExternalLinkCollaborators,
            and(
              eq(
                collectionExternalLinkCollaborators.collectionExternalLinkId,
                collectionExternalLinks.id
              ),
              eq(collectionExternalLinkCollaborators.userId, userIdValue)
            )
          )
          .leftJoin(
            collectionCollaborators,
            and(
              eq(
                collectionCollaborators.collectionId,
                collectionExternalLinks.collectionId
              ),
              eq(collectionCollaborators.userId, userIdValue)
            )
          )
          .where(
            and(
              eq(collectionExternalLinks.externalLinkId, externalLinkId),
              or(
                isNotNull(collectionExternalLinkCollaborators.id),
                isNotNull(collectionCollaborators.id)
              )
            )
          )
          .limit(1)
      : [];

    // Get basic external link data
    const result = await db.execute(sql`
      SELECT
        el.id,
        el.url,
        el.name,
        el.description,
        el.notes,
        el.date_added AS "dateAdded",
        el.visibility,
        el.type,
        el.image_url AS "imageUrl",
        el.image_metadata AS "imageMetadata",
        el.whiteboard_data AS "whiteboardData",
        el.added_by_user_id AS "addedByUserId",
        el.created_at AS "createdAt",
        el.updated_at AS "updatedAt",
        el.start_time AS "startTime",
        el.end_time AS "endTime",
        el.timezone,
        el.tenant_id AS "tenantId",
        el.allow_public_notations AS "allowPublicNotations",
        (
          SELECT cel.status
          FROM collection_external_links cel
          WHERE cel.external_link_id = el.id
          LIMIT 1
        ) AS status,
        (
          SELECT cel.event_id
          FROM collection_external_links cel
          WHERE cel.external_link_id = el.id
          LIMIT 1
        ) AS event_id,
        (
          SELECT COALESCE(cel.start_date, cel.date)
          FROM collection_external_links cel
          WHERE cel.external_link_id = el.id
          LIMIT 1
        ) AS date,
        (
          SELECT COALESCE(cel.start_date, cel.date)
          FROM collection_external_links cel
          WHERE cel.external_link_id = el.id
          LIMIT 1
        ) AS "startDate",
        (
          SELECT COALESCE(cel.end_date, cel.start_date, cel.date)
          FROM collection_external_links cel
          WHERE cel.external_link_id = el.id
          LIMIT 1
        ) AS "endDate",
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', c.id,
                'name', c.name,
                'collectionExternalLinkId', cel.id,
                'status', cel.status,
                'date', COALESCE(cel.start_date, cel.date),
                'startDate', COALESCE(cel.start_date, cel.date),
                'endDate', COALESCE(cel.end_date, cel.start_date, cel.date),
                'userId', cel.user_id
              )
            )
            FROM collection_external_links cel
            JOIN collections c ON cel.collection_id = c.id
            LEFT JOIN collection_collaborators cc ON c.id = cc.collection_id AND cc.user_id = ${userIdParam}
            WHERE cel.external_link_id = el.id
            AND (
              c.visibility = 'public'
              OR c.visibility = 'unlisted'
              OR c.user_id = ${userIdParam}
              OR cc.id IS NOT NULL
            )
          ),
          '[]'::jsonb
        ) AS collections
      FROM external_links el
      WHERE el.id = ${externalLinkId}
      AND (
        el.visibility = 'public' 
        OR el.added_by_user_id = ${userIdParam}
        OR (
          el.visibility IN ('unlisted', 'public') 
          AND ${isCollaborator.length > 0}
        )
        OR (
          -- Allow unlisted external links when they belong to a public/unlisted collection
          -- For COMMUNITY_TENANT items, only allow if the person who added the link to the collection is the link owner
          el.visibility = 'unlisted'
          AND EXISTS (
            SELECT 1 FROM collection_external_links cel
            JOIN collections c ON cel.collection_id = c.id
            WHERE cel.external_link_id = el.id
            AND c.visibility IN ('public', 'unlisted')
            AND (
              -- For non-community tenants, any public/unlisted collection works
              el.tenant_id != ${process.env.COMMUNITY_TENANT}::uuid
              -- For community tenant, the person who added the link must be the link owner (intentional sharing)
              OR (el.tenant_id = ${process.env.COMMUNITY_TENANT}::uuid AND cel.user_id = el.added_by_user_id)
            )
          )
        )
      )
      LIMIT 1;
    `);

    if (result.rows.length === 0) {
      return null;
    }

    const externalLink = result.rows[0];

    // Get collection external link IDs for this external link
    const collectionLinks = await db
      .select({
        id: collectionExternalLinks.id,
      })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.externalLinkId, externalLinkId));

    const collectionLinkIds = collectionLinks.map((link) => link.id);

    // Get notations
    const notations = await db
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
        date: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        startDate: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        endDate: sql`COALESCE(${collectionExternalLinksNotations.endDate}, ${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        visibility: collectionExternalLinksNotations.visibility,
        startTime: collectionExternalLinksNotations.startTime,
        endTime: collectionExternalLinksNotations.endTime,
        timezone: collectionExternalLinksNotations.timezone,
        userId: collectionExternalLinksNotations.userId,
        type: collectionExternalLinksNotations.type,
        templateId: collectionExternalLinksNotations.templateId,
        customFields: collectionExternalLinksNotations.customFields,
        submissionMetadata: collectionExternalLinksNotations.submissionMetadata,
        isTemplate: collectionExternalLinksNotations.isTemplate,
      })
      .from(collectionExternalLinksNotations)
      .where(
        and(
          inArray(
            collectionExternalLinksNotations.collectionExternalLinkId,
            collectionLinkIds
          ),
          or(
            // Public notations are visible to all
            eq(collectionExternalLinksNotations.visibility, 'public'),
            // Users can always see their own notations
            eq(collectionExternalLinksNotations.userId, userId),
            // External link owner can see all notations
            eq(externalLink.addedByUserId, userId),
            // Collaborators can see unlisted notations
            and(
              gt(sql`${isCollaborator.length}`, 0),
              eq(collectionExternalLinksNotations.visibility, 'unlisted')
            )
          )
        )
      )
      .orderBy(collectionExternalLinksNotations.listOrder);

    // Get notation tags separately
    let notationsWithTags = notations;
    if (notations.length > 0) {
      const notationIds = notations.map((notation) => notation.id);

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
      notationsWithTags = notations.map((notation) => {
        const notationTags = notationTagsData
          .filter((tagData) => tagData.notationId === notation.id)
          .map(({ tag }) => tag);

        return {
          ...notation,
          tags: notationTags,
        };
      });
    }

    // Get attachments
    const attachmentsList = await db
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
        highlighted: externalLinkAttachments.highlighted,
      })
      .from(externalLinkAttachments)
      .innerJoin(
        attachments,
        eq(externalLinkAttachments.attachmentId, attachments.id)
      )
      .where(
        and(
          eq(externalLinkAttachments.externalLinkId, externalLinkId),
          or(
            // Public attachments are visible to all
            eq(attachments.visibility, 'public'),
            // Users can always see their own attachments
            eq(attachments.userId, userId),
            // External link owner can see all attachments
            eq(externalLink.addedByUserId, userId),
            // Collaborators can see unlisted attachments
            and(
              gt(sql`${isCollaborator.length}`, 0),
              eq(attachments.visibility, 'unlisted')
            )
          )
        )
      );

    // Get tags
    const tags = await db
      .select({
        id: collectionExternalLinkTagDefinitions.id,
        name: collectionExternalLinkTagDefinitions.name,
        description: collectionExternalLinkTagDefinitions.description,
        color: collectionExternalLinkTagDefinitions.color,
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
        inArray(
          collectionExternalLinkTags.collectionExternalLinkId,
          collectionLinkIds
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

    // Combine all data
    return {
      ...externalLink,
      notations: notationsWithTags || [],
      attachments: attachmentsList || [],
      tags: tags || [],
    };
  } catch (error) {
    console.error('Error fetching external link by ID:', error);
    throw new Error('Failed to fetch external link');
  }
}

// ========================
// Notation Service Functions
// ========================

export async function addNotationToExternalLinkService(
  externalLinkId,
  notationData,
  userId
) {
  try {
    const dateRangeFields = buildDateRangeCreateFields(notationData);
    //first update the external link to set the updated_at date to now
    await db
      .update(externalLinks)
      .set({ updatedAt: new Date() })
      .where(eq(externalLinks.id, externalLinkId));

    //then add the notation
    const notationId = generateUUID();
    const insertedNotation = await db
      .insert(collectionExternalLinksNotations)
      .values({
        id: notationId,
        collectionExternalLinkId: externalLinkId,
        title: notationData.title,
        userId: userId || null, // Allow null for public submissions
        ...dateRangeFields,
        startTime: notationData.startTime || null,
        endTime: notationData.endTime || null,
        timezone: notationData.timezone || null,
        type: notationData.type || null,
        description: notationData.description || null,
        notes: notationData.notes || null,
        category: notationData.category || null,
        status: notationData.status || null,
        highlighted: notationData.highlighted || false,
        visibility: notationData.visibility || 'private',
        templateId: notationData.templateId || null,
        customFields: notationData.customFields || {},
        submissionMetadata: notationData.submitterInfo
          ? { ...notationData.submitterInfo, isPublicSubmission: true }
          : notationData.submissionMetadata || {},
        isTemplate: notationData.isTemplate || false,
      })
      .returning();

    // Add tags if provided
    if (notationData.tags && notationData.tags.length > 0) {
      const tagIds = notationData.tags.map((tag) => tag.id || tag);
      await addTagsToNotationService(notationId, tagIds);
    }

    // Embeddings will be processed asynchronously by the background job

    // Get the notation with tags included
    const notationWithTags = await getNotationsForExternalLinkService(
      externalLinkId,
      userId
    );
    const createdNotation = notationWithTags.find((n) => n.id === notationId);

    // Trigger Slack notification for new notation (only if not private)
    const finalNotation = createdNotation || insertedNotation[0];
    if (finalNotation.visibility !== 'private') {
      triggerNewNotationNotification(finalNotation, externalLinkId, userId);
    }

    // Return the created notation with tags
    return finalNotation;
  } catch (error) {
    console.error('Error adding notation to external link:', error);
    throw error;
  }
}

export async function getNotationsForExternalLinkService(
  externalLinkId,
  userId
) {
  try {
    // First check if user has access to the parent external link
    const collectionExternalLink = await db
      .select({
        id: collectionExternalLinks.id,
        externalLinkId: collectionExternalLinks.externalLinkId,
        collectionId: collectionExternalLinks.collectionId,
      })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.id, externalLinkId))
      .limit(1);

    if (!collectionExternalLink.length) {
      return [];
    }

    const linkData = collectionExternalLink[0];

    // Check if user has access to the external link
    const externalLink = await db
      .select({
        id: externalLinks.id,
        visibility: externalLinks.visibility,
        addedByUserId: externalLinks.addedByUserId,
      })
      .from(externalLinks)
      .leftJoin(
        collectionExternalLinkCollaborators,
        and(
          eq(
            collectionExternalLinkCollaborators.collectionExternalLinkId,
            linkData.id
          ),
          eq(collectionExternalLinkCollaborators.userId, userId)
        )
      )
      .where(
        and(
          eq(externalLinks.id, linkData.externalLinkId),
          or(
            eq(externalLinks.visibility, 'public'),
            eq(externalLinks.addedByUserId, userId),
            and(
              inArray(externalLinks.visibility, ['unlisted', 'public']),
              isNotNull(collectionExternalLinkCollaborators.id)
            )
          )
        )
      )
      .limit(1);

    if (!externalLink.length) {
      return [];
    }

    // Check if user has access to the parent collection
    const collection = await db
      .select({
        id: collections.id,
        visibility: collections.visibility,
        userId: collections.userId,
      })
      .from(collections)
      .leftJoin(
        collectionCollaborators,
        and(
          eq(collectionCollaborators.collectionId, collections.id),
          eq(collectionCollaborators.userId, userId)
        )
      )
      .where(
        and(
          eq(collections.id, linkData.collectionId),
          or(
            eq(collections.visibility, 'public'),
            eq(collections.userId, userId),
            and(
              inArray(collections.visibility, ['unlisted', 'public']),
              isNotNull(collectionCollaborators.id)
            )
          )
        )
      )
      .limit(1);

    if (!collection.length) {
      return [];
    }

    // Check if user is a collaborator on the external link
    const isExternalLinkCollaborator = await db
      .select({ id: collectionExternalLinkCollaborators.id })
      .from(collectionExternalLinkCollaborators)
      .where(
        and(
          eq(
            collectionExternalLinkCollaborators.collectionExternalLinkId,
            externalLinkId
          ),
          eq(collectionExternalLinkCollaborators.userId, userId)
        )
      )
      .limit(1);

    // Check if user is a collaborator on the parent collection
    const isCollectionCollaborator = await db
      .select({ id: collectionCollaborators.id })
      .from(collectionCollaborators)
      .where(
        and(
          eq(collectionCollaborators.collectionId, linkData.collectionId),
          eq(collectionCollaborators.userId, userId)
        )
      )
      .limit(1);

    // User is considered a collaborator if they are either type
    const isCollaborator =
      isExternalLinkCollaborator.length > 0 ||
      isCollectionCollaborator.length > 0;

    // Now fetch notations with visibility filtering
    const notations = await db
      .select()
      .from(collectionExternalLinksNotations)
      .where(
        and(
          eq(
            collectionExternalLinksNotations.collectionExternalLinkId,
            externalLinkId
          ),
          or(
            // Public notations are visible to all
            eq(collectionExternalLinksNotations.visibility, 'public'),
            // Users can always see their own notations
            eq(collectionExternalLinksNotations.userId, userId),
            // External link owner can see all notations
            eq(externalLink[0].addedByUserId, userId),
            // Collection owner can see all notations
            eq(collection[0].userId, userId),
            // Collaborators (both collection and external link) can see unlisted notations
            and(
              eq(collectionExternalLinksNotations.visibility, 'unlisted'),
              isCollaborator
            )
          )
        )
      );

    // Get tags for all notations if there are any
    if (notations.length > 0) {
      const notationIds = notations.map((notation) => notation.id);

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
      return notations.map((notation) => {
        const notationTags = notationTagsData
          .filter((tagData) => tagData.notationId === notation.id)
          .map(({ tag }) => tag);

        return {
          ...notation,
          tags: notationTags,
        };
      });
    }

    return notations;
  } catch (error) {
    console.error('Error fetching notations:', error);
    throw new Error('Failed to fetch notations for external link');
  }
}

export async function getCollectionExternalLinkIdService(externalLinkId) {
  try {
    const result = await db
      .select({ id: collectionExternalLinks.id })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
      .limit(1);

    if (!result || result.length === 0) {
      return null;
    }

    return result[0].id;
  } catch (error) {
    console.error('Error fetching collection external link ID:', error);
    throw new Error('Failed to fetch collection external link ID');
  }
}

export async function updateNotationInExternalLinkService(
  notationId,
  updateData,
  collectionExternalLinkId,
  userId
) {
  try {
    const dateRangeFields = buildDateRangeUpdateFields(updateData);
    // Get the actual external link ID from the collection_external_links junction table
    const [linkData] = await db
      .select({ externalLinkId: collectionExternalLinks.externalLinkId })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.id, collectionExternalLinkId));

    if (!linkData) {
      throw new Error('Collection external link not found');
    }

    //first update the external link to set the updated_at date to now
    await db
      .update(externalLinks)
      .set({ updatedAt: new Date() })
      .where(eq(externalLinks.id, linkData.externalLinkId));

    // Extract tags from update data
    const tags = updateData.tags;

    // Map content to notes if it exists
    const mappedUpdateData = {
      title: updateData.title,
      description: updateData.description,
      notes: updateData.content || updateData.notes, // handle either field name
      category: updateData.category,
      status: updateData.status,
      highlighted: updateData.highlighted,
      visibility: updateData.visibility,
      ...dateRangeFields,
      startTime: updateData.startTime || null,
      endTime: updateData.endTime || null,
      timezone: updateData.timezone || null,
      type: updateData.type || null,
      customFields: updateData.customFields,
      templateId: updateData.templateId,
      isTemplate: updateData.isTemplate,
      updatedAt: new Date(),
    };
    // Remove content field and tags to avoid duplicate storage
    delete mappedUpdateData.content;
    delete mappedUpdateData.tags;
    // Remove undefined values to avoid overwriting with null
    Object.keys(mappedUpdateData).forEach((key) => {
      if (mappedUpdateData[key] === undefined) {
        delete mappedUpdateData[key];
      }
    });

    // Debug logging for custom fields
    if (updateData.customFields !== undefined) {
      console.log(
        'Updating notation with custom fields:',
        JSON.stringify(updateData.customFields, null, 2)
      );
    }

    const result = await db
      .update(collectionExternalLinksNotations)
      .set(mappedUpdateData)
      .where(eq(collectionExternalLinksNotations.id, notationId))
      .returning();

    if (result.length === 0) {
      throw new Error('Notation not found or access denied');
    }

    if (mappedUpdateData.visibility) {
      await syncNotationAttachmentVisibility(
        notationId,
        mappedUpdateData.visibility
      );
    }

    // Handle tags update if provided
    if (tags !== undefined) {
      try {
        const tagIds = tags.map((tag) => tag.id);
        await updateNotationTagsService(notationId, tagIds);
      } catch (tagError) {
        console.error(
          `Error updating tags for notation ${notationId}:`,
          tagError
        );
        // Don't fail the entire operation if tag update fails
      }
    }

    // Embeddings will be processed asynchronously by the background job

    // Trigger Slack notification for notation update (only if not private)
    if (result[0].visibility !== 'private') {
      // Fetch tags to include in notification
      const notationTags = await getTagsForNotation(notationId);
      const notationWithTags = {
        ...result[0],
        tags: notationTags,
      };
      triggerNotationUpdateNotification(
        notationWithTags,
        collectionExternalLinkId,
        userId
      );
    }

    return result[0];
  } catch (error) {
    console.error('Error in updateNotationInExternalLinkService:', error);
    throw error;
  }
}

export async function deleteNotationFromExternalLinkService(notationId) {
  try {
    const result = await db
      .delete(collectionExternalLinksNotations)
      .where(eq(collectionExternalLinksNotations.id, notationId))
      .returning();
    return result[0];
  } catch (error) {
    console.error('Error deleting notation:', error);
    throw new Error('Failed to delete notation from external link');
  }
}

// ========================
// Thread Service Functions
// ========================

export async function addThreadToNotationService(notationId, threadData) {
  try {
    const result = await db
      .insert(collectionExternalLinksThreads)
      .values({
        collectionExternalLinkNotationId: notationId,
        userId: threadData.userId,
        visibility: threadData.visibility || 'private',
        comment: threadData.comment,
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Error adding thread:', error);
    throw new Error('Failed to add thread to notation');
  }
}

export async function getThreadsForNotationService(notationId) {
  try {
    const threads = await db
      .select()
      .from(collectionExternalLinksThreads)
      .where(
        eq(
          collectionExternalLinksThreads.collectionExternalLinkNotationId,
          notationId
        )
      );
    return threads;
  } catch (error) {
    console.error('Error fetching threads:', error);
    throw new Error('Failed to fetch threads for notation');
  }
}

export async function updateThreadInNotationService(threadId, updateData) {
  try {
    const result = await db
      .update(collectionExternalLinksThreads)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(collectionExternalLinksThreads.id, threadId))
      .returning();
    return result[0];
  } catch (error) {
    console.error('Error updating thread:', error);
    throw new Error('Failed to update thread');
  }
}

export async function deleteThreadFromNotationService(threadId) {
  try {
    const result = await db
      .delete(collectionExternalLinksThreads)
      .where(eq(collectionExternalLinksThreads.id, threadId))
      .returning();
    return result[0];
  } catch (error) {
    console.error('Error deleting thread:', error);
    throw new Error('Failed to delete thread from notation');
  }
}

// ========================
// Exporting the service functions
// ========================

export const collectionService = {
  getAllCollectionsService,
  updateCollectionService,
  getCollectionByIdService,
  getResourceByIdService,
  deleteResourceFromCollectionService,
  deleteCollectionService,
  updateResourceOrderService,
  createCollectionService,
  getExternalLinksForAllCollectionsService,
  getExternalLinksForCollectionByIdService,
  getResourcesForCollectionByIdService,
  getResourcesForAllCollectionsService,
  addExternalLinkToCollectionService,
  deleteExternalLinkFromCollectionService,
  updateExternalLinkInCollectionService,
  getExternalLinksForCollectionService,
  getExternalLinkByIdService,
  addNotationToExternalLinkService,
  getNotationsForExternalLinkService,
  updateNotationInExternalLinkService,
  deleteNotationFromExternalLinkService,
  addThreadToNotationService,
  getThreadsForNotationService,
  updateThreadInNotationService,
  deleteThreadFromNotationService,
  getNotationsNewsFeedService,
  createFolderService,
  getAllFoldersService,
  addCollectionToFolderService,
  removeCollectionFromFolderService,
  getCollectionCollaboratorsService,
  getExternalLinkCollaboratorsService,
  inviteExternalLinkCollaboratorService,
  getCollaboratedCollectionsService,
};

export async function getNotationsNewsFeedService(
  page = 1,
  limit = 10,
  userId
) {
  const offset = (page - 1) * limit;
  try {
    const result = await db.execute(sql`
      SELECT n.*,
      cel.external_link_id,
      COALESCE(cel.start_date, cel.date) AS date,
      COALESCE(cel.start_date, cel.date) AS "startDate",
      COALESCE(cel.end_date, cel.start_date, cel.date) AS "endDate"
      FROM collection_external_links_notations n
      INNER JOIN collection_external_links cel 
        ON n.collection_external_link_id = cel.id
      WHERE n.visibility = 'public' OR cel.user_id = ${userId}
      ORDER BY n.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return result.rows;
  } catch (error) {
    console.error('Error fetching newsfeed updates:', error);
    throw new Error('Failed to fetch newsfeed updates');
  }
}

export const getNotationsForExternalLinksService = async (externalLinkIds) => {
  try {
    // Initialize result with each externalLinkId key and an empty notations array
    const result = {};
    externalLinkIds.forEach((id) => {
      result[id] = { notations: [] };
    });

    // First, fetch association rows from collectionExternalLinks for the provided externalLinkIds.
    const links = await db
      .select()
      .from(collectionExternalLinks)
      .where(inArray(collectionExternalLinks.externalLinkId, externalLinkIds));

    // If there are no matching links, simply return the result with empty arrays.
    if (!links || links.length === 0) {
      return result;
    }

    // Build a mapping: collectionExternalLinks.id => externalLinkId and also collect internal ids.
    const collectionLinkIdToExternalLinkId = {};
    const collectionLinkIds = links.map((link) => {
      collectionLinkIdToExternalLinkId[link.id] = link.externalLinkId;
      return link.id;
    });

    // Fetch the notations using the collectionExternalLink ids we obtained.
    const notations = await db
      .select()
      .from(collectionExternalLinksNotations)
      .where(
        inArray(
          collectionExternalLinksNotations.collectionExternalLinkId,
          collectionLinkIds
        )
      );

    // Get tags for all notations if there are any
    let notationsWithTags = notations;
    if (notations.length > 0) {
      const notationIds = notations.map((notation) => notation.id);

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
      notationsWithTags = notations.map((notation) => {
        const notationTags = notationTagsData
          .filter((tagData) => tagData.notationId === notation.id)
          .map(({ tag }) => tag);

        return {
          ...notation,
          tags: notationTags,
        };
      });
    }

    // Group the notations by the corresponding externalLinkId.
    notationsWithTags.forEach((nota) => {
      const externalLinkId =
        collectionLinkIdToExternalLinkId[nota.collectionExternalLinkId];
      if (externalLinkId && result[externalLinkId]) {
        result[externalLinkId].notations.push(nota);
      }
    });

    return result;
  } catch (error) {
    console.error('Error in getNotationsForExternalLinksService:', error);
    throw error;
  }
};

export const getNotationByIdService = async (notationId) => {
  try {
    const notation = await db
      .select()
      .from(collectionExternalLinksNotations)
      .where(eq(collectionExternalLinksNotations.id, notationId))
      .leftJoin(
        collectionExternalLinks,
        eq(
          collectionExternalLinksNotations.collectionExternalLinkId,
          collectionExternalLinks.id
        )
      )
      .limit(1);

    if (!notation || notation.length === 0) {
      return null;
    }

    // Get tags for this notation
    const notationTagsData = await db
      .select({
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
        eq(
          collectionExternalLinkNotationTags.collectionExternalLinkNotationId,
          notationId
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

    const tags = notationTagsData.map(({ tag }) => tag);

    return {
      ...notation[0].collection_external_links_notations,
      tags: tags,
      // userId: notation[0].collection_external_links.userId, // This will give us the user who created the notation
    };
  } catch (error) {
    console.error('Error in getNotationByIdService:', error);
    throw error;
  }
};

export async function getCollectionsWithItemsByIdsService(
  collectionIds,
  userId
) {
  try {
    // First get basic collection info to check type for each collection
    const collectionData = await db
      .select({
        ...collections,
        isPinned: sql`EXISTS (
          SELECT 1 FROM pinned_items 
          WHERE user_id = ${userId} 
          AND item_id = ${collections.id}
          AND item_type = 'collection'
        )`.mapWith(Boolean),
      })
      .from(collections)
      .where(
        and(
          inArray(collections.id, collectionIds),
          or(
            eq(collections.visibility, 'public'),
            eq(collections.visibility, 'unlisted'),
            eq(collections.userId, userId)
          )
        )
      );

    // Process each collection based on its type
    const collectionsWithItems = await Promise.all(
      collectionData.map(async (collection) => {
        if (collection.type === 'external') {
          const externalLinks = await getExternalLinksForCollectionByIdService(
            collection.id,
            userId
          );
          return {
            ...collection,
            items: externalLinks.external_links?.map((link) => ({
              ...link,
              timestamps: isYoutubeUrl(link.url)
                ? parseTimestamps(link.description)
                : null,
            })),
          };
        } else {
          const resources = await getResourcesForCollectionByIdService(
            collection.id
          );
          return {
            ...collection,
            items: resources.resources || [],
          };
        }
      })
    );

    // Sort collections by updated_at date in descending order
    return collectionsWithItems.sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  } catch (error) {
    console.error('Error fetching collections with items:', error);
    throw new Error('Failed to fetch collections with items');
  }
}

export async function getExternalLinksByIdsService(
  externalLinkIds,
  userId = null,
  tenants = []
) {
  try {
    // First get the external links with collaborator visibility check
    const resultedExternalLinks = await db
      .select({
        id: externalLinks.id,
        url: externalLinks.url,
        name: externalLinks.name,
        description: externalLinks.description,
        notes: externalLinks.notes,
        dateAdded: externalLinks.dateAdded,
        visibility: externalLinks.visibility,
        type: externalLinks.type,
        imageUrl: externalLinks.imageUrl,
        imageMetadata: externalLinks.imageMetadata,
        whiteboardData: externalLinks.whiteboardData,
        addedByUserId: externalLinks.addedByUserId,
        createdAt: externalLinks.createdAt,
        updatedAt: externalLinks.updatedAt,
      })
      .from(externalLinks)
      .leftJoin(
        collectionExternalLinks,
        eq(externalLinks.id, collectionExternalLinks.externalLinkId)
      )
      .leftJoin(
        collectionExternalLinkCollaborators,
        eq(
          collectionExternalLinks.id,
          collectionExternalLinkCollaborators.collectionExternalLinkId
        )
      )
      .where(
        and(
          inArray(externalLinks.id, externalLinkIds),
          or(
            eq(externalLinks.visibility, 'public'),
            eq(externalLinks.addedByUserId, userId),
            and(
              inArray(externalLinks.visibility, ['unlisted', 'public']),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          ),
          inArray(externalLinks.tenantId, tenants)
        )
      );

    // Get collection external link IDs for these external links
    const collectionLinks = await db
      .select({
        id: collectionExternalLinks.id,
        externalLinkId: collectionExternalLinks.externalLinkId,
        userId: collectionExternalLinks.userId,
        date: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        startDate: sql`COALESCE(${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
        endDate: sql`COALESCE(${collectionExternalLinks.endDate}, ${collectionExternalLinks.startDate}, ${collectionExternalLinks.date})`,
      })
      .from(collectionExternalLinks)
      .where(inArray(collectionExternalLinks.externalLinkId, externalLinkIds));

    // Get collaborator info for filtering
    const collaboratorInfo = userId
      ? await db
          .select({
            collectionExternalLinkId:
              collectionExternalLinkCollaborators.collectionExternalLinkId,
            userId: collectionExternalLinkCollaborators.userId,
          })
          .from(collectionExternalLinkCollaborators)
          .where(
            and(
              inArray(
                collectionExternalLinkCollaborators.collectionExternalLinkId,
                collectionLinks.map((link) => link.id)
              ),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          )
      : [];

    // Create collaborator lookup map
    const collaboratorMap = {};
    collaboratorInfo.forEach((collab) => {
      collaboratorMap[collab.collectionExternalLinkId] = true;
    });

    // Get notations for all collection external links with proper filtering
    const notations = await db
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
        date: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        startDate: sql`COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        endDate: sql`COALESCE(${collectionExternalLinksNotations.endDate}, ${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date})`,
        visibility: collectionExternalLinksNotations.visibility,
        startTime: collectionExternalLinksNotations.startTime,
        endTime: collectionExternalLinksNotations.endTime,
        timezone: collectionExternalLinksNotations.timezone,
        userId: collectionExternalLinksNotations.userId,
        collectionExternalLinkId:
          collectionExternalLinksNotations.collectionExternalLinkId,
      })
      .from(collectionExternalLinksNotations)
      .where(
        inArray(
          collectionExternalLinksNotations.collectionExternalLinkId,
          collectionLinks.map((link) => link.id)
        )
      )
      .orderBy(collectionExternalLinksNotations.listOrder);

    // Get attachments for all external links with proper filtering
    const attachmentsData = await db
      .select({
        externalLinkId: externalLinkAttachments.externalLinkId,
        attachment: {
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
        },
        highlighted: externalLinkAttachments.highlighted,
      })
      .from(externalLinkAttachments)
      .innerJoin(
        attachments,
        eq(externalLinkAttachments.attachmentId, attachments.id)
      )
      .where(inArray(externalLinkAttachments.externalLinkId, externalLinkIds));

    // Get tags for all collection external links
    const tagsData = await db
      .select({
        collectionExternalLinkId:
          collectionExternalLinkTags.collectionExternalLinkId,
        tag: {
          id: collectionExternalLinkTagDefinitions.id,
          name: collectionExternalLinkTagDefinitions.name,
          description: collectionExternalLinkTagDefinitions.description,
          color: collectionExternalLinkTagDefinitions.color,
        },
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
        inArray(
          collectionExternalLinkTags.collectionExternalLinkId,
          collectionLinks.map((link) => link.id)
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

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
          notations.map((notation) => notation.id)
        )
      )
      .orderBy(collectionExternalLinkTagDefinitions.name);

    // Combine all the data with proper filtering
    const result = resultedExternalLinks.map((link) => {
      // Find all collection links for this external link
      const linkCollectionLinks = collectionLinks.filter(
        (cl) => cl.externalLinkId === link.id
      );
      const linkCollectionIds = linkCollectionLinks.map((cl) => cl.id);

      // Check if user is owner or collaborator
      const isOwner = link.addedByUserId === userId;
      const isCollaborator = linkCollectionLinks.some(
        (cl) => collaboratorMap[cl.id]
      );

      // Filter notations based on ownership/collaboration
      const linkNotations = notations
        .filter((notation) => {
          if (!linkCollectionIds.includes(notation.collectionExternalLinkId)) {
            return false;
          }

          // Apply visibility filtering
          return (
            notation.visibility === 'public' ||
            isOwner ||
            (isCollaborator &&
              !isOwner &&
              (notation.visibility === 'public' ||
                notation.visibility === 'unlisted' ||
                notation.userId === userId))
          );
        })
        .map((notation) => {
          // Add tags to each notation
          const notationTags = notationTagsData
            .filter((tagData) => tagData.notationId === notation.id)
            .map(({ tag }) => tag);

          return {
            ...notation,
            tags: notationTags,
          };
        });

      // Filter attachments based on ownership/collaboration
      const linkAttachments = attachmentsData
        .filter((att) => {
          if (att.externalLinkId !== link.id) {
            return false;
          }

          // Apply visibility filtering
          return (
            att.attachment.visibility === 'public' ||
            att.attachment.visibility === 'unlisted' ||
            isOwner ||
            (isCollaborator &&
              !isOwner &&
              (att.attachment.visibility === 'public' ||
                att.attachment.visibility === 'unlisted' ||
                att.attachment.userId === userId))
          );
        })
        .map(({ attachment, highlighted }) => ({
          ...attachment,
          highlighted,
        }));

      // Get tags for this external link
      const linkTags = tagsData
        .filter((tagData) =>
          linkCollectionIds.includes(tagData.collectionExternalLinkId)
        )
        .map(({ tag }) => tag);

      return {
        ...link,
        date: linkCollectionLinks[0]?.date || null,
        startDate: linkCollectionLinks[0]?.startDate || null,
        endDate: linkCollectionLinks[0]?.endDate || linkCollectionLinks[0]?.startDate || null,
        notations: linkNotations,
        attachments: linkAttachments,
        tags: linkTags,
      };
    });

    return result;
  } catch (error) {
    console.error('Error fetching external links by IDs:', error);
    throw new Error('Failed to fetch external links');
  }
}

export async function createFolderService(folderData, userId, tenantIds) {
  try {
    // Prepare insert data for the folder
    const insertData = {
      name: folderData.name,
      description: folderData.description || null,
      visibility: folderData.visibility || 'private',
      userId: folderData.userId,
      organizationId: null, // Set to null since this is a user folder
      createdAt: new Date(),
      updatedAt: new Date(),
      tenantId: folderData.tenantId,
    };

    // Insert the folder and return the result
    const [folder] = await db.insert(folders).values(insertData).returning();

    // If collections were provided, add them to the folder
    if (folderData.collections && folderData.collections.length > 0) {
      const folderCollectionsData = folderData.collections.map(
        (collectionId, index) => ({
          folderId: folder.id,
          collectionId: collectionId,
          orderPosition: index,
          createdAt: new Date(),
          updatedAt: new Date(),
          tenantId: folderData.tenantId,
        })
      );

      await db.insert(folderCollections).values(folderCollectionsData);
    }

    return folder;
  } catch (error) {
    console.error('Error in createFolderService:', error);
    throw error;
  }
}

export async function getAllFoldersService(userId, tenantIds) {
  try {
    const foldersQuery = await db
      .select({
        id: folders.id,
        name: folders.name,
        description: folders.description,
        visibility: folders.visibility,
        userId: folders.userId,
        organizationId: folders.organizationId,
        createdAt: folders.createdAt,
        updatedAt: folders.updatedAt,
        tenantId: folders.tenantId,
        collections: sql`
          COALESCE(
            NULLIF(
              jsonb_agg(
                CASE WHEN ${collections.id} IS NOT NULL THEN
                  json_build_object(
                    'id', ${collections.id}::text,
                    'name', ${collections.name}::text,
                    'type', ${collections.type}::text,
                    'visibility', ${collections.visibility}::text,
                    'icon', ${collections.icon}::text,
                    'color', ${collections.color}::text,
                    'orderPosition', ${folderCollections.orderPosition}::int
                  )
                END
                ORDER BY ${folderCollections.orderPosition}
              ),
              jsonb_build_array(NULL)  -- This will match when all values are NULL
            ),
            '[]'::jsonb
          )
        `,
      })
      .from(folders)
      .leftJoin(folderCollections, eq(folders.id, folderCollections.folderId))
      .leftJoin(collections, eq(folderCollections.collectionId, collections.id))
      .where(
        and(
          inArray(folders.tenantId, tenantIds),
          or(eq(folders.visibility, 'public'), eq(folders.userId, userId)),
          or(
            eq(collections.visibility, 'public'),
            eq(collections.userId, userId),
            isNull(collections.id)
          )
        )
      )
      .groupBy(folders.id);

    // Sort folders by updated_at date in descending order
    return foldersQuery.sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
    );
  } catch (error) {
    console.error('Error in getAllFoldersService:', error);
    throw error;
  }
}

export async function deleteFolderService(folderId, userId, tenantIds) {
  try {
    return await db.transaction(async (tx) => {
      //make sure the folder belongs to the user
      const folder = await tx
        .select()
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));

      if (!folder[0]) {
        throw new Error('Folder not found');
      }
      // Delete folder collections first
      await tx
        .delete(folderCollections)
        .where(and(eq(folderCollections.folderId, folderId)));

      // Then delete the folder
      await tx
        .delete(folders)
        .where(
          and(eq(folders.id, folderId), inArray(folders.tenantId, tenantIds))
        );

      return { message: 'Folder successfully deleted' };
    });
  } catch (error) {
    console.error('Error in deleteFolderService:', error);
    throw error;
  }
}

export async function addCollectionToFolderService(
  folderId,
  collectionId,
  userId
) {
  try {
    // make sure the folder belongs to the user and the folder has the same tenantId as the collection
    const folder = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.userId, userId)));

    const collection = await db
      .select()
      .from(collections)
      .where(eq(collections.id, collectionId));

    if (!folder[0]) {
      throw new Error('Folder not found');
    }

    if (folder[0].tenantId !== collection[0].tenantId) {
      throw new Error('Folder and collection have different tenantIds');
    }

    // Get the current highest order position for the folder
    const maxOrderResult = await db
      .select({
        maxOrder: sql`COALESCE(MAX(order_position), -1)`.mapWith(Number),
      })
      .from(folderCollections)
      .where(eq(folderCollections.folderId, folderId));

    const newOrderPosition = maxOrderResult[0].maxOrder + 1;

    // Add the collection to the folder
    const result = await db
      .insert(folderCollections)
      .values({
        folderId,
        collectionId,
        orderPosition: newOrderPosition,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Error in addCollectionToFolderService:', error);
    throw error;
  }
}

export async function removeCollectionFromFolderService(
  folderId,
  collectionId,
  userId
) {
  try {
    // First check if the user owns the folder
    const folder = await db
      .select()
      .from(folders)
      .where(eq(folders.id, folderId))
      .limit(1);

    if (!folder[0] || folder[0].userId !== userId) {
      throw new Error(
        'Unauthorized: You do not have permission to modify this folder'
      );
    }

    // Delete the folder collection entry
    const result = await db
      .delete(folderCollections)
      .where(
        and(
          eq(folderCollections.folderId, folderId),
          eq(folderCollections.collectionId, collectionId)
        )
      )
      .returning();

    if (!result.length) {
      throw new Error('Collection not found in folder');
    }

    return { message: 'Collection removed from folder' };
  } catch (error) {
    console.error('Error in removeCollectionFromFolderService:', error);
    throw error;
  }
}

export async function getCollectionByIdsServiceWithResources(
  collectionIds,
  userId,
  tenants
) {
  try {
    // Get collections with basic info and check permissions
    const collectionsData = await db
      .select({
        ...collections,
        isPinned: sql`EXISTS (
          SELECT 1 FROM pinned_items 
          WHERE user_id = ${userId} 
          AND item_id = ${collections.id}
          AND item_type = 'collection'
        )`.mapWith(Boolean),
      })
      .from(collections)
      .where(
        and(
          inArray(collections.id, collectionIds),
          or(
            eq(collections.visibility, 'public'),
            eq(collections.visibility, 'unlisted'),
            eq(collections.userId, userId)
          ),
          inArray(collections.tenantId, tenants)
        )
      );

    // Process each collection based on its type
    const collectionsWithItems = await Promise.all(
      collectionsData.map(async (collection) => {
        if (collection.type === 'external') {
          // Get external links with their notations and attachments
          const externalLinksResult = await db
            .select({
              externalLink: {
                id: externalLinks.id,
                url: externalLinks.url,
                name: externalLinks.name,
                description: externalLinks.description,
                notes: externalLinks.notes,
                dateAdded: externalLinks.dateAdded,
                visibility: externalLinks.visibility,
                type: externalLinks.type,
                imageUrl: externalLinks.imageUrl,
                imageMetadata: externalLinks.imageMetadata,
                whiteboardData: externalLinks.whiteboardData,
                timestamps: externalLinks.timestamps,
                fullText: externalLinks.fullText,
                addedByUserId: externalLinks.addedByUserId,
              },
              collectionExternalLink: {
                id: collectionExternalLinks.id,
                notes: collectionExternalLinks.notes,
                status: collectionExternalLinks.status,
              },
              isCollaborator:
                sql`CASE WHEN ${collectionExternalLinkCollaborators.id} IS NOT NULL THEN true ELSE false END`.mapWith(
                  Boolean
                ),
              notations: sql`
                COALESCE(
                  jsonb_agg(
                    DISTINCT jsonb_build_object(
                      'id', ${collectionExternalLinksNotations.id},
                      'title', ${collectionExternalLinksNotations.title},
                      'description', ${collectionExternalLinksNotations.description},
                      'notes', ${collectionExternalLinksNotations.notes},
                      'category', ${collectionExternalLinksNotations.category},
                      'status', ${collectionExternalLinksNotations.status},
                      'highlighted', ${collectionExternalLinksNotations.highlighted},
                      'createdAt', ${collectionExternalLinksNotations.createdAt},
                      'updatedAt', ${collectionExternalLinksNotations.updatedAt},
                      'listOrder', ${collectionExternalLinksNotations.listOrder},
                      'date', COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date}),
                      'startDate', COALESCE(${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date}),
                      'endDate', COALESCE(${collectionExternalLinksNotations.endDate}, ${collectionExternalLinksNotations.startDate}, ${collectionExternalLinksNotations.date}),
                      'startTime', ${collectionExternalLinksNotations.startTime},
                      'endTime', ${collectionExternalLinksNotations.endTime},
                      'timezone', ${collectionExternalLinksNotations.timezone},
                      'userId', ${collectionExternalLinksNotations.userId},
                      'visibility', ${collectionExternalLinksNotations.visibility}
                    )
                  ) FILTER (WHERE ${collectionExternalLinksNotations.id} IS NOT NULL),
                  '[]'::jsonb
                )
              `,
              attachments: sql`
                COALESCE(
                  jsonb_agg(
                    DISTINCT jsonb_build_object(
                      'id', ${attachments.id},
                      'title', ${attachments.title},
                      'description', ${attachments.description},
                      'type', ${attachments.type},
                      'imageKey', ${attachments.imageKey},
                      'createdAt', ${attachments.createdAt},
                      'updatedAt', ${attachments.updatedAt},
                      'listOrder', ${attachments.listOrder},
                      'visibility', ${attachments.visibility},
                      'highlighted', ${externalLinkAttachments.highlighted}
                    )
                  ) FILTER (WHERE ${attachments.id} IS NOT NULL AND (${attachments.visibility} = 'public' OR ${attachments.visibility} = 'unlisted' OR ${attachments.userId} = ${userId})),
                  '[]'::jsonb
                )
              `,
            })
            .from(collectionExternalLinks)
            .innerJoin(
              externalLinks,
              eq(collectionExternalLinks.externalLinkId, externalLinks.id)
            )
            .leftJoin(
              collectionExternalLinkCollaborators,
              and(
                eq(
                  collectionExternalLinkCollaborators.collectionExternalLinkId,
                  collectionExternalLinks.id
                ),
                eq(collectionExternalLinkCollaborators.userId, userId)
              )
            )
            .leftJoin(
              collectionExternalLinksNotations,
              eq(
                collectionExternalLinksNotations.collectionExternalLinkId,
                collectionExternalLinks.id
              )
            )
            .leftJoin(
              externalLinkAttachments,
              eq(externalLinkAttachments.externalLinkId, externalLinks.id)
            )
            .leftJoin(
              attachments,
              eq(externalLinkAttachments.attachmentId, attachments.id)
            )
            .where(
              and(
                eq(collectionExternalLinks.collectionId, collection.id),
                // Permission check: user must have access to the external link
                or(
                  eq(externalLinks.visibility, 'public'),
                  eq(externalLinks.addedByUserId, userId),
                  and(
                    inArray(externalLinks.visibility, ['unlisted', 'public']),
                    eq(collectionExternalLinkCollaborators.userId, userId)
                  )
                )
              )
            )
            .groupBy(
              externalLinks.id,
              collectionExternalLinks.id,
              collectionExternalLinkCollaborators.id
            );

          // Get all notation IDs from the result to fetch their tags
          const allNotationIds = [];
          externalLinksResult.forEach(({ notations }) => {
            if (Array.isArray(notations)) {
              notations.forEach((notation) => {
                if (notation.id) {
                  allNotationIds.push(notation.id);
                }
              });
            }
          });

          // Get tags for all notations if any exist
          let notationTagsData = [];
          if (allNotationIds.length > 0) {
            notationTagsData = await db
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
                  allNotationIds
                )
              )
              .orderBy(collectionExternalLinkTagDefinitions.name);
          }

          // Get all collection external link IDs to fetch their tags
          const allCollectionExternalLinkIds = externalLinksResult.map(
            ({ collectionExternalLink }) => collectionExternalLink.id
          );

          // Get tags for all collection external links
          let externalLinkTagsData = [];
          if (allCollectionExternalLinkIds.length > 0) {
            externalLinkTagsData = await db
              .select({
                collectionExternalLinkId:
                  collectionExternalLinkTags.collectionExternalLinkId,
                tag: {
                  id: collectionExternalLinkTagDefinitions.id,
                  name: collectionExternalLinkTagDefinitions.name,
                  description: collectionExternalLinkTagDefinitions.description,
                  color: collectionExternalLinkTagDefinitions.color,
                },
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
                inArray(
                  collectionExternalLinkTags.collectionExternalLinkId,
                  allCollectionExternalLinkIds
                )
              )
              .orderBy(collectionExternalLinkTagDefinitions.name);
          }

          // Process external links
          const processedExternalLinks = externalLinksResult.map(
            ({
              externalLink,
              collectionExternalLink,
              notations,
              attachments,
              isCollaborator,
            }) => {
              // Determine user's relationship to the external link
              const isOwner = externalLink.addedByUserId === userId;

              // Filter notations based on user permissions
              let filteredNotations = Array.isArray(notations) ? notations : [];

              if (!isOwner && isCollaborator) {
                // Collaborators can only see public/unlisted notations or ones they created
                filteredNotations = filteredNotations.filter(
                  (notation) =>
                    notation.visibility === 'public' ||
                    notation.visibility === 'unlisted' ||
                    notation.userId === userId
                );
              }
              // Owners can see all notations (no filtering needed)

              // Add tags to each notation
              const notationsWithTags = filteredNotations.map((notation) => {
                const notationTags = notationTagsData
                  .filter((tagData) => tagData.notationId === notation.id)
                  .map(({ tag }) => tag);

                return {
                  ...notation,
                  tags: notationTags,
                };
              });

              // Add tags to the external link
              const externalLinkTags = externalLinkTagsData
                .filter(
                  (tagData) =>
                    tagData.collectionExternalLinkId ===
                    collectionExternalLink.id
                )
                .map(({ tag }) => tag);

              return {
                ...externalLink,
                collectionExternalLinkId: collectionExternalLink.id,
                notes: collectionExternalLink.notes,
                notations: notationsWithTags,
                attachments,
                tags: externalLinkTags,
              };
            }
          );

          return {
            ...collection,
            externalLinks: processedExternalLinks,
          };
        } else {
          // Get resources for resource-type collections
          const resourcesResult = await db
            .select({
              resource: {
                id: resources.id,
                name: resources.name,
                description: resources.description,
                resourceDate: resources.resourceDate,
                url: resources.url,
                typeId: resources.typeId,
              },
              notes: collectionResources.notes,
              orderPosition: collectionResources.orderPosition,
            })
            .from(collectionResources)
            .innerJoin(
              resources,
              eq(collectionResources.resourceId, resources.id)
            )
            .where(
              and(
                eq(collectionResources.collectionId, collection.id),
                inArray(resources.tenantId, tenants)
              )
            )
            .orderBy(collectionResources.orderPosition);

          return {
            ...collection,
            resources: resourcesResult.map(
              ({ resource, notes, orderPosition }) => ({
                ...resource,
                notes,
                orderPosition,
              })
            ),
          };
        }
      })
    );

    return collectionsWithItems;
  } catch (error) {
    console.error('Error fetching collections with resources:', error);
    throw new Error('Failed to fetch collections with resources');
  }
}

export const getAttachmentsForExternalLinksService = async (
  externalLinkIds,
  userId = null
) => {
  try {
    // Initialize result with each externalLinkId key and an empty attachments array
    const result = {};
    externalLinkIds.forEach((id) => {
      result[id] = { attachments: [] };
    });

    // First, get external link ownership info
    const externalLinksInfo = await db
      .select({
        id: externalLinks.id,
        addedByUserId: externalLinks.addedByUserId,
      })
      .from(externalLinks)
      .where(inArray(externalLinks.id, externalLinkIds));

    // Get collaborator info for these external links
    const collaboratorInfo = userId
      ? await db
          .select({
            externalLinkId: collectionExternalLinks.externalLinkId,
            userId: collectionExternalLinkCollaborators.userId,
          })
          .from(collectionExternalLinkCollaborators)
          .innerJoin(
            collectionExternalLinks,
            eq(
              collectionExternalLinkCollaborators.collectionExternalLinkId,
              collectionExternalLinks.id
            )
          )
          .where(
            and(
              inArray(collectionExternalLinks.externalLinkId, externalLinkIds),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          )
      : [];

    // Create lookup maps
    const ownershipMap = {};
    const collaboratorMap = {};

    externalLinksInfo.forEach((link) => {
      ownershipMap[link.id] = link.addedByUserId;
    });

    collaboratorInfo.forEach((collab) => {
      collaboratorMap[collab.externalLinkId] = true;
    });

    // Fetch attachments for all external links with proper filtering
    const attachmentsData = await db
      .select({
        externalLinkId: externalLinkAttachments.externalLinkId,
        attachment: {
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
        },
        highlighted: externalLinkAttachments.highlighted,
      })
      .from(externalLinkAttachments)
      .innerJoin(
        attachments,
        eq(externalLinkAttachments.attachmentId, attachments.id)
      )
      .where(inArray(externalLinkAttachments.externalLinkId, externalLinkIds));

    // Filter attachments based on visibility and ownership/collaboration
    attachmentsData.forEach(({ externalLinkId, attachment, highlighted }) => {
      const isOwner = ownershipMap[externalLinkId] === userId;
      const isCollaborator = collaboratorMap[externalLinkId] === true;

      // Apply filtering logic
      const canSeeAttachment =
        attachment.visibility === 'public' ||
        attachment.visibility === 'unlisted' ||
        isOwner ||
        (isCollaborator &&
          !isOwner &&
          (attachment.visibility === 'public' ||
            attachment.visibility === 'unlisted' ||
            attachment.userId === userId));

      if (canSeeAttachment && result[externalLinkId]) {
        result[externalLinkId].attachments.push({
          ...attachment,
          highlighted,
        });
      }
    });

    return result;
  } catch (error) {
    console.error('Error in getAttachmentsForExternalLinksService:', error);
    throw error;
  }
};

export const getBasicCollectionsByIdsService = async (
  collectionIds,
  userId,
  tenants
) => {
  try {
    const results = await db
      .select({
        id: collections.id,
        name: collections.name,
        type: collections.type,
        visibility: collections.visibility,
        userId: collections.userId,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
      })
      .from(collections)
      .where(
        and(
          inArray(collections.id, collectionIds),
          or(
            eq(collections.visibility, 'public'),
            eq(collections.visibility, 'unlisted'),
            eq(collections.userId, userId)
          ),
          inArray(collections.tenantId, tenants)
        )
      );

    return results;
  } catch (error) {
    console.error('Error in getCollectionsByIdsService:', error);
    throw new Error('Failed to fetch collections');
  }
};

export const getBasicExternalLinksByIdsService = async (
  externalLinkIds,
  userId,
  tenants
) => {
  try {
    // Explicitly define all fields to select
    const results = await db
      .select({
        id: externalLinks.id,
        name: externalLinks.name,
        url: externalLinks.url,
        type: externalLinks.type,
        visibility: externalLinks.visibility,
        collectionId: collectionExternalLinks.collectionId,
        timestamps: externalLinks.timestamps,
        addedByUserId: externalLinks.addedByUserId,
        createdAt: externalLinks.createdAt,
        updatedAt: externalLinks.updatedAt,
      })
      .from(externalLinks)
      .innerJoin(
        collectionExternalLinks,
        eq(externalLinks.id, collectionExternalLinks.externalLinkId)
      )
      .leftJoin(
        collectionExternalLinkCollaborators,
        eq(
          collectionExternalLinks.id,
          collectionExternalLinkCollaborators.collectionExternalLinkId
        )
      )
      .where(
        and(
          inArray(externalLinks.id, externalLinkIds),
          or(
            eq(externalLinks.visibility, 'public'),
            eq(externalLinks.addedByUserId, userId),
            and(
              inArray(externalLinks.visibility, ['unlisted', 'public']),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          ),
          inArray(externalLinks.tenantId, tenants)
        )
      );

    return results;
  } catch (error) {
    console.error('Error in getBasicExternalLinksByIdsService:', error);
    throw error; // Let's throw the original error for better debugging
  }
};

export async function getPinnedCollectionsService(userId, tenants) {
  try {
    // First get all pinned collection IDs and their order
    const pinnedItems = await db
      .select({
        itemId: pinnedItems.itemId,
        orderPosition: pinnedItems.orderPosition,
      })
      .from(pinnedItems)
      .where(
        and(
          eq(pinnedItems.userId, userId),
          eq(pinnedItems.itemType, 'collection')
        )
      )
      .orderBy(pinnedItems.orderPosition);

    if (!pinnedItems.length) {
      return [];
    }

    // Get full collection details for all pinned collections with counts
    const pinnedCollections = await db
      .select({
        ...collections,
        orderPosition: sql`pi.order_position`,
        isPinned: sql`true`.mapWith(Boolean), // Always true since these are pinned collections
        resource_count: sql`(
          SELECT COUNT(DISTINCT cr.resource_id)
          FROM collection_resources cr
          WHERE cr.collection_id = ${collections.id}
        )`.mapWith(Number),
        externalLinksCount: sql`(
          SELECT COUNT(DISTINCT cel.external_link_id)
          FROM collection_external_links cel
          WHERE cel.collection_id = ${collections.id}
        )`.mapWith(Number),
      })
      .from(collections)
      .innerJoin(
        pinnedItems,
        and(
          eq(collections.id, pinnedItems.itemId),
          eq(pinnedItems.userId, userId),
          eq(pinnedItems.itemType, 'collection')
        ).as('pi')
      )
      .where(
        and(
          inArray(
            collections.id,
            pinnedItems.map((item) => item.itemId)
          ),
          inArray(collections.tenantId, tenants),
          or(
            eq(collections.visibility, 'public'),
            eq(collections.userId, userId)
          )
        )
      )
      .orderBy(sql`pi.order_position`);

    // Parse hashtags for consistency
    return pinnedCollections.map((collection) => ({
      ...collection,
      hashtags: collection.hashtags ? collection.hashtags.split(',') : [],
    }));
  } catch (error) {
    console.error('Error in getPinnedCollectionsService:', error);
    throw new Error('Failed to fetch pinned collections');
  }
}

// ========================
// Collaborator Service Functions
// ========================

export async function getCollectionCollaboratorsService(collectionId) {
  try {
    // Use a simple query that only selects columns we know exist
    const collaborators = await db
      .select({
        id: collectionCollaborators.id,
        userId: collectionCollaborators.userId,
        collectionId: collectionCollaborators.collectionId,
        role: collectionCollaborators.role,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(collectionCollaborators)
      .leftJoin(users, eq(collectionCollaborators.userId, users.id))
      .where(eq(collectionCollaborators.collectionId, collectionId));

    // Map to include name field for consistency
    return collaborators.map((collaborator) => ({
      ...collaborator,
      name: collaborator.firstName
        ? `${collaborator.firstName} ${collaborator.lastName || ''}`.trim()
        : null,
    }));
  } catch (error) {
    console.error('Error fetching collection collaborators:', error);
    throw new Error('Failed to fetch collection collaborators');
  }
}

export async function getExternalLinkCollaboratorsService(externalLinkId) {
  try {
    // First get the collection_external_link id
    const collectionLink = await db
      .select()
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
      .limit(1);

    if (!collectionLink[0]) {
      throw new Error('External link not found in any collection');
    }

    const collaborators = await db
      .select({
        id: collectionExternalLinkCollaborators.id,
        userId: collectionExternalLinkCollaborators.userId,
        role: collectionExternalLinkCollaborators.role,
        createdAt: collectionExternalLinkCollaborators.createdAt,
        updatedAt: collectionExternalLinkCollaborators.updatedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(collectionExternalLinkCollaborators)
      .leftJoin(users, eq(collectionExternalLinkCollaborators.userId, users.id))
      .where(
        eq(
          collectionExternalLinkCollaborators.collectionExternalLinkId,
          collectionLink[0].id
        )
      );

    return collaborators;
  } catch (error) {
    console.error('Error fetching external link collaborators:', error);
    throw new Error('Failed to fetch external link collaborators');
  }
}

export async function inviteExternalLinkCollaboratorService(
  externalLinkId,
  collaboratorData,
  invitedByUserId
) {
  try {
    return await db.transaction(async (tx) => {
      // First get the external link details
      const externalLink = await tx
        .select({
          id: externalLinks.id,
          name: externalLinks.name,
          url: externalLinks.url,
          description: externalLinks.description,
          visibility: externalLinks.visibility,
        })
        .from(externalLinks)
        .where(eq(externalLinks.id, externalLinkId))
        .limit(1);

      if (!externalLink[0]) {
        throw new Error('External link not found');
      }

      // Check if the external link is private
      if (externalLink[0].visibility === 'private') {
        throw new Error('Cannot add collaborators to private external links');
      }

      // Get the collection_external_link id
      const collectionLink = await tx
        .select({
          id: collectionExternalLinks.id,
          collectionId: collectionExternalLinks.collectionId,
        })
        .from(collectionExternalLinks)
        .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
        .limit(1);

      if (!collectionLink[0]) {
        throw new Error('External link not found in any collection');
      }

      // Get the collection details
      const collection = await tx
        .select({
          id: collections.id,
          name: collections.name,
          description: collections.description,
          visibility: collections.visibility,
        })
        .from(collections)
        .where(eq(collections.id, collectionLink[0].collectionId))
        .limit(1);

      // Get the inviter's details
      const inviter = await tx
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, invitedByUserId))
        .limit(1);

      if (!inviter[0]) {
        throw new Error('Inviter not found');
      }

      // Check if the user already exists by email
      let user = await tx
        .select()
        .from(users)
        .where(eq(users.email, collaboratorData.email))
        .limit(1);

      // If the user doesn't exist, throw an error
      if (!user[0]) {
        throw new Error('User with this email does not exist in the system');
      }

      let userId = user[0].id;

      // Check if this user is already a collaborator
      const existingCollaborator = await tx
        .select()
        .from(collectionExternalLinkCollaborators)
        .where(
          and(
            eq(
              collectionExternalLinkCollaborators.collectionExternalLinkId,
              collectionLink[0].id
            ),
            eq(collectionExternalLinkCollaborators.userId, userId)
          )
        )
        .limit(1);

      if (existingCollaborator[0]) {
        throw new Error(
          'User is already a collaborator for this external link'
        );
      }

      // Create the collaborator entry
      const newCollaborator = await tx
        .insert(collectionExternalLinkCollaborators)
        .values({
          collectionExternalLinkId: collectionLink[0].id,
          userId: userId,
          role: collaboratorData.role,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return {
        collaborator: newCollaborator[0],
        externalLink: externalLink[0],
        collection: collection[0],
        inviter: inviter[0],
        inviteeEmail: collaboratorData.email,
        inviteeName: collaboratorData.name || user[0].firstName || '',
        message: collaboratorData.message,
        pendingInvite: false,
      };
    });
  } catch (error) {
    console.error('Error inviting collaborator to external link:', error);
    throw error;
  }
}

export async function getCollaboratedCollectionsService(userId, tenants) {
  try {
    const collectionsData = await db.execute(sql`
      WITH collaborated_collections AS (
        SELECT DISTINCT
          c.id,
          c.name,
          c.type,
          c.visibility,
          c.color,
          c.icon,
          c.description,
          c.created_at,
          c.updated_at,
          c.event_id,
          c.status,
          c.tenant_id,
          c.hashtags,
          c.user_id,
          EXISTS (
            SELECT 1 FROM pinned_items 
            WHERE user_id = ${userId} 
            AND item_id = c.id
            AND item_type = 'collection'
          ) as is_pinned
        FROM collections c
        INNER JOIN collection_external_links cel ON c.id = cel.collection_id
        INNER JOIN collection_external_links_collaborators celc ON cel.id = celc.collection_external_link_id
        WHERE c.type = 'external'
          AND celc.user_id = ${userId}
          AND c.tenant_id IN ${tenants}
      ),
      collections_with_links AS (
        SELECT
          cc.id,
          cc.name,
          cc.type,
          cc.visibility,
          cc.color,
          cc.icon,
          cc.description,
          cc.created_at,
          cc.updated_at,
          cc.event_id,
          cc.status,
          cc.tenant_id,
          cc.hashtags,
          cc.user_id,
          cc.is_pinned,
          jsonb_agg(
            CASE WHEN el.id IS NOT NULL AND (
              el.visibility = 'public' 
              OR el.added_by_user_id = ${userId}
              OR (
                el.visibility IN ('unlisted', 'public') 
                AND EXISTS (
                  SELECT 1 FROM collection_external_links_collaborators celc2 
                  WHERE celc2.collection_external_link_id = cel.id 
                  AND celc2.user_id = ${userId}
                )
              )
            ) THEN
              jsonb_build_object(
                'id', el.id,
                'url', el.url,
                'name', el.name,
                'tenant_id', el.tenant_id,
                'description', el.description,
                'notes', el.notes,
                'date', COALESCE(cel.start_date, cel.date),
                'startDate', COALESCE(cel.start_date, cel.date),
                'endDate', COALESCE(cel.end_date, cel.start_date, cel.date),
                'date_added', el.date_added,
                'status', cel.status,
                'userId', cel.user_id,
                'visibility', el.visibility,
                'event_id', cel.event_id,
                'type', el.type,
                'image_url', el.image_url,
                'image_metadata', el.image_metadata,
                'whiteboardData', el.whiteboard_data,
                'attachments', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', a.id,
                        'title', a.title,
                        'description', a.description,
                        'type', a.type,
                        'imageKey', a.image_key,
                        'createdAt', a.created_at,
                        'updatedAt', a.updated_at,
                        'listOrder', a.list_order,
                        'visibility', a.visibility,
                        'highlighted', ela.highlighted
                      )
                    ),
                    '[]'::jsonb
                  )
                  FROM external_link_attachments ela
                  JOIN attachments a ON ela.attachment_id = a.id
                  WHERE ela.external_link_id = el.id
                  AND (
                    a.visibility = 'public' 
                    OR a.visibility = 'unlisted'
                    OR (
                      el.added_by_user_id = ${userId}
                    )
                    OR (
                      el.added_by_user_id != ${userId}
                      AND EXISTS (
                        SELECT 1 FROM collection_external_links_collaborators celc3 
                        WHERE celc3.collection_external_link_id = cel.id 
                        AND celc3.user_id = ${userId}
                      )
                      AND (a.visibility IN ('public', 'unlisted') OR a.user_id = ${userId})
                    )
                  )
                ),
                'collaborators', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', celc.id,
                        'userId', celc.user_id,
                        'role', celc.role,
                        'createdAt', celc.created_at,
                        'updatedAt', celc.updated_at,
                        'firstName', u.first_name,
                        'lastName', u.last_name,
                        'email', u.email
                      )
                    ),
                    '[]'::jsonb
                  )
                  FROM collection_external_links_collaborators celc
                  LEFT JOIN users u ON celc.user_id = u.id
                  WHERE celc.collection_external_link_id = cel.id
                ),
                'notations', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', celn.id,
                        'title', celn.title,
                        'description', celn.description,
                        'notes', celn.notes,
                        'category', celn.category,
                        'status', celn.status,
                        'highlighted', celn.highlighted,
                        'createdAt', celn.created_at,
                        'updatedAt', celn.updated_at,
                        'listOrder', celn.list_order,
                        'date', COALESCE(celn.start_date, celn.date),
                        'startDate', COALESCE(celn.start_date, celn.date),
                        'endDate', COALESCE(celn.end_date, celn.start_date, celn.date),
                        'visibility', celn.visibility,
                        'startTime', celn.start_time,
                        'endTime', celn.end_time,
                        'timezone', celn.timezone,
                        'templateId', celn.template_id,
                        'customFields', celn.custom_fields,
                        'isTemplate', celn.is_template
                      ) ORDER BY celn.list_order
                    ),
                    '[]'::jsonb
                  )
                  FROM collection_external_links_notations celn
                  WHERE celn.collection_external_link_id = cel.id
                  AND (
                    celn.visibility = 'public'
                    OR (
                      el.added_by_user_id = ${userId}
                    )
                    OR (
                      el.added_by_user_id != ${userId}
                      AND EXISTS (
                        SELECT 1 FROM collection_external_links_collaborators celc3 
                        WHERE celc3.collection_external_link_id = cel.id 
                        AND celc3.user_id = ${userId}
                      )
                      AND (celn.visibility IN ('public', 'unlisted') OR celn.user_id = ${userId})
                    )
                  )
                ),
                'tags', (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'id', celtd.id,
                        'name', celtd.name,
                        'description', celtd.description,
                        'color', celtd.color
                      ) ORDER BY celtd.name
                    ),
                    '[]'::jsonb
                  )
                  FROM collection_external_link_tags celt
                  JOIN collection_external_link_tag_definitions celtd ON celt.tag_id = celtd.id
                  WHERE celt.collection_external_link_id = cel.id
                )
              )
            END
          ) FILTER (WHERE el.id IS NOT NULL AND (
            el.visibility = 'public' 
            OR el.added_by_user_id = ${userId}
            OR (
              el.visibility IN ('unlisted', 'public') 
              AND EXISTS (
                SELECT 1 FROM collection_external_links_collaborators celc 
                WHERE celc.collection_external_link_id = cel.id 
                AND celc.user_id = ${userId}
              )
            )
          )) AS external_links
        FROM collaborated_collections cc
        LEFT JOIN collection_external_links cel ON cc.id = cel.collection_id
        LEFT JOIN external_links el ON cel.external_link_id = el.id
        LEFT JOIN collection_external_links_collaborators celc ON cel.id = celc.collection_external_link_id
        WHERE celc.user_id = ${userId} OR cel.user_id = ${userId}
        GROUP BY 
          cc.id, cc.name, cc.type, cc.visibility, 
          cc.color, cc.description, cc.created_at, 
          cc.icon, cc.updated_at, cc.event_id,
          cc.status, cc.hashtags, cc.user_id, cc.tenant_id, cc.is_pinned
      )
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', id,
          'name', name,
          'type', type,
          'visibility', visibility,
          'color', color,
          'description', description,
          'created_at', created_at,
          'updated_at', updated_at,
          'event_id', event_id,
          'icon', icon,
          'is_pinned', is_pinned,
          'status', status,
          'tenant_id', tenant_id,
          'user_id', user_id,
          'hashtags', CASE WHEN hashtags IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(hashtags) END,
          'external_links', COALESCE(external_links, '[]'::jsonb),
          'externalLinksCount', jsonb_array_length(COALESCE(external_links, '[]'::jsonb))
        )
      ) AS collections
      FROM collections_with_links;
    `);

    // Parse hashtags for each collection
    const collections = collectionsData.rows[0].collections || [];
    return collections.map((collection) => {
      const hashtags =
        collection.hashtags && collection.hashtags.length > 0
          ? collection.hashtags[0].split(',')
          : [];
      return {
        ...collection,
        hashtags,
      };
    });
  } catch (error) {
    console.error('Error fetching collaborated collections:', error);
    throw new Error('Failed to fetch collaborated collections');
  }
}

// New service function to add multiple notations at once
export async function addMultipleNotationsToExternalLinkService(
  collectionExternalLinkId,
  notationsArray,
  userId
) {
  try {
    // First, get the actual external link ID from the collection external link
    const collectionExternalLink = await db
      .select({ externalLinkId: collectionExternalLinks.externalLinkId })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.id, collectionExternalLinkId))
      .limit(1);

    if (!collectionExternalLink || collectionExternalLink.length === 0) {
      throw new Error('Collection external link not found');
    }

    const actualExternalLinkId = collectionExternalLink[0].externalLinkId;

    //first update the external link to set the updated_at date to now
    await db
      .update(externalLinks)
      .set({ updatedAt: new Date() })
      .where(eq(externalLinks.id, actualExternalLinkId));

    // Prepare all notations for bulk insert
    const notationsToInsert = notationsArray.map((notationData) => {
      const notationId = generateUUID();
      const dateRangeFields = buildDateRangeCreateFields(notationData);
      return {
        id: notationId,
        collectionExternalLinkId: collectionExternalLinkId,
        title: notationData.title,
        description: notationData.description || '',
        category: notationData.category || 'General',
        status: notationData.status || 'pending',
        highlighted: notationData.highlighted || false,
        ...dateRangeFields,
        startTime: notationData.startTime || null,
        endTime: notationData.endTime || null,
        timezone: notationData.timezone || null,
        type: notationData.type || 'notation',
        visibility: notationData.visibility || 'private',
        notes: notationData.notes || '',
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: userId,
      };
    });

    // Insert all notations at once
    const insertedNotations = await db
      .insert(collectionExternalLinksNotations)
      .values(notationsToInsert)
      .returning();

    // Process embeddings and tags for all created notations
    for (let i = 0; i < insertedNotations.length; i++) {
      const notation = insertedNotations[i];
      const originalNotationData = notationsArray[i];

      // Embeddings will be processed asynchronously by the background job
      // This ensures faster response times for the user

      // Handle tags if provided
      if (originalNotationData.tags && originalNotationData.tags.length > 0) {
        try {
          // Extract tag IDs from tag objects if needed
          const tagIds = originalNotationData.tags
            .map((tag) => {
              // If it's already a tag object with an id, extract the id
              if (typeof tag === 'object' && tag.id) {
                return tag.id;
              }
              // If it's a string, assume it's already a tag ID
              return tag;
            })
            .filter((tagId) => tagId); // Remove any null/undefined values

          if (tagIds.length > 0) {
            await addTagsToNotationService(notation.id, tagIds);
          }
        } catch (tagError) {
          console.error(
            `Error adding tags to notation ${notation.id}:`,
            tagError
          );
          // Don't fail the entire operation if tag assignment fails
        }
      }
    }

    return insertedNotations;
  } catch (error) {
    console.error('Error in addMultipleNotationsToExternalLinkService:', error);
    throw error;
  }
}

/**
 * Toggle public JSON sharing for a collection
 */
export async function toggleCollectionPublicJsonSharingService(
  collectionId,
  enabled,
  userId,
  tenants,
  isAdmin = false
) {
  try {
    // First verify the collection exists and user has permission
    const collection = await db
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.id, collectionId),
          inArray(collections.tenantId, tenants),
          or(eq(collections.userId, userId), isAdmin ? sql`true` : sql`false`)
        )
      )
      .limit(1);

    if (!collection.length) {
      throw new Error('Collection not found or access denied');
    }

    const [collectionRecord] = collection;

    if (
      enabled &&
      !canEnableDirectCollectionSharing(
        collectionRecord.type,
        collectionRecord.visibility
      )
    ) {
      throw new Error(
        'Only public or unlisted resource and external collections can enable public sharing'
      );
    }

    // Update the publicJsonEnabled field
    const updatedCollection = await db
      .update(collections)
      .set({
        publicJsonEnabled: enabled,
        updatedAt: sql`NOW()`,
      })
      .where(eq(collections.id, collectionId))
      .returning();

    return updatedCollection[0];
  } catch (error) {
    console.error('Error toggling collection public JSON sharing:', error);
    throw error;
  }
}

/**
 * Toggle public JSON sharing for an external link
 */
export async function toggleExternalLinkPublicJsonSharingService(
  externalLinkId,
  enabled,
  userId,
  tenants,
  isAdmin = false
) {
  try {
    // Build where conditions
    const conditions = [eq(externalLinks.id, externalLinkId)];

    // Handle tenant check - either the external link has no tenant (null) or matches one of user's tenants
    if (tenants && tenants.length > 0) {
      conditions.push(
        or(
          isNull(externalLinks.tenantId),
          inArray(externalLinks.tenantId, tenants)
        )
      );
    }

    // Add permission check - user must be owner or admin
    conditions.push(
      or(
        eq(externalLinks.addedByUserId, userId),
        isAdmin ? sql`true` : sql`false`
      )
    );

    // First verify the external link exists and user has permission
    const externalLink = await db
      .select()
      .from(externalLinks)
      .where(and(...conditions))
      .limit(1);

    if (!externalLink.length) {
      throw new Error('External link not found or access denied');
    }

    const [externalLinkRecord] = externalLink;

    if (
      enabled &&
      !isPubliclyShareableVisibility(externalLinkRecord.visibility)
    ) {
      throw new Error(
        'Only public or unlisted external links can enable public sharing'
      );
    }

    // Update the publicJsonEnabled field
    const updatedExternalLink = await db
      .update(externalLinks)
      .set({
        publicJsonEnabled: enabled,
        updatedAt: sql`NOW()`,
      })
      .where(eq(externalLinks.id, externalLinkId))
      .returning();

    return updatedExternalLink[0];
  } catch (error) {
    console.error('Error toggling external link public JSON sharing:', error);
    throw error;
  }
}

/**
 * Get public sharing status for collections
 */
export async function getCollectionPublicSharingStatusService(
  collectionIds,
  userId,
  tenants,
  isAdmin = false
) {
  try {
    const collectionsStatus = await db
      .select({
        id: collections.id,
        name: collections.name,
        publicJsonEnabled: collections.publicJsonEnabled,
        visibility: collections.visibility,
      })
      .from(collections)
      .where(
        and(
          inArray(collections.id, collectionIds),
          inArray(collections.tenantId, tenants),
          or(eq(collections.userId, userId), isAdmin ? sql`true` : sql`false`)
        )
      );

    return collectionsStatus;
  } catch (error) {
    console.error('Error fetching collection public sharing status:', error);
    throw error;
  }
}

/**
 * Get public sharing status for external links
 */
export async function getExternalLinkPublicSharingStatusService(
  externalLinkIds,
  userId,
  tenants,
  isAdmin = false
) {
  try {
    const externalLinksStatus = await db
      .select({
        id: externalLinks.id,
        name: externalLinks.name,
        publicJsonEnabled: externalLinks.publicJsonEnabled,
        visibility: externalLinks.visibility,
      })
      .from(externalLinks)
      .where(
        and(
          inArray(externalLinks.id, externalLinkIds),
          inArray(externalLinks.tenantId, tenants),
          or(
            eq(externalLinks.addedByUserId, userId),
            isAdmin ? sql`true` : sql`false`
          )
        )
      );

    return externalLinksStatus;
  } catch (error) {
    console.error('Error fetching external link public sharing status:', error);
    throw error;
  }
}

// New sorting service functions

export async function updateExternalLinkOrderService(
  collectionId,
  externalLinkId,
  sortOrder,
  userId
) {
  try {
    return await db.transaction(async (tx) => {
      // First, get the external link to determine its type
      const externalLinkData = await tx.execute(sql`
        SELECT el.type
        FROM external_links el
        JOIN collection_external_links cel ON el.id = cel.external_link_id
        WHERE cel.collection_id = ${collectionId}
          AND cel.external_link_id = ${externalLinkId}
      `);

      if (externalLinkData.rows.length === 0) {
        throw new Error('External link not found in collection');
      }

      const linkType = externalLinkData.rows[0].type;

      // Get all external links of the same type in the collection, ordered by current sort order
      const sameTypeLinks = await tx.execute(sql`
        SELECT 
          cel.external_link_id,
          cel.sort_order,
          el.type
        FROM collection_external_links cel
        JOIN external_links el ON cel.external_link_id = el.id
        WHERE cel.collection_id = ${collectionId}
          AND el.type = ${linkType}
        ORDER BY cel.sort_order ASC NULLS LAST, cel.created_at ASC
      `);

      const links = sameTypeLinks.rows;

      const targetLinkIndex = links.findIndex(
        (link) => link.external_link_id === externalLinkId
      );

      if (targetLinkIndex === -1) {
        throw new Error('Target link not found in same type group');
      }

      // Remove the target link from its current position
      const targetLink = links.splice(targetLinkIndex, 1)[0];

      // Insert the target link at the new position (sortOrder - 1 because sortOrder is 1-based)
      const newPosition = Math.max(0, Math.min(sortOrder - 1, links.length));
      links.splice(newPosition, 0, targetLink);

      // Update sort orders for all links in this type group
      const updatePromises = links.map((link, index) => {
        const newSortOrder = index + 1; // 1-based sort order
        return tx
          .update(collectionExternalLinks)
          .set({
            sortOrder: newSortOrder,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(collectionExternalLinks.collectionId, collectionId),
              eq(collectionExternalLinks.externalLinkId, link.external_link_id)
            )
          );
      });

      // Execute all updates
      await Promise.all(updatePromises);

      // Update the collection's updated_at date
      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, collectionId));

      // Get the complete external link data with the updated sortOrder
      const updatedExternalLink = await tx.execute(sql`
        SELECT
          el.id,
          el.url,
          el.name,
          el.description,
          el.notes,
          el.date_added as "dateAdded",
          el.visibility,
          el.type,
          el.image_url as "imageUrl",
          el.image_metadata as "imageMetadata",
          el.whiteboard_data as "whiteboardData",
          el.start_time as "startTime",
          el.end_time as "endTime",
          el.timezone,
          el.timestamps,
          el.tenant_id as "tenantId",
          COALESCE(cel.start_date, cel.date) as date,
          COALESCE(cel.start_date, cel.date) as "startDate",
          COALESCE(cel.end_date, cel.start_date, cel.date) as "endDate",
          cel.status,
          cel.user_id as "userId",
          cel.event_id as "eventId",
          cel.sort_order as "sortOrder",
          cel.notes as "collectionNotes"
        FROM external_links el
        JOIN collection_external_links cel ON el.id = cel.external_link_id
        WHERE cel.collection_id = ${collectionId}
          AND cel.external_link_id = ${externalLinkId}
      `);

      if (updatedExternalLink.rows.length === 0) {
        throw new Error('External link not found after update');
      }

      const result = {
        ...updatedExternalLink.rows[0],
        reorderedLinks: links.map((link, index) => ({
          externalLinkId: link.external_link_id,
          newSortOrder: index + 1,
          type: linkType,
        })),
      };

      return result;
    });
  } catch (error) {
    console.error('Error updating external link order:', error);
    throw new Error('Failed to update external link order');
  }
}

export async function updateTypeOrderService(
  collectionId,
  typeOrdering,
  userId
) {
  try {
    return await db.transaction(async (tx) => {
      // Delete existing type ordering for this collection
      await tx
        .delete(collectionTypeOrdering)
        .where(eq(collectionTypeOrdering.collectionId, collectionId));

      // Process the type ordering data based on its format
      let typeOrderingData = [];

      if (typeOrdering && Object.keys(typeOrdering).length > 0) {
        // Check if it's an array format (with objects containing typeName and sortOrder)
        if (Array.isArray(typeOrdering)) {
          typeOrderingData = typeOrdering.map((item) => {
            if (
              typeof item === 'object' &&
              item.typeName !== undefined &&
              item.sortOrder !== undefined
            ) {
              return {
                collectionId: collectionId,
                type: item.typeName,
                sortOrder: parseInt(item.sortOrder, 10),
              };
            } else {
              throw new Error(
                `Invalid type ordering item format: ${JSON.stringify(item)}`
              );
            }
          });
        }
        // Check if it's an object with entries like {typeName: sortOrder}
        else if (typeof typeOrdering === 'object') {
          // Check if the values are objects (like {typeName: "...", sortOrder: ...})

          // Check if the values are objects (like {typeName: "...", sortOrder: ...})
          const firstValue = Object.values(typeOrdering)[0];
          if (
            firstValue &&
            typeof firstValue === 'object' &&
            'typeName' in firstValue
          ) {
            // Handle format like: {"0": {typeName: "6 Months", sortOrder: 0}}
            typeOrderingData = Object.values(typeOrdering).map((item) => ({
              collectionId: collectionId,
              type: item.typeName,
              sortOrder: parseInt(item.sortOrder, 10),
            }));
          } else {
            // Handle format like: {"6 Months": 0, "1 Year": 1}
            typeOrderingData = Object.entries(typeOrdering).map(
              ([type, sortOrder]) => ({
                collectionId: collectionId,
                type: type,
                sortOrder: parseInt(sortOrder, 10),
              })
            );
          }
        }

        if (typeOrderingData.length > 0) {
          // Validate all sortOrder values are valid integers
          for (const item of typeOrderingData) {
            if (isNaN(item.sortOrder)) {
              throw new Error(
                `Invalid sortOrder value: ${item.sortOrder} for type: ${item.type}`
              );
            }
          }

          await tx.insert(collectionTypeOrdering).values(typeOrderingData);
        }
      }

      // Update the collection's updated_at date
      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, collectionId));

      return { success: true, processedItems: typeOrderingData.length };
    });
  } catch (error) {
    console.error('Error updating type order:', error);
    console.error('Type ordering data received:', typeOrdering);
    throw new Error('Failed to update type order');
  }
}

export async function getTypeOrderingService(collectionId) {
  try {
    const typeOrdering = await db
      .select({
        type: collectionTypeOrdering.type,
        sortOrder: collectionTypeOrdering.sortOrder,
      })
      .from(collectionTypeOrdering)
      .where(eq(collectionTypeOrdering.collectionId, collectionId));

    // Convert to object format
    const orderingMap = {};
    typeOrdering.forEach((item) => {
      orderingMap[item.type] = item.sortOrder;
    });

    return orderingMap;
  } catch (error) {
    console.error('Error fetching type ordering:', error);
    throw new Error('Failed to fetch type ordering');
  }
}

// Service function for bulk updating multiple notations
export async function updateMultipleNotationsService(
  updatesArray,
  externalLinkId,
  userId
) {
  try {
    // First update the external link to set the updated_at date to now
    await db
      .update(externalLinks)
      .set({ updatedAt: new Date() })
      .where(eq(externalLinks.id, externalLinkId));

    const updatedNotations = [];

    // Process each update
    for (const updateData of updatesArray) {
      const { id, ...updateFields } = updateData.after;

      // Extract tags from update data
      const tags = updateFields.tags;
      delete updateFields.tags; // Remove tags from updateFields

      // Map content to notes if it exists and prepare update data
      const mappedUpdateData = {
        ...updateFields,
        ...buildDateRangeUpdateFields(updateFields),
        startTime: updateFields.startTime || null,
        endTime: updateFields.endTime || null,
        timezone: updateFields.timezone || null,
        type: updateFields.type || null,
        notes: updateFields.content || updateFields.notes, // handle either field name
        updatedAt: new Date(),
      };

      // Remove content field to avoid duplicate storage
      delete mappedUpdateData.content;
      // Remove fields that shouldn't be updated
      delete mappedUpdateData.createdAt;
      delete mappedUpdateData.userId;
      delete mappedUpdateData.id;

      // Update the notation
      const result = await db
        .update(collectionExternalLinksNotations)
        .set(mappedUpdateData)
        .where(eq(collectionExternalLinksNotations.id, id))
        .returning();

      if (result.length === 0) {
        console.warn(`Notation ${id} not found or access denied`);
        continue;
      }

      updatedNotations.push(result[0]);

      // Handle tags update if provided
      if (tags !== undefined) {
        try {
          // Extract tag IDs from tag objects if needed
          const tagIds = tags
            .map((tag) => {
              // If it's already a tag object with an id, extract the id
              if (typeof tag === 'object' && tag.id) {
                return tag.id;
              }
              // If it's a string, assume it's already a tag ID
              return tag;
            })
            .filter((tagId) => tagId); // Remove any null/undefined values

          await updateNotationTagsService(id, tagIds);
        } catch (tagError) {
          console.error(`Error updating tags for notation ${id}:`, tagError);
          // Don't fail the entire operation if tag update fails
        }
      }

      // Embeddings will be processed asynchronously by the background job
    }

    return updatedNotations;
  } catch (error) {
    console.error('Error in updateMultipleNotationsService:', error);
    throw error;
  }
}

/**
 * Get detailed collection data with full external links, notations, and resources for export
 */
export async function getDetailedCollectionExportDataService(
  collectionId,
  userId,
  tenants
) {
  try {
    // First verify the user has access to this collection using proper privacy logic
    const collection = await db
      .select({
        id: collections.id,
        name: collections.name,
        description: collections.description,
        userId: collections.userId,
        organizationId: collections.organizationId,
        visibility: collections.visibility,
        status: collections.status,
        icon: collections.icon,
        createdAt: collections.createdAt,
        updatedAt: collections.updatedAt,
        color: collections.color,
        type: collections.type,
        eventId: collections.eventId,
        tenantId: collections.tenantId,
        hashtags: collections.hashtags,
        publicJsonEnabled: collections.publicJsonEnabled,
        // Check if user is a collaborator on this collection
        isCollaborator: sql`EXISTS (
          SELECT 1 FROM collection_collaborators cc 
          WHERE cc.collection_id = ${collections.id}
          AND cc.user_id = ${userId}
        )`.mapWith(Boolean),
      })
      .from(collections)
      .where(
        and(
          eq(collections.id, collectionId),
          inArray(collections.tenantId, tenants),
          or(
            eq(collections.visibility, 'public'),
            eq(collections.userId, userId), // Owner access
            and(
              eq(collections.visibility, 'unlisted'),
              sql`EXISTS (
                SELECT 1 FROM collection_collaborators cc 
                WHERE cc.collection_id = ${collections.id}
                AND cc.user_id = ${userId}
              )`
            ) // Collaborator access for unlisted collections
          )
        )
      )
      .limit(1);

    if (collection.length === 0) {
      return null; // Collection not found or access denied
    }

    const collectionData = collection[0];

    // Get all external links for this collection with proper privacy filtering
    const externalLinksData = await db
      .select({
        id: externalLinks.id,
        title: externalLinks.title,
        url: externalLinks.url,
        description: externalLinks.description,
        category: externalLinks.category,
        createdAt: externalLinks.createdAt,
        updatedAt: externalLinks.updatedAt,
        collectionExternalLinkId: collectionExternalLinks.id,
        orderIndex: collectionExternalLinks.orderIndex,
        type: collectionExternalLinks.type,
        visibility: externalLinks.visibility,
        addedByUserId: externalLinks.addedByUserId,
      })
      .from(externalLinks)
      .innerJoin(
        collectionExternalLinks,
        eq(externalLinks.id, collectionExternalLinks.externalLinkId)
      )
      .where(
        and(
          eq(collectionExternalLinks.collectionId, collectionId),
          or(
            eq(externalLinks.visibility, 'public'),
            eq(externalLinks.addedByUserId, userId), // User added this link
            and(
              eq(externalLinks.visibility, 'unlisted'),
              sql`EXISTS (
                SELECT 1 FROM collection_external_links_collaborators celc 
                WHERE celc.collection_external_link_id = ${collectionExternalLinks.id}
                AND celc.user_id = ${userId}
              )`
            ) // Collaborator access for unlisted external links
          )
        )
      )
      .orderBy(collectionExternalLinks.orderIndex);

    // Get all notations for these external links with privacy filtering
    const externalLinkIds = externalLinksData.map(
      (link) => link.collectionExternalLinkId
    );

    let allNotations = [];
    if (externalLinkIds.length > 0) {
      allNotations = await db
        .select({
          id: collectionExternalLinksNotations.id,
          title: collectionExternalLinksNotations.title,
          notes: collectionExternalLinksNotations.notes,
          status: collectionExternalLinksNotations.status,
          category: collectionExternalLinksNotations.category,
          visibility: collectionExternalLinksNotations.visibility,
          highlighted: collectionExternalLinksNotations.highlighted,
          notationDate: collectionExternalLinksNotations.notationDate,
          notationTime: collectionExternalLinksNotations.notationTime,
          createdAt: collectionExternalLinksNotations.createdAt,
          updatedAt: collectionExternalLinksNotations.updatedAt,
          collectionExternalLinkId:
            collectionExternalLinksNotations.collectionExternalLinkId,
          externalLinkId: collectionExternalLinks.externalLinkId,
          userId: collectionExternalLinksNotations.userId,
        })
        .from(collectionExternalLinksNotations)
        .innerJoin(
          collectionExternalLinks,
          eq(
            collectionExternalLinksNotations.collectionExternalLinkId,
            collectionExternalLinks.id
          )
        )
        .where(
          and(
            inArray(
              collectionExternalLinksNotations.collectionExternalLinkId,
              externalLinkIds
            ),
            or(
              eq(collectionExternalLinksNotations.visibility, 'public'),
              eq(collectionExternalLinksNotations.userId, userId), // User created this notation
              eq(collectionExternalLinksNotations.visibility, 'unlisted') // Unlisted notations accessible to anyone with link access
            )
          )
        )
        .orderBy(collectionExternalLinksNotations.createdAt);

      // Get tags for all notations
      for (const notation of allNotations) {
        try {
          notation.tags = await getTagsForNotation(notation.id);
        } catch (error) {
          console.error(
            `Error fetching tags for notation ${notation.id}:`,
            error
          );
          notation.tags = [];
        }
      }
    }

    // Get all resources for this collection
    const resourcesData = await db
      .select({
        id: resources.id,
        title: resources.title,
        description: resources.description,
        url: resources.url,
        category: resources.category,
        resourceType: resources.resourceType,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
        orderIndex: collectionResources.orderIndex,
      })
      .from(resources)
      .innerJoin(
        collectionResources,
        eq(resources.id, collectionResources.resourceId)
      )
      .where(eq(collectionResources.collectionId, collectionId))
      .orderBy(collectionResources.orderIndex);

    // Group notations by external link
    const notationsByExternalLink = {};
    allNotations.forEach((notation) => {
      const linkId = notation.externalLinkId;
      if (!notationsByExternalLink[linkId]) {
        notationsByExternalLink[linkId] = [];
      }
      notationsByExternalLink[linkId].push(notation);
    });

    // Add notations to their respective external links
    const externalLinksWithNotations = externalLinksData.map((link) => ({
      ...link,
      notations: notationsByExternalLink[link.id] || [],
    }));

    return {
      collection: collectionData,
      externalLinks: externalLinksWithNotations,
      resources: resourcesData,
      totalExternalLinks: externalLinksWithNotations.length,
      totalResources: resourcesData.length,
      totalNotations: allNotations.length,
    };
  } catch (error) {
    console.error('Error in getDetailedCollectionExportDataService:', error);
    throw error;
  }
}

/**
 * Get paginated external links for a collection
 */
export async function getExternalLinksForCollectionByIdPaginatedService(
  collectionId,
  userId,
  offset,
  limit
) {
  try {
    // First, get the total count
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM collection_external_links cel
      JOIN external_links el ON cel.external_link_id = el.id
      JOIN collections c ON cel.collection_id = c.id
      WHERE cel.collection_id = ${collectionId}
      AND (
        el.visibility = 'public' 
        OR el.added_by_user_id = ${userId}
        OR (
          el.visibility IN ('unlisted', 'public') 
          AND EXISTS (
            SELECT 1 FROM collection_external_links_collaborators celc 
            WHERE celc.collection_external_link_id = cel.id 
            AND celc.user_id = ${userId}
          )
        )
        OR (
          -- Allow unlisted external links when parent collection is public/unlisted
          el.visibility = 'unlisted' 
          AND c.visibility IN ('public', 'unlisted')
        )
      )
    `);

    const total = countResult[0]?.total || 0;

    // Get paginated external links
    const externalLinks = await db.execute(sql`
      SELECT
        el.id,
        el.url,
        el.name,
        el.description,
        el.notes,
        el.date_added,
        COALESCE(cel.start_date, cel.date) AS date,
        COALESCE(cel.start_date, cel.date) AS "startDate",
        COALESCE(cel.end_date, cel.start_date, cel.date) AS "endDate",
        el.visibility,
        el.type,
        el.is_google_calendar_event,
        el.start_time,
        el.end_time,
        el.timezone,
        el.status,
        el.added_by_user_id as "userId",
        cel.sort_order,
        cel.id as "collectionExternalLinkId",
        cel.type_ordering,
        el.public_json_sharing_enabled as "publicJsonSharingEnabled",
        el.share_slug as "shareSlug",
        EXISTS (
          SELECT 1 FROM collection_external_links_notations 
          WHERE collection_external_link_id = cel.id
        ) as has_notations
      FROM collection_external_links cel
      JOIN external_links el ON cel.external_link_id = el.id
      JOIN collections c ON cel.collection_id = c.id
      WHERE cel.collection_id = ${collectionId}
      AND (
        el.visibility = 'public' 
        OR el.added_by_user_id = ${userId}
        OR (
          el.visibility IN ('unlisted', 'public') 
          AND EXISTS (
            SELECT 1 FROM collection_external_links_collaborators celc 
            WHERE celc.collection_external_link_id = cel.id 
            AND celc.user_id = ${userId}
          )
        )
        OR (
          -- Allow unlisted external links when parent collection is public/unlisted
          el.visibility = 'unlisted' 
          AND c.visibility IN ('public', 'unlisted')
        )
      )
      ORDER BY COALESCE(cel.sort_order, 999999), cel.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    // Get tags for the current page of external links
    const externalLinkIds = externalLinks.map((link) => link.id);
    const tags =
      externalLinkIds.length > 0
        ? await getTagsForExternalLinks(externalLinkIds)
        : {};

    // Get notations for the current page
    const notations =
      externalLinkIds.length > 0
        ? await getNotationsForExternalLinks(
            externalLinks.map((l) => l.collectionExternalLinkId)
          )
        : {};

    // Process external links with tags and notations
    const processedExternalLinks = externalLinks.map((link) => ({
      ...link,
      tags: tags[link.id] || [],
      notations: notations[link.collectionExternalLinkId] || [],
    }));

    return {
      externalLinks: processedExternalLinks,
      total,
    };
  } catch (error) {
    console.error('Error fetching paginated external links:', error);
    throw error;
  }
}

/**
 * Get paginated resources for a collection
 */
export async function getResourcesForCollectionByIdPaginatedService(
  collectionId,
  userId,
  tenantIds,
  offset,
  limit
) {
  try {
    // First, get the total count
    const countResult = await db.execute(sql`
      SELECT COUNT(*)::int as total
      FROM collection_resources cr
      JOIN resources r ON cr.resource_id = r.id
      WHERE cr.collection_id = ${collectionId}
      AND r.tenant_id = ANY(${tenantIds}::uuid[])
    `);

    const total = countResult[0]?.total || 0;

    // Get paginated resources
    const resources = await db.execute(sql`
      WITH orgs AS (
        SELECT
          or_link.resource_id,
          jsonb_agg(
            jsonb_build_object(
              'id', o.id,
              'name', o.name,
              'image_url', o.image_url
            ) ORDER BY o.name
          ) AS organizations
        FROM organization_resources or_link
        JOIN organizations o ON or_link.organization_id = o.id
        GROUP BY or_link.resource_id
      )
      SELECT
        r.id,
        r.name,
        r.description,
        r.content,
        r.url,
        r.resource_type,
        r.created_at as "createdAt",
        r.updated_at as "updatedAt",
        r.status,
        r.image_key as "imageKey",
        r.video_key as "videoKey",
        r.type,
        r.duration,
        r.tenant_id,
        r.hashtags,
        cr.notes,
        cr.order_position as "orderPosition",
        cr.created_at as "dateAdded",
        COALESCE(orgs.organizations, '[]'::jsonb) as organizations
      FROM collection_resources cr
      JOIN resources r ON cr.resource_id = r.id
      LEFT JOIN orgs ON orgs.resource_id = r.id
      WHERE cr.collection_id = ${collectionId}
      AND r.tenant_id = ANY(${tenantIds}::uuid[])
      ORDER BY COALESCE(cr.order_position, 999999), cr.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);

    return {
      resources,
      total,
    };
  } catch (error) {
    console.error('Error fetching paginated resources:', error);
    throw error;
  }
}

/**
 * Helper function to get tags for external links
 */
async function getTagsForExternalLinks(externalLinkIds) {
  if (!externalLinkIds.length) return {};

  const tags = await db.execute(sql`
    SELECT
      celt.external_link_id,
      jsonb_build_object(
        'id', td.id,
        'name', td.name,
        'color', td.color,
        'created_at', td.created_at
      ) as tag
    FROM collection_external_link_tags celt
    JOIN collection_external_link_tag_definitions td ON celt.tag_id = td.id
    WHERE celt.external_link_id = ANY(${externalLinkIds}::uuid[])
  `);

  // Group tags by external link ID
  const tagsByLinkId = {};
  tags.forEach((row) => {
    if (!tagsByLinkId[row.external_link_id]) {
      tagsByLinkId[row.external_link_id] = [];
    }
    tagsByLinkId[row.external_link_id].push(row.tag);
  });

  return tagsByLinkId;
}

/**
 * Helper function to get notations for external links
 */
async function getNotationsForExternalLinks(collectionExternalLinkIds) {
  if (!collectionExternalLinkIds.length) return {};

  const notations = await db.execute(sql`
    SELECT
      n.collection_external_link_id,
      jsonb_build_object(
        'id', n.id,
        'title', n.title,
        'notes', n.notes,
        'category', n.category,
        'date', n.date,
        'start_time', n.start_time,
        'end_time', n.end_time,
        'timezone', n.timezone,
        'status', n.status,
        'highlighted', n.highlighted,
        'created_at', n.created_at,
        'updated_at', n.updated_at
      ) as notation
    FROM collection_external_links_notations n
    WHERE n.collection_external_link_id = ANY(${collectionExternalLinkIds}::uuid[])
    ORDER BY n.created_at DESC
  `);

  // Group notations by collection external link ID
  const notationsByLinkId = {};
  notations.forEach((row) => {
    if (!notationsByLinkId[row.collection_external_link_id]) {
      notationsByLinkId[row.collection_external_link_id] = [];
    }
    notationsByLinkId[row.collection_external_link_id].push(row.notation);
  });

  return notationsByLinkId;
}
