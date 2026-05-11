import express from 'express';
import { socialMediaAccountTypesController } from '../controllers/socialMediaAccountTypesController.js';
import { requireUserAndTenants } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get all social media account types
router.get(
  '/',
  requireUserAndTenants(),
  socialMediaAccountTypesController.getAllAccountTypes
);

// Get a single social media account type
router.get(
  '/:id',
  requireUserAndTenants(),
  socialMediaAccountTypesController.getAccountTypeById
);

// Create a new social media account type
router.post(
  '/',
  requireUserAndTenants(),
  socialMediaAccountTypesController.createAccountType
);

// Update a social media account type
router.put(
  '/:id',
  requireUserAndTenants(),
  socialMediaAccountTypesController.updateAccountType
);

// Delete a social media account type
router.delete(
  '/:id',
  requireUserAndTenants(),
  socialMediaAccountTypesController.deleteAccountType
);

export default router;
