import { stripe } from './stripe.js';
import { db } from '../db/index.js';
import { users } from '../models/users.js';
import { subscriptionPlans } from '../models/subscriptionPlans.js';
import { eq, and } from 'drizzle-orm';
import { subscriptionService } from './subscriptionService.js';

export const stripeSubscriptionService = {
  // Create or get Stripe customer
  async createOrGetCustomer(userId, email, name = null) {
    try {
      // Check if user already has a Stripe customer ID
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (user[0]?.stripeCustomerId) {
        // Verify the customer still exists in Stripe
        try {
          const customer = await stripe.customers.retrieve(
            user[0].stripeCustomerId
          );
          if (!customer.deleted) {
            return customer;
          }
        } catch (error) {
          console.log('Stripe customer not found, creating new one');
        }
      }

      // Create new Stripe customer
      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          userId: userId,
        },
      });

      // Update user with Stripe customer ID
      await db
        .update(users)
        .set({ stripeCustomerId: customer.id })
        .where(eq(users.id, userId));

      return customer;
    } catch (error) {
      console.error('Error creating/getting Stripe customer:', error);
      throw new Error('Failed to create customer');
    }
  },

  // Create subscription
  async createSubscription(userId, planName, email, name = null) {
    try {
      // Get subscription plan details
      const plan = await db
        .select()
        .from(subscriptionPlans)
        .where(
          and(
            eq(subscriptionPlans.name, planName),
            eq(subscriptionPlans.isActive, true)
          )
        )
        .limit(1);

      if (planName === 'basic') {
        return {
          subscriptionId: null,
          clientSecret: null,
          customerId: null,
        };
      }

      if (!plan[0]) {
        throw new Error('Invalid subscription plan');
      }
      // if they are on the basic plan there will be no stripe price id

      if (planName !== 'basic' && !plan[0].stripePriceId) {
        throw new Error('Stripe price ID not configured for this plan');
      }

      // Create or get Stripe customer
      const customer = await this.createOrGetCustomer(userId, email, name);

      // Create Stripe subscription
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [
          {
            price: plan[0].stripePriceId,
          },
        ],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          userId: userId,
          planName: planName,
        },
      });

      return {
        subscriptionId: subscription.id,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
        customerId: customer.id,
      };
    } catch (error) {
      console.error('Error creating subscription:', error);
      throw new Error(`Failed to create subscription: ${error.message}`);
    }
  },

  // Cancel subscription
  async cancelSubscription(userId) {
    try {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user[0]?.stripeSubscriptionId) {
        throw new Error('No active subscription found');
      }

      // Cancel at period end to allow user to continue using until billing cycle ends
      const subscription = await stripe.subscriptions.update(
        user[0].stripeSubscriptionId,
        {
          cancel_at_period_end: true,
        }
      );

      // Update user subscription status
      await db
        .update(users)
        .set({
          subscriptionStatus: 'canceling',
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return subscription;
    } catch (error) {
      console.error('Error canceling subscription:', error);
      throw new Error('Failed to cancel subscription');
    }
  },

  // Reactivate subscription
  async reactivateSubscription(userId) {
    try {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user[0]?.stripeSubscriptionId) {
        throw new Error('No subscription found');
      }

      // Remove the cancellation
      const subscription = await stripe.subscriptions.update(
        user[0].stripeSubscriptionId,
        {
          cancel_at_period_end: false,
        }
      );

      // Update user subscription status
      await db
        .update(users)
        .set({
          subscriptionStatus: 'active',
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return subscription;
    } catch (error) {
      console.error('Error reactivating subscription:', error);
      throw new Error('Failed to reactivate subscription');
    }
  },

  // Handle Stripe webhooks
  async handleWebhook(event) {
    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdate(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionCanceled(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handlePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object);
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error('Error handling webhook:', error);
      throw error;
    }
  },

  // Handle subscription updates
  async handleSubscriptionUpdate(subscription) {
    const userId = subscription.metadata?.userId;
    const planName = subscription.metadata?.planName;

    if (!userId) {
      console.error('No userId in subscription metadata');
      return;
    }

    const status = this.mapStripeStatus(subscription.status);
    const endDate = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null;

    // Check if subscription is canceled but still active (cancel_at_period_end = true)
    let subscriptionStatus = status;
    let subscriptionPlan = planName || 'basic';

    if (subscription.cancel_at_period_end && subscription.status === 'active') {
      // Subscription is canceled but still active until period end
      subscriptionStatus = 'canceling';
      // Keep current plan until period actually ends
    } else if (subscription.status === 'canceled') {
      // Subscription has actually ended - downgrade to basic
      subscriptionPlan = 'basic';
      subscriptionStatus = 'canceled';
    }

    await db
      .update(users)
      .set({
        subscriptionPlan: subscriptionPlan,
        subscriptionStatus: subscriptionStatus,
        subscriptionEndDate: endDate,
        stripeSubscriptionId:
          subscription.status === 'canceled' ? null : subscription.id,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },

  // Handle subscription cancellation (when subscription is actually deleted/ended)
  async handleSubscriptionCanceled(subscription) {
    const userId = subscription.metadata?.userId;

    if (!userId) {
      console.error('No userId in subscription metadata');
      return;
    }

    // When subscription is deleted, downgrade user to basic plan
    await db
      .update(users)
      .set({
        subscriptionPlan: 'basic',
        subscriptionStatus: 'canceled',
        subscriptionEndDate: new Date(),
        stripeSubscriptionId: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },

  // Handle successful payment
  async handlePaymentSucceeded(invoice) {
    const subscription = await stripe.subscriptions.retrieve(
      invoice.subscription
    );
    const userId = subscription.metadata?.userId;

    if (!userId) {
      console.error('No userId in subscription metadata');
      return;
    }

    // Update subscription status to active
    await db
      .update(users)
      .set({
        subscriptionStatus: 'active',
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },

  // Handle failed payment
  async handlePaymentFailed(invoice) {
    const subscription = await stripe.subscriptions.retrieve(
      invoice.subscription
    );
    const userId = subscription.metadata?.userId;

    if (!userId) {
      console.error('No userId in subscription metadata');
      return;
    }

    // Update subscription status to past_due
    await db
      .update(users)
      .set({
        subscriptionStatus: 'past_due',
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  },

  // Map Stripe status to our internal status
  mapStripeStatus(stripeStatus) {
    const statusMap = {
      active: 'active',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid: 'past_due',
      incomplete: 'incomplete',
      incomplete_expired: 'canceled',
      trialing: 'active',
    };

    return statusMap[stripeStatus] || 'inactive';
  },

  // Get subscription details from Stripe
  async getStripeSubscription(userId) {
    try {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user[0]?.stripeSubscriptionId) {
        return null;
      }

      const subscription = await stripe.subscriptions.retrieve(
        user[0].stripeSubscriptionId,
        {
          expand: ['latest_invoice', 'customer'],
        }
      );

      return subscription;
    } catch (error) {
      console.error('Error getting Stripe subscription:', error);
      return null;
    }
  },

  // Clean up duplicate subscriptions for a customer
  async cleanupDuplicateSubscriptions(userId) {
    try {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user[0]?.stripeCustomerId) {
        throw new Error('No Stripe customer found');
      }

      // Get all subscriptions for this customer
      const subscriptions = await stripe.subscriptions.list({
        customer: user[0].stripeCustomerId,
        status: 'all',
      });

      // Separate active/canceling vs canceled subscriptions
      const activeSubscriptions = subscriptions.data.filter(
        (sub) => sub.status === 'active' || sub.status === 'trialing'
      );

      const canceledSubscriptions = subscriptions.data.filter(
        (sub) => sub.status === 'canceled'
      );

      // If there are multiple active subscriptions, keep the most recent one
      if (activeSubscriptions.length > 1) {
        const sortedActive = activeSubscriptions.sort(
          (a, b) => b.created - a.created
        );
        const subscriptionToKeep = sortedActive[0];
        const subscriptionsToCancel = sortedActive.slice(1);

        // Cancel duplicate active subscriptions
        for (const subscription of subscriptionsToCancel) {
          await stripe.subscriptions.cancel(subscription.id);
          console.log(
            `Canceled duplicate active subscription: ${subscription.id}`
          );
        }

        // Update user record with the kept subscription
        const planName = subscriptionToKeep.metadata?.planName || 'premium';
        const subscriptionStatus = subscriptionToKeep.cancel_at_period_end
          ? 'canceling'
          : 'active';

        await db
          .update(users)
          .set({
            stripeSubscriptionId: subscriptionToKeep.id,
            subscriptionPlan: planName,
            subscriptionStatus: subscriptionStatus,
            subscriptionEndDate: new Date(
              subscriptionToKeep.current_period_end * 1000
            ),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        return {
          cleaned: subscriptionsToCancel.length,
          kept: 1,
          keptSubscriptionId: subscriptionToKeep.id,
          keptPlan: planName,
          keptStatus: subscriptionStatus,
          cancelAtPeriodEnd: subscriptionToKeep.cancel_at_period_end,
        };
      }

      // If there's one active subscription, make sure it's properly set in the database
      if (activeSubscriptions.length === 1) {
        const activeSubscription = activeSubscriptions[0];
        const planName = activeSubscription.metadata?.planName || 'premium';
        const subscriptionStatus = activeSubscription.cancel_at_period_end
          ? 'canceling'
          : 'active';

        await db
          .update(users)
          .set({
            stripeSubscriptionId: activeSubscription.id,
            subscriptionPlan: planName,
            subscriptionStatus: subscriptionStatus,
            subscriptionEndDate: new Date(
              activeSubscription.current_period_end * 1000
            ),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        return {
          cleaned: 0,
          kept: 1,
          keptSubscriptionId: activeSubscription.id,
          keptPlan: planName,
          keptStatus: subscriptionStatus,
          cancelAtPeriodEnd: activeSubscription.cancel_at_period_end,
        };
      }

      // If no active subscriptions, user should be on basic plan
      if (activeSubscriptions.length === 0) {
        await db
          .update(users)
          .set({
            subscriptionPlan: 'basic',
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            subscriptionEndDate: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        return {
          cleaned: 0,
          kept: 0,
          message: 'No active subscriptions - user downgraded to basic plan',
        };
      }
    } catch (error) {
      console.error('Error cleaning up duplicate subscriptions:', error);
      throw new Error(`Failed to cleanup subscriptions: ${error.message}`);
    }
  },

  // Change subscription plan (upgrade/downgrade)
  async changeSubscriptionPlan(userId, newPlanName) {
    try {
      const user = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user[0]?.stripeSubscriptionId) {
        throw new Error('No active subscription found');
      }

      // Get the new plan details
      const newPlan = await db
        .select()
        .from(subscriptionPlans)
        .where(
          and(
            eq(subscriptionPlans.name, newPlanName),
            eq(subscriptionPlans.isActive, true)
          )
        )
        .limit(1);

      if (!newPlan[0]) {
        throw new Error('Invalid subscription plan');
      }

      // If downgrading to basic (free plan), cancel the Stripe subscription
      if (
        newPlanName === 'basic' ||
        newPlan[0].price === 0 ||
        !newPlan[0].stripePriceId
      ) {
        // Cancel the Stripe subscription immediately
        const canceledSubscription = await stripe.subscriptions.cancel(
          user[0].stripeSubscriptionId
        );

        // Update user subscription in database to basic plan
        await db
          .update(users)
          .set({
            subscriptionPlan: 'basic',
            subscriptionStatus: 'active',
            stripeSubscriptionId: null, // Remove Stripe subscription ID
            subscriptionEndDate: null, // Basic plan doesn't expire
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        return {
          subscriptionId: null,
          status: 'canceled',
          newPlan: 'basic',
          currentPeriodEnd: new Date(
            canceledSubscription.current_period_end * 1000
          ),
          message: 'Downgraded to basic plan - Stripe subscription canceled',
        };
      }

      // For paid plans, update the subscription with the new price
      if (!newPlan[0].stripePriceId) {
        throw new Error('Stripe price ID not configured for this plan');
      }

      // Get current subscription
      const currentSubscription = await stripe.subscriptions.retrieve(
        user[0].stripeSubscriptionId
      );

      // Update the subscription with the new price
      const updatedSubscription = await stripe.subscriptions.update(
        user[0].stripeSubscriptionId,
        {
          items: [
            {
              id: currentSubscription.items.data[0].id,
              price: newPlan[0].stripePriceId,
            },
          ],
          proration_behavior: 'create_prorations', // This handles upgrade/downgrade billing
          metadata: {
            userId: userId,
            planName: newPlanName,
            previousPlan: currentSubscription.metadata?.planName || 'unknown',
          },
        }
      );

      // Update user subscription in database
      await db
        .update(users)
        .set({
          subscriptionPlan: newPlanName,
          subscriptionStatus: 'active',
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return {
        subscriptionId: updatedSubscription.id,
        status: updatedSubscription.status,
        newPlan: newPlanName,
        currentPeriodEnd: new Date(
          updatedSubscription.current_period_end * 1000
        ),
      };
    } catch (error) {
      console.error('Error changing subscription plan:', error);
      throw new Error(`Failed to change subscription plan: ${error.message}`);
    }
  },
};
