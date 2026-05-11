import express from 'express';
import multer from 'multer';

import { organizationController } from '../controllers/organizationController.js';
import {
  requireAdmin,
  requireUser,
  requireUserAndTenants,
  optionalAuthAndTenants,
} from '../middleware/authMiddleware.js';
import { publicApiRateLimit } from '../middleware/rateLimitMiddleware.js';

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.post(
  '/',
  requireUserAndTenants(),
  upload.single('logo'),
  organizationController.createOrganization
);
router.get(
  '/',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  organizationController.getAllOrganizations
);
router.get(
  '/:id',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  organizationController.getOrganizationById
);
router.put(
  '/:id',
  requireUserAndTenants(),
  upload.single('logo'),
  organizationController.updateOrganization
);
router.delete(
  '/:id',
  requireUserAndTenants(),
  organizationController.deleteOrganization
);
router.get(
  '/:id/members',
  requireAdmin(),
  organizationController.getOrganizationMembers
);

router.post(
  '/:id/subscribe',
  requireUserAndTenants(),
  organizationController.subscribeToOrganization
);

router.delete(
  '/:id/subscribe',
  requireUserAndTenants(),
  organizationController.unsubscribeFromOrganization
);

router.get(
  '/subscriptions/my-subscriptions',
  requireUserAndTenants(),
  organizationController.getUserSubscriptions
);

router.get(
  '/members/all',
  requireAdmin(),
  organizationController.getAllOrganizationMembers
);

export default router;
