import {
  getAllUsersService,
  getUserByEmailService,
  getUserByIdService,
  updateUserService,
  createUserService,
  findUserByClerkId,
  getAllTenantsService,
  getAllUserTypesService,
  addUserToTenant,
  removeUserFromTenants,
  updateClerkUserRoles,
  getUserTenantRoles,
  updateUserRolesForTenantService,
} from '../services/userService.js';
import { getPublicTenants as getPublicTenantsService } from '../services/tenantService.js';
import { pinItemsService } from '../services/pinnedService.js';
import { creditService } from '../services/creditService.js';
import { clerkClient } from '@clerk/express';

const FORBIDDEN_USER_PATCH_FIELDS = [
  'superuser',
  'isSuperuser',
  'clerkUserId',
];

const getForbiddenUserPatchFields = (payload = {}) =>
  FORBIDDEN_USER_PATCH_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(payload, field)
  );

// Simple in-memory cache to prevent rapid duplicate user creation
const userCreationCache = new Map();
const CACHE_DURATION = 5000; // 5 seconds

// Clean up old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of userCreationCache.entries()) {
    if (now - timestamp > CACHE_DURATION) {
      userCreationCache.delete(key);
    }
  }
}, CACHE_DURATION);

export const getUserById = async (req, res) => {
  try {
    const user = await getUserByIdService(req.auth.dbUserId);

    const creditInfo = await creditService.getUserCreditInfo(req.auth.dbUserId);

    res.json({
      ...user,
      creditInfo,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      error: 'Failed to fetch user',
      message: error.message,
    });
  }
};

export const updateUser = async (req, res) => {
  try {
    const forbiddenFields = getForbiddenUserPatchFields(req.body);
    if (forbiddenFields.length > 0) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `The following fields cannot be updated through this endpoint: ${forbiddenFields.join(
          ', '
        )}`,
      });
    }

    const {
      email,
      firstName,
      lastName,
      cancerType,
      yearOfBirth,
      designation,
      userRole,
      promptContext,
      includeUpdatedSince,
      userRoles: newUserRoles,
      profileUpdated,
    } = req.body;

    const userId = req.auth.dbUserId;

    if (profileUpdated) {
      const updatedUser = await updateUserService({
        userId,
        email,
        firstName,
        lastName,
        cancerType,
        yearOfBirth,
        designation,
        promptContext,
        includeUpdatedSince,
        profileUpdated,
      });
      res.json(updatedUser);
    } else {
      // Get current user to compare user roles
      const currentUser = await getUserByIdService(userId);
      const currentUserRoles = currentUser.userRoles || [];

      // Determine roles to add and update
      const rolesToAdd = [];
      const rolesToUpdate = [];

      newUserRoles?.forEach((newRole) => {
        const existingRole = currentUserRoles.find(
          (currentRole) => currentRole.name === newRole.name
        );

        if (!existingRole) {
          // Role doesn't exist yet, add it
          rolesToAdd.push(newRole);
        } else if (existingRole.verified !== newRole.verified) {
          // Role exists but verification status changed, update it
          rolesToUpdate.push({
            id: existingRole.id,
            verified: newRole.verified,
          });
        }
      });

      const rolesToRemove =
        currentUserRoles
          .filter(
            (currentRole) =>
              !newUserRoles?.some(
                (newRole) => newRole.name === currentRole.name
              )
          )
          .map((role) => role.id) || [];

      const updatedUser = await updateUserService({
        userId,
        email,
        firstName,
        lastName,
        userRole,
        cancerType,
        yearOfBirth,
        designation,
        promptContext,
        includeUpdatedSince,
        rolesToAdd,
        rolesToUpdate,
        rolesToRemove,
        clerkUserId: currentUser.clerkUserId,
      });
      res.json(updatedUser);
    }
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      error: 'Failed to update user',
      message: error.message,
    });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await getAllUsersService();
    res.json(users);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({
      error: 'Failed to fetch users',
      message: error.message,
    });
  }
};

export const getUserByEmail = async (req, res) => {
  try {
    const user = await getUserByEmailService(req.params.email);
    res.json(user);
  } catch (error) {
    console.error('Error fetching user by email:', error);
    res.status(500).json({
      error: 'Failed to fetch user',
      message: error.message,
    });
  }
};

export const getAllUserTypes = async (req, res) => {
  try {
    const userTypes = await getAllUserTypesService();
    res.json(userTypes);
  } catch (error) {
    console.error('Error fetching user types:', error);
    res.status(500).json({
      error: 'Failed to fetch user types',
      message: error.message,
    });
  }
};

export const createUser = async (req, res) => {
  try {
    const forbiddenFields = getForbiddenUserPatchFields(req.body);
    if (forbiddenFields.length > 0) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `The following fields cannot be set through this endpoint: ${forbiddenFields.join(
          ', '
        )}`,
      });
    }

    const { email, first_name, last_name, roles, tenants } = req.body;
    const clerkUserId = req.auth.clerkUserId;

    // Check if we're already processing a user creation for this Clerk ID
    if (userCreationCache.has(clerkUserId) || clerkUserId !== null) {
      // Wait a bit and try to find the user that should have been created
      // await new Promise((resolve) => setTimeout(resolve, 100));
      const existingUser = await findUserByClerkId(clerkUserId);
      if (existingUser) {
        // write the roles to the existing user

        const rolesToAdd = roles.map((role) => {
          return {
            name: role.id,
            userId: existingUser.id,
            value: role.id,
            verified: false,
          };
        });

        const updatedUser = await updateUserService({
          userId: existingUser.id,
          rolesToAdd: rolesToAdd,
          hasOnboarded: true,
        });

        // Add user to tenants if provided
        if (Array.isArray(tenants) && tenants.length > 0) {
          for (const tenantId of tenants) {
            await addUserToTenant(existingUser.id, tenantId);
          }
        }

        // Check if kidney cancer tenant and pin collection if needed
        await handleKidneyCancerCollectionPinning(existingUser.id, tenants);

        // Get the updated user with tenant information
        const finalUser = await getUserByIdService(existingUser.id);
        return res.json(finalUser);
      }
    }

    // Mark this user creation as in progress
    userCreationCache.set(clerkUserId, Date.now());

    // Check if user exists first
    const existingUser = await findUserByClerkId(clerkUserId);
    if (existingUser) {
      userCreationCache.delete(clerkUserId); // Clean up cache
      return res.json(existingUser);
    }

    // Create new user with proper error handling for duplicates
    try {
      const newUser = await createUserService({
        clerkId: clerkUserId,
        email,
        firstName: first_name,
        lastName: last_name,
        roles,
        tenantIds:
          Array.isArray(tenants) && tenants.length > 0 ? tenants : undefined,
      });

      // Check if kidney cancer tenant and pin collection if needed
      await handleKidneyCancerCollectionPinning(newUser.id, tenants);

      userCreationCache.delete(clerkUserId); // Clean up cache on success
      res.json(newUser);
    } catch (createError) {
      userCreationCache.delete(clerkUserId); // Clean up cache on error

      // Handle unique constraint violations (race condition)
      if (
        createError.message.includes('duplicate key') ||
        createError.message.includes('unique constraint') ||
        createError.code === '23505'
      ) {
        // If we hit a duplicate, try to find the existing user again
        const existingUser = await findUserByClerkId(clerkUserId);
        if (existingUser) {
          return res.json(existingUser);
        }
      }

      // Re-throw if it's not a duplicate key error
      throw createError;
    }
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      error: 'Failed to create user',
      message: error.message,
    });
  }
};

/**
 * Helper function to pin kidney cancer collection if user has kidney cancer tenant
 */
const handleKidneyCancerCollectionPinning = async (userId, tenants) => {
  try {
    const kidneyTenantId = process.env.KIDNEY_TENANT_ID;
    const kidneyCancerCollectionId = 'ee3ad1eb-868f-448d-b26b-b9efcc8d1a7a';

    // Check if user has kidney cancer tenant
    if (
      kidneyTenantId &&
      Array.isArray(tenants) &&
      tenants.includes(kidneyTenantId)
    ) {
      const itemToPin = {
        id: kidneyCancerCollectionId,
        type: 'collection',
      };

      await pinItemsService([itemToPin], userId, tenants);
    }
  } catch (error) {
    console.error('Error pinning kidney cancer collection:', error);
    // Don't throw error - this is a non-critical operation
  }
};

export const getAllTenants = async (req, res) => {
  try {
    const tenants = await getAllTenantsService(req.auth.isAdmin);
    res.json(tenants);
  } catch (error) {
    console.error('Error fetching all tenants:', error);
    res.status(500).json({
      error: 'Failed to fetch tenants',
      message: error.message,
    });
  }
};

export const getPublicTenants = async (req, res) => {
  try {
    const type = req.query.type || 'any'; // 'resources', 'events', or 'any'
    const tenants = await getPublicTenantsService(type);
    res.json(tenants);
  } catch (error) {
    console.error('Error fetching public tenants:', error);
    res.status(500).json({
      error: 'Failed to fetch public tenants',
      message: error.message,
    });
  }
};

export const addTenantToUser = async (req, res) => {
  try {
    const userId = req.auth.dbUserId;
    const clerkUserId = req.auth.clerkUserId;
    const { tenantType } = req.body;

    // Validate tenant type
    if (!tenantType || (tenantType !== 'personal' && tenantType !== 'kidney')) {
      return res.status(400).json({
        error: 'Invalid tenant type',
        message: 'Tenant type must be either "personal" or "kidney"',
      });
    }

    // Determine the tenant ID based on type
    const tenantId =
      tenantType === 'personal'
        ? process.env.COMMUNITY_TENANT
        : process.env.KIDNEY_TENANT_ID;

    if (!tenantId) {
      return res.status(500).json({
        error: 'Tenant configuration error',
        message: `${tenantType} tenant ID not configured in environment`,
      });
    }

    // Check if user already has this tenant
    const currentUser = await getUserByIdService(userId);
    const hasTenant = currentUser.tenants.some((t) => t.id === tenantId);

    if (hasTenant) {
      return res.status(400).json({
        error: 'Tenant already exists',
        message: `User already has access to ${tenantType} tenant`,
      });
    }

    // Add user to tenant
    await addUserToTenant(userId, tenantId);

    // If adding personal tenant, also add the personal role
    if (tenantType === 'personal') {
      const personalRole = {
        name: 'personal',
        value: 'personal',
        verified: false,
        tenantId: tenantId,
      };

      await updateUserService({
        userId,
        rolesToAdd: [personalRole],
        clerkUserId,
      });
    }

    // Update Clerk metadata to include new tenant
    const updatedMetadata = {
      ...currentUser,
      tenants: [
        ...(currentUser.tenants || []),
        { id: tenantId, type: tenantType },
      ],
    };

    // Update Clerk public metadata
    await clerkClient.users.updateUserMetadata(clerkUserId, {
      publicMetadata: {
        roles: currentUser.userRoles?.map((r) => r.value || r.name) || [],
        tenants: updatedMetadata.tenants.map(
          (t) =>
            t.type ||
            (t.id === process.env.COMMUNITY_TENANT ? 'personal' : 'kidney')
        ),
      },
    });

    // Get updated user data
    const updatedUser = await getUserByIdService(userId);

    res.json({
      message: `Successfully added ${tenantType} tenant to user`,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Error adding tenant to user:', error);
    res.status(500).json({
      error: 'Failed to add tenant to user',
      message: error.message,
    });
  }
};

export const joinPublicTenant = async (req, res) => {
  try {
    const userId = req.auth.dbUserId;
    const clerkUserId = req.auth.clerkUserId;
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({
        error: 'Missing tenant ID',
        message: 'Tenant ID is required',
      });
    }

    // Verify tenant exists and is public
    const tenant = await getAllTenantsService(false);
    const publicTenant = tenant.find((t) => t.id === tenantId);

    if (!publicTenant) {
      return res.status(404).json({
        error: 'Tenant not found',
        message: 'The specified tenant does not exist or is not public',
      });
    }

    // Check if user already has this tenant
    const currentUser = await getUserByIdService(userId);
    const hasTenant = currentUser.tenants?.some((t) => t.id === tenantId);

    if (hasTenant) {
      return res.status(400).json({
        error: 'Already joined',
        message: 'You have already joined this tenant',
      });
    }

    // Add user to tenant
    await addUserToTenant(userId, tenantId);

    // Update Clerk metadata
    const updatedTenants = [...(currentUser.tenants || []), publicTenant];

    await clerkClient.users.updateUserMetadata(clerkUserId, {
      publicMetadata: {
        roles: currentUser.userRoles?.map((r) => r.value || r.name) || [],
        tenants: updatedTenants.map((t) => t.name || t.id),
      },
    });

    // Get updated user data
    const updatedUser = await getUserByIdService(userId);

    res.json({
      message: `Successfully joined ${publicTenant.name}`,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Error joining tenant:', error);
    res.status(500).json({
      error: 'Failed to join tenant',
      message: error.message,
    });
  }
};

export const updateUserTenants = async (req, res) => {
  try {
    const userId = req.auth.dbUserId;
    const clerkUserId = req.auth.clerkUserId;
    const { tenantIds } = req.body;

    if (!Array.isArray(tenantIds)) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'tenantIds must be an array',
      });
    }

    // Get all public tenants
    const publicTenants = await getAllTenantsService(false);
    const publicTenantIds = publicTenants.map((t) => t.id);

    // Validate all provided tenant IDs are public
    const invalidTenants = tenantIds.filter(
      (id) => !publicTenantIds.includes(id)
    );

    if (invalidTenants.length > 0) {
      return res.status(400).json({
        error: 'Invalid tenants',
        message: 'Some tenant IDs are invalid or not public',
        invalidTenantIds: invalidTenants,
      });
    }

    // Get current user tenants
    const currentUser = await getUserByIdService(userId);
    const currentTenantIds = currentUser.tenants?.map((t) => t.id) || [];

    // Determine which tenants to add and remove
    const tenantsToAdd = tenantIds.filter(
      (id) => !currentTenantIds.includes(id)
    );
    const tenantsToRemove = currentTenantIds.filter(
      (id) => !tenantIds.includes(id)
    );

    // Add new tenants
    for (const tenantId of tenantsToAdd) {
      try {
        await addUserToTenant(userId, tenantId);
      } catch (error) {
        console.error('Failed to add tenant:', tenantId, error);
      }
    }

    // Remove tenants
    if (tenantsToRemove.length > 0) {
      await removeUserFromTenants(userId, tenantsToRemove);
    }

    // Update Clerk metadata
    const newTenants = publicTenants.filter((t) => tenantIds.includes(t.id));

    await clerkClient.users.updateUserMetadata(clerkUserId, {
      publicMetadata: {
        roles: currentUser.userRoles?.map((r) => r.value || r.name) || [],
        tenants: newTenants.map((t) => t.name || t.id),
      },
    });

    // Get updated user data
    const updatedUser = await getUserByIdService(userId);

    res.json({
      message: 'Tenant associations updated successfully',
      added: tenantsToAdd,
      removed: tenantsToRemove,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Error updating user tenants:', error);
    res.status(500).json({
      error: 'Failed to update tenants',
      message: error.message,
    });
  }
};

/**
 * Update user roles for a specific tenant
 * Only admins can update roles for users in their tenants
 */
export const updateUserRolesForTenant = async (req, res) => {
  try {
    const { userId: targetUserId, tenantId, roles } = req.body;
    const adminUserId = req.auth.dbUserId;
    const isGlobalAdmin = req.auth.isAdmin;

    // Validate input
    if (!targetUserId || !tenantId || !roles) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'userId, tenantId, and roles are required',
      });
    }

    if (!Array.isArray(roles)) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'roles must be an array of role values',
      });
    }

    // Check if requesting user is admin for this tenant
    // Global admins can update any tenant, otherwise check tenant-specific admin role
    if (!isGlobalAdmin) {
      const tenantRolesByTenant =
        req.auth.tenantRoles || (await getUserTenantRoles(adminUserId));
      const adminTenantRoles = tenantRolesByTenant?.[tenantId]?.roles || [];
      const hasAdminAccess =
        adminTenantRoles.includes('admin') ||
        adminTenantRoles.includes('advocate');

      if (!hasAdminAccess) {
        return res.status(403).json({
          error: 'Forbidden',
          message:
            'You must be an admin or advocate in this tenant to update user roles',
        });
      }
    }

    // Validate role values
    const validRoles = [
      'patient',
      'caregiver',
      'researcher',
      'advocate',
      'admin',
      'personal',
    ];
    const invalidRoles = roles.filter((role) => !validRoles.includes(role));

    if (invalidRoles.length > 0) {
      return res.status(400).json({
        error: 'Invalid roles',
        message: 'Some role values are invalid',
        invalidRoles: invalidRoles,
        validRoles: validRoles,
      });
    }

    // Update the user's roles
    const updatedUser = await updateUserRolesForTenantService(
      targetUserId,
      tenantId,
      roles,
      adminUserId,
      isGlobalAdmin
    );

    res.json({
      message: 'User roles updated successfully',
      user: updatedUser,
    });
  } catch (error) {
    console.error('Error updating user roles:', error);

    // Handle specific error cases
    if (error.message.includes('does not have access to this tenant')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: error.message,
      });
    }

    if (error.message.includes('does not belong to this tenant')) {
      return res.status(404).json({
        error: 'Not found',
        message: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to update user roles',
      message: error.message,
    });
  }
};
