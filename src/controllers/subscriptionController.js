import { subscriptionService } from '../services/subscriptionService.js';
import { snakeToCamelCase } from '../utils/general.js';

export const subscriptionController = {
  // Get all available subscription plans
  async getAllPlans(req, res) {
    try {
      const plans = await subscriptionService.getAllPlans();
      res.json(plans.map(snakeToCamelCase));
    } catch (error) {
      console.error('Error fetching subscription plans:', error);
      res.status(500).json({ error: 'Failed to fetch subscription plans' });
    }
  },

  // Get user's subscription details
  async getUserSubscription(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const [subscription, usage] = await Promise.all([
        subscriptionService.getUserSubscriptionPlan(userId),
        subscriptionService.getUsageStats(userId, req.auth.tenantIds || []),
      ]);

      res.json({
        subscription: snakeToCamelCase(subscription),
        usage: snakeToCamelCase(usage),
      });
    } catch (error) {
      console.error('Error fetching user subscription:', error);
      res.status(500).json({ error: 'Failed to fetch subscription details' });
    }
  },

  // Validate plan change
  async validatePlanChange(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { planName } = req.body;

      if (!planName) {
        return res.status(400).json({ error: 'Plan name is required' });
      }

      const validation = await subscriptionService.validatePlanChange(
        userId,
        planName
      );
      res.json(validation);
    } catch (error) {
      console.error('Error validating plan change:', error);
      res.status(500).json({ error: 'Failed to validate plan change' });
    }
  },

  // Get plan comparison
  async getPlanComparison(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { targetPlan } = req.params;

      const { plan: currentPlan } =
        await subscriptionService.getUserSubscriptionPlan(userId);
      const comparison = await subscriptionService.getPlanComparison(
        currentPlan.name,
        targetPlan
      );

      res.json(comparison);
    } catch (error) {
      console.error('Error getting plan comparison:', error);
      res.status(500).json({ error: 'Failed to get plan comparison' });
    }
  },

  // Get downgrade cleanup suggestions
  async getDowngradeCleanupSuggestions(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { targetPlan } = req.params;

      const suggestions =
        await subscriptionService.getDowngradeCleanupSuggestions(
          userId,
          targetPlan,
          req.auth.tenantIds || []
        );

      res.json(suggestions);
    } catch (error) {
      console.error('Error getting cleanup suggestions:', error);
      res.status(500).json({ error: 'Failed to get cleanup suggestions' });
    }
  },

  // Change subscription plan
  async changeSubscriptionPlan(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { planName } = req.body;

      if (!planName) {
        return res.status(400).json({ error: 'Plan name is required' });
      }

      // Validate the plan change first
      const validation = await subscriptionService.validatePlanChange(
        userId,
        planName
      );
      if (!validation.allowed) {
        return res.status(400).json({
          error: validation.message,
          reason: validation.reason,
          details: validation,
        });
      }

      const updatedUser = await subscriptionService.updateUserSubscriptionPlan(
        userId,
        planName
      );

      res.json({
        message: `Subscription ${validation.changeType}d successfully`,
        changeType: validation.changeType,
        newPlan: planName,
        user: snakeToCamelCase(updatedUser),
      });
    } catch (error) {
      console.error('Error changing subscription plan:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Cancel subscription
  async cancelSubscription(req, res) {
    try {
      const userId = req.auth.dbUserId;

      const updatedUser = await subscriptionService.updateUserSubscriptionPlan(
        userId,
        'basic'
      );

      res.json({
        message: 'Subscription canceled successfully',
        planName: 'basic',
        user: snakeToCamelCase(updatedUser),
      });
    } catch (error) {
      console.error('Error canceling subscription:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Update user's subscription plan (for manual updates)
  async updateUserSubscription(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const { planName, subscriptionEndDate } = req.body;

      if (!planName) {
        return res.status(400).json({ error: 'Plan name is required' });
      }

      // Validate the plan change first
      const validation = await subscriptionService.validatePlanChange(
        userId,
        planName
      );
      if (!validation.allowed) {
        return res.status(400).json({
          error: validation.message,
          reason: validation.reason,
          details: validation,
        });
      }

      const updatedUser = await subscriptionService.updateUserSubscriptionPlan(
        userId,
        planName,
        subscriptionEndDate
      );

      res.json({
        message: 'Subscription updated successfully',
        user: snakeToCamelCase(updatedUser),
      });
    } catch (error) {
      console.error('Error updating subscription:', error);
      if (error.message === 'Invalid subscription plan') {
        return res.status(400).json({ error: error.message });
      }
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  },

  // Check subscription status
  async checkSubscriptionStatus(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const isActive = await subscriptionService.isSubscriptionActive(userId);

      res.json({
        isActive,
        status: isActive ? 'active' : 'inactive',
      });
    } catch (error) {
      console.error('Error checking subscription status:', error);
      res.status(500).json({ error: 'Failed to check subscription status' });
    }
  },

  // Get subscription limits
  async getSubscriptionLimits(req, res) {
    try {
      const userId = req.auth.dbUserId;
      const limits = await subscriptionService.getUserSubscriptionPlan(userId);

      res.json(snakeToCamelCase(limits));
    } catch (error) {
      console.error('Error fetching subscription limits:', error);
      res.status(500).json({ error: 'Failed to fetch subscription limits' });
    }
  },

  // Get current subscription (for /api/subscriptions/current)
  async getCurrentSubscription(req, res) {
    try {
      const userId = req.auth.dbUserId;

      const [subscription, usage] = await Promise.all([
        subscriptionService.getUserSubscriptionPlan(userId),
        subscriptionService.getUsageStats(userId, req.auth.tenantIds || []),
      ]);

      const response = {
        plan: {
          name: subscription.plan.name,
          displayName: subscription.plan.displayName,
          price: parseFloat(subscription.plan.price),
          billingInterval: subscription.plan.billingInterval,
          features: {
            maxExternalCollections: subscription.plan.maxExternalCollections,
            maxRegularCollections: subscription.plan.maxRegularCollections,
            canAddCollaborators: subscription.plan.canAddCollaborators,
            maxCollaboratorsPerCollection:
              subscription.plan.maxCollaboratorsPerCollection,
            maxAttachments: subscription.plan.maxAttachments,
            maxAttachmentSizeMB: subscription.plan.maxAttachmentSizeMB,
            canCreateFolders: subscription.plan.canCreateFolders,
            canExportData: subscription.plan.canExportData,
            prioritySupport: subscription.plan.prioritySupport,
          },
        },
        status: subscription.subscriptionStatus,
        startDate: subscription.subscriptionStartDate,
        endDate: subscription.subscriptionEndDate,
        usage: {
          externalCollections: usage.externalCollectionsCount,
          regularCollections: usage.regularCollectionsCount,
          attachments: usage.attachmentsCount,
          collaborations: usage.collaborationsCount,
        },
      };

      res.json(response);
    } catch (error) {
      console.error('Error fetching current subscription:', error);
      res.status(500).json({ error: 'Failed to fetch current subscription' });
    }
  },
};
