import {
  createNotationTemplateService,
  getNotationTemplateByIdService,
  getTemplatesByExternalLinkService,
  getPublicSubmissionTemplateService,
  updateNotationTemplateService,
  deleteNotationTemplateService,
  createNotationFromTemplateService,
  validateCustomFieldsService,
  getExternalSubmissionsService,
  reviewExternalSubmissionService,
  bulkReviewSubmissionsService,
  getExternalSubmissionByNotationIdService,
  getSubmissionStatisticsService,
} from '../services/notationTemplateService.js';
import { getExternalLinkByIdService } from '../services/collectionService.js';
import { db } from '../db/index.js';
import { collectionExternalLinks } from '../models/external_links.js';
import { eq } from 'drizzle-orm';

export const createNotationTemplate = async (req, res) => {
  try {
    const { externalLinkId } = req.params;
    const templateData = req.body;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    // Check if user has access to the external link
    const externalLink = await getExternalLinkByIdService(
      externalLinkId,
      userId,
      tenantIds
    );

    if (!externalLink) {
      return res
        .status(404)
        .json({ error: 'External link not found or access denied' });
    }

    // Get the collectionExternalLinkId from the collections array
    const collectionExternalLinkId =
      externalLink.collections?.[0]?.collectionExternalLinkId;

    if (!collectionExternalLinkId) {
      return res
        .status(404)
        .json({ error: 'External link is not associated with any collection' });
    }

    // Check if user is owner or has admin permissions
    const isOwner = externalLink.addedByUserId === userId;
    const isCollaboratorWithPermission = externalLink.collaborators?.some(
      (c) => c.userId === userId && c.permissions?.canManageNotations
    );

    if (!isOwner && !isCollaboratorWithPermission) {
      return res
        .status(403)
        .json({ error: 'Permission denied to create templates' });
    }

    // Create the template
    const template = await createNotationTemplateService(
      {
        ...templateData,
        collectionExternalLinkId: collectionExternalLinkId,
      },
      userId
    );

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating notation template:', error);
    res.status(500).json({ error: 'Failed to create notation template' });
  }
};

export const getNotationTemplates = async (req, res) => {
  try {
    const { externalLinkId } = req.params;
    const { includeInactive } = req.query;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    // Check if user has access to the external link
    const externalLink = await getExternalLinkByIdService(
      externalLinkId,
      userId,
      tenantIds
    );

    if (!externalLink) {
      return res
        .status(404)
        .json({ error: 'External link not found or access denied' });
    }

    // Get the collectionExternalLinkId from the collections array
    const collectionExternalLinkId =
      externalLink.collections?.[0]?.collectionExternalLinkId;

    if (!collectionExternalLinkId) {
      return res
        .status(404)
        .json({ error: 'External link is not associated with any collection' });
    }

    const templates = await getTemplatesByExternalLinkService(
      collectionExternalLinkId,
      includeInactive === 'true'
    );

    res.json(templates);
  } catch (error) {
    console.error('Error fetching notation templates:', error);
    res.status(500).json({ error: 'Failed to fetch notation templates' });
  }
};

export const getNotationTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    const template = await getNotationTemplateByIdService(templateId);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Check if user has access to the external link
    const externalLink = await getExternalLinkByIdService(
      template.collectionExternalLinkId,
      userId,
      tenantIds
    );

    if (!externalLink) {
      return res
        .status(404)
        .json({ error: 'Template not found or access denied' });
    }

    res.json(template);
  } catch (error) {
    console.error('Error fetching notation template:', error);
    res.status(500).json({ error: 'Failed to fetch notation template' });
  }
};

export const updateNotationTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const updateData = req.body;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    // Get the template to check permissions
    const template = await getNotationTemplateByIdService(templateId);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Get the external link ID from the collection_external_links table
    const [collectionExternalLink] = await db
      .select({ externalLinkId: collectionExternalLinks.externalLinkId })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.id, template.collectionExternalLinkId))
      .limit(1);

    if (!collectionExternalLink) {
      return res
        .status(404)
        .json({ error: 'Associated external link not found' });
    }

    // Check if user has access to the external link
    const externalLink = await getExternalLinkByIdService(
      collectionExternalLink.externalLinkId,
      userId,
      tenantIds
    );

    if (!externalLink) {
      return res
        .status(404)
        .json({ error: 'Template not found or access denied' });
    }

    // Check if user is owner or has admin permissions
    const isOwner = externalLink.addedByUserId === userId;
    const isCollaboratorWithPermission = externalLink.collaborators?.some(
      (c) => c.userId === userId && c.permissions?.canManageNotations
    );

    if (!isOwner && !isCollaboratorWithPermission) {
      return res
        .status(403)
        .json({ error: 'Permission denied to update template' });
    }

    const updatedTemplate = await updateNotationTemplateService(
      templateId,
      updateData,
      userId
    );

    res.json(updatedTemplate);
  } catch (error) {
    console.error('Error updating notation template:', error);
    res.status(500).json({ error: 'Failed to update notation template' });
  }
};

export const deleteNotationTemplate = async (req, res) => {
  try {
    const { templateId } = req.params;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    // Get the template to check permissions
    const template = await getNotationTemplateByIdService(templateId);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    // Get the external link ID from the collection_external_links table
    const [collectionExternalLink] = await db
      .select({ externalLinkId: collectionExternalLinks.externalLinkId })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.id, template.collectionExternalLinkId))
      .limit(1);

    if (!collectionExternalLink) {
      return res
        .status(404)
        .json({ error: 'Associated external link not found' });
    }

    // Check if user has access to the external link
    const externalLink = await getExternalLinkByIdService(
      collectionExternalLink.externalLinkId,
      userId,
      tenantIds
    );

    if (!externalLink) {
      return res
        .status(404)
        .json({ error: 'Template not found or access denied' });
    }

    // Check if user is owner or has permission
    const isOwner = externalLink.addedByUserId === userId;
    const isCollaboratorWithPermission = externalLink.collaborators?.some(
      (c) => c.userId === userId && c.permissions?.canManageNotations
    );

    if (!isOwner && !isCollaboratorWithPermission) {
      return res
        .status(403)
        .json({ error: 'Permission denied to delete templates' });
    }

    await deleteNotationTemplateService(templateId);

    res.json({ message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Error deleting notation template:', error);
    res.status(500).json({ error: 'Failed to delete notation template' });
  }
};

// Public endpoint to get the submission template
export const getPublicSubmissionTemplate = async (req, res) => {
  try {
    const { externalLinkId } = req.params;

    // Get the collectionExternalLinkId from the collection_external_links table
    const [collectionExternalLink] = await db
      .select({ id: collectionExternalLinks.id })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
      .limit(1);

    if (!collectionExternalLink) {
      return res.status(404).json({ error: 'External link not found' });
    }

    const template = await getPublicSubmissionTemplateService(
      collectionExternalLink.id
    );

    if (!template) {
      return res.status(404).json({
        error: 'No public submission template found',
        details: `No template with isPublicSubmissionTemplate=true found for collection_external_link_id: ${collectionExternalLink.id}`,
      });
    }

    // Return only necessary fields for public consumption
    res.json({
      id: template.id,
      name: template.name,
      description: template.description,
      fields: template.fields.map((field) => ({
        fieldKey: field.fieldKey,
        fieldLabel: field.fieldLabel,
        fieldType: field.fieldType,
        fieldOptions: field.fieldOptions,
        isRequired: field.isRequired,
        placeholderText: field.placeholderText,
        helpText: field.helpText,
        validationRules: field.validationRules,
      })),
    });
  } catch (error) {
    console.error('Error fetching public submission template:', error);
    res.status(500).json({ error: 'Failed to fetch submission template' });
  }
};

// Public endpoint for external notation submissions
export const submitExternalNotation = async (req, res) => {
  try {
    const { externalLinkId } = req.params;
    const { templateId, notationData, submitterInfo } = req.body;

    // Get the collectionExternalLinkId from the collection_external_links table
    const [collectionExternalLink] = await db
      .select({ id: collectionExternalLinks.id })
      .from(collectionExternalLinks)
      .where(eq(collectionExternalLinks.externalLinkId, externalLinkId))
      .limit(1);

    if (!collectionExternalLink) {
      return res.status(404).json({ error: 'External link not found' });
    }

    // Get the public submission template
    const template = await getPublicSubmissionTemplateService(
      collectionExternalLink.id
    );

    if (!template || template.id !== templateId) {
      return res.status(404).json({ error: 'Invalid submission template' });
    }

    // Validate the custom fields
    const validation = validateCustomFieldsService(
      template,
      notationData.customFields
    );
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Validation failed',
        errors: validation.errors,
      });
    }

    // Create submission metadata
    const submissionMetadata = {
      submitterEmail: submitterInfo?.email,
      submitterName: submitterInfo?.name,
      source: 'external',
      ip: req.ip,
      userAgent: req.get('user-agent'),
      referrer: req.get('referrer'),
    };

    // Create the notation (using a system user ID or anonymous user ID)
    // You might want to have a specific system user for external submissions
    const systemUserId = null; // Or use a dedicated external submission user ID

    const notation = await createNotationFromTemplateService(
      templateId,
      {
        ...notationData,
        title:
          notationData.title ||
          `External Submission - ${new Date().toLocaleDateString()}`,
        visibility: 'private', // Start as private until approved
        status: 'Pending', // Default status for external submissions
      },
      systemUserId,
      true,
      submissionMetadata
    );

    res.status(201).json({
      message: 'Notation submitted successfully and is pending approval',
      notationId: notation.id,
    });
  } catch (error) {
    console.error('Error submitting external notation:', error);
    res
      .status(500)
      .json({ error: error.message || 'Failed to submit notation' });
  }
};

// Get external submissions for review
export const getExternalSubmissions = async (req, res) => {
  try {
    const { externalLinkId } = req.params;
    const { approvalStatus, templateId } = req.query;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    // Check if user has access to the external link
    const externalLink = await getExternalLinkByIdService(
      externalLinkId,
      userId,
      tenantIds
    );

    if (!externalLink) {
      return res
        .status(404)
        .json({ error: 'External link not found or access denied' });
    }

    // Check if user is owner or has admin permissions
    const isOwner = externalLink.addedByUserId === userId;
    const isCollaboratorWithPermission = externalLink.collaborators?.some(
      (c) => c.userId === userId && c.permissions?.canManageNotations
    );

    if (!isOwner && !isCollaboratorWithPermission) {
      return res
        .status(403)
        .json({ error: 'Permission denied to view submissions' });
    }

    const filters = {};
    if (approvalStatus) filters.approvalStatus = approvalStatus;
    if (templateId) filters.templateId = templateId;

    const submissions = await getExternalSubmissionsService(
      externalLinkId,
      filters
    );

    res.json(submissions);
  } catch (error) {
    console.error('Error fetching external submissions:', error);
    res.status(500).json({ error: 'Failed to fetch external submissions' });
  }
};

// Approve external submission
export const approveExternalSubmission = async (req, res) => {
  try {
    const { notationId } = req.params;
    const userId = req.auth?.dbUserId || req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    const updatedSubmission = await reviewExternalSubmissionService(
      notationId,
      'approved',
      userId,
      null
    );

    res.json({
      message: 'Submission approved successfully',
      submission: updatedSubmission,
    });
  } catch (error) {
    console.error('Error approving external submission:', error);
    res
      .status(500)
      .json({ error: error.message || 'Failed to approve submission' });
  }
};

// Reject external submission
export const rejectExternalSubmission = async (req, res) => {
  try {
    const { notationId } = req.params;
    const { reviewNotes } = req.body;
    const userId = req.auth?.dbUserId || req.auth?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    if (!reviewNotes) {
      return res.status(400).json({ error: 'Review notes are required for rejection' });
    }

    const updatedSubmission = await reviewExternalSubmissionService(
      notationId,
      'rejected',
      userId,
      reviewNotes
    );

    res.json({
      message: 'Submission rejected successfully',
      submission: updatedSubmission,
    });
  } catch (error) {
    console.error('Error rejecting external submission:', error);
    res
      .status(500)
      .json({ error: error.message || 'Failed to reject submission' });
  }
};

// Review a single external submission
export const reviewExternalSubmission = async (req, res) => {
  try {
    const { notationId } = req.params;
    const { approvalStatus, reviewNotes } = req.body;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    // Get the submission to check permissions
    const submission =
      await getExternalSubmissionByNotationIdService(notationId);

    if (!submission) {
      return res.status(404).json({ error: 'External submission not found' });
    }

    // Check permissions through the notation's external link
    // This would need additional logic to get the external link ID from the notation
    // For now, we'll assume the user has permission if they can access this endpoint

    const updatedSubmission = await reviewExternalSubmissionService(
      notationId,
      approvalStatus,
      userId,
      reviewNotes
    );

    res.json({
      message: `Submission ${approvalStatus} successfully`,
      submission: updatedSubmission,
    });
  } catch (error) {
    console.error('Error reviewing external submission:', error);
    res
      .status(500)
      .json({ error: error.message || 'Failed to review submission' });
  }
};

// Bulk review external submissions
export const bulkReviewSubmissions = async (req, res) => {
  try {
    const { notationIds, approvalStatus, reviewNotes } = req.body;
    const userId = req.auth.dbUserId;

    if (
      !notationIds ||
      !Array.isArray(notationIds) ||
      notationIds.length === 0
    ) {
      return res.status(400).json({ error: 'No notation IDs provided' });
    }

    const updatedSubmissions = await bulkReviewSubmissionsService(
      notationIds,
      approvalStatus,
      userId,
      reviewNotes
    );

    res.json({
      message: `${updatedSubmissions.length} submissions ${approvalStatus} successfully`,
      submissions: updatedSubmissions,
    });
  } catch (error) {
    console.error('Error bulk reviewing submissions:', error);
    res
      .status(500)
      .json({ error: error.message || 'Failed to review submissions' });
  }
};

// Get submission statistics
export const getSubmissionStatistics = async (req, res) => {
  try {
    const { externalLinkId } = req.params;
    const userId = req.auth.dbUserId;
    const tenantIds = req.tenantIds;

    // Check if user has access to the external link
    const externalLink = await getExternalLinkByIdService(
      externalLinkId,
      userId,
      tenantIds
    );

    if (!externalLink) {
      return res
        .status(404)
        .json({ error: 'External link not found or access denied' });
    }

    const statistics = await getSubmissionStatisticsService(externalLinkId);

    res.json(statistics);
  } catch (error) {
    console.error('Error fetching submission statistics:', error);
    res.status(500).json({ error: 'Failed to fetch submission statistics' });
  }
};
