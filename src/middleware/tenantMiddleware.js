import { verifyUserTenantAccess } from '../services/userService.js';

export const validateTenants = async (req, res, next) => {
  try {
    // Get user ID from auth middleware
    const userId = req.auth.dbUserId;
    if (!userId) {
      return res
        .status(401)
        .json({ message: 'Authentication required for tenant access' });
    }

    // Get tenant IDs from header - require explicit tenant specification
    const tenantIdsHeader = req.headers['x-tenant-ids'];
    if (!tenantIdsHeader) {
      return res.status(400).json({
        message:
          'x-tenant-ids header is required to specify which tenants to access',
      });
    }

    const requestedTenantIds = tenantIdsHeader.split(',').filter(Boolean);
    if (requestedTenantIds.length === 0) {
      return res.status(400).json({
        message: 'At least one valid tenant ID must be specified',
      });
    }

    // Verify user has access to the requested tenants
    const authorizedTenants = await verifyUserTenantAccess(
      userId,
      requestedTenantIds
    );

    if (!authorizedTenants || authorizedTenants.length === 0) {
      return res.status(403).json({
        message: 'User has no access to the requested tenants',
      });
    }

    // Check if all requested tenants were authorized
    const authorizedTenantIds = authorizedTenants.map((t) => t.tenantId);
    const unauthorizedTenants = requestedTenantIds.filter(
      (id) => !authorizedTenantIds.includes(id)
    );

    if (unauthorizedTenants.length > 0) {
      return res.status(403).json({
        message: 'Unauthorized access to one or more tenants',
        unauthorizedTenants,
      });
    }

    // Store authorized tenants
    req.auth.tenants = authorizedTenantIds;
    req.tenantIds = authorizedTenantIds;
    req.tenants = authorizedTenants;

    next();
  } catch (error) {
    console.error('Tenant validation error:', error);
    res.status(500).json({ message: 'Error validating tenant access' });
  }
};
