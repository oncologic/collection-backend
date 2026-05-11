import { db } from '../db/index.js';
import { creditTransactions } from '../models/creditTransactions.js';
import { eq, sum, and, sql } from 'drizzle-orm';
import { desc } from 'drizzle-orm';
import { stripe } from './stripe.js';
import { sendPurchaseReceiptEmail } from './emailService.js';
import { subscriptionService } from './subscriptionService.js';
import { users } from '../models/users.js';

export const CREDIT_COST_PER_QUESTION = 1;
export const BASIC_PLAN_MONTHLY_QUESTIONS = 50;

// Define product packages with Stripe product IDs
const CREDIT_PACKAGES = {
  basic: {
    id: 'basic',
    credits: 35,
    amount: 500, // $5.00 in cents
    stripeProductId: 'prod_SWuf8eQG4trnsP',
    stripePriceId: 'price_1RbqpkGhSx1QaqFqKmkpGaGd',
  },
  premium: {
    id: 'premium',
    credits: 150,
    amount: 1500, // $15.00 in cents
    stripeProductId: 'prod_SWufmKjsyo4SOE',
    stripePriceId: 'price_1RbqqCGhSx1QaqFqBohfe9bf',
  },
};

export const creditService = {
  async getCreditBalance(userId) {
    const result = await db
      .select({
        balance: sum(creditTransactions.amount).mapWith(Number),
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId));

    return result[0]?.balance || 0;
  },

  async addCredits(
    userId,
    amount,
    stripeTransactionId = null,
    paymentDetails = {}
  ) {
    const [result] = await db
      .insert(creditTransactions)
      .values({
        userId,
        transactionType: 'purchase',
        amount,
        stripeTransactionId,
        description: 'Credit purchase',
        ...paymentDetails,
      })
      .returning();

    return result;
  },

  async deductCredits(userId, amount, referenceId = null) {
    // Get user's subscription plan and details
    const { user, plan } =
      await subscriptionService.getUserSubscriptionPlan(userId);

    // If user is on basic plan, check if they can use their monthly allowance
    if (plan.name === 'basic') {
      // Get the start of the current subscription period
      const subscriptionStart = new Date(user.subscriptionStartDate);
      const now = new Date();

      // Calculate the start of the current subscription period
      const periodStart = new Date(subscriptionStart);
      periodStart.setMonth(
        subscriptionStart.getMonth() +
          Math.floor(
            (now.getTime() - subscriptionStart.getTime()) /
              (30 * 24 * 60 * 60 * 1000)
          )
      );
      periodStart.setHours(0, 0, 0, 0);

      // Count questions used in current subscription period
      const periodUsage = await db
        .select({
          count: sum(creditTransactions.amount).mapWith(Number),
        })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.userId, userId),
            eq(creditTransactions.transactionType, 'deduction'),
            sql`${creditTransactions.createdAt} >= ${periodStart}`
          )
        );

      const questionsUsedThisPeriod = Math.abs(periodUsage[0]?.count || 0);

      // If they haven't used their monthly allowance, don't deduct credits
      if (questionsUsedThisPeriod + amount <= BASIC_PLAN_MONTHLY_QUESTIONS) {
        // Record the usage but don't deduct credits
        const [result] = await db
          .insert(creditTransactions)
          .values({
            userId,
            transactionType: 'deduction',
            amount: 0, // Don't deduct credits
            referenceId,
            description: 'AI question (monthly allowance)',
          })
          .returning();

        return result;
      }
    }

    // For non-basic plans or if monthly allowance is used up, proceed with credit deduction
    const balance = await this.getCreditBalance(userId);

    if (balance < amount) {
      throw new Error('Insufficient credits');
    }

    const [result] = await db
      .insert(creditTransactions)
      .values({
        userId,
        transactionType: 'deduction',
        amount: -amount,
        referenceId,
        description: 'AI question credit deduction',
      })
      .returning();

    return result;
  },

  async checkCredits(userId, amount) {
    // Get user's subscription plan and details
    const { user, plan } =
      await subscriptionService.getUserSubscriptionPlan(userId);

    // If user is on basic plan, check if they've used their monthly allowance
    if (plan.name === 'basic') {
      // Get the start of the current subscription period
      const subscriptionStart = new Date(user.subscriptionStartDate);
      const now = new Date();

      // Calculate the start of the current subscription period
      const periodStart = new Date(subscriptionStart);
      periodStart.setMonth(
        subscriptionStart.getMonth() +
          Math.floor(
            (now.getTime() - subscriptionStart.getTime()) /
              (30 * 24 * 60 * 60 * 1000)
          )
      );
      periodStart.setHours(0, 0, 0, 0);

      // Count questions used in current subscription period
      const periodUsage = await db
        .select({
          count: sum(creditTransactions.amount).mapWith(Number),
        })
        .from(creditTransactions)
        .where(
          and(
            eq(creditTransactions.userId, userId),
            eq(creditTransactions.transactionType, 'deduction'),
            sql`${creditTransactions.createdAt} >= ${periodStart}`
          )
        );

      const questionsUsedThisPeriod = Math.abs(periodUsage[0]?.count || 0);

      // If they haven't used their monthly allowance, they can proceed
      if (questionsUsedThisPeriod + amount <= BASIC_PLAN_MONTHLY_QUESTIONS) {
        return true;
      }

      // If they've used their monthly allowance, check their credit balance
      const balance = await this.getCreditBalance(userId);
      return balance >= amount;
    }

    // For non-basic plans, just check credit balance
    const balance = await this.getCreditBalance(userId);
    return balance >= amount;
  },

  async getTransactionHistory(userId) {
    return db
      .select()
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.userId, userId),
          eq(creditTransactions.transactionType, 'purchase')
        )
      )
      .orderBy(desc(creditTransactions.createdAt));
  },

  async validatePackage(packageId) {
    const creditPackage = CREDIT_PACKAGES[packageId];
    if (!creditPackage) {
      throw new Error('Invalid package selected');
    }
    return creditPackage;
  },

  async processPurchase(
    userId,
    packageId,
    stripeTransactionId,
    userData = null
  ) {
    const creditPackage = await this.validatePackage(packageId);

    // Get payment details from Stripe
    const payment = await stripe.paymentIntents.retrieve(stripeTransactionId);

    // Add credits to user's account with enhanced data
    const transaction = await this.addCredits(
      userId,
      creditPackage.credits,
      stripeTransactionId,
      {
        payment_status: payment.status,
        payment_amount: payment.amount,
        currency: payment.currency,
      }
    );

    // Send receipt email if user data is provided
    if (userData && userData.email) {
      try {
        await sendPurchaseReceiptEmail(userData, {
          packageId,
          credits: creditPackage.credits,
          amount: creditPackage.amount,
          transactionId: stripeTransactionId,
          paymentStatus: payment.status,
        });
      } catch (emailError) {
        console.error('Failed to send receipt email:', emailError);
        // Continue with the transaction even if email fails
      }
    }

    return {
      transaction,
      credits: creditPackage.credits,
      amount: creditPackage.amount,
    };
  },

  async createPaymentIntent(packageId, userId, email) {
    const creditPackage = await this.validatePackage(packageId);

    return {
      amount: creditPackage.amount,
      currency: 'usd',
      receipt_email: email,
      metadata: {
        packageId: creditPackage.id,
        userId,
        stripeProductId: creditPackage.stripeProductId,
        stripePriceId: creditPackage.stripePriceId,
      },
    };
  },

  async getTransaction(userId, transactionId) {
    const transaction = await db
      .select()
      .from(creditTransactions)
      .where(
        and(
          eq(creditTransactions.userId, userId),
          eq(creditTransactions.id, transactionId)
        )
      )
      .limit(1);

    return transaction[0] || null;
  },

  // Get comprehensive credit information for user
  async getUserCreditInfo(userId) {
    try {
      // Get user's subscription plan and details
      const { user, plan } =
        await subscriptionService.getUserSubscriptionPlan(userId);

      // Get credit balance
      const creditBalance = await this.getCreditBalance(userId);

      // Initialize response object
      const creditInfo = {
        creditBalance,
        subscriptionPlan: {
          name: plan.name,
          displayName: plan.displayName,
        },
        monthlyAllowance: {
          total: 0,
          used: 0,
          remaining: 0,
          hasMonthlyAllowance: false,
        },
      };

      // If user is on basic plan, calculate monthly allowance usage
      if (plan.name === 'basic') {
        const subscriptionStart = new Date(user.subscriptionStartDate);
        const now = new Date();

        // Calculate the start of the current subscription period
        const periodStart = new Date(subscriptionStart);
        periodStart.setMonth(
          subscriptionStart.getMonth() +
            Math.floor(
              (now.getTime() - subscriptionStart.getTime()) /
                (30 * 24 * 60 * 60 * 1000)
            )
        );
        periodStart.setHours(0, 0, 0, 0);

        // Count questions used in current subscription period
        const periodUsage = await db
          .select({
            count: sum(creditTransactions.amount).mapWith(Number),
          })
          .from(creditTransactions)
          .where(
            and(
              eq(creditTransactions.userId, userId),
              eq(creditTransactions.transactionType, 'deduction'),
              sql`${creditTransactions.createdAt} >= ${periodStart}`
            )
          );

        const questionsUsedThisPeriod = Math.abs(periodUsage[0]?.count || 0);
        const remainingQuestions = Math.max(
          0,
          BASIC_PLAN_MONTHLY_QUESTIONS - questionsUsedThisPeriod
        );

        creditInfo.monthlyAllowance = {
          total: BASIC_PLAN_MONTHLY_QUESTIONS,
          used: questionsUsedThisPeriod,
          remaining: remainingQuestions,
          hasMonthlyAllowance: true,
          periodStart: periodStart.toISOString(),
        };
      }

      return creditInfo;
    } catch (error) {
      console.error('Error getting user credit info:', error);
      throw new Error('Failed to get credit information');
    }
  },
};

/**
 * Add initial/welcome credits to a new user without requiring payment
 *
 * @param {string|number} userId - The ID of the user to add credits to
 * @param {number} amount - The number of credits to add
 * @returns {Promise<Object>} The transaction record
 */
export const addCreditsToUser = async (userId, amount) => {
  const [result] = await db
    .insert(creditTransactions)
    .values({
      userId,
      transactionType: 'welcome',
      amount,
      description: 'Welcome credits for new user',
    })
    .returning();

  return result;
};

export { CREDIT_PACKAGES };
