import { db } from '../db/index.js';
import { eq, and, inArray } from 'drizzle-orm';
import crypto from 'crypto';
import { tenantInvites } from '../models/tenantInvites.js';
import { tenantInviteUses } from '../models/tenantInviteUses.js';
import { usersTenants } from '../models/usersTenants.js';
import { tenants } from '../models/tenants.js';
import { users } from '../models/users.js';
import { userRoles } from '../models/userRoles.js';

/**
 * Generate a secure invite token
 */
const generateInviteToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const INVITE_MANAGER_ROLES = ['admin', 'advocate'];

const assertTenantInviteManagementAccess = async (
  userId,
  tenantId,
  isGlobalAdmin = false
) => {
  if (isGlobalAdmin) {
    return;
  }

  const authorizedRole = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(userRoles.tenantId, tenantId),
        inArray(userRoles.value, INVITE_MANAGER_ROLES)
      )
    )
    .limit(1);

  if (!authorizedRole[0]) {
    throw new Error('User does not have permission to manage invites for this tenant');
  }
};

/**
 * Create a tenant invite link
 */
export const createTenantInviteService = async (
  tenantId,
  createdByUserId,
  role,
  metadata = {},
  isGlobalAdmin = false
) => {
  try {
    // Verify tenant exists
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant[0]) {
      throw new Error('Tenant not found');
    }

    await assertTenantInviteManagementAccess(
      createdByUserId,
      tenantId,
      isGlobalAdmin
    );

    // Generate unique token
    const inviteToken = generateInviteToken();

    // Create invite
    const invite = await db
      .insert(tenantInvites)
      .values({
        tenantId,
        inviteToken,
        createdByUserId,
        role, // 'advocate' or 'patient'
        isActive: true,
        maxUses: null, // null = unlimited
        useCount: '0',
        metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return invite[0];
  } catch (error) {
    console.error('Error creating tenant invite:', error);
    throw error;
  }
};

/**
 * Get all active invites for a tenant
 */
export const getTenantInvitesService = async (
  tenantId,
  userId,
  isGlobalAdmin = false
) => {
  try {
    if (!tenantId) {
      throw new Error('Tenant not found');
    }

    await assertTenantInviteManagementAccess(userId, tenantId, isGlobalAdmin);

    const invites = await db
      .select({
        id: tenantInvites.id,
        inviteToken: tenantInvites.inviteToken,
        role: tenantInvites.role,
        isActive: tenantInvites.isActive,
        useCount: tenantInvites.useCount,
        maxUses: tenantInvites.maxUses,
        createdAt: tenantInvites.createdAt,
        revokedAt: tenantInvites.revokedAt,
        createdByFirstName: users.firstName,
        createdByLastName: users.lastName,
        createdByEmail: users.email,
      })
      .from(tenantInvites)
      .leftJoin(users, eq(tenantInvites.createdByUserId, users.id))
      .where(eq(tenantInvites.tenantId, tenantId));

    return invites;
  } catch (error) {
    console.error('Error getting tenant invites:', error);
    throw error;
  }
};

/**
 * Get invite details by token (for the invite acceptance page)
 */
export const getInviteByTokenService = async (token) => {
  try {
    const invite = await db
      .select({
        id: tenantInvites.id,
        tenantId: tenantInvites.tenantId,
        tenantName: tenants.name,
        role: tenantInvites.role,
        isActive: tenantInvites.isActive,
        createdByFirstName: users.firstName,
        createdByLastName: users.lastName,
      })
      .from(tenantInvites)
      .innerJoin(tenants, eq(tenantInvites.tenantId, tenants.id))
      .leftJoin(users, eq(tenantInvites.createdByUserId, users.id))
      .where(
        and(
          eq(tenantInvites.inviteToken, token),
          eq(tenantInvites.isActive, true)
        )
      )
      .limit(1);

    if (!invite[0]) {
      throw new Error('Invalid or inactive invite link');
    }

    return invite[0];
  } catch (error) {
    console.error('Error getting invite by token:', error);
    throw error;
  }
};

/**
 * Accept a tenant invite
 */
export const acceptTenantInviteService = async (token, userId) => {
  try {
    return await db.transaction(async (tx) => {
      // Get invite details
      const invite = await tx
        .select()
        .from(tenantInvites)
        .where(
          and(
            eq(tenantInvites.inviteToken, token),
            eq(tenantInvites.isActive, true)
          )
        )
        .limit(1);

      if (!invite[0]) {
        throw new Error('Invalid or inactive invite link');
      }

      const currentCount = parseInt(invite[0].useCount || '0', 10);
      const maxUses = invite[0].maxUses
        ? parseInt(invite[0].maxUses, 10)
        : null;

      if (Number.isFinite(maxUses) && currentCount >= maxUses) {
        throw new Error('Invalid or inactive invite link');
      }

      // Check if user is already a member of this tenant
      const existingMembership = await tx
        .select()
        .from(usersTenants)
        .where(
          and(
            eq(usersTenants.userId, userId),
            eq(usersTenants.tenantId, invite[0].tenantId)
          )
        )
        .limit(1);

      if (existingMembership[0]) {
        return {
          alreadyMember: true,
          message: 'You are already a member of this tenant',
          tenant: await tx
            .select()
            .from(tenants)
            .where(eq(tenants.id, invite[0].tenantId))
            .limit(1)
            .then((res) => res[0]),
        };
      }

      // Add user to tenant
      const membership = await tx
        .insert(usersTenants)
        .values({
          userId,
          tenantId: invite[0].tenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Add tenant-specific role to user_roles table
      // Invite roles (advocate/patient) are tenant-specific, not global
      const existingRole = await tx
        .select()
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.tenantId, invite[0].tenantId),
            eq(userRoles.value, invite[0].role)
          )
        )
        .limit(1);

      if (!existingRole[0]) {
        await tx.insert(userRoles).values({
          userId,
          tenantId: invite[0].tenantId,
          name: invite[0].role,
          value: invite[0].role,
          description: `${invite[0].role} role`,
          verified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Record the invite use
      await tx.insert(tenantInviteUses).values({
        inviteId: invite[0].id,
        userId,
        tenantId: invite[0].tenantId,
        createdAt: new Date(),
      });

      // Increment use count
      const nextUseCount = currentCount + 1;
      await tx
        .update(tenantInvites)
        .set({
          useCount: String(nextUseCount),
          isActive:
            Number.isFinite(maxUses) && nextUseCount >= maxUses
              ? false
              : invite[0].isActive,
          updatedAt: new Date(),
        })
        .where(eq(tenantInvites.id, invite[0].id));

      // Get tenant details
      const tenant = await tx
        .select()
        .from(tenants)
        .where(eq(tenants.id, invite[0].tenantId))
        .limit(1);

      return {
        success: true,
        message: 'Successfully joined tenant',
        membership: membership[0],
        tenant: tenant[0],
        role: invite[0].role,
      };
    });
  } catch (error) {
    console.error('Error accepting tenant invite:', error);
    throw error;
  }
};

/**
 * Revoke/deactivate a tenant invite
 */
export const revokeTenantInviteService = async (
  inviteId,
  userId,
  isGlobalAdmin = false
) => {
  try {
    // Verify user has permission
    const invite = await db
      .select()
      .from(tenantInvites)
      .where(eq(tenantInvites.id, inviteId))
      .limit(1);

    if (!invite[0]) {
      throw new Error('Invite not found');
    }

    if (!isGlobalAdmin && invite[0].createdByUserId !== userId) {
      await assertTenantInviteManagementAccess(userId, invite[0].tenantId);
    }

    // Revoke the invite
    const revokedInvite = await db
      .update(tenantInvites)
      .set({
        isActive: false,
        revokedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenantInvites.id, inviteId))
      .returning();

    return revokedInvite[0];
  } catch (error) {
    console.error('Error revoking tenant invite:', error);
    throw error;
  }
};

/**
 * Get invite usage statistics
 */
export const getInviteUsageService = async (
  inviteId,
  userId,
  isGlobalAdmin = false
) => {
  try {
    const invite = await db
      .select({
        id: tenantInvites.id,
        tenantId: tenantInvites.tenantId,
        createdByUserId: tenantInvites.createdByUserId,
      })
      .from(tenantInvites)
      .where(eq(tenantInvites.id, inviteId))
      .limit(1);

    if (!invite[0]) {
      throw new Error('Invite not found');
    }

    if (!isGlobalAdmin && invite[0].createdByUserId !== userId) {
      await assertTenantInviteManagementAccess(userId, invite[0].tenantId);
    }

    const uses = await db
      .select({
        id: tenantInviteUses.id,
        userId: tenantInviteUses.userId,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
        joinedAt: tenantInviteUses.createdAt,
      })
      .from(tenantInviteUses)
      .leftJoin(users, eq(tenantInviteUses.userId, users.id))
      .where(eq(tenantInviteUses.inviteId, inviteId));

    return uses;
  } catch (error) {
    console.error('Error getting invite usage:', error);
    throw error;
  }
};
