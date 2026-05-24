import {
  getAllCollectionsService,
  updateCollectionService,
  deleteResourceFromCollectionService,
  getCollectionByIdService,
  getResourceByIdService,
  deleteCollectionService,
  updateResourceOrderService,
  createCollectionService,
  getCollectionByIdServiceWithResources,
  getResourcesForAllCollectionsService,
  getExternalLinksForAllCollectionsService,
  getExternalLinksForCollectionByIdService,
  getResourcesForCollectionByIdService,
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
  getCollectionExternalLinkIdService,
  getNotationsNewsFeedService,
  getNotationByIdService,
  getCollectionsWithItemsByIdsService,
  createFolderService,
  getAllFoldersService,
  deleteFolderService,
  addCollectionToFolderService,
  removeCollectionFromFolderService,
  getPinnedCollectionsService,
  getCollectionCollaboratorsService,
  getExternalLinkCollaboratorsService,
  inviteExternalLinkCollaboratorService,
  getCollaboratedCollectionsService,
  toggleCollectionPublicJsonSharingService,
  toggleExternalLinkPublicJsonSharingService,
  getCollectionPublicSharingStatusService,
  getExternalLinkPublicSharingStatusService,
  updateExternalLinkOrderService,
  updateTypeOrderService,
  getTypeOrderingService,
  getDetailedCollectionExportDataService,
  getExternalLinksForCollectionByIdPaginatedService,
  getResourcesForCollectionByIdPaginatedService,
  createWorkflowInstanceFromTemplateService,
  getWorkflowTimelineForCollectionService,
} from '../services/collectionService.js';
import { mergeCollections } from './collectionMergeController.js';
import {
  isYoutubeUrl,
  parseTimestamps,
  snakeToCamelCase,
} from '../utils/general.js';
import { hydrateNotationMediaService } from '../services/notationService.js';
import { uploadToS3, constructS3Url } from '../utils/s3Utils.js';
import { getAuth, clerkClient } from '@clerk/express';
import { generatePresignedUrl } from '../utils/s3.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { getAttachmentsForExternalLinks } from '../services/attachmentService.js';
import { db } from '../db/index.js';
import { and, eq } from 'drizzle-orm';
import { collectionCollaborators } from '../models/collectionCollaborators.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import { collectionExternalLinks, externalLinks } from '../models/external_links.js';
import { sendCollaborationInviteEmail } from '../services/emailService.js';
import { users } from '../models/users.js';
import { subscriptionService } from '../services/subscriptionService.js';
import {
  inviteCollaboratorService,
  removeCollaboratorService,
} from '../services/invitationService.js';
import { rateLimitConfig } from '../config/rateLimiting.js';
import { getTenantVisibilitySettings } from '../services/tenantService.js';
import { sql } from 'drizzle-orm';

// Debouncing for order updates to prevent rapid API calls
const updateOrderDebouncer = new Map();
const ORDER_DEBOUNCE_DELAY = rateLimitConfig.debouncing.orderUpdates;
const TYPE_DEBOUNCE_DELAY = rateLimitConfig.debouncing.typeUpdates;

const debounceOrderUpdate = (key, fn, delay = ORDER_DEBOUNCE_DELAY) => {
  return new Promise((resolve, reject) => {
    // Clear existing timeout for this key
    if (updateOrderDebouncer.has(key)) {
      clearTimeout(updateOrderDebouncer.get(key).timeout);
    }

    // Set new timeout
    const timeout = setTimeout(async () => {
      try {
        const result = await fn();
        updateOrderDebouncer.delete(key);
        resolve(result);
      } catch (error) {
        updateOrderDebouncer.delete(key);
        reject(error);
      }
    }, delay);

    updateOrderDebouncer.set(key, { timeout, resolve, reject });
  });
};

export const collectionController = {
  mergeCollections,
  async getAllCollections(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const collections = await getAllCollectionsService(
        req.auth.dbUserId,
        tenantIds
      );
      // Sort collections by updated_at date in descending order
      const sortedCollections = collections.sort((a, b) => {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });

      res.json(sortedCollections);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch collections' });
    }
  },
  async updateCollection(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth.dbUserId;

      if (!userId) {
        return res
          .status(401)
          .json({ error: 'Unauthorized: User authentication required' });
      }

      // Check if user exists and has admin status
      const isAdmin = req.auth.isAdmin || false;

      const collection = await updateCollectionService(
        req.params.id,
        req.body,
        userId,
        tenantIds,
        isAdmin
      );

      if (!collection) {
        return res.status(404).json({
          error:
            'Collection not found or you do not have permission to update it',
        });
      }

      res.json(collection);
    } catch (error) {
      console.error('Error updating collection:', error);
      res.status(500).json({ error: 'Failed to update collection' });
    }
  },

  async deleteResourceFromCollection(req, res) {
    const tenantIds = req.tenantIds;
    try {
      // Check if the resource is a valid resource
      const resource = await getResourceByIdService(
        req.params.resourceId,
        req.auth.dbUserId,
        tenantIds
      );
      if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      // Check if the collection exists
      const collection = await getCollectionByIdService(
        req.params.id,
        req.auth.dbUserId,
        tenantIds
      );
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Check if user owns the collection or is a collaborator with permission
      const isOwner = collection.userId === req.auth.dbUserId;
      let isCollaboratorWithPermission = false;

      if (!isOwner) {
        const collaborators = await getCollectionCollaboratorsService(
          req.params.id
        );
        const userCollaboration = collaborators.find(
          (c) => c.userId === req.auth.dbUserId
        );
        isCollaboratorWithPermission =
          userCollaboration && userCollaboration.canAddResources;
      }

      if (!isOwner && !isCollaboratorWithPermission) {
        return res.status(403).json({
          error:
            'Unauthorized: You need permission to remove resources from this collection',
        });
      }

      // Delete the resource from the collection
      const result = await deleteResourceFromCollectionService(
        req.params.id,
        req.params.resourceId
      );

      if (!result) {
        return res
          .status(404)
          .json({ error: 'Resource not found in collection' });
      }

      return res
        .status(200)
        .json({ message: 'Resource successfully removed from collection' });
    } catch (error) {
      console.error('Error deleting resource from collection:', error);
      res
        .status(500)
        .json({ error: 'Failed to delete resource from collection' });
    }
  },

  async deleteExternalLinkFromCollection(req, res) {
    const tenantIds = req.tenantIds;
    try {
      // Check if the external link is a valid resource
      const externalLink = await getExternalLinkByIdService(
        req.params.externalLinkId,
        req.auth.dbUserId,
        tenantIds
      );
      if (!externalLink) {
        return res.status(404).json({ error: 'External link not found' });
      }

      // Check if the collection exists
      const collection = await getCollectionByIdService(
        req.params.id,
        req.auth.dbUserId,
        tenantIds
      );
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Check if user owns the collection or is a collaborator with permission
      const isOwner = collection.userId === req.auth.dbUserId;
      let isCollaboratorWithPermission = false;

      if (!isOwner) {
        const collaborators = await getCollectionCollaboratorsService(
          req.params.id
        );
        const userCollaboration = collaborators.find(
          (c) => c.userId === req.auth.dbUserId
        );
        isCollaboratorWithPermission =
          userCollaboration && userCollaboration.canAddLinks;
      }

      if (!isOwner && !isCollaboratorWithPermission) {
        return res.status(403).json({
          error:
            'Unauthorized: You need permission to remove external links from this collection',
        });
      }

      const result = await deleteExternalLinkFromCollectionService(
        req.params.id,
        req.params.externalLinkId,
        req.auth.dbUserId
      );
      res.json(result);
    } catch (error) {
      console.error('Error deleting external link from collection:', error);
      res
        .status(500)
        .json({ error: 'Failed to delete external link from collection' });
    }
  },

  async deleteCollection(req, res) {
    try {
      const tenantIds = req.tenantIds;
      // Check if the collection exists
      const collection = await getCollectionByIdService(
        req.params.id,
        req.auth.dbUserId,
        tenantIds
      );
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Delete the collection
      const result = await deleteCollectionService(
        req.params.id,
        req.auth.dbUserId,
        tenantIds
      );

      if (!result) {
        return res.status(404).json({ error: 'Failed to delete collection' });
      }

      return res
        .status(200)
        .json({ message: 'Collection successfully deleted' });
    } catch (error) {
      console.error('Error in deleteCollection:', error);
      res.status(500).json({ error: 'Failed to delete collection' });
    }
  },

  async updateResourceOrder(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const collectionId = req.params.id;

      // Check if the collection exists and user has access
      const collection = await getCollectionByIdService(
        collectionId,
        userId,
        tenantIds
      );
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Check if user owns the collection or is a collaborator with permission
      const isOwner = collection.userId === userId;
      let isCollaboratorWithPermission = false;

      if (!isOwner) {
        const collaborators =
          await getCollectionCollaboratorsService(collectionId);
        const userCollaboration = collaborators.find(
          (c) => c.userId === userId
        );
        isCollaboratorWithPermission =
          userCollaboration && userCollaboration.canAddResources;
      }

      if (!isOwner && !isCollaboratorWithPermission) {
        return res.status(403).json({
          error:
            'Unauthorized: You need permission to reorder resources in this collection',
        });
      }

      const result = await updateResourceOrderService(
        req.params.id,
        req.params.resourceId,
        req.body.orderPosition
      );
      res.json(result);
    } catch (error) {
      console.error('Error in updateResourceOrder:', error);
      res.status(500).json({ error: 'Failed to update resource order' });
    }
  },

  async getCollectionsWithItemsByIds(req, res) {
    try {
      const { ids } = req.body;
      const userId = req.auth.dbUserId;

      // Validate input
      if (!Array.isArray(ids)) {
        return res
          .status(400)
          .json({ error: 'Invalid input: ids must be an array' });
      }

      const collections = await getCollectionsWithItemsByIdsService(
        ids,
        userId
      );

      // Transform the response to camelCase
      res.json(snakeToCamelCase(collections));
    } catch (error) {
      console.error('Error in getCollectionsWithItemsByIds:', error);
      res.status(500).json({ error: 'Failed to get collections with items' });
    }
  },

  async createWorkflowInstanceFromTemplate(req, res) {
    try {
      const result = await createWorkflowInstanceFromTemplateService(
        req.params.id,
        req.body || {},
        req.auth.dbUserId,
        req.tenantIds
      );

      res.status(201).json(snakeToCamelCase(result));
    } catch (error) {
      console.error('Error creating workflow instance:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Failed to create workflow instance',
      });
    }
  },

  async getWorkflowTimeline(req, res) {
    try {
      const timeline = await getWorkflowTimelineForCollectionService(
        req.params.id,
        req.auth.dbUserId,
        req.tenantIds
      );

      res.json(snakeToCamelCase(timeline));
    } catch (error) {
      console.error('Error fetching workflow timeline:', error);
      res.status(error.statusCode || 500).json({
        error: error.message || 'Failed to fetch workflow timeline',
      });
    }
  },

  async getCollectionById(req, res) {
    try {
      const tenantIds = req.tenantIds;
      // First get basic collection info to check type
      const basicCollection = await getCollectionByIdService(
        req.params.id,
        req.auth.dbUserId,
        tenantIds
      );

      if (!basicCollection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Security check: For unauthenticated users, verify the collection's tenant allows public access
      if (req.auth?.isPublicAccess && basicCollection.tenantId) {
        const visibilityMap = await getTenantVisibilitySettings([
          basicCollection.tenantId,
        ]);
        const tenantSettings = visibilityMap[basicCollection.tenantId];

        // If the tenant doesn't allow public resources, deny access
        if (!tenantSettings?.resources) {
          return res.status(403).json({
            error:
              'This collection belongs to a private tenant. Please sign in to access.',
          });
        }
      }

      if (
        ['external', 'workflow_template', 'workflow_instance'].includes(
          basicCollection.type
        )
      ) {
        const externalLinks = await getExternalLinksForCollectionByIdService(
          basicCollection.id,
          req.auth.dbUserId
        );

        // Get attachments for all external links
        const externalLinkIds =
          externalLinks.external_links?.map((link) => link.id) || [];
        const attachments = await getAttachmentsForExternalLinks(
          externalLinkIds,
          req.auth.dbUserId
        );

        // Process both timestamps and attachments
        const processedExternalLinks = {
          ...basicCollection, // Preserve basic collection data
          ...externalLinks,
          external_links: externalLinks.external_links?.map((link) => ({
            ...link,
            timestamps: isYoutubeUrl(link.url)
              ? parseTimestamps(link.description)
              : null,
            userId: link.userId,
            attachments: attachments
              .filter((attachment) => attachment.externalLinkId === link.id)
              .map((attachment) => ({
                ...attachment,
                presignedUrl: generatePresignedCloudFrontUrl(
                  attachment.imageKey,
                  3600
                ),
                thumbnailUrl:
                  attachment.type === 'pdf'
                    ? generatePresignedCloudFrontUrl(
                        `thumbnails/${attachment.imageKey}.png`,
                        3600
                      )
                    : null,
              })),
          })),
        };
        res.json(snakeToCamelCase(processedExternalLinks));
      } else {
        const resources = await getResourcesForCollectionByIdService(
          basicCollection.id
        );

        // get the image url for each organization
        resources.resources.forEach((resource) => {
          resource.organizations.forEach((organization) => {
            organization.imageUrl = generatePresignedCloudFrontUrl(
              organization.imageKey
            );
          });
        });

        // Merge basic collection data with resources
        const processedResources = {
          ...basicCollection, // Preserve basic collection data
          ...resources,
        };

        res.json(snakeToCamelCase(processedResources));
      }
    } catch (error) {
      console.error('Error fetching collection by ID:', error);
      res.status(500).json({ error: 'Failed to fetch collection by ID' });
    }
  },

  async getResourcesForAllCollections(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth.dbUserId;
      const resources = await getResourcesForAllCollectionsService(
        userId,
        tenantIds
      );

      // if there are no resources, return an empty array
      if (!resources || resources.length === 0) {
        return res.json([]);
      }

      // Sort resources by updated_at date in descending order
      const sortedResources = resources.sort((a, b) => {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
      res.json(snakeToCamelCase(sortedResources));
    } catch (error) {
      console.error('Error fetching resources for all collections:', error);
      res.status(500).json({ error: 'Failed to fetch resources' });
    }
  },

  async createCollection(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Add the authenticated user's ID to the collection data
      const collectionData = {
        ...req.body,
        createdByUserId: userId,
        lastUpdatedByUserId: userId,
      };

      // make sure the tenant_id is in the tenantIds array
      const isValidTenantId = tenantIds.includes(collectionData.tenantId);
      if (!isValidTenantId) {
        return res.status(400).json({ error: 'Invalid tenant ID' });
      }

      // Check subscription limits for external collections
      if (collectionData.type === 'external') {
        const canCreate = await subscriptionService.canCreateExternalCollection(
          userId,
          tenantIds
        );
        if (!canCreate.allowed) {
          return res.status(403).json({
            error: 'External collection limit reached',
            details: {
              current: canCreate.current,
              limit: canCreate.limit,
              remaining: canCreate.remaining,
            },
          });
        }
      }

      const collection = await createCollectionService(collectionData, userId);
      res.status(201).json(collection);
    } catch (error) {
      console.error('Error creating collection:', error);
      res.status(500).json({ error: 'Failed to create collection' });
    }
  },

  async getExternalLinksForAllCollections(req, res) {
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;
    try {
      const collections = await getExternalLinksForAllCollectionsService(
        userId,
        tenantIds
      );

      // if there are no collections, return an empty array
      if (!collections || collections.length === 0) {
        return res.json([]);
      }

      // Sort collections by updated_at date in descending order
      const sortedCollections = collections.sort((a, b) => {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });

      // Process collections to add YouTube timestamps
      const processedCollections = sortedCollections.map((collection) => ({
        ...collection,
        external_links: collection.external_links?.map((link) => ({
          ...link,
          // timestamps: isYoutubeUrl(link?.url)
          //   ? parseTimestamps(link?.description)
          //   : null,
          userId: link?.userId,
        })),
      }));

      res.json(snakeToCamelCase(processedCollections));
    } catch (error) {
      console.error('Error fetching external links for collections:', error);
      res.status(500).json({ error: 'Failed to fetch external links' });
    }
  },

  async getCollaboratedCollections(req, res) {
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;
    try {
      const collections = await getCollaboratedCollectionsService(
        userId,
        tenantIds
      );

      // if there are no collections, return an empty array
      if (!collections || collections.length === 0) {
        return res.json([]);
      }

      // Sort collections by updated_at date in descending order
      const sortedCollections = collections.sort((a, b) => {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });

      // Process collections to add YouTube timestamps
      const processedCollections = sortedCollections.map((collection) => ({
        ...collection,
        external_links: collection.external_links?.map((link) => ({
          ...link,
          timestamps: isYoutubeUrl(link.url)
            ? parseTimestamps(link.description)
            : null,
          userId: link.userId,
        })),
      }));

      res.json(snakeToCamelCase(processedCollections));
    } catch (error) {
      console.error('Error fetching collaborated collections:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch collaborated collections' });
    }
  },

  async addExternalLinkToCollection(req, res) {
    try {
      const collectionId = req.params.id;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Check if the collection exists and belongs to the user
      const collection = await getCollectionByIdService(
        collectionId,
        userId,
        tenantIds
      );
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Check if user owns the collection or is a collaborator with permission
      const isOwner = collection.userId === userId;
      let isCollaboratorWithPermission = false;

      if (!isOwner) {
        // Check if user is a collaborator with canAddLinks permission
        const collaborators =
          await getCollectionCollaboratorsService(collectionId);
        const userCollaboration = collaborators.find(
          (c) => c.userId === userId
        );
        isCollaboratorWithPermission =
          userCollaboration && userCollaboration.canAddLinks;
      }

      if (!isOwner && !isCollaboratorWithPermission) {
        return res.status(403).json({
          error:
            'Unauthorized: You need permission to add external links to this collection',
        });
      }

      const externalLinkData = {
        ...req.body,
        userId: userId,
      };

      // Handle tenantId assignment for external link
      const requestedTenantId = externalLinkData.tenantId;
      const authorizedTenantIds = req.tenantIds || [];

      // Validate that the requested tenant is authorized
      if (requestedTenantId) {
        if (!authorizedTenantIds.includes(requestedTenantId)) {
          return res.status(403).json({
            error:
              'You are not authorized to create external links in the requested tenant',
          });
        }
        externalLinkData.tenantId = requestedTenantId;
      } else if (authorizedTenantIds.length > 0) {
        // Default to first authorized tenant if no specific tenant requested
        externalLinkData.tenantId = authorizedTenantIds[0];
      } else {
        return res.status(400).json({
          error: 'No tenant specified and no authorized tenants found',
        });
      }

      // Validate visibility permissions for public external links
      // Only admins can make external links public, regardless of tenant
      if (externalLinkData.visibility === 'public') {
        if (!req.auth.isAdmin) {
          return res.status(403).json({
            error:
              'Only administrators can make external links public',
          });
        }
      }

      const result = await addExternalLinkToCollectionService(
        collectionId,
        externalLinkData
      );

      res.status(201).json(snakeToCamelCase(result));
    } catch (error) {
      console.error('Error in addExternalLinkToCollection:', error);
      res
        .status(500)
        .json({ error: 'Failed to add external link to collection' });
    }
  },

  async updateExternalLinkInCollection(req, res) {
    try {
      const { id: collectionId, externalLinkId } = req.params;
      const updateData = req.body;
      const userId = req.auth.dbUserId;

      // Get the external link to check ownership
      const externalLink = await getExternalLinkByIdService(
        externalLinkId,
        userId
      );

      if (!externalLink) {
        return res.status(404).json({ error: 'External link not found' });
      }

      // Check if the user is the owner of the external link
      if (externalLink.addedByUserId !== userId) {
        return res.status(403).json({
          error:
            'Unauthorized: You can only update external links that you created',
        });
      }

      const result = await updateExternalLinkInCollectionService(
        collectionId,
        externalLinkId,
        updateData
      );

      res.json(snakeToCamelCase(result));
    } catch (error) {
      console.error('Error in updateExternalLinkInCollection:', error);
      res.status(500).json({
        error: 'Failed to update external link in collection',
      });
    }
  },

  async updateExternalLinkWhiteboard(req, res) {
    try {
      const { externalLinkId } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      const externalLink = await getExternalLinkByIdService(
        externalLinkId,
        userId,
        tenantIds
      );

      if (!externalLink) {
        return res.status(404).json({ message: 'External link not found' });
      }

      let canEdit = externalLink.addedByUserId === userId;

      if (!canEdit) {
        const collaboratorRows = await db
          .select({ id: collectionExternalLinkCollaborators.id })
          .from(collectionExternalLinks)
          .innerJoin(
            collectionExternalLinkCollaborators,
            and(
              eq(
                collectionExternalLinkCollaborators.collectionExternalLinkId,
                collectionExternalLinks.id
              ),
              eq(collectionExternalLinkCollaborators.userId, userId)
            )
          )
          .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
          .limit(1);

        canEdit = collaboratorRows.length > 0;
      }

      if (!canEdit) {
        return res
          .status(403)
          .json({ message: 'You do not have permission to edit this link' });
      }

      const [updatedExternalLink] = await db
        .update(externalLinks)
        .set({
          whiteboardData: req.body.whiteboardData ?? null,
          updatedAt: new Date(),
        })
        .where(eq(externalLinks.id, externalLinkId))
        .returning();

      return res.json(snakeToCamelCase(updatedExternalLink));
    } catch (error) {
      console.error('Error in updateExternalLinkWhiteboard:', error);
      return res
        .status(500)
        .json({ message: 'Failed to update external link whiteboard' });
    }
  },

  async getExternalLinksForCollection(req, res) {
    try {
      const { id: collectionId } = req.params;
      const externalLinks =
        await getExternalLinksForCollectionService(collectionId);

      if (!externalLinks) {
        return res
          .status(404)
          .json({ error: 'Collection not found or has no external links' });
      }

      // Process YouTube timestamps
      const processedLinks = externalLinks.map((link) => ({
        ...link,
        timestamps: isYoutubeUrl(link.url)
          ? parseTimestamps(link.description)
          : null,
      }));

      res.json(snakeToCamelCase(processedLinks));
    } catch (error) {
      console.error('Error in getExternalLinksForCollection:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch external links for collection' });
    }
  },

  async getExternalLinkById(req, res) {
    try {
      const { externalLinkId } = req.params;
      // Ensure userId is either a valid UUID or null (not the string "null" or "undefined")
      const userId =
        req.auth?.dbUserId &&
        req.auth.dbUserId !== 'null' &&
        req.auth.dbUserId !== 'undefined'
          ? req.auth.dbUserId
          : null;
      const externalLink = await getExternalLinkByIdService(
        externalLinkId,
        userId
      );

      if (!externalLink) {
        return res.status(404).json({ error: 'External link not found' });
      }

      // Process YouTube timestamps
      const processedLink = {
        ...externalLink,
        timestamps: isYoutubeUrl(externalLink.url)
          ? parseTimestamps(externalLink.description)
          : null,
      };

      processedLink.notations = await hydrateNotationMediaService(
        processedLink.notations || [],
        {
          accessMode: 'signed',
          expiresInSeconds: 86400,
        }
      );

      // Handle attachments with presigned URLs
      if (processedLink.attachments && processedLink.attachments.length > 0) {
        const attachmentsWithUrls = await Promise.all(
          processedLink.attachments.map(async (attachment) => {
            if (attachment.imageKey) {
              attachment.presignedUrl = generatePresignedCloudFrontUrl(
                attachment.imageKey,
                3600
              );
            }
            return attachment;
          })
        );
        processedLink.attachments = attachmentsWithUrls;
      }

      res.json(snakeToCamelCase(processedLink));
    } catch (error) {
      console.error('Error in getExternalLinkById:', error);
      res.status(500).json({ error: 'Failed to fetch external link' });
    }
  },

  // -------- Notations --------

  async addExternalLinkNotation(req, res) {
    try {
      const { externalLinkId } = req.params;
      const notationData = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Check if the external link exists and user has access
      const externalLink = await getExternalLinkByIdService(
        externalLinkId,
        userId,
        tenantIds
      );

      if (!externalLink) {
        return res
          .status(404)
          .json({ error: 'External link not found or access denied' });
      }

      // Check if user owns the external link or is a collaborator
      const isOwner = externalLink.addedByUserId === userId;
      let isCollaborator = false;

      if (!isOwner && externalLink.collaborators) {
        isCollaborator = externalLink.collaborators.some(
          (c) => c.userId === userId
        );
      }

      // Get the collaborator's permissions if they are one
      let canAddNotes = false;
      if (isCollaborator) {
        const collaborator =
          await getExternalLinkCollaboratorsService(externalLinkId);
        const userCollaboration = collaborator.find((c) => c.userId === userId);
        canAddNotes =
          userCollaboration && userCollaboration.canAddNotes !== false; // Default to true if not specified
      }

      if (!isOwner && (!isCollaborator || !canAddNotes)) {
        return res.status(403).json({
          error:
            'Unauthorized: You need permission to add notations to this external link',
        });
      }

      // First get the collection_external_links.id
      const collectionExternalLinkId =
        await getCollectionExternalLinkIdService(externalLinkId);

      // Check if using a template
      if (notationData.templateId) {
        const { createNotationFromTemplateService } = await import(
          '../services/notationTemplateService.js'
        );
        const notation = await createNotationFromTemplateService(
          notationData.templateId,
          notationData,
          userId,
          false
        );
        res.status(201).json(notation);
      } else {
        // Then pass this ID to create the notation
        const notation = await addNotationToExternalLinkService(
          collectionExternalLinkId,
          notationData,
          userId
        );
        res.status(201).json(notation);
      }
    } catch (error) {
      console.error('Error adding external link notation:', error);
      res
        .status(500)
        .json({ error: 'Failed to add notation to external link' });
    }
  },

  async getExternalLinkNotations(req, res) {
    try {
      const { externalLinkId } = req.params;
      const { templatesOnly } = req.query;
      const userId = req.auth.dbUserId;
      // get the collectionExternalLinkId from the externalLinkId
      const collectionExternalLinkId =
        await getCollectionExternalLinkIdService(externalLinkId);
      let notations = await getNotationsForExternalLinkService(
        collectionExternalLinkId,
        userId
      );
      
      // Filter for templates if requested
      if (templatesOnly === 'true') {
        notations = notations.filter(n => n.isTemplate === true);
      }

      notations = await hydrateNotationMediaService(notations, {
        accessMode: 'signed',
        expiresInSeconds: 86400,
      });
      
      res.json(notations);
    } catch (error) {
      console.error('Error fetching external link notations:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch notations for external link' });
    }
  },

  async getNotationById(req, res) {
    try {
      const { notationId } = req.params;
      const userId = req.auth.dbUserId;

      // Get the notation with all fields
      const notation = await getNotationByIdService(notationId);

      if (!notation) {
        return res.status(404).json({ error: 'Notation not found' });
      }

      // Check if user has access to view this notation
      // The service already includes tags, now we ensure all fields are returned
      res.json(notation);
    } catch (error) {
      console.error('Error fetching notation by ID:', error);
      res.status(500).json({ error: 'Failed to fetch notation' });
    }
  },

  async updateExternalLinkNotation(req, res) {
    try {
      const { notationId } = req.params;
      const updateData = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Get the notation to check ownership
      const notation = await getNotationByIdService(notationId);

      if (!notation) {
        return res.status(404).json({ error: 'Notation not found' });
      }

      // Get the external link to check permissions and visibility
      const collectionExternalLinkId = notation.collectionExternalLinkId;
      const externalLinkResult = await db
        .select({
          externalLinkId: collectionExternalLinks.externalLinkId,
          collectionId: collectionExternalLinks.collectionId,
        })
        .from(collectionExternalLinks)
        .where(eq(collectionExternalLinks.id, collectionExternalLinkId))
        .limit(1);

      if (!externalLinkResult.length) {
        return res
          .status(404)
          .json({ error: 'Associated external link not found' });
      }

      const externalLink = await getExternalLinkByIdService(
        externalLinkResult[0].externalLinkId,
        userId,
        tenantIds
      );

      if (!externalLink) {
        return res
          .status(403)
          .json({ error: 'Access denied to external link' });
      }

      // Check if user can edit this notation
      const isNotationOwner = notation.userId === userId;
      const isExternalLinkOwner = externalLink.addedByUserId === userId;

      // Check if user is a collaborator with edit permissions
      let canEditAsCollaborator = false;
      if (!isNotationOwner && !isExternalLinkOwner) {
        // Only allow collaborator edits on public/unlisted external links
        if (['public', 'unlisted'].includes(externalLink.visibility)) {
          const userCollaborator = await db
            .select()
            .from(collectionExternalLinkCollaborators)
            .where(
              and(
                eq(
                  collectionExternalLinkCollaborators.collectionExternalLinkId,
                  collectionExternalLinkId
                ),
                eq(collectionExternalLinkCollaborators.userId, userId)
              )
            )
            .limit(1);

          if (
            userCollaborator[0] &&
            ['editor', 'admin'].includes(userCollaborator[0].role)
          ) {
            canEditAsCollaborator = true;
          }
        }
      }

      if (!isNotationOwner && !isExternalLinkOwner && !canEditAsCollaborator) {
        return res.status(403).json({
          error:
            'Unauthorized: You do not have permission to edit this notation',
        });
      }

      const updatedNotation = await updateNotationInExternalLinkService(
        notationId,
        updateData,
        notation.collectionExternalLinkId,
        userId
      );

      // Log to debug what's being returned

      res.json(updatedNotation);
    } catch (error) {
      console.error('Error updating external link notation:', error);
      res.status(500).json({ error: 'Failed to update notation' });
    }
  },

  async deleteExternalLinkNotation(req, res) {
    try {
      const { notationId } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Get the notation to check ownership and get external link info
      const notation = await getNotationByIdService(notationId);

      if (!notation) {
        return res.status(404).json({ error: 'Notation not found' });
      }

      // Get the external link to check permissions
      const collectionExternalLinkId = notation.collectionExternalLinkId;
      const externalLinkResult = await db
        .select({ externalLinkId: collectionExternalLinks.externalLinkId })
        .from(collectionExternalLinks)
        .where(eq(collectionExternalLinks.id, collectionExternalLinkId))
        .limit(1);

      if (!externalLinkResult.length) {
        return res
          .status(404)
          .json({ error: 'Associated external link not found' });
      }

      const externalLink = await getExternalLinkByIdService(
        externalLinkResult[0].externalLinkId,
        userId,
        tenantIds
      );

      if (!externalLink) {
        return res
          .status(403)
          .json({ error: 'Access denied to external link' });
      }

      // Check if user can delete this notation
      const isNotationOwner = notation.userId === userId;
      const isExternalLinkOwner = externalLink.addedByUserId === userId;
      const isAdmin = req.auth.role === 'admin'; // Assuming admin role is available

      if (!isNotationOwner && !isExternalLinkOwner && !isAdmin) {
        return res.status(403).json({
          error:
            'Unauthorized: You can only delete notations you created or if you own the external link',
        });
      }

      const result = await deleteNotationFromExternalLinkService(notationId);
      res.json({ message: 'Notation successfully deleted', result });
    } catch (error) {
      console.error('Error deleting external link notation:', error);
      res.status(500).json({ error: 'Failed to delete notation' });
    }
  },

  // -------- Threads --------

  async addNotationThread(req, res) {
    try {
      const { notationId } = req.params;
      const threadData = {
        ...req.body,
        userId: req.auth.dbUserId, // assuming your auth middleware populates this
      };
      const thread = await addThreadToNotationService(notationId, threadData);
      res.status(201).json(thread);
    } catch (error) {
      console.error('Error adding notation thread:', error);
      res.status(500).json({ error: 'Failed to add thread to notation' });
    }
  },

  async getNotationThreads(req, res) {
    try {
      const { notationId } = req.params;
      const threads = await getThreadsForNotationService(notationId);
      res.json(threads);
    } catch (error) {
      console.error('Error fetching notation threads:', error);
      res.status(500).json({ error: 'Failed to fetch threads for notation' });
    }
  },

  async updateNotationThread(req, res) {
    try {
      const { threadId } = req.params;
      const updateData = req.body;
      const thread = await updateThreadInNotationService(threadId, updateData);
      res.json(thread);
    } catch (error) {
      console.error('Error updating notation thread:', error);
      res.status(500).json({ error: 'Failed to update thread' });
    }
  },

  async deleteNotationThread(req, res) {
    try {
      const { threadId } = req.params;
      const result = await deleteThreadFromNotationService(threadId);
      res.json({ message: 'Thread successfully deleted', result });
    } catch (error) {
      console.error('Error deleting notation thread:', error);
      res.status(500).json({ error: 'Failed to delete thread' });
    }
  },

  async getNotationsNewsFeed(req, res) {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const userId = req.auth.dbUserId;
    try {
      const newsfeed = await getNotationsNewsFeedService(page, limit, userId);
      res.json(snakeToCamelCase(newsfeed));
    } catch (error) {
      console.error('Error fetching newsfeed:', error);
      res.status(500).json({ error: 'Failed to fetch newsfeed updates' });
    }
  },

  async createFolder(req, res) {
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;
    try {
      const folderData = {
        ...req.body,
        userId: userId,
        lastUpdatedByUserId: userId,
        visibility: req.body.visibility.id || 'private',
        type: 'folder', // Force type to be folder
      };

      const folder = await createFolderService(folderData, userId, tenantIds);
      res.status(201).json(folder);
    } catch (error) {
      console.error('Error creating folder:', error);
      res.status(500).json({ error: 'Failed to create folder' });
    }
  },
  async getAllFolders(req, res) {
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;
    try {
      const folders = await getAllFoldersService(userId, tenantIds);
      // Sort folders by updated_at date in descending order
      const sortedFolders = folders.sort((a, b) => {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });

      res.json(sortedFolders);
    } catch (error) {
      console.error('Error fetching folders:', error);
      res.status(500).json({ error: 'Failed to fetch folders' });
    }
  },

  async deleteFolder(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const result = await deleteFolderService(id, userId, tenantIds);
      res.json({ message: 'Folder successfully deleted', result });
    } catch (error) {
      console.error('Error deleting folder:', error);
      res.status(500).json({ error: 'Failed to delete folder' });
    }
  },

  async addCollectionToFolder(req, res) {
    try {
      const { id: folderId } = req.params;
      const { collectionId } = req.body;
      const userId = req.auth.dbUserId;

      // Add the collection to the folder using the service
      const result = await addCollectionToFolderService(
        folderId,
        collectionId,
        userId
      );
      res.status(201).json(result);
    } catch (error) {
      console.error('Error adding collection to folder:', error);
      res.status(500).json({ error: 'Failed to add collection to folder' });
    }
  },

  async removeCollectionFromFolder(req, res) {
    try {
      const { id: folderId, collectionId } = req.params;
      const userId = req.auth.dbUserId;

      // Update the collection in the folder
      const result = await removeCollectionFromFolderService(
        folderId,
        collectionId,
        userId
      );
      res.json(result);
    } catch (error) {
      console.error('Error updating collection in folder:', error);
      res.status(500).json({ error: 'Failed to update collection in folder' });
    }
  },

  async getPinnedCollections(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const collections = await getPinnedCollectionsService(userId, tenantIds);

      // Sort collections by updated_at date in descending order
      const sortedCollections = collections.sort((a, b) => {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });

      res.json(snakeToCamelCase(sortedCollections));
    } catch (error) {
      console.error('Error fetching pinned collections:', error);
      res.status(500).json({ error: 'Failed to fetch pinned collections' });
    }
  },

  async getCollectionCollaborators(req, res) {
    try {
      const { id } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      // Check if user's subscription allows collaborators
      const collaboratorPermissions =
        await subscriptionService.canAddCollaborators(userId);
      // if (!collaboratorPermissions.allowed) {
      //   return res.status(403).json({
      //     error:
      //       'Collaboration features are not available in your current plan',
      //     upgradeRequired: true,
      //   });
      // }

      // Check if collection exists and user has access
      const collection = await getCollectionByIdService(id, userId, tenantIds);
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Check if user is owner or collaborator
      if (collection.userId !== userId) {
        // Check if the user is a collaborator with permissions
        const userCollaborator = await db
          .select()
          .from(collectionCollaborators)
          .where(
            and(
              eq(collectionCollaborators.collectionId, id),
              eq(collectionCollaborators.userId, userId)
            )
          )
          .limit(1);

        if (!userCollaborator[0]) {
          return res.status(403).json({
            error:
              'You do not have permission to view collaborators for this collection',
          });
        }
      }

      const collaborators = await getCollectionCollaboratorsService(id);
      res.json(snakeToCamelCase(collaborators));
    } catch (error) {
      console.error('Error fetching collection collaborators:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch collection collaborators' });
    }
  },

  async getExternalLinkCollaborators(req, res) {
    try {
      const { externalLinkId } = req.params;
      const userId = req.auth.dbUserId;

      // Check if user's subscription allows collaborators
      const collaboratorPermissions =
        await subscriptionService.canAddCollaborators(userId);
      // if (!collaboratorPermissions.allowed) {
      //   return res.status(403).json({
      //     error:
      //       'Collaboration features are not available in your current plan',
      //     upgradeRequired: true,
      //   });
      // }

      // Get the external link to check ownership/permissions
      const externalLink = await getExternalLinkByIdService(
        externalLinkId,
        userId
      );
      if (!externalLink) {
        return res.status(404).json({ error: 'External link not found' });
      }

      // Check if user is the owner of the external link
      if (externalLink.addedByUserId !== userId) {
        // If not owner, check if they're a collaborator
        // First get the collection_external_link id
        const collectionLink = await db
          .select()
          .from(collectionExternalLinks)
          .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
          .limit(1);

        if (!collectionLink[0]) {
          return res
            .status(404)
            .json({ error: 'External link not found in any collection' });
        }

        // Check if user is a collaborator
        const userCollaborator = await db
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

        if (!userCollaborator[0]) {
          return res.status(403).json({
            error:
              'You do not have permission to view collaborators for this external link',
          });
        }
      }

      const collaborators =
        await getExternalLinkCollaboratorsService(externalLinkId);
      res.json(snakeToCamelCase(collaborators));
    } catch (error) {
      console.error('Error fetching external link collaborators:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch external link collaborators' });
    }
  },

  async inviteExternalLinkCollaborator(req, res) {
    try {
      const { externalLinkId } = req.params;
      const userId = req.auth.dbUserId;

      // Check if user's subscription allows collaborators
      const collaboratorPermissions =
        await subscriptionService.canAddCollaborators(userId);
      // if (!collaboratorPermissions.allowed) {
      //   return res.status(403).json({
      //     error:
      //       'Collaboration features are not available in your current plan',
      //     upgradeRequired: true,
      //   });
      // }

      // Validate input data
      const { email, name, role, message } = req.body;

      if (!email || !role) {
        return res.status(400).json({
          error: 'Email and role are required',
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: 'Please provide a valid email address',
        });
      }

      // Check if the user has permission to invite collaborators
      const externalLink = await getExternalLinkByIdService(
        externalLinkId,
        userId
      );
      if (!externalLink) {
        return res.status(404).json({ error: 'External link not found' });
      }

      // Check if external link is private
      if (externalLink.visibility === 'private') {
        return res.status(403).json({
          error: 'Cannot add collaborators to private external links',
        });
      }

      // Check if user is the owner or a collaborator with sufficient permissions
      if (externalLink.addedByUserId !== userId) {
        // Get the collection_external_link id to check collaborator status
        const collectionLink = await db
          .select()
          .from(collectionExternalLinks)
          .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
          .limit(1);

        if (!collectionLink[0]) {
          return res
            .status(404)
            .json({ error: 'External link not found in any collection' });
        }

        // Check if user is a collaborator with appropriate permissions
        const userCollaborator = await db
          .select()
          .from(collectionExternalLinkCollaborators)
          .where(
            and(
              eq(
                collectionExternalLinkCollaborators.collectionExternalLinkId,
                collectionLink[0].id
              ),
              eq(collectionExternalLinkCollaborators.userId, userId),
              eq(collectionExternalLinkCollaborators.role, 'admin') // Only admins can invite others
            )
          )
          .limit(1);

        if (!userCollaborator[0]) {
          return res.status(403).json({
            error:
              'You do not have permission to invite collaborators for this external link',
          });
        }
      }

      // Use the new invitation service
      const inviteResult = await inviteCollaboratorService(
        externalLinkId,
        { email, name, role, message },
        userId
      );

      if (inviteResult.type === 'immediate') {
        res.status(201).json({
          success: true,
          message: 'User added as collaborator immediately',
          type: 'immediate',
          data: snakeToCamelCase(inviteResult.collaborator),
        });
      } else {
        res.status(201).json({
          success: true,
          message:
            'Invitation sent successfully. User will be added as collaborator when they create an account.',
          type: 'pending',
          data: {
            invitationId: inviteResult.invitation.id,
            email: inviteResult.invitation.email,
            role: inviteResult.invitation.role,
            expiresAt: inviteResult.invitation.expiresAt,
          },
        });
      }
    } catch (error) {
      console.error('Error inviting collaborator to external link:', error);

      // Handle specific error cases
      if (error.message.includes('does not exist in the system')) {
        return res.status(404).json({
          error:
            'User with this email does not exist in the system. They must create an account first.',
        });
      }

      if (error.message.includes('private external links')) {
        return res.status(403).json({
          error: 'Cannot add collaborators to private external links',
        });
      }

      if (error.message.includes('already a collaborator')) {
        return res.status(409).json({
          error: 'User is already a collaborator for this external link',
        });
      }

      if (error.message.includes('pending invitation already exists')) {
        return res.status(409).json({
          error:
            'A pending invitation already exists for this email and external link',
        });
      }

      res.status(500).json({
        error: error.message || 'Failed to invite collaborator',
      });
    }
  },

  async removeExternalLinkCollaborator(req, res) {
    try {
      const { externalLinkId, collaboratorUserId } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (!userId) {
        return res
          .status(401)
          .json({ error: 'Unauthorized: User authentication required' });
      }

      // Get the external link to check ownership
      const externalLink = await getExternalLinkByIdService(
        externalLinkId,
        userId,
        tenantIds
      );

      if (!externalLink) {
        return res.status(404).json({ error: 'External link not found' });
      }

      // Only the owner of the external link can remove collaborators
      if (externalLink.addedByUserId !== userId) {
        return res.status(403).json({
          error: 'Only the external link owner can remove collaborators',
        });
      }

      // Check if the collaborator exists
      const collaborator = await db
        .select()
        .from(collectionExternalLinkCollaborators)
        .where(
          and(
            eq(
              collectionExternalLinkCollaborators.externalLinkId,
              externalLinkId
            ),
            eq(collectionExternalLinkCollaborators.userId, collaboratorUserId)
          )
        )
        .limit(1);

      if (!collaborator.length) {
        return res.status(404).json({ error: 'Collaborator not found' });
      }

      // Remove the collaborator
      await db
        .delete(collectionExternalLinkCollaborators)
        .where(
          and(
            eq(
              collectionExternalLinkCollaborators.externalLinkId,
              externalLinkId
            ),
            eq(collectionExternalLinkCollaborators.userId, collaboratorUserId)
          )
        );

      res.json({ message: 'Collaborator removed successfully' });
    } catch (error) {
      console.error('Error removing external link collaborator:', error);
      res
        .status(500)
        .json({ error: 'Failed to remove external link collaborator' });
    }
  },

  /**
   * Toggle public JSON sharing for a collection
   */
  async toggleCollectionPublicJsonSharing(req, res) {
    try {
      const { id: collectionId } = req.params;
      const { enabled } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const isAdmin = req.auth.isAdmin || false;

      if (!userId) {
        return res
          .status(401)
          .json({ error: 'Unauthorized: User authentication required' });
      }

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid input',
          message: 'enabled field must be a boolean value',
        });
      }

      const updatedCollection = await toggleCollectionPublicJsonSharingService(
        collectionId,
        enabled,
        userId,
        tenantIds,
        isAdmin
      );

      res.json({
        message: `Collection public JSON sharing ${enabled ? 'enabled' : 'disabled'} successfully`,
        collection: {
          id: updatedCollection.id,
          name: updatedCollection.name,
          publicJsonEnabled: updatedCollection.publicJsonEnabled,
        },
      });
    } catch (error) {
      console.error('Error toggling collection public JSON sharing:', error);
      if (error.message === 'Collection not found or access denied') {
        return res.status(404).json({ error: error.message });
      }
      if (
        error.message ===
        'Only public or unlisted resource and external collections can enable public sharing'
      ) {
        return res.status(400).json({ error: error.message });
      }
      res
        .status(500)
        .json({ error: 'Failed to toggle collection public JSON sharing' });
    }
  },

  /**
   * Toggle public JSON sharing for an external link
   */
  async toggleExternalLinkPublicJsonSharing(req, res) {
    try {
      const { externalLinkId } = req.params;
      const { enabled } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const isAdmin = req.auth.isAdmin || false;

      if (!userId) {
        return res
          .status(401)
          .json({ error: 'Unauthorized: User authentication required' });
      }

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          error: 'Invalid input',
          message: 'enabled field must be a boolean value',
        });
      }

      const updatedExternalLink =
        await toggleExternalLinkPublicJsonSharingService(
          externalLinkId,
          enabled,
          userId,
          tenantIds,
          isAdmin
        );

      res.json({
        message: `External link public JSON sharing ${enabled ? 'enabled' : 'disabled'} successfully`,
        externalLink: {
          id: updatedExternalLink.id,
          name: updatedExternalLink.name,
          publicJsonEnabled: updatedExternalLink.publicJsonEnabled,
        },
      });
    } catch (error) {
      console.error('Error toggling external link public JSON sharing:', error);
      if (error.message === 'External link not found or access denied') {
        return res.status(404).json({ error: error.message });
      }
      if (
        error.message ===
        'Only public or unlisted external links can enable public sharing'
      ) {
        return res.status(400).json({ error: error.message });
      }
      res
        .status(500)
        .json({ error: 'Failed to toggle external link public JSON sharing' });
    }
  },

  /**
   * Get public sharing status for collections
   */
  async getCollectionPublicSharingStatus(req, res) {
    try {
      const { ids } = req.query; // Comma-separated collection IDs
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const isAdmin = req.auth.isAdmin || false;

      if (!userId) {
        return res
          .status(401)
          .json({ error: 'Unauthorized: User authentication required' });
      }

      if (!ids) {
        return res.status(400).json({
          error: 'Missing collection IDs',
          message:
            'Please provide collection IDs as a comma-separated query parameter',
        });
      }

      const collectionIds = ids.split(',').map((id) => id.trim());

      const collectionsStatus = await getCollectionPublicSharingStatusService(
        collectionIds,
        userId,
        tenantIds,
        isAdmin
      );

      res.json({
        collections: collectionsStatus,
        total: collectionsStatus.length,
      });
    } catch (error) {
      console.error('Error fetching collection public sharing status:', error);
      res
        .status(500)
        .json({ error: 'Failed to fetch collection public sharing status' });
    }
  },

  /**
   * Get public sharing status for external links
   */
  async getExternalLinkPublicSharingStatus(req, res) {
    try {
      const { ids } = req.query; // Comma-separated external link IDs
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const isAdmin = req.auth.isAdmin || false;

      if (!userId) {
        return res
          .status(401)
          .json({ error: 'Unauthorized: User authentication required' });
      }

      if (!ids) {
        return res.status(400).json({
          error: 'Missing external link IDs',
          message:
            'Please provide external link IDs as a comma-separated query parameter',
        });
      }

      const externalLinkIds = ids.split(',').map((id) => id.trim());

      const externalLinksStatus =
        await getExternalLinkPublicSharingStatusService(
          externalLinkIds,
          userId,
          tenantIds,
          isAdmin
        );

      res.json({
        externalLinks: externalLinksStatus,
        total: externalLinksStatus.length,
      });
    } catch (error) {
      console.error(
        'Error fetching external link public sharing status:',
        error
      );
      res
        .status(500)
        .json({ error: 'Failed to fetch external link public sharing status' });
    }
  },

  async updateExternalLinkOrder(req, res) {
    try {
      const { id: collectionId, externalLinkId } = req.params;
      const { sortOrder } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (sortOrder === undefined || sortOrder === null) {
        return res.status(400).json({
          error: 'sortOrder is required',
        });
      }

      // Check if the collection exists and user has access
      const collection = await getCollectionByIdService(
        collectionId,
        userId,
        tenantIds
      );
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Check if user owns the collection or is a collaborator with permission
      const isOwner = collection.userId === userId;
      let isCollaboratorWithPermission = false;

      if (!isOwner) {
        const collaborators =
          await getCollectionCollaboratorsService(collectionId);
        const userCollaboration = collaborators.find(
          (c) => c.userId === userId
        );
        isCollaboratorWithPermission =
          userCollaboration && userCollaboration.canAddLinks;
      }

      if (!isOwner && !isCollaboratorWithPermission) {
        return res.status(403).json({
          error:
            'Unauthorized: You need permission to reorder external links in this collection',
        });
      }

      // Create a unique key for this specific update operation
      const debounceKey = `${collectionId}-${externalLinkId}-${userId}`;

      // Debounce the update to prevent rapid API calls
      const result = await debounceOrderUpdate(debounceKey, async () => {
        return await updateExternalLinkOrderService(
          collectionId,
          externalLinkId,
          sortOrder,
          userId
        );
      });

      const { reorderedLinks, ...externalLinkData } = result;

      res.json({
        success: true,
        message: `External link order updated successfully. ${reorderedLinks?.length || 0} items reordered in the same type group.`,
        data: externalLinkData,
        reorderingSummary: {
          affectedLinksCount: reorderedLinks?.length || 0,
          linkType: reorderedLinks?.[0]?.type || 'unknown',
          newPosition: externalLinkData.sortOrder,
        },
      });
    } catch (error) {
      console.error('Error updating external link order:', error);
      res.status(500).json({
        error: 'Failed to update external link order',
        message: error.message,
      });
    }
  },

  async updateTypeOrder(req, res) {
    try {
      const { id: collectionId } = req.params;
      let { typeOrdering, typeOrderings } = req.body;
      const userId = req.auth.dbUserId;

      // Handle both formats for backward compatibility
      if (typeOrderings && !typeOrdering) {
        typeOrdering = typeOrderings;
      }

      if (!typeOrdering) {
        return res.status(400).json({
          error: 'typeOrdering is required',
          received: { typeOrdering, typeOrderings },
        });
      }

      // Validate the format
      if (typeof typeOrdering !== 'object') {
        return res.status(400).json({
          error: 'typeOrdering must be an object or array',
          receivedType: typeof typeOrdering,
          received: typeOrdering,
        });
      }

      // Create a unique key for this specific update operation
      const debounceKey = `type-order-${collectionId}-${userId}`;

      // Debounce the update to prevent rapid API calls
      const result = await debounceOrderUpdate(
        debounceKey,
        async () => {
          return await updateTypeOrderService(
            collectionId,
            typeOrdering,
            userId
          );
        },
        TYPE_DEBOUNCE_DELAY
      );

      res.json({
        success: true,
        message: `Type order updated successfully. Processed ${result.processedItems || 0} type categories.`,
        data: result,
        processedItems: result.processedItems || 0,
      });
    } catch (error) {
      console.error('Error updating type order:', error);
      console.error('Request body:', req.body);
      res.status(500).json({
        error: 'Failed to update type order',
        message: error.message,
        receivedData: {
          typeOrdering: req.body.typeOrdering,
          typeOrderings: req.body.typeOrderings,
        },
      });
    }
  },

  async getTypeOrdering(req, res) {
    try {
      const { id: collectionId } = req.params;

      const typeOrdering = await getTypeOrderingService(collectionId);

      res.json({
        success: true,
        data: typeOrdering,
      });
    } catch (error) {
      console.error('Error fetching type ordering:', error);
      res.status(500).json({
        error: 'Failed to fetch type ordering',
        message: error.message,
      });
    }
  },

  async getExternalLinkOrdering(req, res) {
    try {
      const { id: collectionId } = req.params;
      const userId = req.auth.dbUserId;

      // Get all external links in the collection with their sort orders, grouped by type
      const linkOrdering = await db.execute(sql`
        SELECT 
          el.id,
          el.name,
          el.type,
          el.url,
          cel.sort_order,
          cel.created_at
        FROM collection_external_links cel
        JOIN external_links el ON cel.external_link_id = el.id
        WHERE cel.collection_id = ${collectionId}
        ORDER BY el.type, cel.sort_order ASC NULLS LAST, cel.created_at ASC
      `);

      // Group by type
      const groupedByType = linkOrdering.rows.reduce((acc, link) => {
        if (!acc[link.type]) {
          acc[link.type] = [];
        }
        acc[link.type].push({
          id: link.id,
          name: link.name,
          url: link.url,
          sortOrder: link.sort_order,
          createdAt: link.created_at,
        });
        return acc;
      }, {});

      res.json({
        success: true,
        data: groupedByType,
        totalLinks: linkOrdering.rows.length,
        types: Object.keys(groupedByType),
      });
    } catch (error) {
      console.error('Error fetching external link ordering:', error);
      res.status(500).json({
        error: 'Failed to fetch external link ordering',
        message: error.message,
      });
    }
  },

  /**
   * Get detailed collection data with full external links and notations for export
   */
  async getDetailedCollectionExportData(req, res) {
    try {
      const { id: collectionId } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (!userId) {
        return res.status(401).json({
          error: 'Unauthorized: User authentication required',
        });
      }

      const detailedData = await getDetailedCollectionExportDataService(
        collectionId,
        userId,
        tenantIds
      );

      if (!detailedData) {
        return res.status(404).json({
          error: 'Collection not found or access denied',
        });
      }

      res.json({
        success: true,
        data: detailedData,
      });
    } catch (error) {
      console.error('Error fetching detailed collection export data:', error);
      res.status(500).json({
        error: 'Failed to fetch detailed collection export data',
        message: error.message,
      });
    }
  },

  /**
   * Get collection by ID with pagination for external links and resources
   */
  async getCollectionByIdPaginated(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const { page = 1, limit = 20, itemType = 'all' } = req.query;
      const pageNum = parseInt(page);
      const limitNum = Math.min(parseInt(limit), 100); // Max 100 items per page
      const offset = (pageNum - 1) * limitNum;

      // First get basic collection info
      const basicCollection = await getCollectionByIdService(
        req.params.id,
        req.auth.dbUserId,
        tenantIds
      );

      if (!basicCollection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Security check: For unauthenticated users, verify the collection's tenant allows public access
      if (req.auth?.isPublicAccess && basicCollection.tenantId) {
        const visibilityMap = await getTenantVisibilitySettings([
          basicCollection.tenantId,
        ]);
        const tenantSettings = visibilityMap[basicCollection.tenantId];

        // If the tenant doesn't allow public resources, deny access
        if (!tenantSettings?.resources) {
          return res.status(403).json({
            error:
              'This collection belongs to a private tenant. Please sign in to access.',
          });
        }
      }

      // Initialize response object
      let response = {
        ...basicCollection,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          totalPages: 0,
        },
      };

      if (basicCollection.type === 'external') {
        // Get paginated external links
        const { externalLinks, total } =
          await getExternalLinksForCollectionByIdPaginatedService(
            basicCollection.id,
            req.auth.dbUserId,
            offset,
            limitNum
          );

        // Get attachments for the current page of external links
        const externalLinkIds = externalLinks.map((link) => link.id);
        const attachments = await getAttachmentsForExternalLinks(
          externalLinkIds,
          req.auth.dbUserId
        );

        // Process external links with attachments and timestamps
        response.externalLinks = externalLinks.map((link) => ({
          ...link,
          timestamps: isYoutubeUrl(link.url)
            ? parseTimestamps(link.description)
            : null,
          attachments: attachments
            .filter((attachment) => attachment.externalLinkId === link.id)
            .map((attachment) => ({
              ...attachment,
              presignedUrl: generatePresignedCloudFrontUrl(
                attachment.imageKey,
                3600
              ),
              thumbnailUrl:
                attachment.type === 'pdf'
                  ? generatePresignedCloudFrontUrl(
                      `thumbnails/${attachment.imageKey}.png`,
                      3600
                    )
                  : null,
            })),
        }));

        response.pagination.total = total;
        response.pagination.totalPages = Math.ceil(total / limitNum);
      } else {
        // Get paginated resources
        const { resources, total } =
          await getResourcesForCollectionByIdPaginatedService(
            basicCollection.id,
            req.auth.dbUserId,
            tenantIds,
            offset,
            limitNum
          );

        // Process resources with presigned URLs
        response.resources = resources.map((resource) => {
          const processedResource = withComputedFieldsResource(resource);

          if (processedResource.imageKey) {
            processedResource.presignedUrl = generatePresignedCloudFrontUrl(
              processedResource.imageKey,
              3600
            );
          }
          if (
            processedResource.type === 'video' &&
            processedResource.videoKey
          ) {
            processedResource.presignedVideoUrl =
              generatePresignedCloudFrontUrl(processedResource.videoKey, 3600);
          }

          return processedResource;
        });

        response.pagination.total = total;
        response.pagination.totalPages = Math.ceil(total / limitNum);
      }

      res.json(response);
    } catch (error) {
      console.error('Error fetching paginated collection:', error);
      res.status(500).json({ error: 'Failed to fetch collection' });
    }
  },

  async inviteCollectionCollaborator(req, res) {
    try {
      const { id: collectionId } = req.params;
      const { email, name, role, message, cascadeToExternalLinks } = req.body;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // Check if user's subscription allows collaborators
      const collaboratorPermissions =
        await subscriptionService.canAddCollaborators(userId);
      // if (!collaboratorPermissions.allowed) {
      //   return res.status(403).json({
      //     error: 'Collaboration features are not available in your current plan',
      //     upgradeRequired: true,
      //   });
      // }

      // Check if collection exists and user has access
      const collection = await getCollectionByIdService(
        collectionId,
        userId,
        tenantIds
      );
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Check if user is owner or has permission to manage collaborators
      if (collection.userId !== userId) {
        const userCollaborator = await db
          .select()
          .from(collectionCollaborators)
          .where(
            and(
              eq(collectionCollaborators.collectionId, collectionId),
              eq(collectionCollaborators.userId, userId)
            )
          )
          .limit(1);

        if (
          !userCollaborator[0] ||
          !userCollaborator[0].canManageCollaborators
        ) {
          return res.status(403).json({
            error:
              'You do not have permission to manage collaborators for this collection',
          });
        }
      }

      // Import the invitation service
      const { inviteCollectionCollaboratorService } = await import(
        '../services/invitationService.js'
      );

      // Invite the collaborator
      const inviteResult = await inviteCollectionCollaboratorService(
        collectionId,
        {
          email,
          name,
          role: role || 'editor',
          message,
        },
        userId,
        cascadeToExternalLinks || false
      );

      // Return appropriate response based on invitation type
      if (inviteResult.type === 'existing') {
        if (inviteResult.alreadyCollaborator) {
          return res.status(409).json({
            success: true,
            message: 'User is already a collaborator for this collection',
            data: snakeToCamelCase(inviteResult.collaborator),
          });
        }
        res.status(201).json({
          success: true,
          message: 'Collaborator added successfully',
          type: 'existing',
          data: snakeToCamelCase(inviteResult.collaborator),
        });
      } else {
        res.status(201).json({
          success: true,
          message:
            'Invitation sent successfully. User will be added as collaborator when they create an account.',
          type: 'pending',
          data: {
            invitationId: inviteResult.invitation.id,
            email: inviteResult.invitation.email,
            role: inviteResult.invitation.role,
            expiresAt: inviteResult.invitation.expiresAt,
          },
        });
      }
    } catch (error) {
      console.error('Error inviting collaborator to collection:', error);

      // Handle specific error cases
      if (error.message.includes('private collections')) {
        return res.status(403).json({
          error: 'Cannot add collaborators to private collections',
        });
      }

      if (error.message.includes('already a collaborator')) {
        return res.status(409).json({
          error: 'User is already a collaborator for this collection',
        });
      }

      res.status(500).json({
        error: error.message || 'Failed to invite collaborator',
      });
    }
  },

  async removeCollectionCollaborator(req, res) {
    try {
      const { id: collectionId, collaboratorId } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;

      if (!userId) {
        return res
          .status(401)
          .json({ error: 'Unauthorized: User authentication required' });
      }

      // Check if collection exists and user has access
      const collection = await getCollectionByIdService(
        collectionId,
        userId,
        tenantIds
      );
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Check if user is owner or has permission to manage collaborators
      if (collection.userId !== userId) {
        const userCollaborator = await db
          .select()
          .from(collectionCollaborators)
          .where(
            and(
              eq(collectionCollaborators.collectionId, collectionId),
              eq(collectionCollaborators.userId, userId)
            )
          )
          .limit(1);

        if (
          !userCollaborator[0] ||
          !userCollaborator[0].canManageCollaborators
        ) {
          return res.status(403).json({
            error:
              'You do not have permission to manage collaborators for this collection',
          });
        }
      }

      // Import the collaboration service
      const { removeCollectionCollaboratorWithCascade } = await import(
        '../services/collaborationService.js'
      );

      // Remove the collaborator with cascade
      const result = await removeCollectionCollaboratorWithCascade(
        collectionId,
        collaboratorId
      );

      if (result === 0) {
        return res.status(404).json({ error: 'Collaborator not found' });
      }

      res.status(200).json({
        success: true,
        message:
          'Collaborator removed successfully from collection and all associated external links',
      });
    } catch (error) {
      console.error('Error removing collection collaborator:', error);
      res.status(500).json({
        error: 'Failed to remove collaborator',
      });
    }
  },

  /**
   * Submit a public notation (no auth required for public submissions)
   */
  async submitPublicNotation(req, res) {
    try {
      const { externalLinkId } = req.params;
      const notationData = req.body;

      // First check if the external link allows public notations
      const externalLink = await getExternalLinkByIdService(externalLinkId, null);
      
      if (!externalLink) {
        return res.status(404).json({ error: 'External link not found' });
      }

      if (!externalLink.allowPublicNotations) {
        return res.status(403).json({ error: 'Public notations are not allowed for this link' });
      }

      // Get the collection external link ID
      const collectionExternalLinkId = await getCollectionExternalLinkIdService(
        externalLinkId
      );

      if (!collectionExternalLinkId) {
        return res.status(404).json({ error: 'Collection link not found' });
      }

      // Create the public notation with limited fields
      const publicNotationData = {
        title: notationData.title || 'Public Submission',
        description: notationData.description,
        notes: notationData.notes,
        status: notationData.status || 'Submitted',
        category: notationData.category || 'public-submission',
        visibility: 'public', // Public submissions are visible
        customFields: notationData.customFields || {},
        isPublicSubmission: true,
        submitterInfo: {
          name: notationData.submitterName,
          email: notationData.submitterEmail,
          submittedAt: new Date().toISOString()
        }
      };

      // Use the regular notation service but without user ID for public submissions
      const notation = await addNotationToExternalLinkService(
        collectionExternalLinkId,
        publicNotationData,
        null // No user ID for public submissions
      );

      res.status(201).json({
        message: 'Notation submitted successfully',
        notation: {
          id: notation.id,
          title: notation.title,
          status: notation.status
        }
      });
    } catch (error) {
      console.error('Error submitting public notation:', error);
      res.status(500).json({
        error: 'Failed to submit notation',
        message: error.message
      });
    }
  },
};

export const withComputedFieldsResource = (resource) => {
  if (resource.imageKey) {
    resource.imageUrl = constructS3Url(resource.imageKey);
  }
  return resource;
};
