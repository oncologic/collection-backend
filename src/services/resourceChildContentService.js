import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { attachments } from '../models/attachments.js';
import { linkGroups } from '../models/linkGroup.js';
import { resourceAttachments } from '../models/resourceAttachments.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import {
  filterResourceChildItemsByVisibility,
  RESOURCE_ACCESS_MODES,
} from './resourceAccessService.js';

const groupLinkGroupsByCategory = (items = []) =>
  items.reduce((acc, item) => {
    const key = item.category || 'other';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});

export const getResourceAttachmentsMapService = async (
  resourceIds,
  {
    viewerUserId = null,
    accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
    parentOwnersById = {},
  } = {}
) => {
  const normalizedIds = [...new Set((resourceIds || []).filter(Boolean))];

  if (normalizedIds.length === 0) {
    return {};
  }

  const rows = await db
    .select({
      resourceId: resourceAttachments.resourceId,
      highlighted: resourceAttachments.highlighted,
      sortOrder: resourceAttachments.sortOrder,
      attachmentId: attachments.id,
      title: attachments.title,
      description: attachments.description,
      type: attachments.type,
      imageKey: attachments.imageKey,
      createdAt: attachments.createdAt,
      updatedAt: attachments.updatedAt,
      listOrder: attachments.listOrder,
      visibility: attachments.visibility,
      userId: attachments.userId,
      tenantId: attachments.tenantId,
    })
    .from(resourceAttachments)
    .innerJoin(attachments, eq(resourceAttachments.attachmentId, attachments.id))
    .where(inArray(resourceAttachments.resourceId, normalizedIds));

  return normalizedIds.reduce((acc, resourceId) => {
    const resourceAttachmentsForId = rows
      .filter((row) => row.resourceId === resourceId)
      .map((row) => ({
        id: row.attachmentId,
        title: row.title,
        description: row.description,
        type: row.type,
        imageKey: row.imageKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        listOrder: row.listOrder,
        visibility: row.visibility,
        userId: row.userId,
        tenantId: row.tenantId,
        resourceId: row.resourceId,
        highlighted: row.highlighted,
        sortOrder: row.sortOrder,
        presignedUrl: row.imageKey
          ? generatePresignedCloudFrontUrl(row.imageKey)
          : null,
      }));

    acc[resourceId] = filterResourceChildItemsByVisibility(
      resourceAttachmentsForId,
      {
        accessMode,
        parentOwnerId: parentOwnersById[resourceId] || null,
        viewerUserId,
      }
    ).sort((a, b) => {
      const sortDelta = (a.sortOrder || 0) - (b.sortOrder || 0);
      if (sortDelta !== 0) {
        return sortDelta;
      }

      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    return acc;
  }, {});
};

export const getResourceLinkGroupsMapService = async (
  resourceIds,
  {
    viewerUserId = null,
    accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
    parentOwnersById = {},
  } = {}
) => {
  const normalizedIds = [...new Set((resourceIds || []).filter(Boolean))];

  if (normalizedIds.length === 0) {
    return {};
  }

  const rows = await db
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
        eq(linkGroups.linkingType, 'resource'),
        inArray(linkGroups.linkingId, normalizedIds)
      )
    );

  return normalizedIds.reduce((acc, resourceId) => {
    const filteredRows = filterResourceChildItemsByVisibility(
      rows.filter((row) => row.linkingId === resourceId),
      {
        accessMode,
        parentOwnerId: parentOwnersById[resourceId] || null,
        viewerUserId,
      }
    );

    acc[resourceId] = groupLinkGroupsByCategory(filteredRows);
    return acc;
  }, {});
};

export const attachChildContentToResources = async (
  resourcesList,
  {
    viewerUserId = null,
    accessMode = RESOURCE_ACCESS_MODES.AUTHENTICATED,
  } = {}
) => {
  const normalizedResources = Array.isArray(resourcesList)
    ? resourcesList.filter(Boolean)
    : [];

  if (normalizedResources.length === 0) {
    return [];
  }

  const resourceIds = normalizedResources.map((resource) => resource.id);
  const parentOwnersById = normalizedResources.reduce((acc, resource) => {
    acc[resource.id] = resource.addedByUserId || null;
    return acc;
  }, {});

  const [attachmentsMap, linkGroupsMap] = await Promise.all([
    getResourceAttachmentsMapService(resourceIds, {
      viewerUserId,
      accessMode,
      parentOwnersById,
    }),
    getResourceLinkGroupsMapService(resourceIds, {
      viewerUserId,
      accessMode,
      parentOwnersById,
    }),
  ]);

  return normalizedResources.map((resource) => ({
    ...resource,
    attachments: attachmentsMap[resource.id] || [],
    linkGroups: linkGroupsMap[resource.id] || {},
  }));
};

export const getResourceChildContentService = async (
  resource,
  options = {}
) => {
  const [augmentedResource] = await attachChildContentToResources(
    resource ? [resource] : [],
    options
  );

  return augmentedResource || null;
};
