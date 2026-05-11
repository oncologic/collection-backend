import express from 'express';
import upload from '../middleware/upload.js';

import { resourceController } from '../controllers/resourceController.js';
import {
  requireUser,
  requireUserAndTenants,
  optionalAuthAndTenants,
} from '../middleware/authMiddleware.js';
import {
  publicApiRateLimit,
  resourceSuggestionRateLimit,
} from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

router.post(
  '/',
  requireUserAndTenants(),
  upload.single('image'),
  resourceController.createResource
);
router.get(
  '/',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  resourceController.getAllResources
);
router.get('/collections', resourceController.getAllResourceCollections);
router.get('/collections/:id', resourceController.getResourcesByCollectionId);

router.post(
  '/collections/:collectionId/resource/:resourceId',
  requireUserAndTenants(),
  resourceController.addResourceToCollection
);
router.delete(
  '/collections/:collectionId/resource/:resourceId',
  requireUserAndTenants(),
  resourceController.removeResourceFromCollection
);

router.get(
  '/subscriptions',
  requireUserAndTenants(),
  resourceController.getResourcesBySubscriptions
);

// Admin endpoints for reviewing pending resources - MUST come before /:id route
router.get(
  '/pending',
  requireUserAndTenants(),
  resourceController.getPendingResources
);

router.get(
  '/:id',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  resourceController.getResourceById
);
router.patch(
  '/:id',
  requireUserAndTenants(),
  upload.single('image'),
  resourceController.updateResource
);
router.delete(
  '/:id',
  requireUserAndTenants(),
  resourceController.deleteResource
);
router.get(
  '/organization/:id',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  resourceController.getResourcesByOrganizationId
);

router.post(
  '/:resourceId/rate',
  requireUserAndTenants(),
  resourceController.rateResource
);

// Public endpoint for suggesting resources (with strict rate limiting)
router.post(
  '/suggest',
  resourceSuggestionRateLimit,
  optionalAuthAndTenants(),
  resourceController.suggestResource
);

router.patch(
  '/:resourceId/review',
  requireUserAndTenants(),
  resourceController.reviewPendingResource
);

export default router;
