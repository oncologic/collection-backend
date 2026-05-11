import {
  createResourceService,
  deleteResourceService,
  getAllResources,
  updateResourceService,
  getResourcesByOrganizationIdService,
  getResourcesByCollectionIdService,
  addResourceToCollectionService,
  removeResourceFromCollectionService,
  getCollectionResourceService,
  getAllResourceCollectionsService,
  getResourceByIdService,
  getResourcesBySubscriptionsService,
  rateResourceService,
  getResourceRatingService,
  createPendingResourceSuggestionService,
  getPendingResourcesService,
  reviewPendingResourceService,
} from '../services/resourceService.js';
import { parseTimestamps } from '../utils/general.js';
import { uploadToS3, constructS3Url } from '../utils/s3Utils.js';
import { s3Uploader } from '../utils/s3Uploader.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { getPinnedItemsService } from '../services/pinnedService.js';
import { getUserById } from './userController.js';
import { getUserByIdService } from '../services/userService.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { autoUpdateResourceEmbedding } from '../services/vectorService.js';
import {
  isUserAdvocateInTenant,
  canEditOrDeleteItem,
} from '../utils/authHelpers.js';
import { allowsPublicResources } from '../services/tenantService.js';
import { RESOURCE_ACCESS_MODES } from '../services/resourceAccessService.js';
import {
  applyPubMedResourceDefaults,
  attachPubMedFigureToResourceData,
} from '../services/pubMedResourceImageService.js';

export const resourceController = {
  async createResource(req, res) {
    try {
      // Parse resource data from multipart form if we have a file
      let resourceData;
      if (req.file) {
        // When uploading with FormData, the resource data comes as a JSON string
        resourceData = JSON.parse(req.body.resource);
      } else {
        // Regular JSON request without file
        resourceData = req.body;
      }

      resourceData.addedByUserId = req.auth.dbUserId;

      // Handle image upload if present
      if (req.file) {
        try {
          // Sanitize filename to remove special characters and spaces
          const sanitizedFilename = req.file.originalname
            .replace(/[^\w\s.-]/g, '') // Remove special characters except word chars, spaces, dots, and hyphens
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
            .toLowerCase();

          const imageKey = `resources/${uuidv4()}-${sanitizedFilename}`;

          // Upload to S3 using the path or buffer
          if (req.file.path) {
            // File stored on disk
            await s3Uploader(req.file.path, imageKey, req.file.mimetype);
            // Clean up temp file
            if (fs.existsSync(req.file.path)) {
              fs.unlinkSync(req.file.path);
            }
          } else if (req.file.buffer) {
            // File in memory
            await s3Uploader(req.file.buffer, imageKey, req.file.mimetype);
          }

          resourceData.imageKey = imageKey;
        } catch (uploadError) {
          console.error('Error uploading image:', uploadError);
          // Clean up temp file on error
          if (req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(500).json({ error: 'Failed to upload image' });
        }
      }

      // Handle tenantId assignment
      const requestedTenantId = resourceData.tenantId;
      const authorizedTenantIds = req.tenantIds || [];

      // Validate that the requested tenant is authorized
      if (requestedTenantId) {
        if (!authorizedTenantIds.includes(requestedTenantId)) {
          return res.status(403).json({
            error:
              'You are not authorized to create resources in the requested tenant',
          });
        }
        resourceData.tenantId = requestedTenantId;
      } else if (authorizedTenantIds.length > 0) {
        // Default to first authorized tenant if no specific tenant requested
        resourceData.tenantId = authorizedTenantIds[0];
      } else {
        return res.status(400).json({
          error: 'No tenant specified and no authorized tenants found',
        });
      }

      // Check if user is trying to create resource in kidney tenant
      const KIDNEY_TENANT_ID = process.env.KIDNEY_TENANT_ID;
      if (
        resourceData.tenantId === KIDNEY_TENANT_ID &&
        !isUserAdvocateInTenant(req, KIDNEY_TENANT_ID)
      ) {
        return res.status(403).json({
          error:
            'Only administrators or advocates can create resources in the kidney cancer tenant',
        });
      }

      // Validate visibility permissions
      // Admins, advocates, or users in personal tenant can make resources public
      const COMMUNITY_TENANT_ID = process.env.COMMUNITY_TENANT;
      if (resourceData.visibility === 'public') {
        const isAdvocateInTenant = isUserAdvocateInTenant(
          req,
          resourceData.tenantId
        );
        if (
          !req.auth.isAdmin &&
          !isAdvocateInTenant &&
          resourceData.tenantId !== COMMUNITY_TENANT_ID
        ) {
          return res.status(403).json({
            error:
              'Only administrators, advocates, or users in the personal tenant can make resources public',
          });
        }
      }

      await applyPubMedResourceDefaults(resourceData);

      if (!req.file) {
        try {
          await attachPubMedFigureToResourceData(resourceData);
        } catch (pubMedImageError) {
          console.error(
            'Error attaching PubMed figure to resource data:',
            pubMedImageError
          );
        }
      }

      const resource = await createResourceService(resourceData);

      // Add presigned URL if image exists
      const responseData = {
        ...resource,
        imageUrl: resource.imageKey
          ? generatePresignedCloudFrontUrl(resource.imageKey)
          : null,
      };

      res.status(201).json(responseData);
    } catch (error) {
      console.error('Error creating resource:', error);
      res.status(500).json({
        error: error.message || 'Failed to create resource',
      });
    }
  },

  async deleteResource(req, res) {
    try {
      const tenantIds = req.tenantIds;
      // First, get the resource to check ownership
      const resource = await getResourceByIdService(
        req.params.id,
        req.auth.dbUserId,
        tenantIds
      );
      if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      // Check if user can delete this resource
      if (!canEditOrDeleteItem(req, resource)) {
        return res.status(403).json({
          error:
            'Forbidden: You must be an admin, advocate, or the resource creator to delete this resource',
        });
      }

      const deletedResource = await deleteResourceService(req.params.id);
      res.status(200).json(deletedResource);
    } catch (error) {
      console.error('Error deleting resource:', error);
      res.status(500).json({ error: 'Failed to delete resource' });
    }
  },

  async updateResource(req, res) {
    try {
      let imageKey = null;
      const tenantIds = req.tenantIds;

      // Parse resource data from multipart form if we have a file
      let resourceData;
      if (req.file) {
        // When uploading with FormData, the resource data comes as a JSON string
        resourceData = req.body.resource
          ? JSON.parse(req.body.resource)
          : req.body;

        // Handle new image upload
        try {
          // Sanitize filename to remove special characters and spaces
          const sanitizedFilename = req.file.originalname
            .replace(/[^\w\s.-]/g, '') // Remove special characters except word chars, spaces, dots, and hyphens
            .replace(/\s+/g, '-') // Replace spaces with hyphens
            .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
            .toLowerCase();

          imageKey = `resources/${uuidv4()}-${sanitizedFilename}`;

          // Upload to S3 using the path or buffer
          if (req.file.path) {
            // File stored on disk
            await s3Uploader(req.file.path, imageKey, req.file.mimetype);
            // Clean up temp file
            if (fs.existsSync(req.file.path)) {
              fs.unlinkSync(req.file.path);
            }
          } else if (req.file.buffer) {
            // File in memory
            await s3Uploader(req.file.buffer, imageKey, req.file.mimetype);
          }
        } catch (uploadError) {
          console.error('Error uploading image:', uploadError);
          // Clean up temp file on error
          if (req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(500).json({ error: 'Failed to upload image' });
        }
      } else {
        // Regular JSON request without file
        resourceData = req.body;
      }

      if (resourceData.featured !== undefined) {
        const featuredResource = await updateResourceService(req.params.id, {
          featured: resourceData.featured,
          listOrder: resourceData.listOrder,
        }, tenantIds, req.auth.dbUserId);
        return res.status(200).json(featuredResource);
      }

      // Get current resource to check organizations
      const currentResource = await getResourceByIdService(
        req.params.id,
        req.auth.dbUserId,
        tenantIds
      );
      if (!currentResource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      // Check if user can update this resource
      if (!canEditOrDeleteItem(req, currentResource)) {
        return res.status(403).json({
          error: 'You are not authorized to update this resource',
        });
      }

      // Only process organization changes if organizations are included in the request
      let organizationsToRemove = [];
      let orgsToAdd = [];

      // Check if organizations are provided in the update
      const hasOrganizations = resourceData.organizations !== undefined;

      if (hasOrganizations) {
        // Get current organization IDs
        const currentOrgIds = currentResource.organizations.map(
          (org) => org.id
        );

        // Get new organization IDs from request
        const newOrgIds = (resourceData.organizations || []).map((org) =>
          typeof org === 'object' ? org.id : org
        );

        if (!Array.isArray(newOrgIds)) {
          return res
            .status(400)
            .json({ error: 'Organizations must be provided as an array' });
        }

        // Find organizations to remove and add
        organizationsToRemove = currentOrgIds.filter(
          (id) => id && !newOrgIds.includes(id)
        );

        orgsToAdd = newOrgIds.filter((id) => id && !currentOrgIds.includes(id));
      }

      // Add the image key and organization changes to the resource data
      const updateData = {
        ...resourceData,
        ...(imageKey && { imageKey }),
        ...(organizationsToRemove.length > 0 && {
          organizationsToRemove: organizationsToRemove.filter(Boolean),
        }),
        ...(orgsToAdd.length > 0 && {
          orgsToAdd: orgsToAdd.filter(Boolean),
        }),
      };

      const resource = await updateResourceService(
        req.params.id,
        updateData,
        tenantIds,
        req.auth.dbUserId
      );

      // Check if resource was returned
      if (!resource) {
        console.error(
          `Resource not found after update. ID: ${req.params.id}, TenantIds: ${JSON.stringify(tenantIds)}, ImageKey: ${imageKey}`
        );
        return res.status(404).json({
          error:
            'Resource not found after update - possible tenant access issue',
        });
      }

      // Auto-update embeddings for the updated resource (non-blocking)
      autoUpdateResourceEmbedding(req.params.id).catch((error) => {
        console.error(
          'Failed to update embeddings for updated resource:',
          error
        );
      });

      // Construct the full URL for the response
      const responseData = {
        ...resource,
        imageUrl: resource?.imageKey
          ? generatePresignedCloudFrontUrl(resource.imageKey)
          : null,
        logoUrl: resource?.imageKey
          ? generatePresignedCloudFrontUrl(resource.imageKey)
          : null, // Keep for backward compatibility
      };

      res.status(200).json(responseData);
    } catch (error) {
      console.error('Error updating resource:', error);
      res.status(500).json({
        error: error.message || 'Failed to update resource',
      });
    }
  },

  async getAllResources(req, res) {
    try {
      let tenantIds = req.tenantIds;
      const isPublicAccess = req.auth.isPublicAccess;

      // For public access, filter to only tenants that allow public resources
      if (isPublicAccess) {
        // Use the tenants that specifically allow public resources
        const publicResourceTenants = req.auth.publicTenantsWithResources || [];

        if (publicResourceTenants.length === 0) {
          // No tenants allow public resources
          return res.status(403).json({
            error:
              'Public access to resources is not available for the requested tenants. Please sign in to access resources.',
          });
        }

        // Filter to only tenants that allow public resources
        tenantIds = publicResourceTenants;
      }

      // For public access, filter resources
      let resources;
      if (isPublicAccess) {
        // Public users only see resources from tenants that allow public access
        // Don't include pending resources for public access
        resources = await getAllResources(
          null, // No user ID for public access
          null,
          tenantIds,
          false // Don't include pending resources
        );

        // Filter out sensitive resources for public users
        resources = resources.filter((resource) => {
          // Filter by sensitivity level
          const sensitivityLevel =
            resource.sensitivityLevel?.name?.toLowerCase();
          return (
            sensitivityLevel !== 'high' && sensitivityLevel !== 'restricted'
          );
        });
      } else {
        // Authenticated users don't see pending resources unless they're admins/advocates
        // For now, regular users don't see pending resources
        resources = await getAllResources(
          req.auth.dbUserId,
          null,
          tenantIds,
          false
        );
      }

      // Only check pinned items for authenticated users
      let pinnedItems = [];
      if (!isPublicAccess && req.auth.dbUserId) {
        pinnedItems = await getPinnedItemsService(req.auth.dbUserId, tenantIds);
      }

      const combinedResources = resources.map((resource) => {
        //get the image url for each organization
        resource.organizations.forEach((organization) => {
          organization.imageUrl = generatePresignedCloudFrontUrl(
            organization.imageKey
          );
        });

        return {
          ...resource,
          pinned: pinnedItems.some((item) => item.id === resource.id),
        };
      });

      if (combinedResources.length === 0) {
        return res.status(200).json(resources);
      }

      // get the resource rating

      // Add logo URLs to each resource
      const resourcesWithUrls = combinedResources.map((resource) => ({
        ...resource,
        imageUrl: resource.imageKey
          ? generatePresignedCloudFrontUrl(resource.imageKey)
          : null,
        logoUrl: resource.imageKey
          ? generatePresignedCloudFrontUrl(resource.imageKey)
          : null, // Keep for backward compatibility
      }));

      res.status(200).json(resourcesWithUrls);
    } catch (error) {
      console.error('Error fetching resources:', error);
      res.status(500).json({ error: 'Failed to fetch resources' });
    }
  },

  async getResourceById(req, res) {
    try {
      let tenantIds = req.tenantIds;
      const isPublicAccess = req.auth.isPublicAccess;

      // For public access, filter to only tenants that allow public resources
      if (isPublicAccess) {
        const publicResourceTenants = req.auth.publicTenantsWithResources || [];

        if (publicResourceTenants.length === 0) {
          return res.status(403).json({
            error:
              'Public access to resources is not available for the requested tenants. Please sign in to access resources.',
          });
        }

        tenantIds = publicResourceTenants;
      }

      const resource = await getResourceByIdService(
        req.params.id,
        isPublicAccess ? null : req.auth.dbUserId,
        tenantIds,
        {
          accessMode: isPublicAccess
            ? RESOURCE_ACCESS_MODES.PUBLIC
            : RESOURCE_ACCESS_MODES.AUTHENTICATED,
          includeChildren: true,
          childAccessMode: isPublicAccess
            ? RESOURCE_ACCESS_MODES.PUBLIC
            : RESOURCE_ACCESS_MODES.AUTHENTICATED,
          childViewerUserId: isPublicAccess ? null : req.auth.dbUserId,
        }
      );

      if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      // For public access, check if resource should be accessible
      if (isPublicAccess) {
        // Check if resource belongs to a tenant that allows public resources
        const publicResourceTenants = req.auth.publicTenantsWithResources || [];

        if (!publicResourceTenants.includes(resource.tenantId)) {
          return res.status(403).json({ error: 'Access denied' });
        }

        // Check sensitivity level
        const sensitivityLevel = resource.sensitivityLevel?.name?.toLowerCase();
        if (sensitivityLevel === 'high' || sensitivityLevel === 'restricted') {
          return res.status(403).json({ error: 'Access denied' });
        }
      }

      // Get the resource rating
      const resourceRating = await getResourceRatingService(
        req.params.id,
        tenantIds
      );

      // Add logo URL and rating to the resource
      const resourceWithDetails = {
        ...resource,
        sensitivityLevel: resourceRating.rating,
        imageUrl: resource.imageKey
          ? generatePresignedCloudFrontUrl(resource.imageKey)
          : null,
        logoUrl: resource.imageKey
          ? generatePresignedCloudFrontUrl(resource.imageKey)
          : null, // Keep for backward compatibility
        rating: resourceRating,
      };

      res.status(200).json(resourceWithDetails);
    } catch (error) {
      console.error('Error fetching resource:', error);
      res.status(500).json({ error: 'Failed to fetch resource' });
    }
  },
  async getResourcesByOrganizationId(req, res) {
    try {
      const resources = await getResourcesByOrganizationIdService(
        req.params.id,
        req.auth?.dbUserId || null,
        req.tenantIds || []
      );

      res.status(200).json(resources);
    } catch (error) {
      console.error('Error fetching resources by organization ID:', error);
      res.status(500).json({ error: 'Failed to fetch resources' });
    }
  },

  async getAllResourceCollections(req, res) {
    try {
      const collections = await getAllResourceCollectionsService(
        req.auth.dbUserId
      );
      res.status(200).json(collections);
    } catch (error) {
      console.error('Error fetching collections:', error);
      res.status(500).json({ error: 'Failed to fetch collections' });
    }
  },
  async getResourcesByCollectionId(req, res) {
    try {
      const resources = await getResourcesByCollectionIdService(req.params.id);
      res.status(200).json(resources);
    } catch (error) {
      console.error('Error fetching resources by collection ID:', error);
      res.status(500).json({ error: 'Failed to fetch resources' });
    }
  },
  async addResourceToCollection(req, res) {
    try {
      const tenantIds = req.tenantIds;
      // First check if the resource exists
      const resource = await getResourceByIdService(
        req.params.resourceId,
        req.auth.dbUserId,
        tenantIds
      );
      if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      const result = await addResourceToCollectionService(
        req.params.collectionId,
        req.params.resourceId,
        req.body.note,
        req.auth.dbUserId,
        req.dbOrganizationId
      );
      res.status(200).json(result);
    } catch (error) {
      console.error('Error adding resource to collection:', error);
      res.status(500).json({ error: 'Failed to add resource to collection' });
    }
  },
  async removeResourceFromCollection(req, res) {
    try {
      // First check if the user is the one who added the resource
      const collectionResource = await getCollectionResourceService(
        req.params.collectionId,
        req.params.resourceId
      );

      if (!collectionResource) {
        return res
          .status(404)
          .json({ error: 'Resource not found in collection' });
      }

      // Check if user is admin or the one who added the resource
      if (collectionResource.userAddedById !== req.dbUserId) {
        return res.status(403).json({
          error:
            'Forbidden: You must be an admin or the user who added this resource to remove it',
        });
      }

      const resource = await removeResourceFromCollectionService(
        req.params.collectionId,
        req.params.resourceId,
        req.auth.dbUserId
      );
      res.status(200).json(resource);
    } catch (error) {
      console.error('Error removing resource from collection:', error);
      res
        .status(500)
        .json({ error: 'Failed to remove resource from collection' });
    }
  },
  async getResourcesBySubscriptions(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const resources = await getResourcesBySubscriptionsService(
        req.auth.dbUserId,
        tenantIds
      );
      res.status(200).json(resources);
    } catch (error) {
      console.error('Error fetching resources by subscriptions:', error);
      res.status(500).json({ error: 'Failed to fetch resources' });
    }
  },
  async rateResource(req, res) {
    try {
      const user = await getUserByIdService(req.auth.dbUserId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const rating = await rateResourceService(
        req.params.resourceId,
        user,
        req.body
      );
      res.status(200).json(rating);
    } catch (error) {
      console.error('Error rating resource:', error);
      res.status(500).json({ error: 'Failed to rate resource' });
    }
  },

  async suggestResource(req, res) {
    try {
      const { name, url, description, email, tenantId } = req.body;

      // Basic validation
      if (!name || !url) {
        return res.status(400).json({
          error: 'Name and URL are required',
        });
      }

      // Email validation
      if (!email) {
        return res.status(400).json({
          error: 'Email address is required',
        });
      }

      // Basic email format validation
      const emailRegex = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: 'Invalid email address format',
        });
      }

      // Tenant validation
      if (!tenantId) {
        return res.status(400).json({
          error: 'Tenant selection is required',
        });
      }

      // Validate that the tenant allows public resource suggestions
      const tenantAllowsPublicResources = await allowsPublicResources(tenantId);
      if (!tenantAllowsPublicResources) {
        return res.status(403).json({
          error: 'The selected tenant does not accept public resource suggestions',
        });
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          error: 'Invalid URL format',
        });
      }

      // Basic spam prevention: check for suspicious patterns
      const suspiciousPatterns = [
        /(bit\.ly|tinyurl|t\.co|goo\.gl)/i, // Shortened URLs (can be legitimate but often spam)
        /(viagra|cialis|casino|poker|loan|debt)/i, // Common spam keywords
      ];

      const isSuspicious = suspiciousPatterns.some((pattern) => {
        return (
          pattern.test(name) ||
          pattern.test(description || '') ||
          pattern.test(url)
        );
      });

      if (isSuspicious) {
        // Still create but log for review
        console.warn(
          `Suspicious resource suggestion detected: ${name} - ${url}`
        );
      }

      // Get user ID if authenticated, otherwise service will use system user
      const systemUserId = req.auth?.dbUserId || null;

      const resourceData = {
        name: name.trim(),
        url: url.trim(),
        description: description?.trim() || '',
        email: email.trim().toLowerCase(), // Store email in lowercase
        tenantId: tenantId.trim(),
        addedByUserId: systemUserId, // Service will create system user if null
      };

      const resource =
        await createPendingResourceSuggestionService(resourceData);

      res.status(201).json({
        message:
          'Resource suggestion submitted successfully. It will be reviewed by an administrator.',
        resource: {
          id: resource.id,
          name: resource.name,
          status: resource.status,
        },
      });
    } catch (error) {
      console.error('Error suggesting resource:', error);
      res.status(500).json({
        error: 'Failed to submit resource suggestion',
        message: error.message,
      });
    }
  },

  async getPendingResources(req, res) {
    try {
      const tenantIds = req.tenantIds;

      // Check if user is admin or advocate
      if (
        !req.auth.isAdmin &&
        !isUserAdvocateInTenant(req, process.env.KIDNEY_TENANT_ID)
      ) {
        return res.status(403).json({
          error: 'Only administrators or advocates can view pending resources',
        });
      }

      const pendingResources = await getPendingResourcesService(tenantIds);

      res.status(200).json(pendingResources);
    } catch (error) {
      console.error('Error fetching pending resources:', error);
      res.status(500).json({ error: 'Failed to fetch pending resources' });
    }
  },

  async reviewPendingResource(req, res) {
    try {
      const { resourceId } = req.params;
      const { status } = req.body; // 'approved' or 'rejected'
      const tenantIds = req.tenantIds;

      if (!['approved', 'rejected'].includes(status)) {
        return res.status(400).json({
          error: 'Invalid status. Must be "approved" or "rejected"',
        });
      }

      // Check if user is admin or advocate
      if (
        !req.auth.isAdmin &&
        !isUserAdvocateInTenant(req, process.env.KIDNEY_TENANT_ID)
      ) {
        return res.status(403).json({
          error:
            'Only administrators or advocates can review pending resources',
        });
      }

      // Get the resource to verify it exists and is pending
      const resource = await getResourceByIdService(
        resourceId,
        req.auth.dbUserId,
        tenantIds
      );

      if (!resource) {
        return res.status(404).json({ error: 'Resource not found' });
      }

      if (resource.status !== 'pending') {
        return res.status(400).json({
          error: 'Resource is not in pending status',
        });
      }

      const updatedResource = await reviewPendingResourceService(
        resourceId,
        status,
        req.auth.dbUserId
      );

      // If approved, generate embeddings
      if (status === 'approved') {
        autoUpdateResourceEmbedding(resourceId).catch((error) => {
          console.error(
            'Failed to generate embeddings for approved resource:',
            error
          );
        });
      }

      res.status(200).json({
        message: `Resource ${status} successfully`,
        resource: updatedResource,
      });
    } catch (error) {
      console.error('Error reviewing pending resource:', error);
      res.status(500).json({ error: 'Failed to review pending resource' });
    }
  },
};

export const withComputedFieldsResource = (resource) => {
  if (resource.imageKey) {
    resource.imageUrl = constructS3Url(resource.imageKey);
  }
  return resource;
};
