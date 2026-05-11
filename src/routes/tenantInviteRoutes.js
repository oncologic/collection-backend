import express from 'express';
import {
  createTenantInvite,
  getTenantInvites,
  getInviteByToken,
  acceptTenantInvite,
  revokeTenantInvite,
  getInviteUsage,
} from '../controllers/tenantInviteController.js';
import { requireUser } from '../middleware/authMiddleware.js';

const router = express.Router();

// Create a new tenant invite link (requires authentication)
router.post('/', requireUser(), createTenantInvite);

// Get all invites for a tenant (requires authentication)
router.get('/tenant/:tenantId', requireUser(), getTenantInvites);

// Get invite details by token (public endpoint - no auth required)
router.get('/token/:token', getInviteByToken);

// Accept a tenant invite (requires authentication)
router.post('/accept/:token', requireUser(), acceptTenantInvite);

// Revoke a tenant invite (requires authentication)
router.delete('/:inviteId', requireUser(), revokeTenantInvite);

// Get usage statistics for an invite (requires authentication)
router.get('/:inviteId/usage', requireUser(), getInviteUsage);

export default router;
