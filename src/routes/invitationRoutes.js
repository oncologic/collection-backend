import express from 'express';
import {
  acceptInvitationByToken,
  getPendingInvitations,
  acceptPendingInvitations,
} from '../controllers/invitationController.js';
import { requireUser } from '../middleware/authMiddleware.js';

const router = express.Router();

// Accept invitation by token (for direct links from email)
router.post('/accept/:token', requireUser(), acceptInvitationByToken);

// Get pending invitations for current user
router.get('/pending', requireUser(), getPendingInvitations);

// Accept all pending invitations for current user (called during login/signup)
router.post('/accept-pending', requireUser(), acceptPendingInvitations);

export default router;
