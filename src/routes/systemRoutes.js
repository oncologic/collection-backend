import express from 'express';
import { requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Rate limiting status (admin only)
router.get('/rate-limit-status', requireAdmin(), (req, res) => {
  // Note: This would need to be implemented to access the internal state
  // of the rate limiting middleware. For now, just return basic info.
  res.json({
    message: 'Rate limiting monitoring endpoint',
    timestamp: new Date().toISOString(),
    // Add more detailed metrics here if needed
  });
});

export default router;
