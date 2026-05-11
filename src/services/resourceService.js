import { db } from '../db/index.js';
import { resources } from '../models/resources.js';
import { tags } from '../models/tags.js';
import { resourceTags } from '../models/resources.js';
import { eq, and, or, not } from 'drizzle-orm';
import { inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { users } from '../models/users.js';
import { organizationResources } from '../models/organizations.js';
import { resourceRatings } from '../models/resourceRatings.js';
import {
  expertiseLevels,
  resourceTypes,
  sensitivityLevels,
  targetAudiences,
} from '../models/metadata.js';
import { collections, collectionResources } from '../models/collections.js';
import { organizationMembers } from '../models/organizations.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { UNASSIGNED_ORGANIZATION_ID } from '../constants/organizations.js';
import { autoUpdateResourceEmbedding } from './vectorService.js';
import { collectionExternalLinkResources } from '../models/collectionExternalLinkResources.js';
import { resourceAttachments } from '../models/resourceAttachments.js';
import { assertResourceMetadataSelectionsForTenant } from './resourceMetadataValidationService.js';
import {
  buildResourceAccessCondition,
  RESOURCE_ACCESS_MODES,
} from './resourceAccessService.js';
import { getResourceChildContentService } from './resourceChildContentService.js';

export const getResourcesWithRelations = (
  qb,
  tenants,
  includePending = false
) => {
  return qb
    .select({
      id: resources.id,
      url: resources.url,
      name: resources.name,
      description: resources.description,
      resourceDate: resources.resourceDate,
      resourceUpdatedDate: resources.resourceUpdatedDate,
      buttonName: resources.buttonName,
      targetAudienceId: resources.targetAudienceId,
      requiresRegistration: resources.requiresRegistration,
      videoUrl: resources.videoUrl,
      videoKey: resources.videoKey,
      videoMetadata: resources.videoMetadata,
      imageKey: resources.imageKey,
      imageMetadata: resources.imageMetadata,
      createdAt: resources.createdAt,
      updatedAt: resources.updatedAt,
      featured: resources.featured,
      listOrder: resources.listOrder,
      resourceType: resourceTypes,
      type: sql`'resource'`,
      sensitivityLevel: sensitivityLevels,
      expertiseLevel: expertiseLevels,
      addedByUserId: resources.addedByUserId,
      tenantId: resources.tenantId,
      status: resources.status,
      organizations: sql`
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'name', o.name,
                'imageUrl', o.image_url,
                'imageKey', o.image_key
              )
            )
            FROM organization_resources or_link
            JOIN organizations o ON o.id = or_link.organization_id
            WHERE or_link.resource_id = ${resources.id}
          ),
          '[]'::jsonb
        )
      `,
      timestamps: resources.timestamps,
      fullText: resources.fullText,
    })
    .from(resources)
    .leftJoin(resourceTypes, eq(resources.typeId, resourceTypes.id))
    .leftJoin(
      sensitivityLevels,
      eq(resources.sensitivityLevelId, sensitivityLevels.id)
    )
    .leftJoin(
      expertiseLevels,
      eq(resources.expertiseLevelId, expertiseLevels.id)
    )
    .where(
      and(
        inArray(resources.tenantId, tenants),
        // Filter out pending resources unless explicitly requested
        includePending ? sql`1 = 1` : sql`${resources.status} = 'approved'`
      )
    );
};

export async function createResourceService(data) {
  try {
    const normalizedTagIds = Array.isArray(data.tags)
      ? data.tags
          .map((tag) => (typeof tag === 'object' ? tag?.id : tag))
          .filter((tagId) => tagId !== null && tagId !== undefined)
      : [];

    await assertResourceMetadataSelectionsForTenant({
      tenantId: data.tenantId,
      typeId: data.typeId,
      tagIds: normalizedTagIds,
      userId: data.addedByUserId,
    });

    // Only include fields that match your database schema
    const cleanedData = {
      url: data.url,
      name: data.name,
      resourceDate: data.resourceDate,
      resourceUpdatedDate: data.resourceUpdatedDate,
      buttonName: data.buttonName,
      targetAudienceId: data.targetAudienceId,
      requiresRegistration: data.requiresRegistration,
      videoUrl: data.videoUrl,
      videoKey: data.videoKey,
      videoMetadata: data.videoMetadata,
      imageKey: data.imageKey,
      imageMetadata: data.imageMetadata,
      typeId: data.typeId, // use typeId instead of resourceType
      sensitivityLevelId: data.sensitivityLevelId, // use the Id fields
      expertiseLevelId: data.expertiseLevelId,
      addedByUserId: data.addedByUserId,
      description: data.description,
      featured: data.featured,
      listOrder: data.listOrder,
      timestamps: data.timestamps,
      fullText: data.fullText,
      tenantId: data.tenantId,
    };

    // Remove any undefined or null values (optional)
    Object.keys(cleanedData).forEach(
      (key) => cleanedData[key] === undefined && delete cleanedData[key]
    );

    return await db.transaction(async (tx) => {
      const [resource] = await tx
        .insert(resources)
        .values(cleanedData)
        .returning();

      // Handle tags
      if (normalizedTagIds.length > 0) {
        await Promise.all(
          normalizedTagIds.map((tagId) =>
            tx.insert(resourceTags).values({
              resourceId: resource.id,
              tagId,
            })
          )
        );
      }

      // Handle organizations
      if (data.organizations) {
        await Promise.all(
          data.organizations.map((organizationId) =>
            tx.insert(organizationResources).values({
              resourceId: resource.id,
              organizationId,
            })
          )
        );
      }

      // Keep embedding generation attached to the service so all creation
      // paths (UI, bulk import, AI) get indexed for semantic search.
      setTimeout(() => {
        autoUpdateResourceEmbedding(resource.id).catch((embeddingError) => {
          console.warn(
            'Failed to update resource embeddings after create:',
            embeddingError
          );
        });
      }, 0);

      return resource;
    });
  } catch (error) {
    console.error('Error creating resource:', error);
    throw new Error(error.message || 'Failed to create resource');
  }
}

export async function deleteResourcesService(resourceIds, options = {}) {
  const ids = Array.isArray(resourceIds) ? resourceIds : [resourceIds];
  const normalizedIds = [...new Set(ids.filter(Boolean))];

  if (normalizedIds.length === 0) {
    return [];
  }

  const conditions = [inArray(resources.id, normalizedIds)];

  if (options.tenantId) {
    conditions.push(eq(resources.tenantId, options.tenantId));
  }

  return await db.transaction(async (tx) => {
    const existingResources = await tx
      .select({
        id: resources.id,
        name: resources.name,
      })
      .from(resources)
      .where(and(...conditions));

    const existingIds = existingResources.map((resource) => resource.id);

    if (existingIds.length === 0) {
      return [];
    }

    await tx
      .delete(collectionExternalLinkResources)
      .where(inArray(collectionExternalLinkResources.resourceId, existingIds));

    await tx
      .delete(resourceAttachments)
      .where(inArray(resourceAttachments.resourceId, existingIds));

    await tx
      .delete(collectionResources)
      .where(inArray(collectionResources.resourceId, existingIds));

    await tx
      .delete(resourceRatings)
      .where(inArray(resourceRatings.resourceId, existingIds));

    await tx
      .delete(organizationResources)
      .where(inArray(organizationResources.resourceId, existingIds));

    await tx
      .delete(resourceTags)
      .where(inArray(resourceTags.resourceId, existingIds));

    return await tx
      .delete(resources)
      .where(and(...conditions))
      .returning();
  });
}

export async function deleteResourceService(id) {
  const deletedResources = await deleteResourcesService(id);
  return deletedResources[0];
}

export async function updateResourceService(
  resourceId,
  data,
  tenantIds,
  actingUserId = null
) {
  try {
    const orgsToAdd = Array.isArray(data.orgsToAdd) ? data.orgsToAdd : [];
    const organizationsToRemove = Array.isArray(data.organizationsToRemove)
      ? data.organizationsToRemove
      : [];

    // Remove fields that should not be in the update data
    const {
      orgsToAdd: _orgsToAdd,
      organizationsToRemove: _organizationsToRemove,
      tags: _tags,
      updatedAt: _updatedAt,
      createdAt: _createdAt,
      organizations: _organizations,
      logoUrl: _logoUrl,
      ...cleanData
    } = data;

    // First get the current resource to get the addedByUserId
    const [currentResource] = await db
      .select({
        addedByUserId: resources.addedByUserId,
        tenantId: resources.tenantId,
        typeId: resources.typeId,
      })
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);

    if (!currentResource) {
      console.error(`Resource not found for update: ${resourceId}`);
      throw new Error('Resource not found');
    }

    const tenantIdForValidation = cleanData.tenantId || currentResource.tenantId;
    const typeIdForValidation =
      cleanData.typeId !== undefined ? cleanData.typeId : currentResource.typeId;
    let tagIdsForValidation = null;

    if (data.tags !== undefined) {
      tagIdsForValidation = data.tags.map((tagId) =>
        typeof tagId === 'object' ? tagId.id : tagId
      );
    } else if (cleanData.tenantId && cleanData.tenantId !== currentResource.tenantId) {
      const existingTags = await db
        .select({ tagId: resourceTags.tagId })
        .from(resourceTags)
        .where(eq(resourceTags.resourceId, resourceId));
      tagIdsForValidation = existingTags.map((tag) => tag.tagId);
    }

    if (
      cleanData.typeId !== undefined ||
      data.tags !== undefined ||
      (cleanData.tenantId && cleanData.tenantId !== currentResource.tenantId)
    ) {
      await assertResourceMetadataSelectionsForTenant({
        tenantId: tenantIdForValidation,
        typeId: typeIdForValidation,
        tagIds: tagIdsForValidation || [],
        userId: actingUserId || currentResource.addedByUserId,
      });
    }

    await db.transaction(async (tx) => {
      // Handle organizations removal
      if (organizationsToRemove.length > 0) {
        await tx.execute(
          sql`DELETE FROM organization_resources 
              WHERE resource_id = ${resourceId} 
              AND organization_id = ANY(ARRAY[${sql.join(
                organizationsToRemove
              )}]::uuid[])`
        );
      }

      // Handle organizations addition
      if (orgsToAdd.length > 0) {
        await tx.execute(
          sql`INSERT INTO organization_resources (resource_id, organization_id)
              SELECT ${resourceId}, unnest(ARRAY[${sql.join(
                orgsToAdd
              )}]::uuid[])
              ON CONFLICT DO NOTHING`
        );
      }

      // Handle tags if they're provided
      if (data.tags !== undefined) {
        await tx
          .delete(resourceTags)
          .where(eq(resourceTags.resourceId, resourceId));

        if (data.tags && data.tags.length > 0) {
          await tx.insert(resourceTags).values(
            data.tags.map((tagId) => ({
              resourceId: resourceId,
              tagId: typeof tagId === 'object' ? tagId.id : tagId,
            }))
          );
        }
      }

      // Update the resource
      await tx
        .update(resources)
        .set({
          ...cleanData,
          updatedAt: new Date(),
        })
        .where(eq(resources.id, resourceId));
    });

    // Fetch the updated resource with all relations

    const updatedResource = await getResourceByIdService(
      resourceId,
      currentResource.addedByUserId,
      tenantIds
    );

    if (!updatedResource) {
      console.error(`Failed to fetch updated resource: ${resourceId}`);
      console.error(
        `UserId: ${currentResource.addedByUserId}, TenantIds: ${JSON.stringify(tenantIds)}`
      );
      console.error(
        `KIDNEY_TENANT_ID: ${process.env.KIDNEY_TENANT_ID}, COMMUNITY_TENANT: ${process.env.COMMUNITY_TENANT}`
      );
    }

    return updatedResource;
  } catch (error) {
    console.error('Error in updateResourceService:', error);
    throw error;
  }
}

export const getAllResources = async (
  dbUserId,
  filterDate = null,
  tenants,
  includePending = false
) => {
  const accessMode = dbUserId
    ? RESOURCE_ACCESS_MODES.AUTHENTICATED
    : RESOURCE_ACCESS_MODES.PUBLIC;

  // Build query directly without double filtering
  let query = db
    .select({
      id: resources.id,
      url: resources.url,
      name: resources.name,
      description: resources.description,
      resourceDate: resources.resourceDate,
      resourceUpdatedDate: resources.resourceUpdatedDate,
      buttonName: resources.buttonName,
      targetAudienceId: resources.targetAudienceId,
      requiresRegistration: resources.requiresRegistration,
      videoUrl: resources.videoUrl,
      videoKey: resources.videoKey,
      videoMetadata: resources.videoMetadata,
      imageKey: resources.imageKey,
      imageMetadata: resources.imageMetadata,
      createdAt: resources.createdAt,
      updatedAt: resources.updatedAt,
      featured: resources.featured,
      listOrder: resources.listOrder,
      resourceType: resourceTypes,
      type: sql`'resource'`,
      sensitivityLevel: sensitivityLevels,
      expertiseLevel: expertiseLevels,
      addedByUserId: resources.addedByUserId,
      tenantId: resources.tenantId,
      status: resources.status,
      organizations: sql`
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'name', o.name,
                'imageUrl', o.image_url,
                'imageKey', o.image_key
              )
            )
            FROM organization_resources or_link
            JOIN organizations o ON o.id = or_link.organization_id
            WHERE or_link.resource_id = ${resources.id}
          ),
          '[]'::jsonb
        )
      `,
      timestamps: resources.timestamps,
      fullText: resources.fullText,
    })
    .from(resources)
    .leftJoin(resourceTypes, eq(resources.typeId, resourceTypes.id))
    .leftJoin(
      sensitivityLevels,
      eq(resources.sensitivityLevelId, sensitivityLevels.id)
    )
    .leftJoin(
      expertiseLevels,
      eq(resources.expertiseLevelId, expertiseLevels.id)
    )
    .where(
      and(
        buildResourceAccessCondition({
          accessMode,
          userId: dbUserId,
          tenantIds: tenants,
          resourceTable: resources,
        }),
        // Filter out pending resources unless explicitly requested (for admins)
        includePending ? sql`1 = 1` : sql`${resources.status} = 'approved'`
      )
    );

  // Add date filter if filterDate is provided
  if (filterDate) {
    query = query.where(sql`${resources.updatedAt} >= ${filterDate}`);
  }

  const resourcesData = await query;

  if (resourcesData.length === 0) {
    return [];
  }

  // Get all resource ratings in a single query
  const resourceRatings = await getResourceRatingService(
    resourcesData.map((r) => r.id),
    tenants
  );

  // Fetch tags for all resources
  const resourceIds = resourcesData.map((r) => r.id);

  let tagsData = [];
  if (resourceIds.length > 0) {
    tagsData = await db
      .select({
        resourceId: resourceTags.resourceId,
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(resourceTags)
      .leftJoin(tags, eq(resourceTags.tagId, tags.id))
      .where(inArray(resourceTags.resourceId, resourceIds));
  }

  // Default rating object for resources without ratings
  const defaultRating = { rating: 0, count: 0 };

  // Combine resources with their tags and ratings
  return resourcesData.map((resource) => {
    // Generate presigned URL for resource image
    const imageUrl = resource.imageKey
      ? generatePresignedCloudFrontUrl(resource.imageKey)
      : null;

    return {
      ...resource,
      imageUrl,
      tags: tagsData
        .filter((tag) => tag.resourceId === resource.id)
        .map((t) => ({ id: t.tagId, name: t.tagName })),
      rating: resourceRatings[resource.id] || defaultRating,
      sensitivityLevel: resourceRatings[resource.id]?.rating || 0,
    };
  });
};

export async function getResourceByIdService(id, userId, tenants, options = {}) {
  try {
    const {
      accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
      includeChildren = false,
      bypassAccessCheck = false,
      childAccessMode = accessMode,
      childViewerUserId = userId,
    } = options;

    // Ensure tenants is an array
    if (!tenants || !Array.isArray(tenants) || tenants.length === 0) {
      // If no tenants provided, we can't fetch any resources
      console.error('No tenants provided to getResourceByIdService');
      return null;
    }

    // Build the query with tenant filtering built into getResourcesWithRelations
    let query = getResourcesWithRelations(db, tenants);

    // Add resource ID filter
    const whereConditions = [eq(resources.id, id)];

    if (!bypassAccessCheck) {
      whereConditions.push(
        buildResourceAccessCondition({
          accessMode,
          userId,
          tenantIds: tenants,
          resourceTable: resources,
        })
      );
    }

    const [resource] = await query.where(and(...whereConditions));

    if (!resource) {
      return resource;
    }

    // Generate presigned URL for resource image
    if (resource.imageKey) {
      resource.imageUrl = generatePresignedCloudFrontUrl(resource.imageKey);
    }

    // get the image url for each organization
    resource.organizations.forEach((organization) => {
      organization.imageUrl = generatePresignedCloudFrontUrl(
        organization.imageKey
      );
    });

    // Fetch tags for this resource
    const tagsData = await db
      .select({
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(resourceTags)
      .leftJoin(tags, eq(resourceTags.tagId, tags.id))
      .where(eq(resourceTags.resourceId, id));

    const hydratedResource = {
      ...resource,
      tags: tagsData.map((t) => ({ id: t.tagId, name: t.tagName })),
    };

    if (!includeChildren) {
      return hydratedResource;
    }

    return await getResourceChildContentService(hydratedResource, {
      viewerUserId: childViewerUserId,
      accessMode: childAccessMode,
    });
  } catch (error) {
    console.error('Error fetching resource by ID:', error);
    throw new Error(`Failed to fetch resource with ID: ${id}`);
  }
}

export async function getResourcesByOrganizationIdService(
  organizationId,
  userId,
  tenants
) {
  try {
    if (!Array.isArray(tenants) || tenants.length === 0) {
      return [];
    }

    const visibilityConditions = [
      inArray(resources.tenantId, tenants),
      sql`(
        CASE 
          WHEN ${resources.tenantId} = ${process.env.COMMUNITY_TENANT}::uuid THEN ${resources.addedByUserId} = ${userId}
          ELSE 1 = 1
        END
      )`,
      sql`${resources.status} = 'approved'`,
    ];

    const organizationCondition =
      organizationId === UNASSIGNED_ORGANIZATION_ID
        ? sql`NOT EXISTS (
            SELECT 1
            FROM organization_resources or_link
            WHERE or_link.resource_id = ${resources.id}
          )`
        : sql`EXISTS (
            SELECT 1
            FROM organization_resources or_link
            WHERE or_link.resource_id = ${resources.id}
              AND or_link.organization_id = ${organizationId}
          )`;

    const resourcesList = await db
      .select({
        id: resources.id,
        url: resources.url,
        name: resources.name,
        description: resources.description,
        resourceDate: resources.resourceDate,
        resourceUpdatedDate: resources.resourceUpdatedDate,
        buttonName: resources.buttonName,
        targetAudienceId: resources.targetAudienceId,
        requiresRegistration: resources.requiresRegistration,
        videoUrl: resources.videoUrl,
        videoKey: resources.videoKey,
        videoMetadata: resources.videoMetadata,
        imageKey: resources.imageKey,
        imageMetadata: resources.imageMetadata,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
        featured: resources.featured,
        listOrder: resources.listOrder,
        resourceType: resourceTypes,
        type: sql`'resource'`,
        sensitivityLevel: sensitivityLevels,
        expertiseLevel: expertiseLevels,
        addedByUserId: resources.addedByUserId,
        tenantId: resources.tenantId,
        status: resources.status,
        organizations: sql`
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', o.id,
                  'name', o.name,
                  'imageUrl', o.image_url,
                  'imageKey', o.image_key
                )
              )
              FROM organization_resources or_link
              JOIN organizations o ON o.id = or_link.organization_id
              WHERE or_link.resource_id = ${resources.id}
            ),
            '[]'::jsonb
          )
        `,
        timestamps: resources.timestamps,
        fullText: resources.fullText,
      })
      .from(resources)
      .leftJoin(resourceTypes, eq(resources.typeId, resourceTypes.id))
      .leftJoin(
        sensitivityLevels,
        eq(resources.sensitivityLevelId, sensitivityLevels.id)
      )
      .leftJoin(
        expertiseLevels,
        eq(resources.expertiseLevelId, expertiseLevels.id)
      )
      .where(and(...visibilityConditions, organizationCondition));

    if (resourcesList.length === 0) {
      return [];
    }

    // Fetch tags for these resources
    const tagsData = await db
      .select({
        resourceId: resourceTags.resourceId,
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(resourceTags)
      .leftJoin(tags, eq(resourceTags.tagId, tags.id))
      .where(inArray(resourceTags.resourceId, resourcesList.map((r) => r.id)));

    // get the resource ratings
    const resourceRatings = await getResourceRatingService(
      resourcesList.map((r) => r.id),
      tenants
    );

    // Combine resources with their tags
    const resourcesWithTags = resourcesList.map((resource) => {
      const resourceTags = tagsData
        .filter((tag) => tag.resourceId === resource.id)
        .map((t) => ({ id: t.tagId, name: t.tagName }));

      // Generate presigned URLs for organization images
      resource.organizations.forEach((organization) => {
        organization.imageUrl = organization.imageKey
          ? generatePresignedCloudFrontUrl(organization.imageKey)
          : null;
      });

      return {
        ...resource,
        imageUrl: resource.imageKey
          ? generatePresignedCloudFrontUrl(resource.imageKey)
          : null,
        tags: resourceTags,
        sensitivityLevel: resourceRatings[resource.id]?.rating || null,
        rating: resourceRatings[resource.id] || null,
      };
    });

    return resourcesWithTags;
  } catch (error) {
    console.error('Error fetching resources by organization ID:', error);
    throw new Error(
      `Failed to fetch resources with organization ID: ${organizationId}`
    );
  }
}

export async function getResourcesByCollectionIdService(collectionId) {
  try {
    // Get collection details
    const [collection] = await db
      .select()
      .from(collections)
      .where(eq(collections.id, collectionId));

    if (!collection) {
      throw new Error(`Collection with ID ${collectionId} not found`);
    }

    // Update to include notes in the collection resources query
    const collectionResourceIds = await db
      .select({
        resourceId: collectionResources.resourceId,
        userAddedById: collectionResources.userAddedById,
        notes: collectionResources.notes,
      })
      .from(collectionResources)
      .where(eq(collectionResources.collectionId, collectionId))
      .orderBy(collectionResources.orderPosition);

    if (collectionResourceIds.length === 0) {
      return {
        collection,
        resources: [],
      };
    }

    const allResources = await getAllResources();
    const resourcesInCollection = allResources
      .filter((resource) =>
        collectionResourceIds.some((cr) => cr.resourceId === resource.id)
      )
      .sort((a, b) => {
        const aIndex = collectionResourceIds.findIndex(
          (cr) => cr.resourceId === a.id
        );
        const bIndex = collectionResourceIds.findIndex(
          (cr) => cr.resourceId === b.id
        );
        return aIndex - bIndex;
      })
      .map((resource) => {
        const collectionResource = collectionResourceIds.find(
          (cr) => cr.resourceId === resource.id
        );
        return {
          ...resource,
          userAddedById: collectionResource?.userAddedById,
          notes: collectionResource?.notes,
        };
      });

    return {
      collection,
      resources: resourcesInCollection,
    };
  } catch (error) {
    console.error('Error fetching resources by collection ID:', error);
    throw new Error(
      `Failed to fetch resources with collection ID: ${collectionId}`
    );
  }
}

export async function addResourceToCollectionService(
  collectionId,
  resourceId,
  notes,
  userId,
  organizationId
) {
  try {
    //do this all in a transaction
    await db.transaction(async (tx) => {
      // Create values object with required fields
      const values = {
        collectionId,
        resourceId,
        notes,
      };

      //first update the collection to set the updated_at date to now
      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, collectionId));

      // Only add optional fields if they are provided
      if (userId) values.userAddedById = userId;
      if (organizationId) values.organizationAddedById = organizationId;

      await tx.insert(collectionResources).values(values);
    });
  } catch (error) {
    console.error('Error adding resource to collection:', error);
    throw new Error('Failed to add resource to collection');
  }
}

export async function removeResourceFromCollectionService(
  collectionId,
  resourceId
) {
  try {
    await db
      .delete(collectionResources)
      .where(
        and(
          eq(collectionResources.collectionId, collectionId),
          eq(collectionResources.resourceId, resourceId)
        )
      );
  } catch (error) {
    console.error('Error removing resource from collection:', error);
    throw new Error('Failed to remove resource from collection');
  }
}

export async function getAllResourceCollectionsService(
  userId,
  filterDate = null
) {
  let query = db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      organizationId: collections.organizationId,
      visibility: collections.visibility,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      resourceCount: sql`count(${collectionResources.resourceId})::integer`,
    })
    .from(collections)
    .leftJoin(
      collectionResources,
      eq(collections.id, collectionResources.collectionId)
    )
    .where(
      and(
        or(
          eq(collections.userId, userId),
          eq(collections.visibility, 'public')
        ),
        eq(collections.type, 'resource')
      )
    );

  // Add date filter if filterDate is provided
  if (filterDate) {
    query = query.where(sql`${collections.updatedAt} >= ${filterDate}`);
  }

  return await query.groupBy(collections.id);
}

export const getCollectionResourceService = async (
  collectionId,
  resourceId
) => {
  const [result] = await db
    .select()
    .from(collectionResources)
    .where(
      and(
        eq(collectionResources.collectionId, collectionId),
        eq(collectionResources.resourceId, resourceId)
      )
    );
  return result;
};

export async function getResourcesBySubscriptionsService(userId, tenants) {
  try {
    // Calculate date 3 months ago from current date
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const resourcesResult = await getResourcesWithRelations(db)
      .innerJoin(
        organizationResources,
        eq(resources.id, organizationResources.resourceId)
      )
      .innerJoin(
        organizationMembers,
        eq(
          organizationResources.organizationId,
          organizationMembers.organizationId
        )
      )
      .where(
        and(
          eq(organizationMembers.userId, userId),
          // Filter resources created or updated within the last 3 months
          sql`GREATEST(${resources.createdAt}, ${resources.updatedAt}) >= ${threeMonthsAgo.toISOString()}::timestamp`,
          inArray(resources.tenantId, tenants)
        )
      );

    return resourcesResult;
  } catch (error) {
    console.error('Error fetching resources by subscriptions:', error);
    throw new Error('Failed to fetch resources');
  }
}

export async function getResourcesByIdsService(resourceIds, userId, tenants) {
  try {
    // Get resources with relations that match the IDs and tenant-specific visibility conditions
    const resourcesList = await getResourcesWithRelations(db, tenants).where(
      and(
        inArray(resources.id, resourceIds),
        buildResourceAccessCondition({
          accessMode: RESOURCE_ACCESS_MODES.AUTHENTICATED,
          userId,
          tenantIds: tenants,
          resourceTable: resources,
        }),
        inArray(resources.tenantId, tenants)
      )
    );

    // Fetch tags for these resources
    const tagsData = await db
      .select({
        resourceId: resourceTags.resourceId,
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(resourceTags)
      .leftJoin(tags, eq(resourceTags.tagId, tags.id))
      .where(
        sql`${resourceTags.resourceId} IN ${resourcesList.map((r) => r.id)}`
      );

    // Combine resources with their tags
    return resourcesList.map((resource) => ({
      ...resource,
      tags: tagsData
        .filter((tag) => tag.resourceId === resource.id)
        .map((t) => ({ id: t.tagId, name: t.tagName })),
    }));
  } catch (error) {
    console.error('Error fetching resources by IDs:', error);
    throw new Error('Failed to fetch resources');
  }
}

export const getBasicResourcesByIdsService = async (
  resourceIds,
  userId,
  tenants
) => {
  try {
    const results = await db
      .select({
        id: resources.id,
        name: resources.name,
        addedByUserId: resources.addedByUserId,
        category: resourceTypes.name,
        url: resources.url,
        videoUrl: resources.videoUrl,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
        timestamps: resources.timestamps,
      })
      .from(resources)
      .innerJoin(resourceTypes, eq(resources.typeId, resourceTypes.id))
      .where(
        and(
          inArray(resources.id, resourceIds),
          buildResourceAccessCondition({
            accessMode: RESOURCE_ACCESS_MODES.AUTHENTICATED,
            userId,
            tenantIds: tenants,
            resourceTable: resources,
          }),
          inArray(resources.tenantId, tenants)
        )
      );

    return results;
  } catch (error) {
    console.error('Error in getBasicResourcesByIdsService:', error);
    throw new Error('Failed to fetch resources');
  }
};

export async function getResourceRatingService(resourceIds, tenantIds) {
  try {
    // If single resourceId is passed, convert to array
    const ids = Array.isArray(resourceIds) ? resourceIds : [resourceIds];

    // Get ratings for all resources in a single query
    const ratings = await db
      .select({
        resourceId: resourceRatings.resourceId,
        rating: resourceRatings.rating,
        count: sql`count(*)::integer`,
      })
      .from(resourceRatings)
      .where(inArray(resourceRatings.resourceId, ids))
      .groupBy(resourceRatings.resourceId, resourceRatings.rating)
      .orderBy(
        resourceRatings.resourceId,
        sql`count(*) DESC, ${resourceRatings.rating} DESC`
      );

    // Process ratings to get the most common rating for each resource
    const ratingsByResource = {};

    // Initialize all requested resource IDs with default values
    ids.forEach((id) => {
      ratingsByResource[id] = {
        rating: 0,
        count: 0,
      };
    });

    // Group ratings by resource
    const groupedRatings = {};
    ratings.forEach((r) => {
      if (!groupedRatings[r.resourceId]) {
        groupedRatings[r.resourceId] = [];
      }
      groupedRatings[r.resourceId].push(r);
    });

    // For each resource, find the rating with the highest count
    Object.entries(groupedRatings).forEach(([resourceId, resourceRatings]) => {
      if (resourceRatings.length > 0) {
        // Sort by count (descending) and rating (descending)
        const sortedRatings = resourceRatings.sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count;
          return b.rating - a.rating;
        });

        ratingsByResource[resourceId] = {
          rating: sortedRatings[0].rating,
          count: sortedRatings[0].count,
        };
      }
    });

    // If a single resourceId was passed, return just that result
    return Array.isArray(resourceIds)
      ? ratingsByResource
      : ratingsByResource[resourceIds];
  } catch (error) {
    console.error('Error getting resource ratings:', error);
    throw new Error('Failed to get resource ratings');
  }
}

export async function rateResourceService(resourceId, user, ratingData) {
  try {
    const [existingRating] = await db
      .select()
      .from(resourceRatings)
      .where(
        and(
          eq(resourceRatings.resourceId, resourceId),
          eq(resourceRatings.ratingByUserId, user.id)
        )
      );

    let rating;
    if (existingRating) {
      // Update existing rating
      [rating] = await db
        .update(resourceRatings)
        .set({
          rating: ratingData.sensitivity,
          ratingNotes: ratingData.reason,
          ratingType: user.userRole,
          updatedAt: new Date(),
        })
        .where(eq(resourceRatings.id, existingRating.id))
        .returning();
    } else {
      // Create new rating
      [rating] = await db
        .insert(resourceRatings)
        .values({
          resourceId,
          rating: ratingData.sensitivity,
          ratingNotes: ratingData.reason,
          ratingType: user.userRole,
          ratingByUserId: user.id,
        })
        .returning();
    }

    // Get the most common rating after update
    const mostCommonRating = await getResourceRatingService(resourceId);

    if (mostCommonRating) {
      // Update the resource's sensitivity level
      await db
        .update(resources)
        .set({
          sensitivityLevelId: mostCommonRating.rating,
          updatedAt: new Date(),
        })
        .where(eq(resources.id, resourceId));
    }

    return rating;
  } catch (error) {
    console.error('Error rating resource:', error);
    throw new Error('Failed to rate resource');
  }
}

// Helper function to get or create system user for public submissions
async function getOrCreateSystemUser() {
  const SYSTEM_USER_EMAIL = 'system@contexlia.com';

  // Try to find existing system user
  let [systemUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, SYSTEM_USER_EMAIL))
    .limit(1);

  // If not found, create one
  if (!systemUser) {
    [systemUser] = await db
      .insert(users)
      .values({
        email: SYSTEM_USER_EMAIL,
        firstName: 'System',
        lastName: 'User',
        clerkUserId: 'system_user_' + Date.now(), // Unique placeholder
      })
      .returning();
  }

  return systemUser.id;
}

// Create a pending resource suggestion (public submission)
export async function createPendingResourceSuggestionService(data) {
  try {
    // Validate tenantId is provided (should be validated in controller, but double-check here)
    if (!data.tenantId) {
      throw new Error('Tenant ID is required for resource suggestions');
    }

    // Get default resource type (first available, or require it)
    const [defaultResourceType] = await db
      .select()
      .from(resourceTypes)
      .limit(1);

    if (!defaultResourceType) {
      throw new Error('No resource types available');
    }

    // Get default sensitivity and expertise levels (lowest/default)
    const [defaultSensitivity] = await db
      .select()
      .from(sensitivityLevels)
      .orderBy(sensitivityLevels.id)
      .limit(1);

    const [defaultExpertise] = await db
      .select()
      .from(expertiseLevels)
      .orderBy(expertiseLevels.id)
      .limit(1);

    // Get default target audience
    const [defaultTargetAudience] = await db
      .select()
      .from(targetAudiences)
      .limit(1);

    // Get or create system user if no user provided
    let addedByUserId = data.addedByUserId;
    if (!addedByUserId) {
      addedByUserId = await getOrCreateSystemUser();
    }

    // Create resource with pending status
    const cleanedData = {
      url: data.url,
      name: data.name,
      description: data.description || '',
      resourceDate: data.resourceDate || new Date().toISOString().split('T')[0],
      resourceUpdatedDate:
        data.resourceUpdatedDate || new Date().toISOString().split('T')[0],
      typeId: data.typeId || defaultResourceType.id,
      sensitivityLevelId: data.sensitivityLevelId || defaultSensitivity.id,
      expertiseLevelId: data.expertiseLevelId || defaultExpertise.id,
      targetAudienceId: data.targetAudienceId || defaultTargetAudience.id,
      addedByUserId: addedByUserId,
      tenantId: data.tenantId, // Use provided tenantId (validated in controller)
      status: 'pending', // Set status to pending
      suggestedByEmail: data.email || null, // Store email of person who suggested
    };

    return await db.transaction(async (tx) => {
      const [resource] = await tx
        .insert(resources)
        .values(cleanedData)
        .returning();

      return resource;
    });
  } catch (error) {
    console.error('Error creating pending resource suggestion:', error);
    throw new Error('Failed to create resource suggestion');
  }
}

// Get pending resources for admin review
export async function getPendingResourcesService(tenantIds) {
  try {
    const pendingResources = await db
      .select({
        id: resources.id,
        url: resources.url,
        name: resources.name,
        description: resources.description,
        resourceDate: resources.resourceDate,
        resourceUpdatedDate: resources.resourceUpdatedDate,
        buttonName: resources.buttonName,
        targetAudienceId: resources.targetAudienceId,
        requiresRegistration: resources.requiresRegistration,
        videoUrl: resources.videoUrl,
        videoKey: resources.videoKey,
        videoMetadata: resources.videoMetadata,
        imageKey: resources.imageKey,
        imageMetadata: resources.imageMetadata,
        createdAt: resources.createdAt,
        updatedAt: resources.updatedAt,
        featured: resources.featured,
        listOrder: resources.listOrder,
        resourceType: resourceTypes,
        type: sql`'resource'`,
        sensitivityLevel: sensitivityLevels,
        expertiseLevel: expertiseLevels,
        addedByUserId: resources.addedByUserId,
        tenantId: resources.tenantId,
        status: resources.status,
        suggestedByEmail: resources.suggestedByEmail,
        organizations: sql`
          COALESCE(
            (
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', o.id,
                  'name', o.name,
                  'imageUrl', o.image_url,
                  'imageKey', o.image_key
                )
              )
              FROM organization_resources or_link
              JOIN organizations o ON o.id = or_link.organization_id
              WHERE or_link.resource_id = ${resources.id}
            ),
            '[]'::jsonb
          )
        `,
        timestamps: resources.timestamps,
        fullText: resources.fullText,
      })
      .from(resources)
      .leftJoin(resourceTypes, eq(resources.typeId, resourceTypes.id))
      .leftJoin(
        sensitivityLevels,
        eq(resources.sensitivityLevelId, sensitivityLevels.id)
      )
      .leftJoin(
        expertiseLevels,
        eq(resources.expertiseLevelId, expertiseLevels.id)
      )
      .where(
        and(
          inArray(resources.tenantId, tenantIds),
          eq(resources.status, 'pending')
        )
      )
      .orderBy(resources.createdAt);

    // Fetch tags for all pending resources
    const resourceIds = pendingResources.map((r) => r.id);

    let tagsData = [];
    if (resourceIds.length > 0) {
      tagsData = await db
        .select({
          resourceId: resourceTags.resourceId,
          tagId: tags.id,
          tagName: tags.name,
        })
        .from(resourceTags)
        .leftJoin(tags, eq(resourceTags.tagId, tags.id))
        .where(inArray(resourceTags.resourceId, resourceIds));
    }

    return pendingResources.map((resource) => ({
      ...resource,
      tags: tagsData
        .filter((tag) => tag.resourceId === resource.id)
        .map((t) => ({ id: t.tagId, name: t.tagName })),
    }));
  } catch (error) {
    console.error('Error fetching pending resources:', error);
    throw new Error('Failed to fetch pending resources');
  }
}

// Approve or reject a pending resource
export async function reviewPendingResourceService(
  resourceId,
  status,
  reviewerId
) {
  try {
    if (!['approved', 'rejected'].includes(status)) {
      throw new Error('Invalid status. Must be "approved" or "rejected"');
    }

    const [updatedResource] = await db
      .update(resources)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(resources.id, resourceId))
      .returning();

    if (!updatedResource) {
      throw new Error('Resource not found');
    }

    return updatedResource;
  } catch (error) {
    console.error('Error reviewing pending resource:', error);
    throw new Error('Failed to review pending resource');
  }
}

// Example usage:
// const description = `
//   Some description
//   Timestamps
//   Microbiome at: 11:30
//   Another topic at 15:45
//   Final section at: 23:10
// `;
//
// Result:
// [
//   { title: "Microbiome", timestamp: 690, formattedTime: "11:30" },
//   { title: "Another topic", timestamp: 945, formattedTime: "15:45" },
//   { title: "Final section", timestamp: 1390, formattedTime: "23:10" }
// ]
