import {
  previewImportService,
  executeImportService,
  updateImportDataService,
  parseTSVContent,
  transformTSVData,
  getResourceDuplicateGroupsService,
  deleteDuplicateResourcesService,
} from '../services/tsvImportService.js';
import { getUserTenantRoles, verifyUserTenantAccess } from '../services/userService.js';
import {
  getResourceEmbeddingBackfillStatusForTenants,
  queueResourceEmbeddingBackfillForTenants,
} from '../services/vectorService.js';

const ensureTenantImportAccess = async (req, res, tenantId) => {
  const userId = req.auth?.dbUserId;

  if (!tenantId) {
    res.status(400).json({
      success: false,
      message: 'Tenant ID is required',
    });
    return false;
  }

  if (!userId) {
    res.status(401).json({
      success: false,
      message: 'User authentication required',
    });
    return false;
  }

  const authorizedTenants = await verifyUserTenantAccess(userId, [tenantId]);

  if (!authorizedTenants?.length) {
    res.status(403).json({
      success: false,
      message: 'You do not have access to this tenant',
    });
    return false;
  }

  const tenantRoles = await getUserTenantRoles(userId);
  const canManageTenantResources =
    req.auth?.isAdmin || tenantRoles?.[tenantId]?.roles?.includes('advocate');

  if (!canManageTenantResources) {
    res.status(403).json({
      success: false,
      message:
        'Only administrators or advocates in this tenant can manage bulk imports and duplicate cleanup',
    });
    return false;
  }

  return true;
};

/**
 * Preview TSV import data
 * POST /api/import/preview
 */
export const previewImport = async (req, res) => {
  try {
    const { tsvContent, tenantId } = req.body;

    if (!tsvContent) {
      return res.status(400).json({
        success: false,
        message: 'TSV content is required',
      });
    }

    const hasAccess = await ensureTenantImportAccess(req, res, tenantId);
    if (!hasAccess) {
      return;
    }

    const previewData = await previewImportService(tsvContent, tenantId);
    
    res.status(200).json({
      success: true,
      data: previewData.data,
      summary: previewData.summary,
    });
  } catch (error) {
    console.error('Error in previewImport:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to preview import',
    });
  }
};

/**
 * Execute the import with confirmed data
 * POST /api/import/execute
 */
export const executeImport = async (req, res) => {
  try {
    const { importData, tenantId } = req.body;
    const userId = req.auth?.dbUserId;

    if (!importData) {
      return res.status(400).json({
        success: false,
        message: 'Import data is required',
      });
    }

    const hasAccess = await ensureTenantImportAccess(req, res, tenantId);
    if (!hasAccess) {
      return;
    }

    const result = await executeImportService(importData, userId, tenantId);

    res.status(200).json({
      success: true,
      results: result.results,
      summary: result.summary,
    });
  } catch (error) {
    console.error('Error in executeImport:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to execute import',
    });
  }
};

/**
 * Update import data before final import
 * PUT /api/import/update
 */
export const updateImportData = async (req, res) => {
  try {
    const { importData } = req.body;

    if (!importData) {
      return res.status(400).json({
        success: false,
        message: 'Import data is required',
      });
    }

    const updatedData = await updateImportDataService(importData);

    res.status(200).json({
      success: true,
      data: updatedData.data,
    });
  } catch (error) {
    console.error('Error in updateImportData:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update import data',
    });
  }
};

/**
 * Get duplicate resource titles and usage counts for a tenant
 * GET /api/import/resource-duplicates?tenantId=...
 */
export const getResourceDuplicates = async (req, res) => {
  try {
    const tenantId = req.query.tenantId;
    const hasAccess = await ensureTenantImportAccess(req, res, tenantId);

    if (!hasAccess) {
      return;
    }

    const result = await getResourceDuplicateGroupsService(tenantId);

    res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error('Error in getResourceDuplicates:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to load duplicate resources',
    });
  }
};

/**
 * Bulk delete selected duplicate resources for a tenant
 * DELETE /api/import/resource-duplicates
 */
export const deleteResourceDuplicates = async (req, res) => {
  try {
    const { tenantId, resourceIds } = req.body;
    const hasAccess = await ensureTenantImportAccess(req, res, tenantId);

    if (!hasAccess) {
      return;
    }

    if (!Array.isArray(resourceIds) || resourceIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one resource ID is required',
      });
    }

    const result = await deleteDuplicateResourcesService(resourceIds, tenantId);

    res.status(200).json({
      success: true,
      deletedCount: result.deletedCount,
      requestedCount: result.requestedCount,
      skippedResourceIds: result.skippedResourceIds,
      deletedResources: result.deletedResources,
    });
  } catch (error) {
    console.error('Error in deleteResourceDuplicates:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete duplicate resources',
    });
  }
};

/**
 * Queue resource embedding backfill for a tenant
 * POST /api/import/resource-embeddings/backfill
 */
export const backfillResourceEmbeddings = async (req, res) => {
  try {
    const { tenantId, forceAll = false } = req.body;
    const userId = req.auth?.dbUserId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required',
      });
    }

    const authorizedTenants = await verifyUserTenantAccess(userId, [tenantId]);

    if (!authorizedTenants?.length) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this tenant',
      });
    }

    const tenantRoles = await getUserTenantRoles(userId);
    const canManageTenantResources =
      req.auth?.isAdmin || tenantRoles?.[tenantId]?.roles?.includes('advocate');

    if (!canManageTenantResources) {
      return res.status(403).json({
        success: false,
        message:
          'Only administrators or advocates in this tenant can backfill resource embeddings',
      });
    }

    const result = await queueResourceEmbeddingBackfillForTenants(
      [tenantId],
      forceAll
    );
    const status = await getResourceEmbeddingBackfillStatusForTenants([
      tenantId,
    ]);

    res.status(200).json({
      success: true,
      queuedCount: result.queuedCount,
      resourceIds: result.resourceIds,
      alreadyRunning: result.alreadyRunning || false,
      status,
      message:
        result.alreadyRunning
          ? 'A resource embedding rebuild is already running for this tenant'
          : result.queuedCount > 0
          ? `Queued ${result.queuedCount} resource embedding update${
              result.queuedCount === 1 ? '' : 's'
            }. Search results may take a few minutes to refresh.`
          : forceAll
            ? 'No resources found in this tenant to rebuild embeddings for'
            : 'All resources in this tenant already have up-to-date embeddings',
    });
  } catch (error) {
    console.error('Error in backfillResourceEmbeddings:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to queue resource embedding backfill',
    });
  }
};

/**
 * Get resource embedding backfill status for a tenant
 * GET /api/import/resource-embeddings/status?tenantId=...
 */
export const getResourceEmbeddingBackfillStatus = async (req, res) => {
  try {
    const tenantId = req.query.tenantId;
    const userId = req.auth?.dbUserId;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required',
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User authentication required',
      });
    }

    const authorizedTenants = await verifyUserTenantAccess(userId, [tenantId]);

    if (!authorizedTenants?.length) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this tenant',
      });
    }

    const tenantRoles = await getUserTenantRoles(userId);
    const canManageTenantResources =
      req.auth?.isAdmin || tenantRoles?.[tenantId]?.roles?.includes('advocate');

    if (!canManageTenantResources) {
      return res.status(403).json({
        success: false,
        message:
          'Only administrators or advocates in this tenant can view resource embedding status',
      });
    }

    const status = await getResourceEmbeddingBackfillStatusForTenants([
      tenantId,
    ]);

    res.status(200).json({
      success: true,
      status,
    });
  } catch (error) {
    console.error('Error in getResourceEmbeddingBackfillStatus:', error);
    res.status(500).json({
      success: false,
      message:
        error.message || 'Failed to fetch resource embedding backfill status',
    });
  }
};

/**
 * Parse TSV file upload
 * POST /api/import/parse
 */
export const parseTSVFile = async (req, res) => {
  try {
    const file = req.file; // multer puts the file in req.file
    const { tenantId } = req.body;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: 'TSV file is required',
      });
    }

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required',
      });
    }

    // Read file content from multer buffer
    const tsvContent = file.buffer.toString('utf-8');
    
    // Parse and transform the data
    const parsedData = parseTSVContent(tsvContent);
    const transformedData = await transformTSVData(parsedData, tenantId);

    res.status(200).json({
      success: true,
      data: transformedData,
      summary: {
        organizationsCount: transformedData.organizations.length,
        resourcesCount: transformedData.resources.length,
        uniqueTagsCount: transformedData.tags.length,
      }
    });
  } catch (error) {
    console.error('Error in parseTSVFile:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to parse TSV file',
    });
  }
};
