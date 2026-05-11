import { subscriptionService } from '../services/subscriptionService.js';
import { stripeSubscriptionService } from '../services/stripeSubscriptionService.js';
import { getUserByIdService } from '../services/userService.js';

import { stripe } from '../services/stripe.js';
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

      // Get Stripe subscription details if available
      const stripeSubscription =
        await stripeSubscriptionService.getStripeSubscription(userId);

      res.json({
        subscription: snakeToCamelCase(subscription),
        usage: snakeToCamelCase(usage),
        stripeDetails: stripeSubscription
          ? {
              status: stripeSubscription.status,
              currentPeriodEnd: new Date(
                stripeSubscription.current_period_end * 1000
              ),
              cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
            }
          : null,
      });
    } catch (error) {
      console.error('Error fetching user subscription:', error);
      res.status(500).json({ error: 'Failed to fetch subscription details' });
    }
  },

  // Create Stripe subscription
  async createStripeSubscription(req, res) {
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

      // Get user details
      const user = await getUserByIdService(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      let result;

      // Handle basic plan (free) - no Stripe interaction needed
      if (planName === 'basic') {
        // Update user to basic plan with automatic Stripe cancellation
        await subscriptionService.updateUserSubscriptionPlan(
          userId,
          'basic',
          null,
          { cancelStripeSubscription: true }
        );

        return res.json({
          message: 'Successfully switched to basic plan',
          planName: 'basic',
          subscriptionId: null,
          changeType: validation.changeType,
        });
      }

      // If user already has a Stripe subscription, change the plan instead of creating new
      if (user.stripeSubscriptionId && validation.changeType !== 'new') {
        result = await stripeSubscriptionService.changeSubscriptionPlan(
          userId,
          planName
        );

        res.json({
          message: `Subscription ${validation.changeType}d successfully`,
          subscriptionId: result.subscriptionId,
          changeType: validation.changeType,
          newPlan: result.newPlan,
          currentPeriodEnd: result.currentPeriodEnd,
        });
      } else {
        // Create new Stripe subscription for paid plans
        result = await stripeSubscriptionService.createSubscription(
          userId,
          planName,
          user.email,
          user.name
        );

        // Update user subscription details
        await subscriptionService.updateUserSubscriptionPlan(
          userId,
          planName,
          result.subscriptionId
        );

        res.json({
          subscriptionId: result.subscriptionId,
          clientSecret: result.clientSecret,
          customerId: result.customerId,
        });
      }
    } catch (error) {
      console.error('Error creating Stripe subscription:', error);
      res.status(500).json({ error: error.message });
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

      // Handle basic plan (free) - no Stripe interaction needed
      if (planName === 'basic') {
        // Update user to basic plan with automatic Stripe cancellation
        await subscriptionService.updateUserSubscriptionPlan(
          userId,
          'basic',
          null,
          { cancelStripeSubscription: true }
        );

        return res.json({
          message: 'Successfully downgraded to basic plan',
          planName: 'basic',
          subscriptionId: null,
          changeType: validation.changeType,
          newPlan: 'basic',
        });
      }

      // For paid plans, change the plan through Stripe
      const result = await stripeSubscriptionService.changeSubscriptionPlan(
        userId,
        planName
      );

      res.json({
        message: `Subscription ${validation.changeType}d successfully`,
        subscriptionId: result.subscriptionId,
        changeType: validation.changeType,
        newPlan: result.newPlan,
        currentPeriodEnd: result.currentPeriodEnd,
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

      const subscription =
        await stripeSubscriptionService.cancelSubscription(userId);

      res.json({
        message: 'Subscription canceled successfully',
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      });
    } catch (error) {
      console.error('Error canceling subscription:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Reactivate subscription
  async reactivateSubscription(req, res) {
    try {
      const userId = req.auth.dbUserId;

      const subscription =
        await stripeSubscriptionService.reactivateSubscription(userId);

      res.json({
        message: 'Subscription reactivated successfully',
        status: subscription.status,
      });
    } catch (error) {
      console.error('Error reactivating subscription:', error);
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

      // Handle basic plan (free) - need to cancel existing Stripe subscription
      if (planName === 'basic') {
        // Update user to basic plan with Stripe cancellation
        const updatedUser =
          await subscriptionService.updateUserSubscriptionPlan(
            userId,
            'basic',
            null,
            { cancelStripeSubscription: true }
          );

        return res.json({
          message: 'Successfully downgraded to basic plan',
          user: snakeToCamelCase(updatedUser),
          planName: 'basic',
          changeType: validation.changeType,
        });
      }

      // For paid plans, use the Stripe service to handle plan changes
      if (validation.changeType !== 'new') {
        const result = await stripeSubscriptionService.changeSubscriptionPlan(
          userId,
          planName
        );

        return res.json({
          message: `Subscription ${validation.changeType}d successfully`,
          subscriptionId: result.subscriptionId,
          changeType: validation.changeType,
          newPlan: result.newPlan,
          currentPeriodEnd: result.currentPeriodEnd,
        });
      }

      // For new subscriptions to paid plans, just update the database
      // (This should typically go through the create-subscription endpoint instead)
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

  // Handle Stripe webhooks
  async handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
      );

      // Handle the event
      await stripeSubscriptionService.handleWebhook(event);

      // Always return a 200 status code for Stripe webhooks
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('Subscription Webhook Error:', error.message);
      // Still return a 200 status code even for signature verification errors
      return res.status(200).json({ error: error.message });
    }
  },

  // Clean up duplicate subscriptions
  async cleanupDuplicateSubscriptions(req, res) {
    try {
      const userId = req.auth.dbUserId;

      const result =
        await stripeSubscriptionService.cleanupDuplicateSubscriptions(userId);

      res.json({
        message: 'Duplicate subscriptions cleaned up successfully',
        ...result,
      });
    } catch (error) {
      console.error('Error cleaning up duplicate subscriptions:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Sync user subscription status with Stripe (manual fix for edge cases)
  async syncSubscriptionStatus(req, res) {
    try {
      const userId = req.auth.dbUserId;

      // Clean up duplicates first
      const cleanupResult =
        await stripeSubscriptionService.cleanupDuplicateSubscriptions(userId);

      // Get current user status
      const user = await getUserByIdService(userId);
      const stripeSubscription =
        await stripeSubscriptionService.getStripeSubscription(userId);

      res.json({
        message: 'Subscription status synced successfully',
        cleanup: cleanupResult,
        currentStatus: {
          databasePlan: user.subscriptionPlan,
          databaseStatus: user.subscriptionStatus,
          stripeSubscriptionId: user.stripeSubscriptionId,
          stripeStatus: stripeSubscription?.status,
          stripeCancelAtPeriodEnd: stripeSubscription?.cancel_at_period_end,
          stripeCurrentPeriodEnd: stripeSubscription?.current_period_end
            ? new Date(stripeSubscription.current_period_end * 1000)
            : null,
        },
      });
    } catch (error) {
      console.error('Error syncing subscription status:', error);
      res.status(500).json({ error: error.message });
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

      // Get Stripe subscription details if available
      const stripeSubscription =
        await stripeSubscriptionService.getStripeSubscription(userId);

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

      // Add Stripe-specific details if available
      if (stripeSubscription) {
        response.stripeDetails = {
          subscriptionId: stripeSubscription.id,
          status: stripeSubscription.status,
          currentPeriodStart: new Date(
            stripeSubscription.current_period_start * 1000
          ),
          currentPeriodEnd: new Date(
            stripeSubscription.current_period_end * 1000
          ),
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
          customerId: stripeSubscription.customer,
        };
      }

      res.json(response);
    } catch (error) {
      console.error('Error fetching current subscription:', error);
      res.status(500).json({ error: 'Failed to fetch current subscription' });
    }
  },

  // Get user invoices (for /api/subscriptions/invoices)
  async getInvoices(req, res) {
    try {
      const userId = req.auth.dbUserId;

      // Get user's Stripe customer ID
      const user = await getUserByIdService(userId);
      if (!user || !user.stripeCustomerId) {
        return res.json({ invoices: [] });
      }

      // Fetch invoices from Stripe
      const invoices = await stripe.invoices.list({
        customer: user.stripeCustomerId,
        limit: 100, // Adjust as needed
        expand: ['data.subscription'],
      });

      const formattedInvoices = invoices.data.map((invoice) => ({
        id: invoice.id,
        amount: invoice.amount_paid / 100, // Convert from cents
        currency: invoice.currency.toUpperCase(),
        status: invoice.status,
        paid: invoice.paid,
        date: new Date(invoice.created * 1000),
        periodStart: invoice.period_start
          ? new Date(invoice.period_start * 1000)
          : null,
        periodEnd: invoice.period_end
          ? new Date(invoice.period_end * 1000)
          : null,
        downloadUrl: invoice.hosted_invoice_url,
        pdfUrl: invoice.invoice_pdf,
        description:
          invoice.description ||
          `${invoice.subscription?.metadata?.planName || 'Subscription'} - ${invoice.currency.toUpperCase()} ${(invoice.amount_paid / 100).toFixed(2)}`,
        subscriptionId: invoice.subscription?.id || null,
      }));

      res.json({ invoices: formattedInvoices });
    } catch (error) {
      console.error('Error fetching invoices:', error);
      res.status(500).json({ error: 'Failed to fetch invoice history' });
    }
  },
};
