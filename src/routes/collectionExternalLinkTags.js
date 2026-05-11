import express from 'express';
import { requireUserAndTenants } from '../middleware/authMiddleware.js';
import {
  getUserTagsService,
  createOrGetTagService,
  addTagsToCollectionExternalLinkService,
  removeTagsFromCollectionExternalLinkService,
  getTagsForCollectionExternalLinkService,
  searchTagsService,
  getCollectionExternalLinkIdService,
} from '../services/collectionExternalLinkTagsService.js';

const router = express.Router();

/**
 * Get all tags for the authenticated user
 */
router.get('/my-tags', requireUserAndTenants(), async (req, res) => {
  try {
    const userId = req.auth.dbUserId;
    const tenants = req.tenants?.map((t) => t.tenantId) || [];

    const tags = await getUserTagsService(userId, tenants);
    res.json(tags);
  } catch (error) {
    console.error('Error fetching user tags:', error);
    res.status(500).json({ message: 'Failed to fetch user tags' });
  }
});

/**
 * Search tags by name
 */
router.get('/search', requireUserAndTenants(), async (req, res) => {
  try {
    const { q } = req.query;
    const userId = req.auth.dbUserId;
    const tenants = req.tenants?.map((t) => t.tenantId) || [];

    if (!q || q.trim().length < 2) {
      return res
        .status(400)
        .json({ message: 'Search term must be at least 2 characters' });
    }

    const tags = await searchTagsService(q.trim(), userId, tenants);
    res.json(tags);
  } catch (error) {
    console.error('Error searching tags:', error);
    res.status(500).json({ message: 'Failed to search tags' });
  }
});

/**
 * Create a new tag or get existing one
 */
router.post('/create', requireUserAndTenants(), async (req, res) => {
  try {
    const { name, description, color } = req.body;
    const userId = req.auth.dbUserId;
    const tenantId = req.tenants?.[0]?.tenantId; // Use first tenant's ID

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ message: 'Tag name is required' });
    }

    if (!tenantId) {
      return res.status(400).json({ message: 'Tenant ID is required' });
    }

    const tag = await createOrGetTagService(
      { name: name.trim(), description, color },
      userId,
      tenantId
    );

    res.status(201).json(tag);
  } catch (error) {
    console.error('Error creating tag:', error);
    res.status(500).json({ message: 'Failed to create tag' });
  }
});

/**
 * Get tags for a specific external link
 */
router.get(
  '/external-link/:externalLinkId',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { externalLinkId } = req.params;

      // Get the collection external link ID
      const collectionExternalLinkId =
        await getCollectionExternalLinkIdService(externalLinkId);

      const tags = await getTagsForCollectionExternalLinkService(
        collectionExternalLinkId
      );
      res.json(tags);
    } catch (error) {
      console.error('Error fetching tags for external link:', error);
      res.status(500).json({ message: 'Failed to fetch tags' });
    }
  }
);

/**
 * Add tags to an external link
 */
router.post(
  '/external-link/:externalLinkId/add',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { externalLinkId } = req.params;
      const { tagIds } = req.body;

      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return res.status(400).json({ message: 'Tag IDs array is required' });
      }

      // Get the collection external link ID
      const collectionExternalLinkId =
        await getCollectionExternalLinkIdService(externalLinkId);

      const result = await addTagsToCollectionExternalLinkService(
        collectionExternalLinkId,
        tagIds
      );
      res.json(result);
    } catch (error) {
      console.error('Error adding tags to external link:', error);
      res.status(500).json({ message: 'Failed to add tags' });
    }
  }
);

/**
 * Remove tags from an external link
 */
router.delete(
  '/external-link/:externalLinkId/remove',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { externalLinkId } = req.params;
      const { tagIds } = req.body;

      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return res.status(400).json({ message: 'Tag IDs array is required' });
      }

      // Get the collection external link ID
      const collectionExternalLinkId =
        await getCollectionExternalLinkIdService(externalLinkId);

      const result = await removeTagsFromCollectionExternalLinkService(
        collectionExternalLinkId,
        tagIds
      );
      res.json(result);
    } catch (error) {
      console.error('Error removing tags from external link:', error);
      res.status(500).json({ message: 'Failed to remove tags' });
    }
  }
);

/**
 * Create tag and add to external link in one operation
 */
router.post(
  '/external-link/:externalLinkId/create-and-add',
  requireUserAndTenants(),
  async (req, res) => {
    try {
      const { externalLinkId } = req.params;
      const { name, description, color } = req.body;
      const userId = req.auth.dbUserId;
      const tenantId = req.tenants?.[0]?.tenantId;

      if (!name || name.trim().length === 0) {
        return res.status(400).json({ message: 'Tag name is required' });
      }

      if (!tenantId) {
        return res.status(400).json({ message: 'Tenant ID is required' });
      }

      // Get the collection external link ID
      const collectionExternalLinkId =
        await getCollectionExternalLinkIdService(externalLinkId);

      // Create or get the tag
      const tag = await createOrGetTagService(
        { name: name.trim(), description, color },
        userId,
        tenantId
      );

      // Add the tag to the collection external link
      await addTagsToCollectionExternalLinkService(collectionExternalLinkId, [
        tag.id,
      ]);

      res
        .status(201)
        .json({ tag, message: 'Tag created and added successfully' });
    } catch (error) {
      console.error('Error creating and adding tag:', error);
      res.status(500).json({ message: 'Failed to create and add tag' });
    }
  }
);

/**
 * Debug endpoint to test tag insertion
 */
router.post('/debug-add-tag', requireUserAndTenants(), async (req, res) => {
  try {
    const { externalLinkId, tagId } = req.body;

    if (!externalLinkId || !tagId) {
      return res.status(400).json({
        message: 'Both externalLinkId and tagId are required',
        received: { externalLinkId, tagId },
      });
    }

    // Get the collection external link ID
    const collectionExternalLinkId =
      await getCollectionExternalLinkIdService(externalLinkId);

    const result = await addTagsToCollectionExternalLinkService(
      collectionExternalLinkId,
      [tagId]
    );

    res.json({
      success: true,
      result,
      input: { externalLinkId, tagId, collectionExternalLinkId },
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({
      success: false,
      message: error.message,
      stack: error.stack,
    });
  }
});

export default router;
