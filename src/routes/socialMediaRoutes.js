import express from 'express';
import { socialMediaController } from '../controllers/socialMediaController.js';

import { requireUserAndTenants } from '../middleware/authMiddleware.js';

const router = express.Router();

// Platform routes
router.get(
  '/platforms',
  requireUserAndTenants(),
  socialMediaController.getAllPlatforms
);
router.get(
  '/platforms/catalog',
  requireUserAndTenants(),
  socialMediaController.getPlatformCatalog
);
router.get(
  '/platforms/:id',
  requireUserAndTenants(),
  socialMediaController.getPlatformById
);
router.post(
  '/platforms',
  requireUserAndTenants(),
  socialMediaController.createPlatform
);
router.put(
  '/platforms/:id',
  requireUserAndTenants(),
  socialMediaController.updatePlatform
);
router.delete(
  '/platforms/:id',
  requireUserAndTenants(),
  socialMediaController.deletePlatform
);

// Social Media Account routes
router.get(
  '/accounts',
  requireUserAndTenants(),
  socialMediaController.getAllAccounts
);
router.get(
  '/accounts/:id',
  requireUserAndTenants(),
  socialMediaController.getAccountById
);
router.get(
  '/platforms/:platformId/accounts/:accountType',
  requireUserAndTenants(),
  socialMediaController.getAccountsByType
);
router.post(
  '/accounts',
  requireUserAndTenants(),
  socialMediaController.createAccount
);
router.post(
  '/accounts/bulk',
  requireUserAndTenants(),
  socialMediaController.bulkCreateAccounts
);
router.put(
  '/accounts/:id',
  requireUserAndTenants(),
  socialMediaController.updateAccount
);
router.delete(
  '/accounts/:id',
  requireUserAndTenants(),
  socialMediaController.deleteAccount
);

// Social Media Associations routes
router.get(
  '/associations',
  requireUserAndTenants(),
  socialMediaController.getAssociations
);
router.post(
  '/associations',
  requireUserAndTenants(),
  socialMediaController.createAssociation
);
router.delete(
  '/associations',
  requireUserAndTenants(),
  socialMediaController.deleteAssociation
);

export default router;
