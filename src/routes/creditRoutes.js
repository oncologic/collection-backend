import express from 'express';
import { creditController } from '../controllers/creditController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get credit balance
router.get('/balance', requireUser(), creditController.getBalance);

// Get transaction history
router.get(
  '/transactions',
  requireUser(),
  creditController.getTransactionHistory
);

// Admin routes - require admin privileges
// Get any user's credit balance
router.get(
  '/admin/balance/:userId',
  requireAdmin(),
  creditController.getAdminBalance
);

// Add credits directly to any user's account
router.post(
  '/admin/add/:userId',
  requireAdmin(),
  creditController.addAdminCredits
);

// Set any user's credit balance to an exact amount
router.put(
  '/admin/balance/:userId',
  requireAdmin(),
  creditController.setAdminCredits
);

export default router;
