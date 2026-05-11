import { inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  resourceTypes,
  sensitivityLevels,
  expertiseLevels,
  eventTypes,
} from '../models/metadata.js';
import OpenAI from 'openai';
import { eq, and, ne, or } from 'drizzle-orm';
import { linkGroups } from '../models/linkGroup.js';
import { snakeToCamelCase } from '../utils/general.js';
import { resources } from '../models/resources.js';
import {
  buildResourceAccessCondition,
  buildResourceChildVisibilityCondition,
  RESOURCE_ACCESS_MODES,
} from './resourceAccessService.js';
import { getResourceLinkGroupsMapService } from './resourceChildContentService.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DEFAULT_LINKING_TYPE = 'external_link';

const normalizeLinkingType = (linkingType) =>
  linkingType === 'resource' ? 'resource' : DEFAULT_LINKING_TYPE;

const groupLinkGroupsByCategory = (items = []) =>
  items.reduce((acc, link) => {
    const category = link.category || 'other';
    acc[category] = acc[category] || [];
    acc[category].push(link);
    return acc;
  }, {});

export async function getAllResourceTypesService(tenantIds, userId = null) {
  try {
    const conditions = [sql`${resourceTypes.tenantId} IS NULL`];

    if (tenantIds && tenantIds.length > 0) {
      conditions.push(
        and(
          eq(resourceTypes.visibility, 'public'),
          inArray(resourceTypes.tenantId, tenantIds)
        )
      );
      conditions.push(
        and(
          eq(resourceTypes.visibility, 'tenant'),
          inArray(resourceTypes.tenantId, tenantIds)
        )
      );
    }

    if (userId) {
      if (tenantIds && tenantIds.length > 0) {
        conditions.push(
          and(
            eq(resourceTypes.visibility, 'private'),
            eq(resourceTypes.addedByUserId, userId),
            inArray(resourceTypes.tenantId, tenantIds)
          )
        );
      }
    }

    const result = await db
      .select()
      .from(resourceTypes)
      .where(or(...conditions))
      .orderBy(resourceTypes.name);
    return result;
  } catch (error) {
    console.error('Error fetching resource types:', error);
    throw new Error(`Failed to fetch resource types: ${error.message}`);
  }
}

const findDuplicateResourceType = async ({
  name,
  tenantId,
  excludeId = null,
}) => {
  if (!name?.trim()) {
    return null;
  }

  const duplicateConditions = [
    sql`LOWER(${resourceTypes.name}) = LOWER(${name.trim()})`,
    tenantId
      ? or(eq(resourceTypes.tenantId, tenantId), sql`${resourceTypes.tenantId} IS NULL`)
      : sql`${resourceTypes.tenantId} IS NULL`,
  ];

  if (excludeId !== null) {
    duplicateConditions.push(ne(resourceTypes.id, excludeId));
  }

  const [duplicate] = await db
    .select({
      id: resourceTypes.id,
      name: resourceTypes.name,
      tenantId: resourceTypes.tenantId,
    })
    .from(resourceTypes)
    .where(and(...duplicateConditions))
    .limit(1);

  return duplicate || null;
};

export async function getAllEventTypesService(tenantIds, userId) {
  try {
    // Get event types based on visibility rules:
    // 1. Public event types (visible to everyone)
    // 2. Tenant event types (visible to users in the same tenant)
    // 3. Private event types (visible only to the creator)
    const conditions = [];

    // Include public event types
    conditions.push(eq(eventTypes.visibility, 'public'));

    // Include tenant event types for user's tenants
    if (tenantIds && tenantIds.length > 0) {
      conditions.push(
        and(
          eq(eventTypes.visibility, 'tenant'),
          inArray(eventTypes.tenantId, tenantIds)
        )
      );
    }

    // Include user's private event types
    if (userId) {
      conditions.push(
        and(
          eq(eventTypes.visibility, 'private'),
          eq(eventTypes.addedByUserId, userId)
        )
      );
    }

    // Include global event types (where tenantId is null - legacy support)
    conditions.push(sql`${eventTypes.tenantId} IS NULL`);

    const result = await db
      .select()
      .from(eventTypes)
      .where(or(...conditions))
      .orderBy(eventTypes.name);

    return result;
  } catch (error) {
    console.error('Error fetching event types:', error);
    throw new Error(`Failed to fetch event types: ${error.message}`);
  }
}

export async function getAllSensitivityLevelsService() {
  try {
    const result = await db
      .select()
      .from(sensitivityLevels)
      .orderBy(sensitivityLevels.name);
    return result;
  } catch (error) {
    console.error('Error fetching sensitivity levels:', error);
    throw new Error(`Failed to fetch sensitivity levels: ${error.message}`);
  }
}

export async function getAllExpertiseLevelsService() {
  try {
    const result = await db
      .select()
      .from(expertiseLevels)
      .orderBy(expertiseLevels.name);
    return result;
  } catch (error) {
    console.error('Error fetching expertise levels:', error);
    throw new Error(`Failed to fetch expertise levels: ${error.message}`);
  }
}

export async function generateDescriptionService(
  prompt,
  currentContent,
  contextDetails
) {
  try {
    let systemPrompt =
      'You are a helpful assistant that writes clear, concise descriptions.';
    let userPrompt = '';

    if (contextDetails.type === 'event') {
      userPrompt = `Please write a description for an event with the following details:
- Title: ${contextDetails.title || 'N/A'}
- Date: ${contextDetails.startDate || 'N/A'}
- Time: ${contextDetails.startTime || 'N/A'}
- Type: ${contextDetails.eventType || 'N/A'}
- Format: ${contextDetails.virtualEvent ? 'Virtual' : ''} ${
        contextDetails.inPersonEvent ? 'In-Person' : ''
      }
${
  contextDetails.locationName
    ? `- Location: ${contextDetails.locationName}`
    : ''
}
${
  contextDetails.organizations?.length
    ? `- Organizations: ${contextDetails.organizations.join(', ')}`
    : ''
}
${
  contextDetails.tags?.length ? `- Tags: ${contextDetails.tags.join(', ')}` : ''
}

Additional instructions: ${prompt || 'Write a clear and engaging description'}

${currentContent ? `Current description: ${currentContent}` : ''}`;
    } else {
      userPrompt = `${prompt}\n${
        currentContent ? `Current content: ${currentContent}` : ''
      }`;
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error('Error generating description:', error);
    throw new Error(`Failed to generate description: ${error.message}`);
  }
}

export async function getAllLinkGroupsService(tenantIds = [], userId = null) {
  try {
    if (!userId) {
      return [];
    }

    const whereConditions = [eq(linkGroups.userId, userId)];

    if (Array.isArray(tenantIds) && tenantIds.length > 0) {
      whereConditions.push(inArray(linkGroups.tenantId, tenantIds));
    }

    const result = await db
      .select({
        id: linkGroups.id,
        date: linkGroups.date,
        name: linkGroups.name,
        description: linkGroups.description,
        url: linkGroups.url,
        category: linkGroups.category,
        linkingId: linkGroups.linkingId,
        linkingType: linkGroups.linkingType,
        visibility: linkGroups.visibility,
        userId: linkGroups.userId,
        organizationId: linkGroups.organizationId,
        tenantId: linkGroups.tenantId,
        createdAt: linkGroups.createdAt,
        updatedAt: linkGroups.updatedAt,
        vectorUpdatedAt: linkGroups.vectorUpdatedAt,
      })
      .from(linkGroups)
      .where(and(...whereConditions))
      .orderBy(linkGroups.name);
    return result;
  } catch (error) {
    console.error('Error fetching link groups:', error);
    throw new Error(`Failed to fetch link groups: ${error.message}`);
  }
}

export async function getLinkGroupByIdService(
  id,
  userId,
  tenantIds = [],
  options = {}
) {
  try {
    const linkingType = normalizeLinkingType(options.linkingType);

    if (linkingType === 'resource') {
      const [resource] = await db
        .select({
          id: resources.id,
          addedByUserId: resources.addedByUserId,
        })
        .from(resources)
        .where(
          and(
            eq(resources.id, id),
            eq(resources.status, 'approved'),
            buildResourceAccessCondition({
              accessMode: RESOURCE_ACCESS_MODES.AUTHENTICATED,
              userId,
              tenantIds,
              resourceTable: resources,
            })
          )
        )
        .limit(1);

      if (!resource) {
        return {};
      }

      const groupedLinks = await getResourceLinkGroupsMapService([id], {
        viewerUserId: userId,
        accessMode: RESOURCE_ACCESS_MODES.AUTHENTICATED,
        parentOwnersById: {
          [id]: resource.addedByUserId,
        },
      });

      return snakeToCamelCase(groupedLinks[id] || {});
    }

    const result = await db
      .select()
      .from(linkGroups)
      .where(
        and(
          eq(linkGroups.linkingId, id),
          eq(linkGroups.linkingType, linkingType),
          and(
            or(
              eq(linkGroups.visibility, 'public'),
              eq(linkGroups.visibility, 'unlisted'),
              and(
                eq(linkGroups.visibility, 'private'),
                eq(linkGroups.userId, userId)
              )
            )
          )
        )
      );

    const groupedLinks = groupLinkGroupsByCategory(result);

    return snakeToCamelCase(groupedLinks);
  } catch (error) {
    console.error('Error fetching link group:', error);
    throw new Error(`Failed to fetch link group: ${error.message}`);
  }
}

export async function getLinkGroupByIdServiceShared(
  id,
  options = {}
) {
  try {
    const linkingType = normalizeLinkingType(options.linkingType);

    if (linkingType === 'resource') {
      const [resource] = await db
        .select({
          id: resources.id,
          addedByUserId: resources.addedByUserId,
        })
        .from(resources)
        .where(and(eq(resources.id, id), eq(resources.status, 'approved')))
        .limit(1);

      if (!resource) {
        return {};
      }

      const groupedLinks = await getResourceLinkGroupsMapService([id], {
        viewerUserId: null,
        accessMode: RESOURCE_ACCESS_MODES.SHARED,
        parentOwnersById: {
          [id]: resource.addedByUserId,
        },
      });

      return snakeToCamelCase(groupedLinks[id] || {});
    }

    const result = await db
      .select()
      .from(linkGroups)
      .where(
        and(
          eq(linkGroups.linkingId, id),
          eq(linkGroups.linkingType, linkingType),
          and(
            or(
              eq(linkGroups.visibility, 'public'),
              eq(linkGroups.visibility, 'unlisted')
            )
          )
        )
      );

    const groupedLinks = groupLinkGroupsByCategory(result);

    return snakeToCamelCase(groupedLinks);
  } catch (error) {
    console.error('Error fetching link group:', error);
    throw new Error(`Failed to fetch link group: ${error.message}`);
  }
}

export async function getLinkGroupsByIdsService(
  linkGroupIds,
  userId,
  tenantIds = [],
  options = {}
) {
  try {
    const normalizedIds = Array.isArray(linkGroupIds)
      ? [...new Set(linkGroupIds.filter(Boolean))]
      : [linkGroupIds].filter(Boolean);

    if (normalizedIds.length === 0) {
      return [];
    }

    const accessMode =
      options.accessMode || RESOURCE_ACCESS_MODES.AUTHENTICATED;

    const externalLinkRows = await db
      .select({
        id: linkGroups.id,
        date: linkGroups.date,
        name: linkGroups.name,
        description: linkGroups.description,
        url: linkGroups.url,
        category: linkGroups.category,
        linkingId: linkGroups.linkingId,
        linkingType: linkGroups.linkingType,
        visibility: linkGroups.visibility,
        userId: linkGroups.userId,
        organizationId: linkGroups.organizationId,
        tenantId: linkGroups.tenantId,
        createdAt: linkGroups.createdAt,
        updatedAt: linkGroups.updatedAt,
      })
      .from(linkGroups)
      .where(
        and(
          inArray(linkGroups.id, normalizedIds),
          eq(linkGroups.linkingType, DEFAULT_LINKING_TYPE),
          or(
            userId ? eq(linkGroups.userId, userId) : sql`1 = 0`,
            and(
              inArray(linkGroups.visibility, ['public', 'unlisted']),
              Array.isArray(tenantIds) && tenantIds.length > 0
                ? inArray(linkGroups.tenantId, tenantIds)
                : sql`1 = 0`
            )
          )
        )
      );

    const resourceRows = await db
      .select({
        id: linkGroups.id,
        date: linkGroups.date,
        name: linkGroups.name,
        description: linkGroups.description,
        url: linkGroups.url,
        category: linkGroups.category,
        linkingId: linkGroups.linkingId,
        linkingType: linkGroups.linkingType,
        visibility: linkGroups.visibility,
        userId: linkGroups.userId,
        organizationId: linkGroups.organizationId,
        tenantId: linkGroups.tenantId,
        createdAt: linkGroups.createdAt,
        updatedAt: linkGroups.updatedAt,
      })
      .from(linkGroups)
      .innerJoin(resources, eq(linkGroups.linkingId, resources.id))
      .where(
        and(
          inArray(linkGroups.id, normalizedIds),
          eq(linkGroups.linkingType, 'resource'),
          eq(resources.status, 'approved'),
          buildResourceAccessCondition({
            accessMode,
            userId,
            tenantIds,
            resourceTable: resources,
          }),
          buildResourceChildVisibilityCondition({
            childVisibilityField: linkGroups.visibility,
            childOwnerField: linkGroups.userId,
            parentOwnerField: resources.addedByUserId,
            viewerUserId: userId,
            accessMode,
          })
        )
      );

    return [...externalLinkRows, ...resourceRows];
  } catch (error) {
    console.error('Error fetching link groups by IDs:', error);
    throw new Error(`Failed to fetch link groups by IDs: ${error.message}`);
  }
}

export async function getBasicLinkGroupsByIdsService(
  linkGroupIds,
  userId,
  tenantIds = [],
  options = {}
) {
  return getLinkGroupsByIdsService(linkGroupIds, userId, tenantIds, options);
}

export async function createLinkGroupService(linkGroupData) {
  try {
    const result = await db
      .insert(linkGroups)
      .values({
        ...linkGroupData,
        linkingType: normalizeLinkingType(linkGroupData.linkingType),
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Error creating link group:', error);
    throw new Error(`Failed to create link group: ${error.message}`);
  }
}

export async function updateLinkGroupService(id, linkGroupData, userId) {
  const { createdAt, updatedAt, ...cleanedLinkGroupData } = linkGroupData;

  try {
    const result = await db
      .update(linkGroups)
      .set({
        ...cleanedLinkGroupData,
        linkingType: cleanedLinkGroupData.linkingType
          ? normalizeLinkingType(cleanedLinkGroupData.linkingType)
          : undefined,
      })
      .where(
        and(
          eq(linkGroups.id, id),
          userId ? eq(linkGroups.userId, userId) : sql`1 = 1`
        )
      )
      .returning();
    return result[0];
  } catch (error) {
    console.error('Error updating link group:', error);
    throw new Error(`Failed to update link group: ${error.message}`);
  }
}

export async function deleteLinkGroupService(id, userId) {
  try {
    const result = await db
      .delete(linkGroups)
      .where(and(eq(linkGroups.id, id), eq(linkGroups.userId, userId)));
    return result;
  } catch (error) {
    console.error('Error deleting link group:', error);
    throw new Error(`Failed to delete link group: ${error.message}`);
  }
}

export async function patchLinkGroupService(id, linkGroupData, userId) {
  try {
    const result = await db
      .update(linkGroups)
      .set({
        ...linkGroupData,
        linkingType: linkGroupData.linkingType
          ? normalizeLinkingType(linkGroupData.linkingType)
          : undefined,
      })
      .where(
        and(
          eq(linkGroups.id, id),
          userId ? eq(linkGroups.userId, userId) : sql`1 = 1`
        )
      )
      .returning();
    return result[0];
  } catch (error) {
    console.error('Error patching link group:', error);
    throw new Error(`Failed to patch link group: ${error.message}`);
  }
}

// Event Type CRUD operations
export async function createEventTypeService(eventTypeData, tenantIds, userId) {
  try {
    // Use tenantId from request body if provided, otherwise use the first tenant ID from auth
    const tenantId =
      eventTypeData.tenantId ||
      (tenantIds && tenantIds.length > 0 ? tenantIds[0] : null);

    const result = await db
      .insert(eventTypes)
      .values({
        name: eventTypeData.name,
        description: eventTypeData.description,
        tenantId: tenantId,
        addedByUserId: userId,
        visibility: eventTypeData.visibility || 'tenant', // Default to tenant visibility
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Error creating event type:', error);
    throw new Error(`Failed to create event type: ${error.message}`);
  }
}

export async function createResourceTypeService(
  resourceTypeData,
  tenantIds,
  userId
) {
  try {
    const tenantId =
      resourceTypeData.tenantId ||
      (tenantIds && tenantIds.length > 0 ? tenantIds[0] : null);

    if (!tenantId) {
      throw new Error('Tenant ID is required to create a resource type');
    }

    if (!tenantIds || !tenantIds.includes(tenantId)) {
      throw new Error('Unauthorized to create a resource type for this tenant');
    }

    const duplicate = await findDuplicateResourceType({
      name: resourceTypeData.name,
      tenantId,
    });

    if (duplicate) {
      throw new Error('A resource type with this name already exists');
    }

    const result = await db
      .insert(resourceTypes)
      .values({
        name: resourceTypeData.name?.trim(),
        description: resourceTypeData.description,
        tenantId,
        addedByUserId: userId,
        visibility: resourceTypeData.visibility || 'tenant',
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Error creating resource type:', error);
    throw new Error(`Failed to create resource type: ${error.message}`);
  }
}

export async function updateResourceTypeService(
  id,
  resourceTypeData,
  tenantIds
) {
  try {
    const [existingResourceType] = await db
      .select()
      .from(resourceTypes)
      .where(eq(resourceTypes.id, id))
      .limit(1);

    if (!existingResourceType) {
      throw new Error('Resource type not found');
    }

    if (
      existingResourceType.tenantId &&
      (!tenantIds || !tenantIds.includes(existingResourceType.tenantId))
    ) {
      throw new Error('Unauthorized to update this resource type');
    }

    const duplicate = await findDuplicateResourceType({
      name: resourceTypeData.name,
      tenantId: existingResourceType.tenantId,
      excludeId: Number(id),
    });

    if (duplicate) {
      throw new Error('A resource type with this name already exists');
    }

    const result = await db
      .update(resourceTypes)
      .set({
        name: resourceTypeData.name?.trim(),
        description: resourceTypeData.description,
        visibility:
          resourceTypeData.visibility ?? existingResourceType.visibility,
        updatedAt: new Date(),
      })
      .where(eq(resourceTypes.id, id))
      .returning();

    return result[0];
  } catch (error) {
    console.error('Error updating resource type:', error);
    throw new Error(`Failed to update resource type: ${error.message}`);
  }
}

export async function deleteResourceTypeService(id, tenantIds) {
  try {
    const [existingResourceType] = await db
      .select()
      .from(resourceTypes)
      .where(eq(resourceTypes.id, id))
      .limit(1);

    if (!existingResourceType) {
      throw new Error('Resource type not found');
    }

    if (
      existingResourceType.tenantId &&
      (!tenantIds || !tenantIds.includes(existingResourceType.tenantId))
    ) {
      throw new Error('Unauthorized to delete this resource type');
    }

    return await db.delete(resourceTypes).where(eq(resourceTypes.id, id));
  } catch (error) {
    console.error('Error deleting resource type:', error);
    throw new Error(`Failed to delete resource type: ${error.message}`);
  }
}

export async function updateEventTypeService(id, eventTypeData, tenantIds) {
  try {
    // Verify the event type belongs to one of the user's tenants
    const existingEventType = await db
      .select()
      .from(eventTypes)
      .where(eq(eventTypes.id, id))
      .limit(1);

    if (!existingEventType.length) {
      throw new Error('Event type not found');
    }

    // Check authorization
    if (
      existingEventType[0].tenantId &&
      (!tenantIds || !tenantIds.includes(existingEventType[0].tenantId))
    ) {
      throw new Error('Unauthorized to update this event type');
    }

    const result = await db
      .update(eventTypes)
      .set({
        name: eventTypeData.name,
        description: eventTypeData.description,
        updatedAt: new Date(),
      })
      .where(eq(eventTypes.id, id))
      .returning();

    return result[0];
  } catch (error) {
    console.error('Error updating event type:', error);
    throw new Error(`Failed to update event type: ${error.message}`);
  }
}

export async function deleteEventTypeService(id, tenantIds) {
  try {
    // Verify the event type belongs to one of the user's tenants
    const existingEventType = await db
      .select()
      .from(eventTypes)
      .where(eq(eventTypes.id, id))
      .limit(1);

    if (!existingEventType.length) {
      throw new Error('Event type not found');
    }

    // Check authorization
    if (
      existingEventType[0].tenantId &&
      (!tenantIds || !tenantIds.includes(existingEventType[0].tenantId))
    ) {
      throw new Error('Unauthorized to delete this event type');
    }

    const result = await db.delete(eventTypes).where(eq(eventTypes.id, id));

    return result;
  } catch (error) {
    console.error('Error deleting event type:', error);
    throw new Error(`Failed to delete event type: ${error.message}`);
  }
}
