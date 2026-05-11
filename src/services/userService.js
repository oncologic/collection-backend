import { db } from '../db/index.js';
import { users } from '../models/users.js';
import { sql, eq, and, inArray } from 'drizzle-orm';
import { userTypeMap } from '../models/userTypeMap.js';
import { userRoles } from '../models/userRoles.js';
import { clerkClient } from '@clerk/express';
import { usersTenants } from '../models/usersTenants.js';
import { tenants } from '../models/tenants.js';
import { acceptPendingInvitationsService } from './invitationService.js';
import { pinItemsService } from './pinnedService.js';
import { findUserCollaborationsForPinning } from './collaborationService.js';
import { addCreditsToUser } from './creditService.js';

export async function findUserByClerkId(clerkId) {
  const query = sql`
    SELECT id, email, first_name, last_name, has_onboarded, superuser
    FROM users 
    WHERE clerk_user_id = ${clerkId}
    LIMIT 1
  `;

  const result = await db.execute(query);
  return result.rows[0] || null;
}

export async function createUserFromClerk(clerkData) {
  const query = sql`
    INSERT INTO users (email, first_name, last_name, clerk_user_id)
    VALUES (${clerkData.email}, ${clerkData.firstName}, ${clerkData.lastName}, ${clerkData.id})
    RETURNING id, email, first_name, last_name, clerk_user_id
  `;

  const result = await db.execute(query);
  return result[0];
}

export async function getUserByIdService(id) {
  try {
    const query = sql`
      SELECT 
        u.id,
        u.first_name as "firstName",
        u.last_name as "lastName",
        u.email,
        u.user_role as "userRole",
        u.designation,
        u.cancer_type as "cancerType",
        u.prompt_context as "promptContext",
        u.year_of_birth as "yearOfBirth",
        u.created_at as "createdAt",
        u.clerk_user_id as "clerkUserId",
        u.has_onboarded as "hasOnboarded",
        u.superuser as "isSuperuser",
        COALESCE(
          ARRAY_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'id', ur.id,
              'name', ur.name,
              'value', ur.value,
              'description', ur.description,
              'verified', ur.verified,
              'licenseNumber', ur.license_number,
              'licenseState', ur.license_state,
              'tenantId', ur.tenant_id
            )
          ) FILTER (WHERE ur.id IS NOT NULL),
          ARRAY[]::jsonb[]
        ) as "userRoles",
        COALESCE(
          ARRAY_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'id', t.id,
              'name', t.name,
              'domain', t.domain
            )
          ) FILTER (WHERE t.id IS NOT NULL),
          ARRAY[]::jsonb[]
        ) as "tenants"
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN users_tenants ut ON u.id = ut.user_id
      LEFT JOIN tenants t ON ut.tenant_id = t.id
      WHERE u.id = ${id}
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.user_role, u.designation, u.created_at, u.superuser
      LIMIT 1
    `;

    const result = await db.execute(query);
    const user = result.rows[0];
    
    if (!user) {
      return null;
    }

    // Get tenant-specific roles
    const tenantRoles = await getUserTenantRoles(id);
    
    // Add roles to each tenant
    if (user.tenants && Array.isArray(user.tenants)) {
      user.tenants = user.tenants.map(tenant => ({
        ...tenant,
        roles: tenantRoles[tenant.id]?.roles || []
      }));
    }

    return user;
  } catch (error) {
    console.error('Error fetching user by id:', error);
    throw new Error('Failed to fetch user by id');
  }
}

export async function updateUserService({
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
  clerkUserId,
  profileUpdated,
  tenantId,
  hasOnboarded,
}) {
  try {
    return await db.transaction(async (tx) => {
      // Create an object with only the provided fields
      const updateFields = {
        ...(email !== undefined && { email }),
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(userRole !== undefined && { userRole }),
        ...(cancerType !== undefined && { cancerType }),
        ...(yearOfBirth !== undefined && { yearOfBirth }),
        ...(designation !== undefined && { designation }),
        ...(promptContext !== undefined && { promptContext }),
        ...(includeUpdatedSince !== undefined && { includeUpdatedSince }),
        ...(hasOnboarded !== undefined && { hasOnboarded }),
      };

      // Only perform update if there are fields to update
      let user = null;
      if (Object.keys(updateFields).length > 0) {
        user = await tx
          .update(users)
          .set(updateFields)
          .where(eq(users.id, userId));
      }

      // Remove specified user roles
      if (rolesToRemove?.length > 0) {
        await tx
          .delete(userRoles)
          .where(
            and(
              eq(userRoles.userId, userId),
              inArray(userRoles.id, rolesToRemove)
            )
          );
      }

      // Update existing user roles
      if (rolesToUpdate?.length > 0) {
        for (const role of rolesToUpdate) {
          await tx
            .update(userRoles)
            .set({
              verified: role.verified,
              value: role.id || role.value || role.name,
              ...(role.tenantId !== undefined && { tenantId: role.tenantId }),
            })
            .where(eq(userRoles.id, role.id));
        }
      }

      // Add new user roles
      if (rolesToAdd?.length > 0) {
        await tx.insert(userRoles).values(
          rolesToAdd.map((role) => ({
            userId,
            value: role.id || role.value || role.name,
            name: role.name,
            verified: role.verified,
            tenantId: role.tenantId || tenantId || null,
            ...(role.licenseNumber !== undefined && {
              licenseNumber: role.licenseNumber,
            }),
            ...(role.licenseState !== undefined && {
              licenseState: role.licenseState,
            }),
          }))
        );
      }

      // NOTE: We intentionally do NOT update Clerk metadata for role changes
      // Clerk roles (like admin) should only be managed through specific admin actions
      // Tenant-specific roles are managed in the database only
      // This prevents accidentally modifying global Clerk roles when updating tenant-specific roles

      return user;
    });
  } catch (error) {
    console.error('Error updating user:', error);
    throw new Error('Failed to update user');
  }
}

export async function getAllUsersService() {
  try {
    const query = sql`
      SELECT 
        u.id,
        u.first_name as "firstName",
        u.last_name as "lastName",
        u.email,
        u.user_role as "userRole",
        u.designation,
        u.created_at as "createdAt",
        COALESCE(
          ARRAY_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'id', ur.id,
              'name', ur.name,
              'value', ur.value,
              'description', ur.description,
              'verified', ur.verified,
              'licenseNumber', ur.license_number,
              'licenseState', ur.license_state,
              'tenantId', ur.tenant_id
            )
          ) FILTER (WHERE ur.id IS NOT NULL),
          ARRAY[]::jsonb[]
        ) as "userRoles",
        COALESCE(
          ARRAY_AGG(
            DISTINCT JSONB_BUILD_OBJECT(
              'id', t.id,
              'name', t.name,
              'domain', t.domain
            )
          ) FILTER (WHERE t.id IS NOT NULL),
          ARRAY[]::jsonb[]
        ) as "tenants"
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN users_tenants ut ON u.id = ut.user_id
      LEFT JOIN tenants t ON ut.tenant_id = t.id
      GROUP BY u.id, u.first_name, u.last_name, u.email, u.user_role, u.designation, u.created_at
    `;

    const result = await db.execute(query);
    return result.rows;
  } catch (error) {
    console.error('Error fetching all users:', error);
    throw new Error('Failed to fetch all users');
  }
}

export async function getUserByEmailService(email) {
  try {
    const user = await db.select().from(users).where(eq(users.email, email));
    return user;
  } catch (error) {
    console.error('Error fetching user by email:', error);
    throw new Error('Failed to fetch user by email');
  }
}

export async function getAllUserTypesService() {
  try {
    const userTypes = await db
      .select({
        id: userTypes.id,
        name: userTypes.name,
        description: userTypes.description,
        createdAt: userTypes.createdAt,
        updatedAt: userTypes.updatedAt,
      })
      .from(userTypes);
    return userTypes;
  } catch (error) {
    console.error('Error fetching all user types:', error);
    throw new Error('Failed to fetch all user types');
  }
}

/**
 * Filters roles to only include those that don't require approval or are already verified
 * @param {Array} roles - Array of role objects
 * @returns {Array} - Filtered array of roles
 */
export function filterApprovedRoles(roles) {
  if (!roles || !Array.isArray(roles)) {
    return [];
  }

  return roles.filter((role) => {
    // Include the role if it's already verified
    if (role.verified === true) {
      return true;
    }

    // Include the role if it doesn't require approval
    if (role.requires_approval === false) {
      return true;
    }

    // For backward compatibility, check for roles in different formats
    if (typeof role === 'string' || !role.id) {
      return true;
    }

    // Skip roles that explicitly require approval
    return !role.requires_approval;
  });
}

export async function createUserService({
  clerkId,
  email,
  firstName,
  lastName,
  roles,
  tenantIds,
}) {
  try {
    // First, create the user in a transaction with better race condition handling
    const newUser = await db.transaction(async (tx) => {
      // Try to create the user, handle duplicates gracefully
      let newUser;
      try {
        const insertResult = await tx
          .insert(users)
          .values({
            email,
            firstName,
            lastName,
            clerkUserId: clerkId,
          })
          .returning();

        newUser = insertResult;
      } catch (insertError) {
        // If it's a unique constraint violation, fetch the existing user
        if (
          insertError.message.includes('duplicate key') ||
          insertError.message.includes('unique constraint') ||
          insertError.code === '23505'
        ) {
          const existingUser = await tx
            .select()
            .from(users)
            .where(eq(users.clerkUserId, clerkId))
            .limit(1);

          if (existingUser.length === 0) {
            throw new Error('Failed to create or find user');
          }

          // Return existing user without processing roles/tenants again
          return existingUser[0];
        }

        // Re-throw if it's not a duplicate key error
        throw insertError;
      }

      const userId = newUser[0].id;

      // Determine which roles to assign based on the tenant
      const primaryTenantId =
        tenantIds && tenantIds.length > 0
          ? tenantIds[0]
          : process.env.KIDNEY_TENANT_ID;

      if (primaryTenantId === process.env.COMMUNITY_TENANT) {
        // Personal tenant - only assign 'personal' role
        await tx.insert(userRoles).values({
          name: 'personal',
          userId: userId,
          value: 'personal',
          verified: false,
          tenantId: process.env.COMMUNITY_TENANT || null,
        });
      } else if (primaryTenantId === process.env.KIDNEY_TENANT_ID) {
        // Kidney tenant - assign 'patient' role
        await tx.insert(userRoles).values({
          name: 'patient',
          userId: userId,
          value: 'patient',
          verified: false,
          tenantId: process.env.KIDNEY_TENANT_ID || null,
        });
      } else if (roles && roles.length > 0) {
        // Use provided roles if no specific tenant handling
        for (const role of roles) {
          await tx.insert(userRoles).values({
            name: typeof role === 'string' ? role : role.name || role.id,
            userId: userId,
            value:
              typeof role === 'string'
                ? role
                : role.value || role.id || role.name,
            verified: false,
            tenantId: primaryTenantId || null,
          });
        }
      }

      // Insert user into user_tenants table
      if (primaryTenantId) {
        await tx.insert(usersTenants).values({
          userId: userId,
          tenantId: primaryTenantId,
        });
      }
      // }
      // }

      // Filter roles to only include those that don't require approval
      // const approvedRoles = filterApprovedRoles(roles);

      // Use the new utility function to update Clerk
      // await updateClerkUserRoles(clerkId, approvedRoles);

      return newUser[0];
    });

    // After user creation transaction is complete, handle invitations and pinning
    const userId = newUser.id;

    // Handle all post-creation tasks separately to avoid call stack issues TODO: need to find this
    // await handlePostUserCreationTasks(email, userId, tenantIds);

    return newUser;
  } catch (error) {
    console.error('Error creating user:', error);

    // If it's a unique constraint violation, try to find the existing user
    if (
      error.message.includes('duplicate key') ||
      error.message.includes('unique constraint') ||
      error.code === '23505'
    ) {
      const existingUser = await findUserByClerkId(clerkId);
      if (existingUser) {
        return existingUser;
      }
    }

    throw new Error('Failed to create user');
  }
}

/**
 * Handle all post-user creation tasks (invitations and pinning)
 */
//Not adding right now because we give users basic credit to use for free each month
async function handlePostUserCreationTasks(email, userId, tenantIds) {
  // Add credits to the user first
  try {
    await addCreditsToUser(userId, 35);
  } catch (creditError) {
    console.error('Error adding credits to user:', creditError);
  }

  // Automatically accept any pending invitations FIRST
  let invitationItemsToPin = [];
  try {
    const invitationResult = await acceptPendingInvitationsService(
      email,
      userId,
      tenantIds
    );

    const { acceptedInvitations, itemsToPin } = invitationResult;
    invitationItemsToPin = itemsToPin || [];
  } catch (invitationError) {
    // Log the error but don't fail user creation
    console.error(
      'Error accepting pending invitations during user creation:',
      invitationError
    );
  }

  // THEN find all collaborations (including newly accepted ones) for pinning
  try {
    const collaborationItems = await findUserCollaborationsForPinning(
      email,
      userId
    );

    // Combine invitation items and collaboration items, removing duplicates
    const allItemsToPin = [...invitationItemsToPin, ...collaborationItems];
    const uniqueItemsToPin = allItemsToPin.filter(
      (item, index, self) =>
        index ===
        self.findIndex((i) => i.id === item.id && i.type === item.type)
    );

    if (uniqueItemsToPin.length > 0) {
      await handleItemPinning(
        uniqueItemsToPin,
        userId,
        tenantIds,
        'collaboration and invitation items'
      );
    }
  } catch (pinningError) {
    // Log the error but don't fail user creation
    console.error(
      'Error pinning user collaborations during user creation:',
      pinningError
    );
  }
}

/**
 * Handle pinning items with error handling
 */
async function handleItemPinning(items, userId, tenantIds, itemType) {
  try {
    await pinItemsService(items, userId, tenantIds);
  } catch (pinningError) {
    console.error(
      `Error pinning ${itemType} during user creation:`,
      pinningError
    );
  }
}

export async function verifyUserTenantAccess(userId, tenantIds) {
  try {
    // If no specific tenantIds provided, get ALL user's tenants
    const query = db
      .select({
        tenantId: usersTenants.tenantId,
        name: tenants.name,
        domain: tenants.domain,
      })
      .from(usersTenants)
      .innerJoin(tenants, eq(tenants.id, usersTenants.tenantId))
      .where(eq(usersTenants.userId, userId))
      .groupBy(usersTenants.tenantId, tenants.name, tenants.domain);

    // Only filter by specific tenantIds if they were provided and are valid
    if (tenantIds?.length && tenantIds.some((id) => id !== '')) {
      query.where(
        inArray(
          usersTenants.tenantId,
          tenantIds.filter((id) => id !== '')
        )
      );
    }

    return await query;
  } catch (error) {
    console.error('Error verifying tenant access:', error);
    throw error;
  }
}

export async function getUserTenants(userId) {
  try {
    const userTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        domain: tenants.domain,
        role: usersTenants.role,
      })
      .from(usersTenants)
      .innerJoin(tenants, eq(tenants.id, usersTenants.tenantId))
      .where(eq(usersTenants.userId, userId));

    return userTenants;
  } catch (error) {
    console.error('Error fetching user tenants:', error);
    throw new Error('Failed to fetch user tenants');
  }
}

export async function addUserToTenant(userId, tenantId, role = 'member') {
  try {
    // Check if the user-tenant relationship already exists
    const existing = await db
      .select()
      .from(usersTenants)
      .where(
        and(
          eq(usersTenants.userId, userId),
          eq(usersTenants.tenantId, tenantId)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    const result = await db
      .insert(usersTenants)
      .values({
        userId,
        tenantId,
        role,
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Error adding user to tenant:', error);

    // Handle unique constraint violations
    if (
      error.message.includes('duplicate key') ||
      error.message.includes('unique constraint') ||
      error.code === '23505'
    ) {
      // Try to fetch the existing record
      const existing = await db
        .select()
        .from(usersTenants)
        .where(
          and(
            eq(usersTenants.userId, userId),
            eq(usersTenants.tenantId, tenantId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        return existing[0];
      }
    }

    throw new Error('Failed to add user to tenant');
  }
}

/**
 * Removes a user from multiple tenants
 * @param {string} userId - The user ID
 * @param {string[]} tenantIds - Array of tenant IDs to remove user from
 * @returns {Promise} - Result of the operation
 */
export async function removeUserFromTenants(userId, tenantIds) {
  try {
    if (!userId || !tenantIds || tenantIds.length === 0) {
      throw new Error('User ID and tenant IDs are required');
    }

    // Delete user-tenant relationships
    await db
      .delete(usersTenants)
      .where(
        and(
          eq(usersTenants.userId, userId),
          inArray(usersTenants.tenantId, tenantIds)
        )
      );

    return { success: true, removedCount: tenantIds.length };
  } catch (error) {
    console.error('Error removing user from tenants:', error);
    throw new Error('Failed to remove user from tenants');
  }
}

/**
 * Updates a Clerk user's public metadata with roles
 * @param {string} clerkUserId - The Clerk user ID
 * @param {Array} roles - Array of roles to set in public metadata
 * @returns {Promise} - The result of the Clerk API call
 */
export async function updateClerkUserRoles(clerkUserId, roles) {
  try {
    if (!clerkUserId) {
      throw new Error('Clerk user ID is required');
    }

    if (!roles || !Array.isArray(roles)) {
      roles = [];
    }

    // Get current user metadata to preserve admin role
    const currentUser = await clerkClient.users.getUser(clerkUserId);
    const currentRoles = currentUser.publicMetadata?.roles || [];
    const hasAdminRole = currentRoles.includes('admin');

    // Extract role values from objects, handling different formats
    const roleValues = roles
      .map((role) => {
        // If role is just a string, use it directly
        if (typeof role === 'string') return role;

        // Handle different object formats:
        // - Role objects from userRoles table (have value/name properties)
        // - Role objects from API request (have id property)
        if (typeof role === 'object') {
          // Prioritize value over name over id
          return role.value || role.name || role.id;
        }

        return null;
      })
      .filter(Boolean); // Remove any null/undefined values

    // CRITICAL: Always preserve admin role if it exists
    if (hasAdminRole && !roleValues.includes('admin')) {
      roleValues.push('admin');
    }

    // Update the public metadata in Clerk
    const result = await clerkClient.users.updateUserMetadata(clerkUserId, {
      publicMetadata: {
        roles: roleValues,
      },
    });

    return result;
  } catch (error) {
    console.error('Error updating Clerk user roles:', error);
    throw new Error('Failed to update Clerk user roles');
  }
}

/**
 * Syncs a user's DB roles with their Clerk public metadata
 * @param {number} userId - The database user ID
 * @param {string} clerkUserId - The Clerk user ID
 * @param {string} [tenantId] - Optional tenant ID to filter roles by
 * @returns {Promise} - Result of the sync operation
 */
export async function syncUserRolesWithClerk(userId, clerkUserId, tenantId) {
  try {
    if (!userId || !clerkUserId) {
      throw new Error('User ID and Clerk User ID are required');
    }

    // Get current Clerk metadata to preserve admin role
    const currentUser = await clerkClient.users.getUser(clerkUserId);
    const currentClerkRoles = currentUser.publicMetadata?.roles || [];
    const hasAdminRole = currentClerkRoles.includes('admin');

    // Build the query to get roles
    let query = db
      .select({
        id: userRoles.id,
        name: userRoles.name,
        value: userRoles.value,
        verified: userRoles.verified,
        tenantId: userRoles.tenantId,
      })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    // Filter by tenant ID if provided
    if (tenantId) {
      query = query.where(eq(userRoles.tenantId, tenantId));
    }

    // Execute the query
    const currentRoles = await query;

    // Only include roles that are verified or don't require verification
    const rolesToSync = currentRoles
      .filter((role) => role.verified === true || role.verified === null)
      .map((role) => role.value || role.name);

    // CRITICAL: Always preserve admin role if it exists
    if (hasAdminRole && !rolesToSync.includes('admin')) {
      rolesToSync.push('admin');
    }

    // Update the Clerk user with these roles
    return await updateClerkUserRoles(clerkUserId, rolesToSync);
  } catch (error) {
    console.error('Error syncing user roles with Clerk:', error);
    throw new Error('Failed to sync user roles with Clerk');
  }
}

/**
 * Updates a specific role for a user and syncs with Clerk
 * @param {object} params - Parameters for updating the role
 * @param {number} params.userId - The database user ID
 * @param {string} params.roleName - The name of the role to update
 * @param {boolean} params.verified - Whether the role is verified
 * @param {string} [params.licenseNumber] - Optional license number for the role
 * @param {string} [params.licenseState] - Optional license state for the role
 * @param {string} [params.tenantId] - Optional tenant ID for the role
 * @returns {Promise} - The updated user role
 */
export async function updateUserRoleAndSyncClerk({
  userId,
  roleName,
  verified,
  licenseNumber,
  licenseState,
  tenantId,
}) {
  try {
    return await db.transaction(async (tx) => {
      if (!userId || !roleName) {
        throw new Error('User ID and role name are required');
      }

      // Check if the user exists and get the clerkUserId
      const user = await tx
        .select({ id: users.id, clerkUserId: users.clerkUserId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user || user.length === 0 || !user[0].clerkUserId) {
        throw new Error('User not found or missing Clerk ID');
      }

      const clerkUserId = user[0].clerkUserId;

      // Check if the role already exists for this user
      const existingRole = await tx
        .select()
        .from(userRoles)
        .where(and(eq(userRoles.userId, userId), eq(userRoles.name, roleName)))
        .limit(1);

      let updatedRole;

      if (existingRole && existingRole.length > 0) {
        // Update existing role
        const updateData = {
          verified,
          ...(licenseNumber !== undefined && { licenseNumber }),
          ...(licenseState !== undefined && { licenseState }),
          ...(tenantId !== undefined && { tenantId }),
        };

        updatedRole = await tx
          .update(userRoles)
          .set(updateData)
          .where(eq(userRoles.id, existingRole[0].id))
          .returning();
      } else {
        // Add new role
        updatedRole = await tx
          .insert(userRoles)
          .values({
            userId,
            name: roleName,
            value: roleName, // Ensure value matches name
            verified,
            ...(licenseNumber !== undefined && { licenseNumber }),
            ...(licenseState !== undefined && { licenseState }),
            ...(tenantId !== undefined && { tenantId }),
          })
          .returning();
      }

      // NOTE: We intentionally do NOT sync with Clerk here
      // Tenant-specific roles should remain in the database only

      return updatedRole[0];
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    throw new Error('Failed to update user role');
  }
}

export async function getAllTenantsService(isAdmin = false) {
  try {
    if (isAdmin) {
      // Admin can see all tenants
      const allTenants = await db.select().from(tenants);
      return allTenants;
    } else {
      // Regular users can only see public tenants
      const publicTenants = await db
        .select()
        .from(tenants)
        .where(eq(tenants.access, 'public'));
      return publicTenants;
    }
  } catch (error) {
    console.error('Error fetching all tenants:', error);
    throw new Error('Failed to fetch all tenants');
  }
}

/**
 * Get user's roles for each tenant they belong to
 * @param {string} userId - The database user ID
 * @returns {Promise<Array>} - Array of tenant IDs with their associated roles
 */
export async function getUserTenantRoles(userId) {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // First, get all tenants the user belongs to
    const userTenants = await db
      .select({
        tenantId: usersTenants.tenantId,
        tenantName: tenants.name,
      })
      .from(usersTenants)
      .innerJoin(tenants, eq(tenants.id, usersTenants.tenantId))
      .where(eq(usersTenants.userId, userId));

    // Then get all roles for this user
    const userRolesList = await db
      .select({
        tenantId: userRoles.tenantId,
        value: userRoles.value,
      })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));

    // Transform the result to a more convenient format
    const formattedRoles = {};
    
    // Initialize with all tenants
    userTenants.forEach((tenant) => {
      formattedRoles[tenant.tenantId] = {
        tenantName: tenant.tenantName,
        roles: [],
      };
    });

    // Add roles to their respective tenants
    userRolesList.forEach((role) => {
      if (role.tenantId && formattedRoles[role.tenantId]) {
        formattedRoles[role.tenantId].roles.push(role.value);
      }
    });

    return formattedRoles;
  } catch (error) {
    console.error('Error fetching user tenant roles:', error);
    throw new Error('Failed to fetch user tenant roles');
  }
}

/**
 * Update user roles for a specific tenant
 * @param {string} targetUserId - The user whose roles are being updated
 * @param {string} tenantId - The tenant ID where roles are being updated
 * @param {Array} newRoles - Array of role values to set for the user
 * @param {string} adminUserId - The admin user making the change
 * @returns {Promise<Object>} - Updated user with new roles
 */
export async function updateUserRolesForTenantService(
  targetUserId,
  tenantId,
  newRoles,
  adminUserId,
  isGlobalAdmin = false
) {
  try {
    if (!targetUserId || !tenantId || !adminUserId) {
      throw new Error('Target user ID, tenant ID, and admin user ID are required');
    }

    // Global admins are allowed to manage any tenant. For tenant-scoped admins,
    // require an actual membership row in users_tenants.
    if (!isGlobalAdmin) {
      const adminTenantAccess = await db
        .select()
        .from(usersTenants)
        .where(
          and(
            eq(usersTenants.userId, adminUserId),
            eq(usersTenants.tenantId, tenantId)
          )
        )
        .limit(1);

      if (adminTenantAccess.length === 0) {
        throw new Error('Admin does not have access to this tenant');
      }
    }

    // Verify target user belongs to this tenant
    const targetUserTenantAccess = await db
      .select()
      .from(usersTenants)
      .where(
        and(
          eq(usersTenants.userId, targetUserId),
          eq(usersTenants.tenantId, tenantId)
        )
      )
      .limit(1);

    if (targetUserTenantAccess.length === 0) {
      throw new Error('Target user does not belong to this tenant');
    }

    // Start transaction
    return await db.transaction(async (tx) => {
      // Get current roles for the user in this tenant
      const currentRoles = await tx
        .select()
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, targetUserId),
            eq(userRoles.tenantId, tenantId)
          )
        );

      const currentRoleValues = currentRoles.map(r => r.value);
      
      // Determine roles to add and remove
      const rolesToAdd = newRoles.filter(role => !currentRoleValues.includes(role));
      const rolesToRemove = currentRoles.filter(r => !newRoles.includes(r.value));

      // Remove roles that are no longer needed
      if (rolesToRemove.length > 0) {
        await tx
          .delete(userRoles)
          .where(
            and(
              eq(userRoles.userId, targetUserId),
              eq(userRoles.tenantId, tenantId),
              inArray(userRoles.id, rolesToRemove.map(r => r.id))
            )
          );
      }

      // Add new roles
      if (rolesToAdd.length > 0) {
        await tx.insert(userRoles).values(
          rolesToAdd.map(roleValue => ({
            userId: targetUserId,
            tenantId: tenantId,
            name: roleValue,
            value: roleValue,
            verified: false, // New roles start as unverified
          }))
        );
      }

      // NOTE: We intentionally do NOT update Clerk metadata here
      // Clerk roles should only be managed through specific admin actions
      // Tenant-specific roles are managed in the database only

      // Return updated user with new roles
      const updatedUser = await getUserByIdService(targetUserId);
      return updatedUser;
    });
  } catch (error) {
    console.error('Error updating user roles for tenant:', error);
    throw error;
  }
}
