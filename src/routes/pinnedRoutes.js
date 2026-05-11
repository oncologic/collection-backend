import express from 'express';
import { pinnedController } from '../controllers/pinnedController.js';
import { requireUserAndTenants } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get all pinned items for the user
router.get('/', requireUserAndTenants(), pinnedController.getPinnedItems);

// Pin items
router.post('/', requireUserAndTenants(), pinnedController.pinItems);

// Unpin items
router.delete('/', requireUserAndTenants(), pinnedController.unpinItems);

// Update pinned item order
router.patch(
  '/:itemId/order',
  requireUserAndTenants(),
  pinnedController.updatePinnedItemOrder
);

export default router;
