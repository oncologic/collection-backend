import express from 'express';
import { webhookController } from '../controllers/webhookController.js';
import { verifyClerkWebhook } from '../middleware/webhookMiddleware.js';

const router = express.Router();

// Clerk webhook endpoint
router.post('/clerk', verifyClerkWebhook, webhookController.handleClerkWebhook);

export default router;
