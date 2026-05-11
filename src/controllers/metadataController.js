import {
  getAllResourceTypesService,
  createResourceTypeService,
  updateResourceTypeService,
  deleteResourceTypeService,
  getAllSensitivityLevelsService,
  getAllExpertiseLevelsService,
  getAllEventTypesService,
  createEventTypeService,
  updateEventTypeService,
  deleteEventTypeService,
  getAllLinkGroupsService,
  getLinkGroupByIdService,
  createLinkGroupService,
  updateLinkGroupService,
  deleteLinkGroupService,
  patchLinkGroupService,
} from '../services/metadataService.js';
import { getExternalLinkByIdService } from '../services/collectionService.js';
import { getResourceByIdService } from '../services/resourceService.js';
import { canEditOrDeleteItem } from '../utils/authHelpers.js';
import { db } from '../db/index.js';
import { linkGroups } from '../models/linkGroup.js';
import { and, eq } from 'drizzle-orm';

const resolveLinkGroupParentContext = async (
  req,
  linkingId,
  linkingType,
  tenantIds,
  userId
) => {
  const normalizedLinkingType =
    linkingType === 'resource' ? 'resource' : 'external_link';

  if (!linkingId) {
    const error = new Error('linkingId is required');
    error.status = 400;
    throw error;
  }

  if (normalizedLinkingType === 'resource') {
    const resource = await getResourceByIdService(linkingId, userId, tenantIds);

    if (!resource) {
      const error = new Error('Resource not found');
      error.status = 404;
      throw error;
    }

    if (!canEditOrDeleteItem(req, resource)) {
      const error = new Error(
        'Forbidden: You must be an admin, advocate, or the resource creator to manage resource link groups'
      );
      error.status = 403;
      throw error;
    }

    return {
      linkingType: normalizedLinkingType,
      tenantId: resource.tenantId,
    };
  }

  const externalLink = await getExternalLinkByIdService(linkingId, userId);

  if (!externalLink) {
    const error = new Error('External link not found');
    error.status = 404;
    throw error;
  }

  return {
    linkingType: normalizedLinkingType,
    tenantId: externalLink.tenantId,
  };
};

export const metadataController = {
  async getAllResourceTypes(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId;
      const resourceTypes = await getAllResourceTypesService(tenantIds, userId);
      res.json(resourceTypes);
    } catch (error) {
      res.status(500).json({
        message: 'Error fetching resource types',
        error: error.message,
      });
    }
  },

  async createResourceType(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId;
      const resourceType = await createResourceTypeService(
        req.body,
        tenantIds,
        userId
      );
      res.status(201).json(resourceType);
    } catch (error) {
      res.status(500).json({
        message: 'Error creating resource type',
        error: error.message,
      });
    }
  },

  async updateResourceType(req, res) {
    try {
      const { id } = req.params;
      const tenantIds = req.tenantIds;
      const resourceType = await updateResourceTypeService(
        id,
        req.body,
        tenantIds
      );
      res.json(resourceType);
    } catch (error) {
      res.status(500).json({
        message: 'Error updating resource type',
        error: error.message,
      });
    }
  },

  async deleteResourceType(req, res) {
    try {
      const { id } = req.params;
      const tenantIds = req.tenantIds;
      await deleteResourceTypeService(id, tenantIds);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({
        message: 'Error deleting resource type',
        error: error.message,
      });
    }
  },

  async getAllEventTypes(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId;
      const eventTypes = await getAllEventTypesService(tenantIds, userId);
      res.json(eventTypes);
    } catch (error) {
      res.status(500).json({
        message: 'Error fetching event types',
        error: error.message,
      });
    }
  },

  async createEventType(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId;
      const eventType = await createEventTypeService(
        req.body,
        tenantIds,
        userId
      );
      res.status(201).json(eventType);
    } catch (error) {
      res.status(500).json({
        message: 'Error creating event type',
        error: error.message,
      });
    }
  },

  async updateEventType(req, res) {
    try {
      const { id } = req.params;
      const tenantIds = req.tenantIds;
      const eventType = await updateEventTypeService(id, req.body, tenantIds);
      res.json(eventType);
    } catch (error) {
      res.status(500).json({
        message: 'Error updating event type',
        error: error.message,
      });
    }
  },

  async deleteEventType(req, res) {
    try {
      const { id } = req.params;
      const tenantIds = req.tenantIds;
      await deleteEventTypeService(id, tenantIds);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({
        message: 'Error deleting event type',
        error: error.message,
      });
    }
  },
  async getAllSensitivityLevels(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const sensitivityLevels = await getAllSensitivityLevelsService(tenantIds);
      res.json(sensitivityLevels);
    } catch (error) {
      res.status(500).json({
        message: 'Error fetching sensitivity levels',
        error: error.message,
      });
    }
  },
  async getAllExpertiseLevels(req, res) {
    try {
      const expertiseLevels = await getAllExpertiseLevelsService();
      res.json(expertiseLevels);
    } catch (error) {
      res.status(500).json({
        message: 'Error fetching expertise levels',
        error: error.message,
      });
    }
  },

  async getAllLinkGroups(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId;
      const linkGroups = await getAllLinkGroupsService(tenantIds, userId);
      res.json(linkGroups);
    } catch (error) {
      res.status(500).json({
        message: 'Error fetching link groups',
        error: error.message,
      });
    }
  },
  async getLinkGroupById(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const linkingType = req.query.linkingType || 'external_link';
      const linkGroup = await getLinkGroupByIdService(id, userId, tenantIds, {
        linkingType,
      });
      res.json(linkGroup);
    } catch (error) {
      res.status(500).json({
        message: 'Error fetching link group',
        error: error.message,
      });
    }
  },

  async createLinkGroup(req, res) {
    const userId = req.auth.dbUserId;
    const {
      name,
      description,
      date,
      url,
      category,
      linkingId,
      linkingType,
      visibility,
      organizationId,
    } = req.body;
    const linkDetails = {
      name,
      description,
      date,
      url,
      category,
      linkingId,
      linkingType,
      visibility,
      userId,
      organizationId,
    };
    const tenantIds = req.tenantIds;

    try {
      const parentContext = await resolveLinkGroupParentContext(
        req,
        linkingId,
        linkingType,
        tenantIds,
        userId
      );

      linkDetails.linkingType = parentContext.linkingType;
      linkDetails.tenantId = parentContext.tenantId;

      const linkGroup = await createLinkGroupService(linkDetails);
      res.json(linkGroup);
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({
          message: error.message,
        });
      }

      res.status(500).json({
        message: 'Error creating link group',
        error: error.message,
      });
    }
  },
  async updateLinkGroup(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth.dbUserId;

      // Clean up date fields that might be empty objects or invalid values
      const cleanedBody = { ...req.body };
      const dateFields = ['date', 'createdAt', 'updatedAt', 'vectorUpdatedAt'];

      dateFields.forEach((field) => {
        if (cleanedBody[field] !== undefined) {
          // If it's an empty object, null, or invalid date, remove it
          if (
            cleanedBody[field] === null ||
            (typeof cleanedBody[field] === 'object' &&
              Object.keys(cleanedBody[field]).length === 0) ||
            (typeof cleanedBody[field] === 'string' &&
              cleanedBody[field].trim() === '')
          ) {
            delete cleanedBody[field];
          }
        }
      });

      delete cleanedBody.tenantId;

      const [existingLinkGroup] = await db
        .select({
          id: linkGroups.id,
          linkingId: linkGroups.linkingId,
          linkingType: linkGroups.linkingType,
        })
        .from(linkGroups)
        .where(and(eq(linkGroups.id, id), eq(linkGroups.userId, userId)))
        .limit(1);

      if (!existingLinkGroup) {
        return res.status(404).json({
          message: 'Link group not found',
        });
      }

      if (cleanedBody.linkingId || cleanedBody.linkingType) {
        const parentContext = await resolveLinkGroupParentContext(
          req,
          cleanedBody.linkingId || existingLinkGroup.linkingId,
          cleanedBody.linkingType || existingLinkGroup.linkingType,
          req.tenantIds,
          userId
        );

        cleanedBody.linkingType = parentContext.linkingType;
        cleanedBody.tenantId = parentContext.tenantId;
      }

      const linkGroup = await updateLinkGroupService(id, cleanedBody, userId);

      if (!linkGroup) {
        return res.status(404).json({
          message: 'Link group not found',
        });
      }

      res.json(linkGroup);
    } catch (error) {
      res.status(500).json({
        message: 'Error updating link group',
        error: error.message,
      });
    }
  },
  async deleteLinkGroup(req, res) {
    try {
      const { id } = req.params;
      const tenantIds = req.tenantIds;
      const linkGroup = await deleteLinkGroupService(
        id,
        req.auth.dbUserId,
        tenantIds
      );
      res.json(linkGroup);
    } catch (error) {
      res.status(500).json({
        message: 'Error deleting link group',
        error: error.message,
      });
    }
  },
  async patchLinkGroup(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth.dbUserId;
      const [existingLinkGroup] = await db
        .select({
          id: linkGroups.id,
          linkingId: linkGroups.linkingId,
          linkingType: linkGroups.linkingType,
        })
        .from(linkGroups)
        .where(and(eq(linkGroups.id, id), eq(linkGroups.userId, userId)))
        .limit(1);

      if (!existingLinkGroup) {
        return res.status(404).json({
          message: 'Link group not found',
        });
      }

      const patchBody = { ...req.body };
      delete patchBody.tenantId;

      if (patchBody.linkingId || patchBody.linkingType) {
        const parentContext = await resolveLinkGroupParentContext(
          req,
          patchBody.linkingId || existingLinkGroup.linkingId,
          patchBody.linkingType || existingLinkGroup.linkingType,
          req.tenantIds,
          userId
        );

        patchBody.linkingType = parentContext.linkingType;
        patchBody.tenantId = parentContext.tenantId;
      }

      const linkGroup = await patchLinkGroupService(id, patchBody, userId);

      if (!linkGroup) {
        return res.status(404).json({
          message: 'Link group not found',
        });
      }

      res.json(linkGroup);
    } catch (error) {
      res.status(500).json({
        message: 'Error patching link group',
        error: error.message,
      });
    }
  },
};
