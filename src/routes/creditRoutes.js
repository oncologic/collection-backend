import express from 'express';
import { creditController } from '../controllers/creditController.js';
import { requireUser } from '../middleware/authMiddleware.js';
import { requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get credit balance
router.get('/balance', requireUser(), creditController.getBalance);

// Add credits (typically called after successful Stripe payment)
router.post('/add', requireUser(), creditController.addCredits);

// Get transaction history
router.get(
  '/transactions',
  requireUser(),
  creditController.getTransactionHistory
);

// Create Stripe payment intent
router.post(
  '/create-payment-intent',
  requireUser(),
  creditController.createPaymentIntent
);

// Get billing history (includes both credit transactions and Stripe receipts)
router.get(
  '/billing-history',
  requireUser(),
  creditController.getBillingHistory
);

// Get receipt for specific transaction
router.get(
  '/receipt/:transactionId',
  requireUser(),
  creditController.getReceipt
);

// Admin routes - require admin privileges
// Get any user's credit balance
router.get(
  '/admin/balance/:userId',
  requireAdmin(),
  creditController.getAdminBalance
);

// Add credits directly to any user's account (bypass Stripe)
router.post(
  '/admin/add/:userId',
  requireAdmin(),
  creditController.addAdminCredits
);

// Webhook route - the raw body parser middleware is already applied in app.js
router.post('/webhook', creditController.handleStripeWebhook);

export default router;
