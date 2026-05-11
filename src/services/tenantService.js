import { db } from '../db/index.js';
import { tenants } from '../models/tenants.js';
import { eq, inArray } from 'drizzle-orm';

/**
 * Get tenant visibility settings for public access
 * @param {string|Array<string>} tenantIds - Single tenant ID or array of tenant IDs
 * @returns {Promise<Object>} - Object with tenantId as key and visibility settings as value
 */
export async function getTenantVisibilitySettings(tenantIds) {
  try {
    const ids = Array.isArray(tenantIds) ? tenantIds : [tenantIds];

    if (ids.length === 0) {
      return {};
    }

    const tenantRecords = await db
      .select({
        id: tenants.id,
        settings: tenants.settings,
        access: tenants.access,
      })
      .from(tenants)
      .where(inArray(tenants.id, ids));

    const visibilityMap = {};

    tenantRecords.forEach((tenant) => {
      // Check if tenant has public access in the access field
      const hasPublicAccess = tenant.access === 'public';

      const settings = tenant.settings || {};
      const publicAccess = settings.publicAccess || {};

      // Only allow public access if access='public' AND settings are enabled
      visibilityMap[tenant.id] = {
        resources: hasPublicAccess && publicAccess.resources === true,
        events: hasPublicAccess && publicAccess.events === true,
      };
    });

    return visibilityMap;
  } catch (error) {
    console.error('Error fetching tenant visibility settings:', error);
    // Return default (private) settings on error
    const ids = Array.isArray(tenantIds) ? tenantIds : [tenantIds];
    const defaultMap = {};
    ids.forEach((id) => {
      defaultMap[id] = { resources: false, events: false };
    });
    return defaultMap;
  }
}

/**
 * Check if a tenant allows public access to resources
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<boolean>} - True if public access is allowed
 */
export async function allowsPublicResources(tenantId) {
  if (!tenantId) return false;

  const visibilityMap = await getTenantVisibilitySettings([tenantId]);
  return visibilityMap[tenantId]?.resources === true;
}

/**
 * Check if a tenant allows public access to events
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<boolean>} - True if public access is allowed
 */
export async function allowsPublicEvents(tenantId) {
  if (!tenantId) return false;

  const visibilityMap = await getTenantVisibilitySettings([tenantId]);
  return visibilityMap[tenantId]?.events === true;
}

/**
 * Check if any of the provided tenants allow public access to resources
 * @param {Array<string>} tenantIds - Array of tenant IDs
 * @returns {Promise<boolean>} - True if any tenant allows public resources
 */
export async function anyTenantAllowsPublicResources(tenantIds) {
  if (!tenantIds || tenantIds.length === 0) return false;

  const visibilityMap = await getTenantVisibilitySettings(tenantIds);
  return Object.values(visibilityMap).some(
    (settings) => settings.resources === true
  );
}

/**
 * Check if any of the provided tenants allow public access to events
 * @param {Array<string>} tenantIds - Array of tenant IDs
 * @returns {Promise<boolean>} - True if any tenant allows public events
 */
export async function anyTenantAllowsPublicEvents(tenantIds) {
  if (!tenantIds || tenantIds.length === 0) return false;

  const visibilityMap = await getTenantVisibilitySettings(tenantIds);
  return Object.values(visibilityMap).some(
    (settings) => settings.events === true
  );
}

/**
 * Get tenants that allow public access to resources
 * @param {Array<string>} tenantIds - Array of tenant IDs to check
 * @returns {Promise<Array<string>>} - Array of tenant IDs that allow public resources
 */
export async function getTenantsWithPublicResources(tenantIds) {
  if (!tenantIds || tenantIds.length === 0) return [];

  const visibilityMap = await getTenantVisibilitySettings(tenantIds);
  return tenantIds.filter((id) => visibilityMap[id]?.resources === true);
}

/**
 * Get tenants that allow public access to events
 * @param {Array<string>} tenantIds - Array of tenant IDs to check
 * @returns {Promise<Array<string>>} - Array of tenant IDs that allow public events
 */
export async function getTenantsWithPublicEvents(tenantIds) {
  if (!tenantIds || tenantIds.length === 0) return [];

  const visibilityMap = await getTenantVisibilitySettings(tenantIds);
  return tenantIds.filter((id) => visibilityMap[id]?.events === true);
}

/**
 * Get all tenants that allow public access (for resources and/or events)
 * This is used for public/unauthenticated access discovery
 * @param {string} type - 'resources', 'events', or 'any' (default: 'any')
 * @returns {Promise<Array<Object>>} - Array of tenant objects with id, name, and visibility settings
 */
export async function getPublicTenants(type = 'any') {
  try {
    // Get all tenants
    const allTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        domain: tenants.domain,
        settings: tenants.settings,
        access: tenants.access,
      })
      .from(tenants);

    // Filter tenants based on public access settings AND access field
    const publicTenants = allTenants
      .filter((tenant) => {
        // Check if tenant has public access in the access field
        const hasPublicAccess = tenant.access === 'public';

        const settings = tenant.settings || {};
        const publicAccess = settings.publicAccess || {};

        // Tenant must have access='public' AND have public access settings enabled
        if (!hasPublicAccess) {
          return false;
        }

        if (type === 'resources') {
          return publicAccess.resources === true;
        } else if (type === 'events') {
          return publicAccess.events === true;
        } else {
          // 'any' - return tenants that allow public access to resources OR events
          return (
            publicAccess.resources === true || publicAccess.events === true
          );
        }
      })
      .map((tenant) => ({
        id: tenant.id,
        name: tenant.name,
        domain: tenant.domain,
        publicResources: tenant.settings?.publicAccess?.resources === true,
        publicEvents: tenant.settings?.publicAccess?.events === true,
      }));

    return publicTenants;
  } catch (error) {
    console.error('Error fetching public tenants:', error);
    return [];
  }
}
