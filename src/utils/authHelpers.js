/**
 * Auth helper utilities for checking user roles and permissions
 */

/**
 * Check if a user has advocate role in a specific tenant
 * @param {Object} req - Express request object with auth data
 * @param {string} tenantId - The tenant ID to check for advocate role
 * @returns {boolean} - True if user is admin or has advocate role in the specified tenant
 */
export function isUserAdvocateInTenant(req, tenantId) {
  // Admin always has advocate privileges
  if (req.auth?.isAdmin) {
    return true;
  }

  // Check if user has advocate role globally (from Clerk metadata)
  if (req.auth?.isAdvocate) {
    return true;
  }

  // Check tenant-specific roles
  if (!req.auth?.tenantRoles || !tenantId) {
    return false;
  }

  const tenantRoles = req.auth.tenantRoles[tenantId];
  if (!tenantRoles || !tenantRoles.roles) {
    return false;
  }

  // Check if user has advocate role in this specific tenant
  return tenantRoles.roles.includes('advocate');
}

/**
 * Check if a user has a specific role in a tenant
 * @param {Object} req - Express request object with auth data
 * @param {string} tenantId - The tenant ID to check
 * @param {string} role - The role to check for
 * @returns {boolean} - True if user has the specified role in the tenant
 */
export function hasRoleInTenant(req, tenantId, role) {
  // Admin always has all roles
  if (req.auth?.isAdmin) {
    return true;
  }

  // Check tenant-specific roles
  if (!req.auth?.tenantRoles || !tenantId) {
    return false;
  }

  const tenantRoles = req.auth.tenantRoles[tenantId];
  if (!tenantRoles || !tenantRoles.roles) {
    return false;
  }

  return tenantRoles.roles.includes(role);
}

/**
 * Get all roles for a user in a specific tenant
 * @param {Object} req - Express request object with auth data
 * @param {string} tenantId - The tenant ID
 * @returns {Array} - Array of role strings
 */
export function getUserTenantRoles(req, tenantId) {
  if (!req.auth?.tenantRoles || !tenantId) {
    return [];
  }

  const tenantRoles = req.auth.tenantRoles[tenantId];
  return tenantRoles?.roles || [];
}

/**
 * Check if user can manage resources in a tenant
 * (Admin or Advocate can manage resources)
 * @param {Object} req - Express request object with auth data
 * @param {string} tenantId - The tenant ID
 * @returns {boolean} - True if user can manage resources
 */
export function canManageResourcesInTenant(req, tenantId) {
  return isUserAdvocateInTenant(req, tenantId);
}

/**
 * Check if a user can edit or delete an item (resource, event, etc.)
 * User can edit/delete if they are:
 * - Admin
 * - The creator/owner of the item
 * - An advocate in the item's tenant
 * @param {Object} req - Express request object with auth data
 * @param {Object} item - The item to check (must have tenantId and addedByUserId)
 * @returns {boolean} - True if user can edit/delete the item
 */
export function canEditOrDeleteItem(req, item) {
  if (!item) return false;

  // Admin can always edit/delete
  if (req.auth?.isAdmin) {
    return true;
  }

  // Owner can always edit/delete
  if (item.addedByUserId === req.auth?.dbUserId) {
    return true;
  }

  // Advocate in tenant can edit/delete
  if (item.tenantId) {
    return isUserAdvocateInTenant(req, item.tenantId);
  }

  return false;
}
