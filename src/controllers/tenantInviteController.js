import {
  createTenantInviteService,
  getTenantInvitesService,
  getInviteByTokenService,
  acceptTenantInviteService,
  revokeTenantInviteService,
  getInviteUsageService,
} from '../services/tenantInviteService.js';
import { snakeToCamelCase } from '../utils/general.js';

/**
 * Create a new tenant invite link
 */
export const createTenantInvite = async (req, res) => {
  try {
    const { tenantId, role, metadata } = req.body;
    const userId = req.auth.dbUserId;
    const isGlobalAdmin = req.auth.isAdmin || false;

    if (!tenantId) {
      return res.status(400).json({
        error: 'Tenant ID is required',
      });
    }

    if (!role || !['advocate', 'patient'].includes(role)) {
      return res.status(400).json({
        error: 'Valid role (advocate or patient) is required',
      });
    }

    const invite = await createTenantInviteService(
      tenantId,
      userId,
      role,
      metadata || {},
      isGlobalAdmin
    );

    res.status(201).json({
      success: true,
      message: 'Tenant invite created successfully',
      data: snakeToCamelCase(invite),
    });
  } catch (error) {
    console.error('Error creating tenant invite:', error);

    if (error.message.includes('permission')) {
      return res.status(403).json({
        error: error.message,
      });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to create tenant invite',
    });
  }
};

/**
 * Get all invites for a tenant
 */
export const getTenantInvites = async (req, res) => {
  try {
    const { tenantId } = req.params;
    const userId = req.auth.dbUserId;
    const isGlobalAdmin = req.auth.isAdmin || false;

    if (!tenantId) {
      return res.status(400).json({
        error: 'Tenant ID is required',
      });
    }

    const invites = await getTenantInvitesService(
      tenantId,
      userId,
      isGlobalAdmin
    );

    res.status(200).json({
      success: true,
      data: snakeToCamelCase(invites),
    });
  } catch (error) {
    console.error('Error getting tenant invites:', error);

    if (error.message.includes('permission')) {
      return res.status(403).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to get tenant invites',
    });
  }
};

/**
 * Get invite details by token (public endpoint for invite acceptance page)
 */
export const getInviteByToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        error: 'Invite token is required',
      });
    }

    const invite = await getInviteByTokenService(token);

    res.status(200).json({
      success: true,
      data: snakeToCamelCase(invite),
    });
  } catch (error) {
    console.error('Error getting invite by token:', error);

    if (error.message.includes('Invalid')) {
      return res.status(404).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to get invite details',
    });
  }
};

/**
 * Accept a tenant invite
 */
export const acceptTenantInvite = async (req, res) => {
  try {
    const { token } = req.params;
    const userId = req.auth.dbUserId;

    if (!token) {
      return res.status(400).json({
        error: 'Invite token is required',
      });
    }

    const result = await acceptTenantInviteService(token, userId);

    if (result.alreadyMember) {
      return res.status(200).json({
        success: true,
        message: result.message,
        alreadyMember: true,
        data: snakeToCamelCase(result.tenant),
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: snakeToCamelCase({
        membership: result.membership,
        tenant: result.tenant,
        role: result.role,
      }),
    });
  } catch (error) {
    console.error('Error accepting tenant invite:', error);

    if (error.message.includes('Invalid')) {
      return res.status(404).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to accept tenant invite',
    });
  }
};

/**
 * Revoke a tenant invite
 */
export const revokeTenantInvite = async (req, res) => {
  try {
    const { inviteId } = req.params;
    const userId = req.auth.dbUserId;
    const isGlobalAdmin = req.auth.isAdmin || false;

    if (!inviteId) {
      return res.status(400).json({
        error: 'Invite ID is required',
      });
    }

    const invite = await revokeTenantInviteService(
      inviteId,
      userId,
      isGlobalAdmin
    );

    res.status(200).json({
      success: true,
      message: 'Tenant invite revoked successfully',
      data: snakeToCamelCase(invite),
    });
  } catch (error) {
    console.error('Error revoking tenant invite:', error);

    if (error.message.includes('permission')) {
      return res.status(403).json({
        error: error.message,
      });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to revoke tenant invite',
    });
  }
};

/**
 * Get usage statistics for an invite
 */
export const getInviteUsage = async (req, res) => {
  try {
    const { inviteId } = req.params;
    const userId = req.auth.dbUserId;
    const isGlobalAdmin = req.auth.isAdmin || false;

    if (!inviteId) {
      return res.status(400).json({
        error: 'Invite ID is required',
      });
    }

    const usage = await getInviteUsageService(
      inviteId,
      userId,
      isGlobalAdmin
    );

    res.status(200).json({
      success: true,
      data: snakeToCamelCase(usage),
    });
  } catch (error) {
    console.error('Error getting invite usage:', error);

    if (error.message.includes('permission')) {
      return res.status(403).json({
        error: error.message,
      });
    }

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to get invite usage',
    });
  }
};
