import express from 'express';
import {
  requireUser,
  requireUserAndTenants,
} from '../middleware/authMiddleware.js';
import {
  createNotation,
  updateNotation,
  deleteNotation,
  addTagsToNotation,
  removeTagsFromNotation,
} from '../controllers/notationController.js';

const router = express.Router();

// Create a new notation
router.post(
  '/notations',
  requireUserAndTenants(),
  createNotation
);

// Update a notation
router.put(
  '/notations/:notationId',
  requireUserAndTenants(),
  updateNotation
);

// Delete a notation
router.delete(
  '/notations/:notationId',
  requireUserAndTenants(),
  deleteNotation
);

// Add tags to a notation
router.post(
  '/notations/:notationId/tags',
  requireUserAndTenants(),
  addTagsToNotation
);

// Remove tags from a notation
router.delete(
  '/notations/:notationId/tags',
  requireUserAndTenants(),
  removeTagsFromNotation
);

export default router;