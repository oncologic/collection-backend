import {
  inviteCollaboratorService,
  acceptInvitationByTokenService,
  getPendingInvitationsService,
  acceptPendingInvitationsService,
} from '../services/invitationService.js';
import { pinItemsService } from '../services/pinnedService.js';
import { snakeToCamelCase } from '../utils/general.js';
import { db } from '../db/index.js';
import { users } from '../models/users.js';
import { eq } from 'drizzle-orm';

/**
 * Accept an invitation using a token from email link
 */
export const acceptInvitationByToken = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    if (!token) {
      return res.status(400).json({
        error: 'Invitation token is required',
      });
    }

    const result = await acceptInvitationByTokenService(
      token,
      userId,
      tenantIds
    );

    if (result.alreadyCollaborator) {
      return res.status(200).json({
        success: true,
        message: result.message,
        alreadyCollaborator: true,
      });
    }

    // Handle pinning separately to avoid circular dependency
    if (
      result.itemsToPin &&
      result.itemsToPin.length > 0 &&
      tenantIds.length > 0
    ) {
      try {
        await pinItemsService(result.itemsToPin, userId, tenantIds);
      } catch (pinningError) {
        console.error(
          'Error pinning collaboration items during token invitation acceptance:',
          pinningError
        );
      }
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: snakeToCamelCase(result.collaborator),
    });
  } catch (error) {
    console.error('Error accepting invitation by token:', error);

    if (error.message.includes('Invalid or expired')) {
      return res.status(404).json({
        error: 'Invalid or expired invitation token',
      });
    }

    if (error.message.includes('expired')) {
      return res.status(410).json({
        error: 'Invitation has expired',
      });
    }

    if (error.message.includes('email does not match')) {
      return res.status(403).json({
        error: 'Invitation email does not match your account email',
      });
    }

    res.status(500).json({
      error: 'Failed to accept invitation',
    });
  }
};

/**
 * Get pending invitations for the current user
 */
export const getPendingInvitations = async (req, res) => {
  try {
    const userId = req.auth.dbUserId;

    // Get user's email directly from database to avoid circular dependency
    const user = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    const invitations = await getPendingInvitationsService(user[0].email);

    res.status(200).json({
      success: true,
      data: snakeToCamelCase(invitations),
    });
  } catch (error) {
    console.error('Error getting pending invitations:', error);
    res.status(500).json({
      error: 'Failed to get pending invitations',
    });
  }
};

/**
 * Accept all pending invitations for the current user
 * This is typically called during login/signup flow
 */
export const acceptPendingInvitations = async (req, res) => {
  try {
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    // Get user's email directly from database to avoid circular dependency
    const user = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    const result = await acceptPendingInvitationsService(
      user[0].email,
      userId,
      tenantIds
    );

    const { acceptedInvitations, itemsToPin } = result;

    // Handle pinning separately to avoid circular dependency
    if (itemsToPin && itemsToPin.length > 0 && tenantIds.length > 0) {
      try {
        await pinItemsService(itemsToPin, userId, tenantIds);
      } catch (pinningError) {
        console.error(
          'Error pinning collaboration items during pending invitation acceptance:',
          pinningError
        );
      }
    }

    res.status(200).json({
      success: true,
      message: `Accepted ${acceptedInvitations.length} pending invitations`,
      data: {
        acceptedCount: acceptedInvitations.length,
        invitations: snakeToCamelCase(acceptedInvitations),
      },
    });
  } catch (error) {
    console.error('Error accepting pending invitations:', error);
    res.status(500).json({
      error: 'Failed to accept pending invitations',
    });
  }
};
