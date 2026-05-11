import { db } from '../db/index.js';
import { eq, and, inArray, or } from 'drizzle-orm';
import { userRoles } from '../models/userRoles.js';
import { slackWorkspaces } from '../models/slackIntegrations.js';
import { collections } from '../models/collections.js';
import { externalLinks } from '../models/external_links.js';

/**
 * Middleware to check if user is an admin for any of their tenants
 * This should be used AFTER requireUserAndTenants() which sets req.tenants
 */
export const requireTenantAdmin = () => async (req, res, next) => {
  try {
    const userId = req.auth?.dbUserId;

    // Check if requireUserAndTenants was called first
    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not authenticated'
      });
    }

    // Use req.tenants which was set by requireUserAndTenants/validateTenants
    const tenants = req.tenants;
    const tenantIds = req.tenantIds || req.auth.tenants;

    if (!tenants || !tenantIds || tenantIds.length === 0) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'User has no tenant access'
      });
    }

    // Check if user has admin role in any of their tenants
    const adminRoles = await db
      .select()
      .from(userRoles)
      .where(
        and(
          eq(userRoles.userId, userId),
          inArray(userRoles.tenantId, tenantIds),
          eq(userRoles.value, 'admin')
        )
      );

    if (adminRoles.length === 0) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required for Slack integration setup'
      });
    }

    // Add admin tenant IDs to request for later use
    req.adminTenants = adminRoles.map(role => role.tenantId);

    next();
  } catch (error) {
    console.error('Error in requireTenantAdmin middleware:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify admin permissions'
    });
  }
};

/**
 * Middleware to check if user can manage a specific Slack workspace
 */
export const canManageSlackWorkspace = () => async (req, res, next) => {
  try {
    const userId = req.auth?.dbUserId;
    const workspaceId = req.params.workspaceId || req.body.workspaceId;

    // Get admin tenants - use req.adminTenants if requireTenantAdmin was already called
    let adminTenants = req.adminTenants;

    if (!adminTenants) {
      // Otherwise check admin permissions ourselves
      // First check if req.tenantIds exists (from requireUserAndTenants)
      const tenantIds = req.tenantIds || req.auth?.tenants;

      if (!tenantIds || !tenantIds.length) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'No tenant access'
        });
      }

      // Check which tenants user is admin for
      const adminRoles = await db
        .select()
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            inArray(userRoles.tenantId, tenantIds),
            eq(userRoles.value, 'admin')
          )
        );

      adminTenants = adminRoles.map(role => role.tenantId);
    }

    if (!userId || !workspaceId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters'
      });
    }

    if (!adminTenants.length) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }

    // Check if workspace belongs to one of user's admin tenants
    const workspace = await db
      .select()
      .from(slackWorkspaces)
      .where(
        and(
          eq(slackWorkspaces.id, workspaceId),
          inArray(slackWorkspaces.tenantId, adminTenants)
        )
      )
      .limit(1);

    if (workspace.length === 0) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to manage this Slack workspace'
      });
    }

    req.workspace = workspace[0];
    next();
  } catch (error) {
    console.error('Error in canManageSlackWorkspace middleware:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify workspace permissions'
    });
  }
};

/**
 * Middleware to check if user can configure Slack for a collection
 */
export const canConfigureCollectionSlack = () => async (req, res, next) => {
  try {
    const userId = req.auth?.dbUserId;
    const collectionId = req.params.collectionId || req.body.collectionId;

    // Use req.tenantIds if it exists (from requireUserAndTenants)
    // Otherwise fall back to getting from header
    let tenantIds = req.tenantIds || req.auth?.tenants;

    if (!tenantIds) {
      const tenantIdsHeader = req.headers['x-tenant-ids'];
      tenantIds = tenantIdsHeader ? tenantIdsHeader.split(',').map(id => id.trim()) : [];
    }

    if (!userId || !collectionId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters'
      });
    }

    if (!tenantIds || !tenantIds.length) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'No tenant access'
      });
    }

    // Check if user owns the collection or is an admin
    const collection = await db
      .select()
      .from(collections)
      .where(
        and(
          eq(collections.id, collectionId),
          inArray(collections.tenantId, tenantIds)
        )
      )
      .limit(1);

    if (collection.length === 0) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Collection not found or no access'
      });
    }

    // Check if user owns the collection or is an admin for the tenant
    const isOwner = collection[0].userId === userId;

    let isAdmin = false;
    if (!isOwner) {
      const adminRole = await db
        .select()
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.tenantId, collection[0].tenantId),
            eq(userRoles.value, 'admin')
          )
        )
        .limit(1);

      isAdmin = adminRole.length > 0;
    }

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to configure Slack for this collection'
      });
    }

    req.collection = collection[0];
    next();
  } catch (error) {
    console.error('Error in canConfigureCollectionSlack middleware:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify collection permissions'
    });
  }
};

/**
 * Middleware to check if user can configure Slack for an external link
 */
export const canConfigureExternalLinkSlack = () => async (req, res, next) => {
  try {
    const userId = req.auth?.dbUserId;
    const externalLinkId = req.params.externalLinkId || req.body.externalLinkId;

    // Use req.tenantIds if it exists (from requireUserAndTenants)
    // Otherwise fall back to getting from header
    let tenantIds = req.tenantIds || req.auth?.tenants;

    if (!tenantIds) {
      const tenantIdsHeader = req.headers['x-tenant-ids'];
      tenantIds = tenantIdsHeader ? tenantIdsHeader.split(',').map(id => id.trim()) : [];
    }

    if (!userId || !externalLinkId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters'
      });
    }

    if (!tenantIds || !tenantIds.length) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'No tenant access'
      });
    }

    // Check if user owns the external link or is an admin
    const externalLink = await db
      .select()
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.id, externalLinkId),
          inArray(externalLinks.tenantId, tenantIds)
        )
      )
      .limit(1);

    if (externalLink.length === 0) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'External link not found or no access'
      });
    }

    // Check if user owns the external link or is an admin for the tenant
    const isOwner = externalLink[0].addedByUserId === userId;

    let isAdmin = false;
    if (!isOwner) {
      const adminRole = await db
        .select()
        .from(userRoles)
        .where(
          and(
            eq(userRoles.userId, userId),
            eq(userRoles.tenantId, externalLink[0].tenantId),
            eq(userRoles.value, 'admin')
          )
        )
        .limit(1);

      isAdmin = adminRole.length > 0;
    }

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You do not have permission to configure Slack for this external link'
      });
    }

    req.externalLink = externalLink[0];
    next();
  } catch (error) {
    console.error('Error in canConfigureExternalLinkSlack middleware:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to verify external link permissions'
    });
  }
};