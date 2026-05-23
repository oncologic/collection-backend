import express from 'express';
import upload from '../middleware/upload.js';

import { collectionController } from '../controllers/collectionController.js';
import {
  requireAdmin,
  requireUser,
  requireUserAndTenants,
  requireAdvocate,
  optionalAuthAndTenants,
} from '../middleware/authMiddleware.js';
import { dragDropRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

router.get(
  '/',
  requireUserAndTenants(),
  collectionController.getAllCollections
);
router.get(
  '/resources',
  requireUserAndTenants(),
  collectionController.getResourcesForAllCollections
);
router.get(
  '/external-links',
  requireUserAndTenants(),
  collectionController.getExternalLinksForAllCollections
);
router.get(
  '/collaborated',
  requireUserAndTenants(),
  collectionController.getCollaboratedCollections
);
router.get(
  '/pinned',
  requireUserAndTenants(),
  collectionController.getPinnedCollections
);

router.post(
  '/:id/workflow-instance',
  requireUserAndTenants(),
  collectionController.createWorkflowInstanceFromTemplate
);

router.get(
  '/:id/workflow-timeline',
  requireUserAndTenants(),
  collectionController.getWorkflowTimeline
);

// Use optional auth to allow public/unlisted collections to be viewed without login
router.get(
  '/:id',
  optionalAuthAndTenants(),
  collectionController.getCollectionById
);

// Paginated collection route - also optional auth for public/unlisted collections
router.get(
  '/:id/paginated',
  optionalAuthAndTenants(),
  collectionController.getCollectionByIdPaginated
);

// Collaborator routes
router.get(
  '/:id/collaborators',
  requireUserAndTenants(),
  collectionController.getCollectionCollaborators
);

router.post(
  '/:id/collaborators',
  requireUserAndTenants(),
  collectionController.inviteCollectionCollaborator
);

router.delete(
  '/:id/collaborators/:collaboratorId',
  requireUserAndTenants(),
  collectionController.removeCollectionCollaborator
);

router.get(
  '/external-link/:externalLinkId/collaborators',
  requireUserAndTenants(),
  collectionController.getExternalLinkCollaborators
);

router.post(
  '/external-link/:externalLinkId/collaborators',
  requireUserAndTenants(),
  collectionController.inviteExternalLinkCollaborator
);

router.delete(
  '/external-link/:externalLinkId/collaborators/:collaboratorUserId',
  requireUserAndTenants(),
  collectionController.removeExternalLinkCollaborator
);

router.post(
  '/',
  requireUserAndTenants(),
  collectionController.createCollection
);

router.patch(
  '/:id',
  requireUserAndTenants(),
  collectionController.updateCollection
);

router.delete(
  '/:id/resource/:resourceId',
  requireUserAndTenants(),
  collectionController.deleteResourceFromCollection
);

router.delete(
  '/:id/external-link/:externalLinkId',
  requireUserAndTenants(),
  collectionController.deleteExternalLinkFromCollection
);

router.patch(
  '/:id/resources/:resourceId/order',
  requireUserAndTenants(),
  collectionController.updateResourceOrder
);

router.delete(
  '/:id',
  requireUserAndTenants(),
  collectionController.deleteCollection
);

// Merge collections endpoint
router.post(
  '/merge',
  requireUserAndTenants(),
  collectionController.mergeCollections
);

router.post(
  '/:id/external-link',
  requireUserAndTenants(),
  collectionController.addExternalLinkToCollection
);

// Use optional auth to allow public/unlisted external links to be viewed without login
router.get(
  '/external-link/:externalLinkId',
  optionalAuthAndTenants(),
  collectionController.getExternalLinkById
);

router.delete(
  '/:id/external-link/:externalLinkId',
  requireUserAndTenants(),
  collectionController.deleteExternalLinkFromCollection
);

router.get(
  '/:id/external-link',
  requireUserAndTenants(),
  collectionController.getExternalLinksForCollection
);

router.patch(
  '/:id/external-link/:externalLinkId',
  requireUserAndTenants(),
  collectionController.updateExternalLinkInCollection
);

// Notation routes
router.post(
  '/:id/external-link/:externalLinkId/notation',
  requireUserAndTenants(),
  collectionController.addExternalLinkNotation
);
router.get(
  '/external-link/:externalLinkId/notations',
  requireUserAndTenants(),
  collectionController.getExternalLinkNotations
);

// Public notation submission (no auth required)
router.post(
  '/external-link/:externalLinkId/public-notation',
  collectionController.submitPublicNotation
);
router.get(
  '/external-link/notation/:notationId',
  requireUserAndTenants(),
  collectionController.getNotationById
);
router.patch(
  '/external-link/notation/:notationId',
  requireUserAndTenants(),
  collectionController.updateExternalLinkNotation
);

router.delete(
  '/external-link/notation/:notationId',
  requireUserAndTenants(),
  collectionController.deleteExternalLinkNotation
);

// Thread routes
router.post(
  '/external-link/notation/:notationId/thread',
  requireUserAndTenants(),
  collectionController.addNotationThread
);
router.get(
  '/external-link/notation/:notationId/threads',
  requireUserAndTenants(),
  collectionController.getNotationThreads
);
router.patch(
  '/external-link/notation/thread/:threadId',
  requireUserAndTenants(),
  collectionController.updateNotationThread
);
router.delete(
  '/external-link/notation/thread/:threadId',
  requireUserAndTenants(),
  collectionController.deleteNotationThread
);

router.get(
  '/newsfeed/notations',
  requireUserAndTenants(),
  collectionController.getNotationsNewsFeed
);

// Public JSON sharing management routes
router.patch(
  '/:id/public-json-sharing',
  requireUserAndTenants(),
  collectionController.toggleCollectionPublicJsonSharing
);

router.patch(
  '/external-link/:externalLinkId/public-json-sharing',
  requireUserAndTenants(),
  collectionController.toggleExternalLinkPublicJsonSharing
);

router.get(
  '/public-sharing-status',
  requireUserAndTenants(),
  collectionController.getCollectionPublicSharingStatus
);

router.get(
  '/external-links/public-sharing-status',
  requireUserAndTenants(),
  collectionController.getExternalLinkPublicSharingStatus
);

// Sorting/ordering routes with rate limiting
router.patch(
  '/:id/external-link/:externalLinkId/order',
  dragDropRateLimit,
  requireUserAndTenants(),
  collectionController.updateExternalLinkOrder
);

router.patch(
  '/:id/type-ordering',
  dragDropRateLimit,
  requireUserAndTenants(),
  collectionController.updateTypeOrder
);

router.get(
  '/:id/type-ordering',
  requireUserAndTenants(),
  collectionController.getTypeOrdering
);

router.get(
  '/:id/external-link-ordering',
  requireUserAndTenants(),
  collectionController.getExternalLinkOrdering
);

// New endpoint for detailed collection export data
router.get(
  '/:id/detailed-export-data',
  requireUserAndTenants(),
  collectionController.getDetailedCollectionExportData
);

export default router;
