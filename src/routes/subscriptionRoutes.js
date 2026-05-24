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

// Cancel subscription
router.post(
  '/cancel',
  requireUser(),
  subscriptionController.cancelSubscription
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

export default router;
