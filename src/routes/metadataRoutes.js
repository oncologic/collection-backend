import express from 'express';
import { metadataController } from '../controllers/metadataController.js';
import {
  requireUser,
  requireUserAndTenants,
  optionalAuthAndTenants,
} from '../middleware/authMiddleware.js';
import { publicApiRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// Metadata routes
router.get('/resource-types', publicApiRateLimit, optionalAuthAndTenants(), metadataController.getAllResourceTypes);
router.post(
  '/resource-types',
  requireUserAndTenants(),
  metadataController.createResourceType
);
router.put(
  '/resource-types/:id',
  requireUserAndTenants(),
  metadataController.updateResourceType
);
router.delete(
  '/resource-types/:id',
  requireUserAndTenants(),
  metadataController.deleteResourceType
);
router.get(
  '/event-types',
  requireUserAndTenants(),
  metadataController.getAllEventTypes
);
router.post(
  '/event-types',
  requireUserAndTenants(),
  metadataController.createEventType
);
router.put(
  '/event-types/:id',
  requireUserAndTenants(),
  metadataController.updateEventType
);
router.delete(
  '/event-types/:id',
  requireUserAndTenants(),
  metadataController.deleteEventType
);
router.get(
  '/sensitivity-levels',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  metadataController.getAllSensitivityLevels
);
router.get(
  '/expertise-levels',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  metadataController.getAllExpertiseLevels
);
router.get(
  '/link-groups',
  requireUserAndTenants(),
  metadataController.getAllLinkGroups
);
router.get(
  '/link-groups/:id',
  requireUserAndTenants(),
  metadataController.getLinkGroupById
);
router.post(
  '/link-groups',
  requireUserAndTenants(),
  metadataController.createLinkGroup
);
router.put(
  '/link-groups/:id',
  requireUserAndTenants(),
  metadataController.updateLinkGroup
);
router.delete(
  '/link-groups/:id',
  requireUserAndTenants(),
  metadataController.deleteLinkGroup
);
router.patch(
  '/link-groups/:id',
  requireUserAndTenants(),
  metadataController.patchLinkGroup
);

// router.get("/target-audiences", metadataController.getAllTargetAudiences);

export default router;
