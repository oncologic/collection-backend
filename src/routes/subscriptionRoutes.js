import express from 'express';
import { subscriptionController } from '../controllers/subscriptionController.js';
import {
  requireUser,
  requireUserAndTenants,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Get all available subscription plans
router.get('/plans', subscriptionController.getAllPlans);

// Get user's current subscription (for frontend /api/subscriptions/current)
router.get(
  '/current',
  requireUser(),
  subscriptionController.getCurrentSubscription
);

// Get user's current subscription and usage
router.get(
  '/my-subscription',
  requireUser(),
  subscriptionController.getUserSubscription
);

// Get user's invoice history (for frontend /api/subscriptions/invoices)
router.get('/invoices', requireUser(), subscriptionController.getInvoices);

// Create Stripe subscription
router.post(
  '/create-subscription',
  requireUser(),
  subscriptionController.createStripeSubscription
);

// Validate plan change
router.post(
  '/validate-plan-change',
  requireUser(),
  subscriptionController.validatePlanChange
);

// Get plan comparison
router.get(
  '/compare/:targetPlan',
  requireUser(),
  subscriptionController.getPlanComparison
);

// Get downgrade cleanup suggestions
router.get(
  '/cleanup-suggestions/:targetPlan',
  requireUser(),
  subscriptionController.getDowngradeCleanupSuggestions
);

// Change subscription plan
router.post(
  '/change-plan',
  requireUser(),
  subscriptionController.changeSubscriptionPlan
);

// Clean up duplicate subscriptions
router.post(
  '/cleanup-duplicates',
  requireUser(),
  subscriptionController.cleanupDuplicateSubscriptions
);

// Sync subscription status with Stripe (for edge cases)
router.post(
  '/sync-status',
  requireUser(),
  subscriptionController.syncSubscriptionStatus
);

// Cancel subscription
router.post(
  '/cancel',
  requireUser(),
  subscriptionController.cancelSubscription
);

// Reactivate subscription
router.post(
  '/reactivate',
  requireUser(),
  subscriptionController.reactivateSubscription
);

// Update user's subscription plan (manual)
router.put(
  '/my-subscription',
  requireUser(),
  subscriptionController.updateUserSubscription
);

// Check subscription status
router.get(
  '/status',
  requireUser(),
  subscriptionController.checkSubscriptionStatus
);

// Get subscription limits
router.get(
  '/limits',
  requireUser(),
  subscriptionController.getSubscriptionLimits
);

// Stripe webhook for subscription events
router.post('/webhook', subscriptionController.handleStripeWebhook);

export default router;
