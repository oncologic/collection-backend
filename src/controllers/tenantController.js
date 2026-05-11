import { db } from '../db/index.js';
import { tenants } from '../models/tenants.js';
import { usersTenants } from '../models/usersTenants.js';
import { userRoles } from '../models/userRoles.js';
import { users } from '../models/users.js';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * Get all tenants (admin only)
 */
export const getAllTenants = async (req, res) => {
  try {
    const allTenants = await db.select().from(tenants);

    res.json(allTenants);
  } catch (error) {
    console.error('Error fetching tenants:', error);
    res.status(500).json({
      error: 'Failed to fetch tenants',
      message: error.message,
    });
  }
};

/**
 * Get a single tenant by ID (admin only)
 */
export const getTenantById = async (req, res) => {
  try {
    const { id } = req.params;

    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (tenant.length === 0) {
      return res.status(404).json({
        error: 'Tenant not found',
      });
    }

    res.json(tenant[0]);
  } catch (error) {
    console.error('Error fetching tenant:', error);
    res.status(500).json({
      error: 'Failed to fetch tenant',
      message: error.message,
    });
  }
};

/**
 * Create a new tenant (admin only)
 */
export const createTenant = async (req, res) => {
  try {
    const { name, domain, settings, access } = req.body;

    if (!name) {
      return res.status(400).json({
        error: 'Name is required',
      });
    }

    const newTenant = await db
      .insert(tenants)
      .values({
        name,
        domain: domain || null,
        settings: settings || {},
        access: access || 'private',
      })
      .returning();

    res.status(201).json(newTenant[0]);
  } catch (error) {
    console.error('Error creating tenant:', error);
    res.status(500).json({
      error: 'Failed to create tenant',
      message: error.message,
    });
  }
};

/**
 * Update a tenant (admin only)
 */
export const updateTenant = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, domain, settings, access } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (domain !== undefined) updateData.domain = domain;
    if (settings !== undefined) updateData.settings = settings;
    if (access !== undefined) updateData.access = access;
    updateData.updatedAt = new Date();

    const updatedTenant = await db
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.id, id))
      .returning();

    if (updatedTenant.length === 0) {
      return res.status(404).json({
        error: 'Tenant not found',
      });
    }

    res.json(updatedTenant[0]);
  } catch (error) {
    console.error('Error updating tenant:', error);
    res.status(500).json({
      error: 'Failed to update tenant',
      message: error.message,
    });
  }
};

/**
 * Delete a tenant (admin only)
 */
export const deleteTenant = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if tenant exists
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (tenant.length === 0) {
      return res.status(404).json({
        error: 'Tenant not found',
      });
    }

    // Delete tenant (cascade will handle related records if foreign keys are set up)
    await db.delete(tenants).where(eq(tenants.id, id));

    res.json({ message: 'Tenant deleted successfully' });
  } catch (error) {
    console.error('Error deleting tenant:', error);
    res.status(500).json({
      error: 'Failed to delete tenant',
      message: error.message,
    });
  }
};

/**
 * Get all users in a tenant (admin only)
 */
export const getTenantUsers = async (req, res) => {
  try {
    const { id } = req.params;

    // Get all users in this tenant with their roles
    const tenantUsers = await db
      .select({
        userId: usersTenants.userId,
        tenantId: usersTenants.tenantId,
        createdAt: usersTenants.createdAt,
        user: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(usersTenants)
      .innerJoin(users, eq(usersTenants.userId, users.id))
      .where(eq(usersTenants.tenantId, id));

    // Get roles for each user in this tenant
    const userIds = tenantUsers.map((tu) => tu.userId);
    const roles =
      userIds.length > 0
        ? await db
            .select()
            .from(userRoles)
            .where(
              and(
                eq(userRoles.tenantId, id),
                inArray(userRoles.userId, userIds)
              )
            )
        : [];

    // Group roles by userId
    const rolesByUser = {};
    roles.forEach((role) => {
      if (!rolesByUser[role.userId]) {
        rolesByUser[role.userId] = [];
      }
      rolesByUser[role.userId].push(role);
    });

    // Combine users with their roles
    const usersWithRoles = tenantUsers.map((tu) => ({
      ...tu.user,
      roles: rolesByUser[tu.userId] || [],
    }));

    res.json(usersWithRoles);
  } catch (error) {
    console.error('Error fetching tenant users:', error);
    res.status(500).json({
      error: 'Failed to fetch tenant users',
      message: error.message,
    });
  }
};

/**
 * Add a user to a tenant (admin only)
 */
export const addUserToTenant = async (req, res) => {
  try {
    const { id } = req.params; // tenant id
    const { userId, roles } = req.body;

    if (!req.auth?.isSuperuser) {
      return res.status(403).json({
        error: 'Forbidden',
        message:
          'Only database-level superusers can add existing users across tenants',
      });
    }

    if (!userId) {
      return res.status(400).json({
        error: 'User ID is required',
      });
    }

    // Check if user exists
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user.length === 0) {
      return res.status(404).json({
        error: 'User not found',
      });
    }

    // Check if tenant exists
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (tenant.length === 0) {
      return res.status(404).json({
        error: 'Tenant not found',
      });
    }

    // Check if user is already in tenant
    const existing = await db
      .select()
      .from(usersTenants)
      .where(
        and(eq(usersTenants.userId, userId), eq(usersTenants.tenantId, id))
      )
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({
        error: 'User is already in this tenant',
      });
    }

    // Add user to tenant
    await db.insert(usersTenants).values({
      userId,
      tenantId: id,
    });

    // Add roles if provided
    if (roles && Array.isArray(roles) && roles.length > 0) {
      const roleValues = roles.map((role) => ({
        userId,
        tenantId: id,
        name: typeof role === 'string' ? role : role.name || role.value,
        value: typeof role === 'string' ? role : role.value || role.name,
        verified: false,
      }));

      await db.insert(userRoles).values(roleValues);
    }

    res.json({ message: 'User added to tenant successfully' });
  } catch (error) {
    console.error('Error adding user to tenant:', error);
    res.status(500).json({
      error: 'Failed to add user to tenant',
      message: error.message,
    });
  }
};

/**
 * Remove a user from a tenant (admin only)
 */
export const removeUserFromTenant = async (req, res) => {
  try {
    const { id, userId } = req.params; // tenant id and user id

    // Remove user from tenant
    await db
      .delete(usersTenants)
      .where(
        and(eq(usersTenants.userId, userId), eq(usersTenants.tenantId, id))
      );

    // Remove all roles for this user in this tenant
    await db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, id)));

    res.json({ message: 'User removed from tenant successfully' });
  } catch (error) {
    console.error('Error removing user from tenant:', error);
    res.status(500).json({
      error: 'Failed to remove user from tenant',
      message: error.message,
    });
  }
};

/**
 * Update user roles in a tenant (admin only)
 */
export const updateUserRolesInTenant = async (req, res) => {
  try {
    const { id, userId } = req.params; // tenant id and user id
    const { roles } = req.body;

    if (!Array.isArray(roles)) {
      return res.status(400).json({
        error: 'Roles must be an array',
      });
    }

    // Get current roles
    const currentRoles = await db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, id)));

    const currentRoleValues = currentRoles.map((r) => r.value);

    // Determine roles to add and remove
    const rolesToAdd = roles.filter(
      (role) => !currentRoleValues.includes(role)
    );
    const rolesToRemove = currentRoles.filter((r) => !roles.includes(r.value));

    // Remove roles that are no longer needed
    if (rolesToRemove.length > 0) {
      await db.delete(userRoles).where(
        and(
          eq(userRoles.userId, userId),
          eq(userRoles.tenantId, id),
          inArray(
            userRoles.id,
            rolesToRemove.map((r) => r.id)
          )
        )
      );
    }

    // Add new roles
    if (rolesToAdd.length > 0) {
      await db.insert(userRoles).values(
        rolesToAdd.map((roleValue) => ({
          userId,
          tenantId: id,
          name: roleValue,
          value: roleValue,
          verified: false,
        }))
      );
    }

    res.json({ message: 'User roles updated successfully' });
  } catch (error) {
    console.error('Error updating user roles:', error);
    res.status(500).json({
      error: 'Failed to update user roles',
      message: error.message,
    });
  }
};
