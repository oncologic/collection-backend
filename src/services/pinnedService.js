import { db } from '../db/index.js';
import { eq, and, inArray, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// Import models
import { pinnedItems } from '../models/pinnedItems.js';
import { resources } from '../models/resources.js';
import { events } from '../models/events.js';
import { organizations } from '../models/organizations.js';
import {
  collectionExternalLinks,
  externalLinks,
} from '../models/external_links.js';
import { collections } from '../models/collections.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import {
  collectionExternalLinksNotations,
  collectionExternalLinkNotationTags,
} from '../models/collectionExternalLinksNotations.js';
import { collectionExternalLinkTagDefinitions } from '../models/collectionExternalLinkTags.js';

// Import services for deep fetching

import { getCollectionsWithItemsByIdsService } from '../services/collectionService.js';
import { getResourcesWithRelations } from '../services/resourceService.js';

export async function getPinnedItemsService(userId, tenantIds) {
  try {
    // Get all pinned items for the user
    const userPinnedItems = await db
      .select()
      .from(pinnedItems)
      .where(eq(pinnedItems.userId, userId))
      .orderBy(pinnedItems.orderPosition);

    // Group items by type
    const groupedItems = userPinnedItems.reduce((acc, item) => {
      if (!acc[item.itemType]) {
        acc[item.itemType] = [];
      }
      acc[item.itemType].push(item.itemId);
      return acc;
    }, {});

    // Initialize empty arrays for each type
    const resourceItems = [];
    const eventItems = [];
    const organizationItems = [];
    const collectionItems = [];
    const externalLinkItems = [];

    // Fetch details for each type of item with full relations
    if (groupedItems.resource) {
      const resourceResults = await getResourcesWithRelations(
        db,
        tenantIds
      ).where(
        and(
          inArray(resources.id, groupedItems.resource),
          inArray(resources.tenantId, tenantIds)
        )
      );
      resourceItems.push(...resourceResults);
    }

    if (groupedItems.event) {
      const eventResults = await db
        .select()
        .from(events)
        .where(
          and(
            inArray(events.id, groupedItems.event),
            inArray(events.tenantId, tenantIds)
          )
        );
      eventItems.push(...eventResults);
    }

    if (groupedItems.organization) {
      const orgResults = await db
        .select()
        .from(organizations)
        .where(
          and(
            inArray(organizations.id, groupedItems.organization),
            inArray(organizations.tenantId, tenantIds)
          )
        );
      organizationItems.push(...orgResults);
    }

    if (groupedItems.collection) {
      const collectionResults = await getCollectionsWithItemsByIdsService(
        groupedItems.collection,
        userId
      );
      // Only include collections from the specified tenants
      const filteredCollections = collectionResults.filter((collection) =>
        tenantIds.includes(collection.tenantId)
      );
      collectionItems.push(...filteredCollections);
    }

    if (groupedItems.external_link) {
      // First get the basic external link data
      const linkResults = await db
        .select({
          id: externalLinks.id,
          url: externalLinks.url,
          name: externalLinks.name,
          description: externalLinks.description,
          notes: externalLinks.notes,
          dateAdded: externalLinks.dateAdded,
          addedByUserId: externalLinks.addedByUserId,
          visibility: externalLinks.visibility,
          type: externalLinks.type,
          imageKey: externalLinks.imageKey,
          imageMetadata: externalLinks.imageMetadata,
          imageUrl: externalLinks.imageUrl,
          createdAt: externalLinks.createdAt,
          updatedAt: externalLinks.updatedAt,
          timestamps: externalLinks.timestamps,
          startTime: externalLinks.startTime,
          endTime: externalLinks.endTime,
          timezone: externalLinks.timezone,
          fullText: externalLinks.fullText,
          tenantId: externalLinks.tenantId,
          publicJsonEnabled: externalLinks.publicJsonEnabled,
          collectionExternalLinkId: collectionExternalLinks.id,
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
            inArray(externalLinks.id, groupedItems.external_link),
            or(
              eq(externalLinks.visibility, 'public'),
              eq(externalLinks.visibility, 'unlisted'),
              eq(externalLinks.addedByUserId, userId),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          )
        );

      // Now get notations with their tags for these external links
      for (const link of linkResults) {
        const notationsWithTags = await db
          .select({
            id: collectionExternalLinksNotations.id,
            title: collectionExternalLinksNotations.title,
            description: collectionExternalLinksNotations.description,
            notes: collectionExternalLinksNotations.notes,
            category: collectionExternalLinksNotations.category,
            status: collectionExternalLinksNotations.status,
            highlighted: collectionExternalLinksNotations.highlighted,
            listOrder: collectionExternalLinksNotations.listOrder,
            visibility: collectionExternalLinksNotations.visibility,
            date: collectionExternalLinksNotations.date,
            startTime: collectionExternalLinksNotations.startTime,
            endTime: collectionExternalLinksNotations.endTime,
            timezone: collectionExternalLinksNotations.timezone,
            type: collectionExternalLinksNotations.type,
            createdAt: collectionExternalLinksNotations.createdAt,
            updatedAt: collectionExternalLinksNotations.updatedAt,
            tagId: collectionExternalLinkTagDefinitions.id,
            tagName: collectionExternalLinkTagDefinitions.name,
            tagDescription: collectionExternalLinkTagDefinitions.description,
            tagColor: collectionExternalLinkTagDefinitions.color,
          })
          .from(collectionExternalLinksNotations)
          .leftJoin(
            collectionExternalLinkNotationTags,
            eq(
              collectionExternalLinksNotations.id,
              collectionExternalLinkNotationTags.collectionExternalLinkNotationId
            )
          )
          .leftJoin(
            collectionExternalLinkTagDefinitions,
            eq(
              collectionExternalLinkNotationTags.tagId,
              collectionExternalLinkTagDefinitions.id
            )
          )
          .where(
            eq(
              collectionExternalLinksNotations.collectionExternalLinkId,
              link.collectionExternalLinkId
            )
          )
          .orderBy(collectionExternalLinksNotations.listOrder);

        // Group notations and their tags
        const notationsMap = new Map();

        notationsWithTags.forEach((row) => {
          if (!notationsMap.has(row.id)) {
            notationsMap.set(row.id, {
              id: row.id,
              title: row.title,
              description: row.description,
              notes: row.notes,
              category: row.category,
              status: row.status,
              highlighted: row.highlighted,
              listOrder: row.listOrder,
              visibility: row.visibility,
              date: row.date,
              startTime: row.startTime,
              endTime: row.endTime,
              timezone: row.timezone,
              type: row.type,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              tags: [],
            });
          }

          // Add tag if it exists
          if (row.tagId) {
            notationsMap.get(row.id).tags.push({
              id: row.tagId,
              name: row.tagName,
              description: row.tagDescription,
              color: row.tagColor,
            });
          }
        });

        // Add notations to the link
        link.notations = Array.from(notationsMap.values());
      }

      externalLinkItems.push(...linkResults);
    }

    // Combine all items with their order positions, filtering out items that don't exist in the specified tenants
    const allItems = userPinnedItems
      .map((pinnedItem) => {
        let itemDetails;
        switch (pinnedItem.itemType) {
          case 'resource':
            itemDetails = resourceItems.find((r) => r.id === pinnedItem.itemId);
            break;
          case 'event':
            itemDetails = eventItems.find((e) => e.id === pinnedItem.itemId);
            break;
          case 'organization':
            itemDetails = organizationItems.find(
              (o) => o.id === pinnedItem.itemId
            );
            break;
          case 'collection':
            itemDetails = collectionItems.find(
              (c) => c.id === pinnedItem.itemId
            );
            break;
          case 'external_link':
            itemDetails = externalLinkItems.find(
              (e) => e.id === pinnedItem.itemId
            );
            break;
        }
        // Only return items where we successfully got the details
        // This implicitly enforces tenant filtering since the detail queries include tenant filters
        return itemDetails
          ? {
              ...itemDetails,
              type: pinnedItem.itemType,
              orderPosition: pinnedItem.orderPosition,
              pinnedItemId: pinnedItem.id,
            }
          : null;
      })
      .filter(Boolean); // Remove any items where itemDetails was null

    return allItems;
  } catch (error) {
    console.error('Error in getPinnedItemsService:', error);
    throw error;
  }
}

export async function pinItemsService(items, userId, tenantIds) {
  try {
    return await db.transaction(async (tx) => {
      // Get current max order position
      const maxOrderResult = await tx
        .select({
          maxOrder: sql`COALESCE(MAX(order_position), -1)`.mapWith(Number),
        })
        .from(pinnedItems)
        .where(eq(pinnedItems.userId, userId));

      let currentOrder = maxOrderResult[0].maxOrder + 1;

      // Insert new pinned items
      const pinnedItemsToInsert = items.map((item) => ({
        userId,
        itemId: item.id,
        itemType: item.type === 'external-link' ? 'external_link' : item.type,
        orderPosition: currentOrder++,
      }));

      const result = await tx
        .insert(pinnedItems)
        .values(pinnedItemsToInsert)
        .returning();

      return result;
    });
  } catch (error) {
    console.error('Error in pinItemsService:', error);
    throw error;
  }
}

export async function unpinItemsService(itemIds, userId) {
  try {
    const result = await db
      .delete(pinnedItems)
      .where(
        and(
          inArray(pinnedItems.itemId, itemIds),
          eq(pinnedItems.userId, userId)
        )
      )
      .returning();

    // Reorder remaining items to ensure no gaps
    await reorderPinnedItems(userId);

    return result;
  } catch (error) {
    console.error('Error in unpinItemsService:', error);
    throw error;
  }
}

export async function updatePinnedItemOrderService(itemId, newOrder, userId) {
  try {
    return await db.transaction(async (tx) => {
      // Get the current item
      const currentItem = await tx
        .select()
        .from(pinnedItems)
        .where(and(eq(pinnedItems.id, itemId), eq(pinnedItems.userId, userId)))
        .limit(1);

      if (!currentItem.length) {
        throw new Error('Pinned item not found');
      }

      const currentOrder = currentItem[0].orderPosition;

      // Update all affected items
      if (newOrder > currentOrder) {
        // Moving down: update items between current and new position
        await tx
          .update(pinnedItems)
          .set({ orderPosition: sql`order_position - 1` })
          .where(
            and(
              eq(pinnedItems.userId, userId),
              sql`order_position > ${currentOrder} AND order_position <= ${newOrder}`
            )
          );
      } else if (newOrder < currentOrder) {
        // Moving up: update items between new and current position
        await tx
          .update(pinnedItems)
          .set({ orderPosition: sql`order_position + 1` })
          .where(
            and(
              eq(pinnedItems.userId, userId),
              sql`order_position >= ${newOrder} AND order_position < ${currentOrder}`
            )
          );
      }

      // Update the item's position
      const result = await tx
        .update(pinnedItems)
        .set({ orderPosition: newOrder })
        .where(eq(pinnedItems.id, itemId))
        .returning();

      return result[0];
    });
  } catch (error) {
    console.error('Error in updatePinnedItemOrderService:', error);
    throw error;
  }
}

async function reorderPinnedItems(userId) {
  try {
    // Get all remaining items ordered by current position
    const items = await db
      .select()
      .from(pinnedItems)
      .where(eq(pinnedItems.userId, userId))
      .orderBy(pinnedItems.orderPosition);

    // Update positions to be sequential
    await Promise.all(
      items.map((item, index) =>
        db
          .update(pinnedItems)
          .set({ orderPosition: index })
          .where(eq(pinnedItems.id, item.id))
      )
    );
  } catch (error) {
    console.error('Error in reorderPinnedItems:', error);
    throw error;
  }
}
