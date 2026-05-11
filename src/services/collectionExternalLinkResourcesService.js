import { eq, and, inArray, desc } from 'drizzle-orm';
import { db } from '../db/index.js';

import { resources } from '../models/resources.js';
import { users } from '../models/users.js';
import {
  resourceTypes,
  sensitivityLevels,
  expertiseLevels,
} from '../models/metadata.js';
import { collectionExternalLinkResources } from '../models/collectionExternalLinkResources.js';
import { collectionExternalLinks } from '../models/external_links.js';

export const collectionExternalLinkResourcesService = {
  async addResourcesToExternalLink(
    collectionId,
    externalLinkId,
    resourceData,
    userId,
    organizationId
  ) {
    try {
      const resourcesToAdd = Array.isArray(resourceData)
        ? resourceData
        : [resourceData];

      // Extract resource IDs to validate
      const resourceIds = resourcesToAdd.map((r) => r.resourceId);

      // Check which resources actually exist
      const existingResources = await db
        .select({ id: resources.id })
        .from(resources)
        .where(inArray(resources.id, resourceIds));

      const existingResourceIds = new Set(existingResources.map((r) => r.id));

      // Filter out resources that don't exist
      const validResources = resourcesToAdd.filter((r) =>
        existingResourceIds.has(r.resourceId)
      );

      // Log warning for non-existent resources
      const invalidResourceIds = resourceIds.filter(
        (id) => !existingResourceIds.has(id)
      );
      if (invalidResourceIds.length > 0) {
        console.warn(
          'Attempted to add non-existent resources:',
          invalidResourceIds
        );
      }

      if (validResources.length === 0) {
        return {
          success: false,
          addedCount: 0,
          resources: [],
          error: 'None of the specified resources exist',
          invalidResourceIds,
        };
      }

      // Prepare resources for insertion
      const preparedResources = validResources.map((resource, index) => ({
        collectionId,
        externalLinkId,
        resourceId: resource.resourceId,
        notes: resource.notes || null,
        orderPosition: resource.orderPosition ?? index,
        userAddedById: userId,
        organizationAddedById: organizationId,
      }));

      // Insert resources, ignoring duplicates
      const insertedResources = await db
        .insert(collectionExternalLinkResources)
        .values(preparedResources)
        .onConflictDoNothing()
        .returning();

      return {
        success: true,
        addedCount: insertedResources.length,
        resources: insertedResources,
        skippedCount: resourcesToAdd.length - validResources.length,
        invalidResourceIds,
      };
    } catch (error) {
      console.error('Error adding resources to external link:', error);
      throw error;
    }
  },

  async removeResourcesFromExternalLink(
    collectionId,
    externalLinkId,
    resourceIds
  ) {
    try {
      const idsToRemove = Array.isArray(resourceIds)
        ? resourceIds
        : [resourceIds];

      // Check if there are IDs to remove
      if (!idsToRemove || idsToRemove.length === 0) {
        return {
          success: false,
          removedCount: 0,
          resources: [],
          message: 'No resource IDs provided',
        };
      }

      // First, let's check what resources are actually linked to this external link
      const allLinkedResources = await db
        .select()
        .from(collectionExternalLinkResources)
        .where(
          and(
            eq(collectionExternalLinkResources.collectionId, collectionId),
            eq(collectionExternalLinkResources.externalLinkId, externalLinkId)
          )
        );

      // Now check if the specific resources exist in the junction table
      const existingResources = await db
        .select()
        .from(collectionExternalLinkResources)
        .where(
          and(
            eq(collectionExternalLinkResources.collectionId, collectionId),
            eq(collectionExternalLinkResources.externalLinkId, externalLinkId),
            inArray(collectionExternalLinkResources.resourceId, idsToRemove)
          )
        );

      if (existingResources.length === 0) {
        console.warn(
          'No matching resources found to remove. The resources may not be linked to this external link.'
        );
        return {
          success: false,
          removedCount: 0,
          resources: [],
          message:
            'No matching resources found to remove. The resources may not be linked to this external link.',
        };
      }

      // Now delete them
      const deletedResources = await db
        .delete(collectionExternalLinkResources)
        .where(
          and(
            eq(collectionExternalLinkResources.collectionId, collectionId),
            eq(collectionExternalLinkResources.externalLinkId, externalLinkId),
            inArray(collectionExternalLinkResources.resourceId, idsToRemove)
          )
        )
        .returning();

      return {
        success: true,
        removedCount: deletedResources.length,
        resources: deletedResources,
      };
    } catch (error) {
      console.error('Error removing resources from external link:', error);
      throw error;
    }
  },

  async getResourcesForExternalLink(collectionId, externalLinkId) {
    try {
      const result = await db
        .select()
        .from(collectionExternalLinkResources)
        .leftJoin(
          resources,
          eq(collectionExternalLinkResources.resourceId, resources.id)
        )
        .leftJoin(resourceTypes, eq(resources.typeId, resourceTypes.id))
        .leftJoin(
          sensitivityLevels,
          eq(resources.sensitivityLevelId, sensitivityLevels.id)
        )
        .leftJoin(
          expertiseLevels,
          eq(resources.expertiseLevelId, expertiseLevels.id)
        )
        .leftJoin(
          users,
          eq(collectionExternalLinkResources.userAddedById, users.id)
        )
        .where(
          and(
            eq(collectionExternalLinkResources.collectionId, collectionId),
            eq(collectionExternalLinkResources.externalLinkId, externalLinkId)
          )
        )
        .orderBy(collectionExternalLinkResources.orderPosition);

      // Transform the result to a cleaner structure
      return result.map((row) => ({
        id: row.collection_external_link_resources.id,
        resourceId: row.collection_external_link_resources.resourceId,
        notes: row.collection_external_link_resources.notes,
        orderPosition: row.collection_external_link_resources.orderPosition,
        createdAt: row.collection_external_link_resources.createdAt,
        resource: row.resources
          ? {
              id: row.resources.id,
              name: row.resources.name,
              description: row.resources.description,
              url: row.resources.url,
              resourceDate: row.resources.resourceDate,
              resourceUpdatedDate: row.resources.resourceUpdatedDate,
              buttonName: row.resources.buttonName,
              requiresRegistration: row.resources.requiresRegistration,
              videoUrl: row.resources.videoUrl,
              videoKey: row.resources.videoKey,
              videoMetadata: row.resources.videoMetadata,
              imageKey: row.resources.imageKey,
              imageMetadata: row.resources.imageMetadata,
              timestamps: row.resources.timestamps,
              fullText: row.resources.fullText,
              createdAt: row.resources.createdAt,
              updatedAt: row.resources.updatedAt,
              featured: row.resources.featured,
              listOrder: row.resources.listOrder,
              imageUrl: row.resources.imageUrl,
              typeId: row.resources.typeId,
              sensitivityLevelId: row.resources.sensitivityLevelId,
              expertiseLevelId: row.resources.expertiseLevelId,
            }
          : null,
        resourceType: row.resource_types
          ? {
              id: row.resource_types.id,
              name: row.resource_types.name,
              description: row.resource_types.description,
            }
          : null,
        sensitivityLevel: row.sensitivity_levels
          ? {
              id: row.sensitivity_levels.id,
              name: row.sensitivity_levels.name,
              description: row.sensitivity_levels.description,
            }
          : null,
        expertiseLevel: row.expertise_levels
          ? {
              id: row.expertise_levels.id,
              name: row.expertise_levels.name,
              description: row.expertise_levels.description,
            }
          : null,
        addedBy: row.users
          ? {
              id: row.users.id,
              firstName: row.users.firstName,
              lastName: row.users.lastName,
            }
          : null,
      }));
    } catch (error) {
      console.error('Error getting resources for external link:', error);
      throw error;
    }
  },

  async updateResourceOrder(
    collectionId,
    externalLinkId,
    resourceId,
    newOrderPosition
  ) {
    try {
      const updated = await db
        .update(collectionExternalLinkResources)
        .set({
          orderPosition: newOrderPosition,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(collectionExternalLinkResources.collectionId, collectionId),
            eq(collectionExternalLinkResources.externalLinkId, externalLinkId),
            eq(collectionExternalLinkResources.resourceId, resourceId)
          )
        )
        .returning();

      return updated[0];
    } catch (error) {
      console.error('Error updating resource order:', error);
      throw error;
    }
  },

  async updateResourceNotes(collectionId, externalLinkId, resourceId, notes) {
    try {
      const updated = await db
        .update(collectionExternalLinkResources)
        .set({
          notes,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(collectionExternalLinkResources.collectionId, collectionId),
            eq(collectionExternalLinkResources.externalLinkId, externalLinkId),
            eq(collectionExternalLinkResources.resourceId, resourceId)
          )
        )
        .returning();

      return updated[0];
    } catch (error) {
      console.error('Error updating resource notes:', error);
      throw error;
    }
  },
};
