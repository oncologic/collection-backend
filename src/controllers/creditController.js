import { creditService } from '../services/creditService.js';

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
      const creditAmount = Number(amount);

      if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
        return res.status(400).json({ error: 'Amount must be positive' });
      }

      const transaction = await creditService.addCredits(
        userId,
        creditAmount,
        {
          description: description || 'Admin credit addition',
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

  // Admin method to set a user's credit balance to an exact amount
  async setAdminCredits(req, res) {
    try {
      const { userId } = req.params;
      const { amount, description } = req.body;
      const creditAmount = Number(amount);

      if (!Number.isFinite(creditAmount) || creditAmount < 0) {
        return res.status(400).json({ error: 'Amount cannot be negative' });
      }

      const result = await creditService.setCreditBalance(
        userId,
        creditAmount,
        {
          description: description || 'Admin credit balance adjustment',
        }
      );

      res.json({
        ...result,
        message: `Successfully set credits for user ${userId} to ${creditAmount}`,
      });
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

};
