import express from 'express';

import {
  requireUser,
  requireUserAndTenants,
} from '../middleware/authMiddleware.js';
import { sharedLinkController } from '../controllers/sharedLinksController.js';

const router = express.Router();

// Protected routes (require authentication)
router.post(
  '/',
  requireUserAndTenants(),
  sharedLinkController.createSharedLink
);
router.get(
  '/user',
  requireUserAndTenants(),
  sharedLinkController.getUserSharedLinks
);
router.delete(
  '/:linkId',
  requireUserAndTenants(),
  sharedLinkController.revokeSharedLink
);
router.patch(
  '/:linkId',
  requireUserAndTenants(),
  sharedLinkController.updateSharedLink
);
router.get(
  '/manage/:linkId',
  requireUserAndTenants(),
  sharedLinkController.getSharedLinkById
);

// Get shared links by type and ID (protected)
router.get(
  '/type/:type/id/:id',
  requireUserAndTenants(),
  sharedLinkController.getSharedLinksByTypeAndId
);

// Public routes (no authentication required, but email validation needed)

// Validate email access for a shared link
router.post(
  '/:linkId/validate-email',
  sharedLinkController.validateEmailAccess
);

// Access shared content (requires email in query params)
router.get('/:linkId', sharedLinkController.accessSharedContent);

// Get link groups for a shared link (requires email)
router.get('/:linkId/link-groups', sharedLinkController.getAllSharedLinkGroups);

// Review routes (require email validation)
router.post('/:linkId/user-info', sharedLinkController.submitReviewerInfo);
router.post('/:linkId/feedback', sharedLinkController.submitItemFeedback);
router.post('/:linkId/review/submit', sharedLinkController.submitReview);
router.get('/:linkId/review', sharedLinkController.getReviewData);

export default router;
