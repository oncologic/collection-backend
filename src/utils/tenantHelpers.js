// Tenant helper utilities

/**
 * Determines the appropriate tenant based on various inputs
 * @param {string} preferredTenant - Tenant preference from user/frontend
 * @param {Object} metadata - Clerk metadata object
 * @returns {Object} - Object containing tenantId and associated roles
 */
export function determineTenantAndRoles(preferredTenant, metadata = {}) {
  // Check for tenant preference in order of priority
  const tenant =
    preferredTenant ||
    metadata?.unsafe_metadata?.tenant ||
    metadata?.public_metadata?.tenant ||
    'kidney'; // Default to kidney for backward compatibility

  let tenantId;
  let defaultRoles;

  switch (tenant) {
    case 'personal':
      tenantId = process.env.COMMUNITY_TENANT;
      defaultRoles = ['personal'];
      break;
    case 'kidney':
    default:
      tenantId = process.env.KIDNEY_TENANT_ID;
      defaultRoles = ['patient'];
      break;
  }

  return {
    tenantId,
    defaultRoles,
    tenantType: tenant,
  };
}

/**
 * Checks if a user has access to a specific tenant type
 * @param {Array} userTenants - Array of user's tenant objects
 * @param {string} tenantType - 'personal' or 'kidney'
 * @returns {boolean}
 */
export function hasAccessToTenantType(userTenants, tenantType) {
  if (!Array.isArray(userTenants)) return false;

  const targetTenantId =
    tenantType === 'personal'
      ? process.env.COMMUNITY_TENANT
      : process.env.KIDNEY_TENANT_ID;

  return userTenants.some(
    (tenant) =>
      tenant.id === targetTenantId || tenant.tenantId === targetTenantId
  );
}

/**
 * Gets the primary tenant for a user
 * @param {Array} userTenants - Array of user's tenant objects
 * @returns {string} - 'personal' or 'kidney'
 */
export function getPrimaryTenantType(userTenants) {
  if (!Array.isArray(userTenants) || userTenants.length === 0) {
    return 'kidney'; // Default
  }

  // Check if user has personal tenant
  const hasPersonal = hasAccessToTenantType(userTenants, 'personal');
  const hasKidney = hasAccessToTenantType(userTenants, 'kidney');

  // If user only has one type, return that
  if (hasPersonal && !hasKidney) return 'personal';
  if (hasKidney && !hasPersonal) return 'kidney';

  // If user has both, return kidney as default (can be changed based on business logic)
  return 'kidney';
}
