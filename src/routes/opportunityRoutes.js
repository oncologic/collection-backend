import express from 'express';
import { opportunityController } from '../controllers/opportunityController.js';
import {
  requireUser,
  requireUserAndTenants,
  optionalAuthAndTenants,
} from '../middleware/authMiddleware.js';
import {
  publicApiRateLimit,
} from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// Public routes (with optional auth for personalization)
router.get(
  '/',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  opportunityController.getOpportunities
);

// Protected routes - require authentication
router.post(
  '/',
  requireUserAndTenants(),
  opportunityController.createOpportunity
);

// Application routes (must come before /:id routes to avoid conflicts)
router.get(
  '/applications',
  requireUserAndTenants(),
  opportunityController.getUserApplications
);

router.patch(
  '/applications/:applicationId/review',
  requireUserAndTenants(),
  opportunityController.reviewApplication
);

router.delete(
  '/applications/:applicationId',
  requireUserAndTenants(),
  opportunityController.deleteApplication
);

// Messaging routes (must come before /:id routes)
router.post(
  '/messages',
  requireUserAndTenants(),
  opportunityController.sendMessage
);

router.get(
  '/messages',
  requireUserAndTenants(),
  opportunityController.getMessages
);

// Routes with :id parameter (must come after routes without :id)
router.get(
  '/:id',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  opportunityController.getOpportunityById
);

router.patch(
  '/:id',
  requireUserAndTenants(),
  opportunityController.updateOpportunity
);

router.post(
  '/:id/apply',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  opportunityController.applyToOpportunity
);

router.get(
  '/:id/applications',
  requireUserAndTenants(),
  opportunityController.getOpportunityApplications
);

// Save/bookmark routes
router.post(
  '/:id/save',
  requireUserAndTenants(),
  opportunityController.saveOpportunity
);

router.delete(
  '/:id/save',
  requireUserAndTenants(),
  opportunityController.unsaveOpportunity
);

export default router;