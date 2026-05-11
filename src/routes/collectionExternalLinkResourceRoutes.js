import express from 'express';
import { requireUserAndTenants } from '../middleware/authMiddleware.js';
import { collectionExternalLinkResourcesService } from '../services/collectionExternalLinkResourcesService.js';

const router = express.Router();

// Add resources to an external link within a collection
router.post(
  '/collections/:collectionId/external-links/:externalLinkId/resources',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { collectionId, externalLinkId } = req.params;
      const resourceData = req.body;
      const userId = req.auth.dbUserId;
      const organizationId = req.tenants?.[0]?.organizationId || null;

      const result =
        await collectionExternalLinkResourcesService.addResourcesToExternalLink(
          collectionId,
          externalLinkId,
          resourceData,
          userId,
          organizationId
        );

      res.status(201).json(result);
    } catch (error) {
      console.error('Error adding resources to external link:', error);
      res.status(500).json({
        error: 'Failed to add resources to external link',
        message: error.message,
      });
    }
  }
);

// Get all resources for an external link within a collection
router.get(
  '/collections/:collectionId/external-links/:externalLinkId/resources',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { collectionId, externalLinkId } = req.params;

      const resources =
        await collectionExternalLinkResourcesService.getResourcesForExternalLink(
          collectionId,
          externalLinkId
        );

      res.json({
        success: true,
        resources,
        count: resources.length,
      });
    } catch (error) {
      console.error('Error getting resources for external link:', error);
      res.status(500).json({
        error: 'Failed to get resources for external link',
        message: error.message,
      });
    }
  }
);

// Remove resources from an external link within a collection
router.delete(
  '/collections/:collectionId/external-links/:externalLinkId/resources',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { collectionId, externalLinkId } = req.params;
      const { resourceIds } = req.body;

      if (!resourceIds) {
        return res.status(400).json({
          error: 'Missing required field: resourceIds',
        });
      }

      const result =
        await collectionExternalLinkResourcesService.removeResourcesFromExternalLink(
          collectionId,
          externalLinkId,
          resourceIds
        );

      res.json(result);
    } catch (error) {
      console.error('Error removing resources from external link:', error);
      res.status(500).json({
        error: 'Failed to remove resources from external link',
        message: error.message,
      });
    }
  }
);

// Update resource order
router.patch(
  '/collections/:collectionId/external-links/:externalLinkId/resources/:resourceId/order',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { collectionId, externalLinkId, resourceId } = req.params;
      const { orderPosition } = req.body;

      if (orderPosition === undefined) {
        return res.status(400).json({
          error: 'Missing required field: orderPosition',
        });
      }

      const updated =
        await collectionExternalLinkResourcesService.updateResourceOrder(
          collectionId,
          externalLinkId,
          resourceId,
          orderPosition
        );

      res.json({
        success: true,
        resource: updated,
      });
    } catch (error) {
      console.error('Error updating resource order:', error);
      res.status(500).json({
        error: 'Failed to update resource order',
        message: error.message,
      });
    }
  }
);

// Update resource notes
router.patch(
  '/collections/:collectionId/external-links/:externalLinkId/resources/:resourceId/notes',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { collectionId, externalLinkId, resourceId } = req.params;
      const { notes } = req.body;

      const updated =
        await collectionExternalLinkResourcesService.updateResourceNotes(
          collectionId,
          externalLinkId,
          resourceId,
          notes
        );

      res.json({
        success: true,
        resource: updated,
      });
    } catch (error) {
      console.error('Error updating resource notes:', error);
      res.status(500).json({
        error: 'Failed to update resource notes',
        message: error.message,
      });
    }
  }
);

export { router as collectionExternalLinkResourceRoutes };
