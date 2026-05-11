import { clerkClient } from '@clerk/express';
import {
  createOrganizationService,
  deleteOrganizationService,
  getAllOrganizations,
  getOrganizationById,
  updateOrganizationService,
  getOrganizationMembersService,
  subscribeToOrganization,
  unsubscribeFromOrganization,
  getUserSubscribedOrganizations,
  getAllOrganizationMembersService,
} from '../services/organizationService.js';
import { uploadToS3, constructS3Url } from '../utils/s3Utils.js';
import { sendSubscriptionNotificationEmail } from '../services/emailService.js';
import { getUserById } from './userController.js';
import { getUserByIdService } from '../services/userService.js';
import { v4 as uuidv4 } from 'uuid';
import { s3Uploader, s3Delete } from '../utils/s3Uploader.js';
import { isUserAdvocateInTenant } from '../utils/authHelpers.js';

import heicConvert from 'heic-convert';

export const organizationController = {
  async createOrganization(req, res) {
    const organizationData = { ...req.body };
    organizationData.userId = req.auth.dbUserId;

    // Handle tenantId assignment
    // Use tenantId from request body if provided, otherwise use first authorized tenant
    const requestedTenantId = req.body.tenantId;
    const authorizedTenantIds = req.tenantIds || [];

    // Validate that the requested tenant is authorized
    if (requestedTenantId) {
      if (!authorizedTenantIds.includes(requestedTenantId)) {
        return res.status(403).json({
          error:
            'You are not authorized to create organizations in the requested tenant',
        });
      }
      organizationData.tenantId = requestedTenantId;
    } else if (authorizedTenantIds.length > 0) {
      // Default to first authorized tenant if no specific tenant requested
      organizationData.tenantId = authorizedTenantIds[0];
    } else {
      return res.status(400).json({
        error: 'No tenant specified and no authorized tenants found',
      });
    }

    // Check if user is trying to create organization in kidney tenant
    // Allow both admins and advocates to create organizations
    const KIDNEY_TENANT_ID = process.env.KIDNEY_TENANT_ID;
    if (
      organizationData.tenantId === KIDNEY_TENANT_ID &&
      !req.auth.isAdmin &&
      !isUserAdvocateInTenant(req, KIDNEY_TENANT_ID)
    ) {
      return res.status(403).json({
        error:
          'Only administrators and advocates can create organizations in the kidney cancer tenant',
      });
    }

    try {
      // Handle image upload if a file is provided
      if (req.file) {
        try {
          let buffer = req.file.buffer;
          let mimeType = req.file.mimetype;

          // Handle HEIC/HEIF format conversion
          if (mimeType === 'image/heic' || mimeType === 'image/heif') {
            const convertedBuffer = await heic({
              buffer: req.file.buffer,
              format: 'JPEG',
              quality: 0.9,
            });
            buffer = convertedBuffer;
            mimeType = 'image/jpeg';
          }

          // Generate a unique key for S3
          const fileExtension =
            mimeType === 'image/jpeg'
              ? 'jpg'
              : req.file.originalname.split('.').pop();
          const key = `organizations/${uuidv4()}.${fileExtension}`;

          // Upload to S3
          await s3Uploader(buffer, key, mimeType);

          // Add the image key and URL to organization data
          organizationData.imageKey = key;
        } catch (error) {
          console.error('Error uploading organization image:', error);
          throw new Error('Failed to upload organization image');
        } finally {
          // Clean up the buffer
          req.file.buffer = null;
        }
      }

      // Create the organization with the image data
      const organization = await createOrganizationService(organizationData);

      return res.status(201).json(organization);
    } catch (error) {
      console.error('Error creating organization:', error);

      // If there was an error and we uploaded an image, try to clean it up
      if (organizationData.imageKey) {
        try {
          await s3Delete(organizationData.imageKey);
        } catch (deleteError) {
          console.error(
            'Error cleaning up image after failed organization creation:',
            deleteError
          );
        }
      }

      return res.status(500).json({ error: 'Error creating organization' });
    }
  },

  async deleteOrganization(req, res) {
    try {
      const { id } = req.params;
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId || null;
      // Get the organization details before deletion to access imageKey
      const organization = await getOrganizationById(id, tenantIds, userId);
      if (!organization) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      // Check if user is admin or the creator of the organization
      const user = await getUserByIdService(req.auth.dbUserId);
      const isAdmin = user.userRoles.some((role) => role.value === 'admin');
      const isCreator = req.auth.dbUserId === organization.userId;

      if (!isAdmin && !isCreator) {
        return res.status(403).json({
          error: 'You are not authorized to delete this organization',
        });
      }

      // If organization has an image, delete it from S3
      if (organization.imageKey) {
        try {
          await s3Delete(organization.imageKey);
        } catch (deleteError) {
          console.error(
            'Error deleting organization image from S3:',
            deleteError
          );
          // Continue with organization deletion even if image deletion fails
        }
      }

      // Delete the organization from the database
      await deleteOrganizationService(id);

      return res
        .status(200)
        .json({ message: 'Organization deleted successfully' });
    } catch (error) {
      // Handle specific error for related items
      if (error.statusCode === 409 && error.relatedItems) {
        return res.status(409).json({
          error: 'Cannot delete organization with related items',
          message: `This organization has ${error.relatedItems.details.join(', ')} associated with it. Please delete or reassign these items before deleting the organization.`,
          relatedItems: error.relatedItems,
        });
      }

      return res.status(500).json({ error: 'Error deleting organization' });
    }
  },

  async updateOrganization(req, res) {
    try {
      let imageKey = null;
      const tenantIds = req.tenantIds;
      const userId = req.auth.dbUserId;

      // First fetch the existing organization
      const existingOrganization = await getOrganizationById(
        req.params.id,
        tenantIds,
        userId
      );

      if (!existingOrganization) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      // If there's a file in the request, upload it to S3
      if (req.file) {
        try {
          let buffer = req.file.buffer;
          let mimeType = req.file.mimetype;

          // Handle HEIC/HEIF format conversion if needed
          if (mimeType === 'image/heic' || mimeType === 'image/heif') {
            try {
              const convertedBuffer = await heicConvert({
                buffer: req.file.buffer,
                format: 'JPEG',
                quality: 0.9,
              });
              buffer = convertedBuffer;
              mimeType = 'image/jpeg';
            } catch (conversionError) {
              throw new Error('Error converting HEIC image');
            }
          }

          // Generate a unique key for S3
          const fileExtension =
            mimeType === 'image/jpeg'
              ? 'jpg'
              : req.file.originalname.split('.').pop();
          const key = `organizations/${uuidv4()}.${fileExtension}`;

          // Upload to S3
          await s3Uploader(buffer, key, mimeType);

          // Only attempt to delete if there's a valid existing image key
          if (
            existingOrganization?.imageKey &&
            existingOrganization.imageKey !== 'null'
          ) {
            await s3Delete(existingOrganization.imageKey);
          }

          imageKey = key;
        } catch (error) {
          console.error('Error uploading organization image:', error);
          throw new Error('Failed to upload organization image');
        } finally {
          // Clean up the buffer
          req.file.buffer = null;
        }
      }

      // Check if body is empty but there's no file upload either
      if (!req.file && (!req.body || Object.keys(req.body).length === 0)) {
        return res.status(400).json({
          error:
            'No data provided for update. Please send data as multipart/form-data or ensure Content-Type is set correctly.',
        });
      }

      // Add the image key to the organization data if a new image was uploaded
      const organizationData = {
        ...req.body,
        ...(imageKey && { imageKey }),
      };

      // Remove imageUrl if it exists in the request body
      if ('imageUrl' in organizationData) {
        delete organizationData.imageUrl;
        delete organizationData.logoUrl;
      }

      if (
        existingOrganization.userId === 'null' ||
        existingOrganization.userId === null
      ) {
        organizationData.userId = userId;
      }

      const organization = await updateOrganizationService(
        req.params.id,
        organizationData
      );

      // Construct the full URL for the response
      const responseData = {
        ...organization,
        logoUrl: organization.imageKey
          ? constructS3Url(organization.imageKey)
          : null,
      };

      res.status(200).json(responseData);
    } catch (error) {
      console.error('Error updating organization:', error);
      res.status(500).json({ error: 'Failed to update organization' });
    }
  },

  async getAllOrganizations(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId || null;
      const organizations = await getAllOrganizations(tenantIds, userId);

      if (organizations.length === 0) {
        return res.status(200).json(organizations);
      }

      const organizationsWithUrls = organizations.map((org) => ({
        ...org,
        logoUrl: org.imageKey ? constructS3Url(org.imageKey) : null,
      }));

      res.status(200).json(organizationsWithUrls);
    } catch (error) {
      console.error('Error fetching organizations:', error);
      res.status(500).json({ error: 'Failed to fetch organizations' });
    }
  },

  async getOrganizationById(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId || null;
      const organization = await getOrganizationById(
        req.params.id,
        tenantIds,
        userId
      );
      if (!organization) {
        return res.status(403).json({ error: 'Organization not found' });
      }
      // Add logo URL to the organization
      const organizationWithUrl = {
        ...organization,
        logoUrl: organization.imageKey
          ? constructS3Url(organization.imageKey)
          : null,
      };

      res.status(200).json(organizationWithUrl);
    } catch (error) {
      console.error('Error fetching organization:', error);
      res.status(500).json({ error: 'Failed to fetch organization' });
    }
  },
  async getOrganizationMembers(req, res) {
    try {
      const tenantIds = req.tenantIds;
      const userId = req.auth?.dbUserId || null;
      const organization = await getOrganizationById(
        req.params.id,
        tenantIds,
        userId
      );
      if (!organization) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      const members = await getOrganizationMembersService(organization.id);

      res.status(200).json(members);
    } catch (error) {
      console.error('Error fetching organization members:', error);
      res.status(500).json({ error: 'Failed to fetch organization members' });
    }
  },
  async subscribeToOrganization(req, res) {
    try {
      const organizationId = req.params.id;
      const userId = req.auth.dbUserId;
      const role = req.body.role;
      const tenantIds = req.tenantIds;
      // Check if organization exists
      const organization = await getOrganizationById(
        organizationId,
        tenantIds,
        userId
      );
      if (!organization) {
        return res.status(404).json({ error: 'Organization not found' });
      }

      const subscription = await subscribeToOrganization(
        userId,
        organizationId,
        role
      );

      // Get user data from Clerk
      const user = await getUserByIdService(userId);

      const userData = {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      };

      // Send notification email
      await sendSubscriptionNotificationEmail(userData, organization);

      res.status(201).json({
        message: 'Successfully subscribed to organization',
        subscription,
      });
    } catch (error) {
      console.error('Error subscribing to organization:', error);
      if (error.message === 'User is already subscribed to this organization') {
        return res.status(409).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to subscribe to organization' });
    }
  },

  async unsubscribeFromOrganization(req, res) {
    try {
      const organizationId = req.params.id;
      const userId = req.auth.dbUserId;

      const unsubscribed = await unsubscribeFromOrganization(
        userId,
        organizationId
      );
      res.status(200).json({
        message: 'Successfully unsubscribed from organization',
        unsubscribed,
      });
    } catch (error) {
      console.error('Error unsubscribing from organization:', error);
      if (error.message === 'Subscription not found') {
        return res.status(404).json({ error: error.message });
      }
      res
        .status(500)
        .json({ error: 'Failed to unsubscribe from organization' });
    }
  },
  async getUserSubscriptions(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const subscribedOrganizations = await getUserSubscribedOrganizations(
        userId,
        tenantIds
      );

      if (subscribedOrganizations.length === 0) {
        return res.status(200).json({
          message: 'User has no subscriptions',
          organizations: [],
        });
      }

      res.status(200).json({
        message: 'Successfully retrieved subscribed organizations',
        organizations: subscribedOrganizations,
      });
    } catch (error) {
      console.error('Error fetching user subscriptions:', error);
      res.status(500).json({
        error: 'Failed to fetch subscribed organizations',
      });
    }
  },
  async getAllOrganizationMembers(req, res) {
    try {
      const members = await getAllOrganizationMembersService();
      res.status(200).json(members);
    } catch (error) {
      console.error('Controller error:', error);
      res.status(500).json({ message: error.message });
    }
  },
};

export const withComputedFields = (organization) => {
  if (organization.imageKey) {
    organization.imageUrl = constructS3Url(organization.imageKey);
  }
  return organization;
};
