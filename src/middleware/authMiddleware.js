import { getAuth, clerkClient, requireAuth } from '@clerk/express';
import {
  findUserByClerkId,
  getUserTenantRoles,
} from '../services/userService.js';
import { validateTenants } from './tenantMiddleware.js';
import { rateLimitConfig } from '../config/rateLimiting.js';
import { getTenantVisibilitySettings } from '../services/tenantService.js';
import { db } from '../db/index.js';
import { userRoles } from '../models/userRoles.js';
import { eq, and } from 'drizzle-orm';

// Simple in-memory cache for user data
const userCache = new Map();
const {
  ttl: CACHE_TTL,
  maxSize: MAX_CACHE_SIZE,
  cleanupInterval: CLEANUP_INTERVAL,
} = rateLimitConfig.userCache;

// Cache cleanup function
const cleanupCache = () => {
  const now = Date.now();
  for (const [key, value] of userCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      userCache.delete(key);
    }
  }

  // If cache is still too large, remove oldest entries
  if (userCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(userCache.entries()).sort(
      (a, b) => a[1].timestamp - b[1].timestamp
    );
    const toRemove = entries.slice(0, userCache.size - MAX_CACHE_SIZE);
    toRemove.forEach(([key]) => userCache.delete(key));
  }
};

// Cleanup cache every 5 minutes
setInterval(cleanupCache, CLEANUP_INTERVAL);

const getCachedUser = (clerkUserId) => {
  const cached = userCache.get(clerkUserId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  return null;
};

const setCachedUser = (clerkUserId, userData) => {
  userCache.set(clerkUserId, {
    data: userData,
    timestamp: Date.now(),
  });
};

const ensureAdminRole = async (userId) => {
  const adminRoles = await db
    .select()
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.value, 'admin')))
    .limit(1);

  return adminRoles.length > 0;
};

export const requireAdmin = () => {
  return [
    requireAuth(),
    async (req, res, next) => {
      const auth = getAuth(req);

      try {
        // Check cache first
        let cachedData = getCachedUser(auth.userId);

        if (!cachedData) {
          // If not cached, fetch from APIs
          const dbUser = await findUserByClerkId(auth.userId);

          if (!dbUser) {
            return res.status(404).json({
              error: 'User not found in database',
            });
          }

          cachedData = {
            dbUser,
          };

          setCachedUser(auth.userId, cachedData);
        }

        // Add database user ID to the request object
        req.auth.dbUserId = cachedData.dbUser.id;
        req.auth.isAdmin = true;
        req.auth.isSuperuser = Boolean(cachedData.dbUser.superuser);

        // Check if user has admin role in the database userRoles table
        const hasAdminRole = await ensureAdminRole(cachedData.dbUser.id);

        if (!hasAdminRole) {
          return res.status(403).json({
            error: 'Forbidden: Requires admin role',
            message: 'User does not have admin role in database',
          });
        }

        next();
      } catch (error) {
        console.error('Error in requireAdmin middleware:', error);
        return res.status(500).json({
          error: 'An error occurred while checking admin privileges',
        });
      }
    },
  ];
};

export const requireSuperuser = () => {
  return [
    requireAuth(),
    async (req, res, next) => {
      const auth = getAuth(req);

      try {
        const dbUser = await findUserByClerkId(auth.userId);

        if (!dbUser) {
          return res.status(404).json({
            error: 'User not found in database',
          });
        }

        req.auth.dbUserId = dbUser.id;
        req.auth.isSuperuser = Boolean(dbUser.superuser);
        req.auth.isAdmin = await ensureAdminRole(dbUser.id);

        if (!req.auth.isSuperuser) {
          return res.status(403).json({
            error: 'Forbidden: Requires superuser access',
            message: 'Only superusers can access cross-tenant user management',
          });
        }

        next();
      } catch (error) {
        console.error('Error in requireSuperuser middleware:', error);
        return res.status(500).json({
          error: 'An error occurred while checking superuser privileges',
        });
      }
    },
  ];
};

export const requireUserAndTenants = () => {
  const middlewareChain = [
    requireAuth(),
    async (req, res, next) => {
      const auth = getAuth(req);
      try {
        // Check cache first
        let cachedData = getCachedUser(auth.userId);

        if (!cachedData || !Array.isArray(cachedData.roles)) {
          // If not cached, fetch from APIs
          const [dbUser, clerkUser] = await Promise.all([
            findUserByClerkId(auth.userId),
            clerkClient.users.getUser(auth.userId),
          ]);

          if (!dbUser) {
            return res.status(404).json({
              error: 'User not found in database',
            });
          }

          cachedData = {
            dbUser,
            roles: clerkUser.publicMetadata?.roles || [],
          };

          setCachedUser(auth.userId, cachedData);
        }

        // Set the dbUserId here
        req.auth.dbUserId = cachedData.dbUser.id;

        // Set isAdmin to true if the user is an admin
        req.auth.isAdmin = cachedData.roles.includes('admin');
        req.auth.isSuperuser = Boolean(cachedData.dbUser.superuser);

        // Fetch and attach tenant-specific roles
        const tenantRoles = await getUserTenantRoles(cachedData.dbUser.id);
        req.auth.tenantRoles = tenantRoles;

        next();
      } catch (error) {
        console.error('Error in requireUser middleware:', error);
        return res.status(500).json({
          error: 'An error occurred while checking user',
        });
      }
    },
    // validateTenants will now have access to req.auth.dbUserId
    async (req, res, next) => {
      await validateTenants(req, res, next);
    },
  ];

  return middlewareChain;
};

export const requireUser = () => {
  return [
    requireAuth(),
    async (req, res, next) => {
      const auth = getAuth(req);

      try {
        const dbUser = await findUserByClerkId(auth.userId);
        const clerkUser = await clerkClient.users.getUser(auth.userId);

        if (!dbUser) {
          return res.status(404).json({
            error: 'User not found in database',
          });
        }
        req.auth.clerkUserId = clerkUser.id;
        req.auth.dbUserId = dbUser.id;
        req.auth.isAdmin =
          clerkUser.publicMetadata?.roles?.includes('admin') || false;
        req.auth.isSuperuser = Boolean(dbUser.superuser);

        next();
      } catch (error) {
        console.error('❌ Error in requireUser middleware:', error);
        return res.status(500).json({
          error: 'An error occurred while checking user',
        });
      }
    },
  ];
};

export const requireAdvocate = () => {
  return [
    requireAuth(),
    async (req, res, next) => {
      const auth = getAuth(req);

      try {
        const user = await clerkClient.users.getUser(auth.userId);
        const clerkUser = await clerkClient.users.getUser(auth.userId);

        const dbUser = await findUserByClerkId(auth.userId);

        if (!dbUser) {
          return res.status(404).json({
            error: 'User not found in database',
          });
        }

        // Add database user ID to the request object
        req.auth.dbUserId = dbUser.id;

        // Set isAdmin to true if the user is an admin
        req.auth.isAdmin =
          clerkUser.publicMetadata?.roles?.includes('admin') || false;
        req.auth.isSuperuser = Boolean(dbUser.superuser);

        // Set isAdvocate flag as well
        req.auth.isAdvocate =
          clerkUser.publicMetadata?.roles?.includes('advocate') || false;

        // Fetch and attach tenant-specific roles
        const tenantRoles = await getUserTenantRoles(dbUser.id);
        req.auth.tenantRoles = tenantRoles;

        // Access roles directly from public metadata
        const roles = user.publicMetadata?.roles || [];

        if (!roles.includes('admin') && !roles.includes('advocate')) {
          return res.status(403).json({
            error: 'Forbidden: Requires admin or advocate role',
            roles: roles,
          });
        }

        next();
      } catch (error) {
        console.error('Error in requireAdvocate middleware:', error);
        return res.status(500).json({
          error: 'An error occurred while checking advocate privileges',
        });
      }
    },
  ];
};

export const requireClerkAuth = () => {
  return [
    requireAuth(),
    async (req, res, next) => {
      const auth = getAuth(req);
      try {
        // No need to call getUser twice
        const clerkUser = await clerkClient.users.getUser(auth.userId);

        // Add the Clerk user ID to req.auth
        req.auth.clerkUserId = clerkUser.id;

        // Set isAdmin to true if the user is an admin
        req.auth.isAdmin = clerkUser.publicMetadata?.roles?.includes('admin');
        next();
      } catch (error) {
        console.error('Error in requireClerkAuth middleware:', error);
        return res.status(500).json({
          error: 'An error occurred while verifying authentication',
        });
      }
    },
  ];
};

export const optionalAuth = () => {
  return async (req, res, next) => {
    const auth = getAuth(req);

    // If no auth, mark as public access and continue
    if (!auth || !auth.userId) {
      req.auth = {
        isPublicAccess: true,
        isAuthenticated: false,
        dbUserId: null,
        isAdmin: false,
        tenantRoles: [],
      };

      // Check if X-Tenant-Ids header is provided for public access
      const tenantIdsHeader = req.headers['x-tenant-ids'];

      if (tenantIdsHeader) {
        // Parse the header
        const requestedTenantIds = tenantIdsHeader.split(',').filter(Boolean);

        if (requestedTenantIds.length > 0) {
          // Check which tenants allow public access (for resources or events)
          const visibilityMap =
            await getTenantVisibilitySettings(requestedTenantIds);

          // Filter to only tenants that allow public access for resources OR events
          const publicTenants = requestedTenantIds.filter((tenantId) => {
            const settings = visibilityMap[tenantId];
            return settings && (settings.resources || settings.events);
          });

          if (publicTenants.length === 0) {
            // No tenants allow public access
            return res.status(403).json({
              error:
                'Public access is not available for the requested tenants. Please sign in to access this content.',
            });
          }

          // Store visibility info for use in controllers/services
          req.auth.publicTenantVisibility = visibilityMap;
          req.auth.publicTenantsWithResources = requestedTenantIds.filter(
            (id) => visibilityMap[id]?.resources === true
          );
          req.auth.publicTenantsWithEvents = requestedTenantIds.filter(
            (id) => visibilityMap[id]?.events === true
          );

          req.tenantIds = publicTenants;
        } else {
          req.tenantIds = [];
        }
      } else {
        // No tenant header provided - check all tenants for public access
        // This is a fallback, but ideally tenants should be specified
        // For backward compatibility, check if kidney tenant exists and allows public access
        const KIDNEY_TENANT_ID = process.env.KIDNEY_TENANT_ID;
        if (KIDNEY_TENANT_ID) {
          const visibilityMap = await getTenantVisibilitySettings([
            KIDNEY_TENANT_ID,
          ]);
          const settings = visibilityMap[KIDNEY_TENANT_ID];
          if (settings && (settings.resources || settings.events)) {
            req.tenantIds = [KIDNEY_TENANT_ID];
            req.auth.publicTenantVisibility = visibilityMap;
            req.auth.publicTenantsWithResources = settings.resources
              ? [KIDNEY_TENANT_ID]
              : [];
            req.auth.publicTenantsWithEvents = settings.events
              ? [KIDNEY_TENANT_ID]
              : [];
          } else {
            req.tenantIds = [];
          }
        } else {
          req.tenantIds = [];
        }
      }

      return next();
    }

    try {
      // Check cache first
      let cachedData = getCachedUser(auth.userId);

      if (!cachedData) {
        // If not cached, fetch from APIs
        const [dbUser, clerkUser] = await Promise.all([
          findUserByClerkId(auth.userId),
          clerkClient.users.getUser(auth.userId),
        ]);

        if (!dbUser) {
          // User exists in Clerk but not in DB - treat as public access
          req.auth = {
            isPublicAccess: true,
            isAuthenticated: false,
            dbUserId: null,
            isAdmin: false,
            tenantRoles: [],
          };

          // Check tenant visibility for public access
          const tenantIdsHeader = req.headers['x-tenant-ids'];
          if (tenantIdsHeader) {
            const requestedTenantIds = tenantIdsHeader
              .split(',')
              .filter(Boolean);
            if (requestedTenantIds.length > 0) {
              const visibilityMap =
                await getTenantVisibilitySettings(requestedTenantIds);
              const publicTenants = requestedTenantIds.filter((tenantId) => {
                const settings = visibilityMap[tenantId];
                return settings && (settings.resources || settings.events);
              });
              req.tenantIds = publicTenants;
              req.auth.publicTenantVisibility = visibilityMap;
              req.auth.publicTenantsWithResources = requestedTenantIds.filter(
                (id) => visibilityMap[id]?.resources === true
              );
              req.auth.publicTenantsWithEvents = requestedTenantIds.filter(
                (id) => visibilityMap[id]?.events === true
              );
            } else {
              req.tenantIds = [];
            }
          } else {
            // Fallback to kidney tenant if available
            const KIDNEY_TENANT_ID = process.env.KIDNEY_TENANT_ID;
            if (KIDNEY_TENANT_ID) {
              const visibilityMap = await getTenantVisibilitySettings([
                KIDNEY_TENANT_ID,
              ]);
              const settings = visibilityMap[KIDNEY_TENANT_ID];
              if (settings && (settings.resources || settings.events)) {
                req.tenantIds = [KIDNEY_TENANT_ID];
                req.auth.publicTenantVisibility = visibilityMap;
                req.auth.publicTenantsWithResources = settings.resources
                  ? [KIDNEY_TENANT_ID]
                  : [];
                req.auth.publicTenantsWithEvents = settings.events
                  ? [KIDNEY_TENANT_ID]
                  : [];
              } else {
                req.tenantIds = [];
              }
            } else {
              req.tenantIds = [];
            }
          }
          return next();
        }

        cachedData = {
          dbUser,
          roles: clerkUser.publicMetadata?.roles || [],
        };

        setCachedUser(auth.userId, cachedData);
      }

      // Set the authenticated user info
      req.auth = {
        isPublicAccess: false,
        isAuthenticated: true,
        userId: auth.userId,
        dbUserId: cachedData.dbUser.id,
        isAdmin: cachedData.roles.includes('admin'),
        clerkUserId: auth.userId,
      };

      // Fetch and attach tenant-specific roles
      const tenantRoles = await getUserTenantRoles(cachedData.dbUser.id);
      req.auth.tenantRoles = tenantRoles;

      // Now validate tenants for authenticated users
      await validateTenants(req, res, next);
    } catch (error) {
      console.error('Error in optionalAuth middleware:', error);
      // On error, treat as public access but check tenant visibility
      req.auth = {
        isPublicAccess: true,
        isAuthenticated: false,
        dbUserId: null,
        isAdmin: false,
        tenantRoles: [],
      };

      // Try to get tenant visibility on error
      try {
        const tenantIdsHeader = req.headers['x-tenant-ids'];
        if (tenantIdsHeader) {
          const requestedTenantIds = tenantIdsHeader.split(',').filter(Boolean);
          if (requestedTenantIds.length > 0) {
            const visibilityMap =
              await getTenantVisibilitySettings(requestedTenantIds);
            const publicTenants = requestedTenantIds.filter((tenantId) => {
              const settings = visibilityMap[tenantId];
              return settings && (settings.resources || settings.events);
            });
            req.tenantIds = publicTenants;
            req.auth.publicTenantVisibility = visibilityMap;
          } else {
            req.tenantIds = [];
          }
        } else {
          // Fallback to kidney tenant if available
          const KIDNEY_TENANT_ID = process.env.KIDNEY_TENANT_ID;
          if (KIDNEY_TENANT_ID) {
            const visibilityMap = await getTenantVisibilitySettings([
              KIDNEY_TENANT_ID,
            ]);
            const settings = visibilityMap[KIDNEY_TENANT_ID];
            if (settings && (settings.resources || settings.events)) {
              req.tenantIds = [KIDNEY_TENANT_ID];
              req.auth.publicTenantVisibility = visibilityMap;
            } else {
              req.tenantIds = [];
            }
          } else {
            req.tenantIds = [];
          }
        }
      } catch (visibilityError) {
        console.error('Error checking tenant visibility:', visibilityError);
        req.tenantIds = [];
      }

      next();
    }
  };
};

export const optionalAuthAndTenants = () => {
  return optionalAuth();
};
