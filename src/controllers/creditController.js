import { creditService } from '../services/creditService.js';
import { stripe } from '../services/stripe.js'; // Import the shared instance
import { getUserByIdService } from '../services/userService.js';

export const creditController = {
  async getBalance(req, res) {
    try {
      const balance = await creditService.getCreditBalance(req.auth.dbUserId);
      res.json({ balance });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Admin method to get any user's credit balance
  async getAdminBalance(req, res) {
    try {
      const { userId } = req.params;
      const balance = await creditService.getCreditBalance(userId);
      res.json({ balance, userId });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Admin method to add credits directly to a user's account
  async addAdminCredits(req, res) {
    try {
      const { userId } = req.params;
      const { amount, description } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Amount must be positive' });
      }

      const transaction = await creditService.addCredits(
        userId,
        amount,
        null, // No Stripe transaction ID for admin credits
        {
          description: description || 'Admin credit addition',
          added_by_admin: true,
          admin_user_id: req.auth.dbUserId,
        }
      );

      const newBalance = await creditService.getCreditBalance(userId);

      res.json({
        transaction,
        newBalance,
        message: `Successfully added ${amount} credits to user ${userId}`,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async addCredits(req, res) {
    try {
      const { amount, stripeTransactionId } = req.body;
      const transaction = await creditService.addCredits(
        req.auth.dbUserId,
        amount,
        stripeTransactionId
      );
      res.json(transaction);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async getTransactionHistory(req, res) {
    try {
      const transactions = await creditService.getTransactionHistory(
        req.auth.dbUserId
      );
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async createPaymentIntent(req, res) {
    try {
      const { packageId } = req.body;
      const userId = req.auth.dbUserId;
      //get the user
      const user = await getUserByIdService(userId);
      const email = user.email;

      // Get payment details from credit service
      const paymentDetails = await creditService.createPaymentIntent(
        packageId,
        userId,
        email
      );

      // Create a payment intent with Stripe
      const paymentIntent = await stripe.paymentIntents.create({
        ...paymentDetails,
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        productId: paymentDetails.metadata.stripeProductId,
        priceId: paymentDetails.metadata.stripePriceId,
      });
    } catch (error) {
      console.error('Error creating payment intent:', error);
      res.status(500).json({ error: error.message });
    }
  },

  async getBillingHistory(req, res) {
    try {
      // Get both local transaction history and Stripe payments
      const [localTransactions, stripePayments] = await Promise.all([
        creditService.getTransactionHistory(req.auth.dbUserId),
        stripe.paymentIntents.list({
          limit: 100,
          metadata: { userId: req.auth.dbUserId },
        }),
      ]);

      // Enhance local transactions with Stripe data
      const enhancedTransactions = localTransactions.map((transaction) => {
        if (transaction.stripe_transaction_id) {
          const stripePayment = stripePayments.data.find(
            (p) => p.id === transaction.stripe_transaction_id
          );
          if (stripePayment) {
            return {
              ...transaction,
              receipt_url:
                stripePayment.charges?.data?.[0]?.receipt_url || null,
              payment_status: stripePayment.status,
              payment_amount: stripePayment.amount,
              currency: stripePayment.currency,
            };
          }
        }
        return transaction;
      });

      res.json(enhancedTransactions);
    } catch (error) {
      console.error('Error fetching billing history:', error);
      res.status(500).json({ error: error.message });
    }
  },

  async getReceipt(req, res) {
    try {
      const { transactionId } = req.params;

      // Verify the transaction belongs to the user
      const transaction = await creditService.getTransaction(
        req.auth.dbUserId,
        transactionId
      );

      if (!transaction) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      if (transaction.stripe_transaction_id) {
        const payment = await stripe.paymentIntents.retrieve(
          transaction.stripe_transaction_id
        );
        const receipt_url = payment.charges?.data?.[0]?.receipt_url;

        if (receipt_url) {
          return res.json({ receipt_url });
        }
      }

      res.status(404).json({ error: 'Receipt not available' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  async handleStripeWebhook(req, res) {
    const sig = req.headers['stripe-signature'];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      // Handle the event
      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const { packageId, userId } = paymentIntent.metadata || {};

        if (!packageId || !userId) {
          console.error(
            'Missing required metadata in payment intent:',
            paymentIntent.id
          );
          return res.status(200).json({ error: 'Missing required metadata' });
        }

        const userData = await getUserByIdService(userId);

        try {
          await creditService.processPurchase(
            userId,
            packageId,
            paymentIntent.id,
            userData
          );
        } catch (processingError) {
          console.error('Error processing purchase:', processingError);
          // Still return 200 to Stripe so they don't retry
          return res.status(200).json({
            received: true,
            warning: `Error processing purchase: ${processingError.message}`,
          });
        }
      }

      // Always return a 200 status code for Stripe webhooks
      return res.status(200).json({ received: true });
    } catch (error) {
      console.error('Webhook Error:', error.message);
      // Still return a 200 status code even for signature verification errors
      return res.status(200).json({ error: error.message });
    }
  },
};
