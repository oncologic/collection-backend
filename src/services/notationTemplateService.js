import { db } from '../db/index.js';
import { eq, and, inArray, desc, asc, sql } from 'drizzle-orm';
import {
  notationTemplates,
  notationTemplateFields,
  externalNotationSubmissions,
} from '../models/notationTemplates.js';
import { collectionExternalLinksNotations } from '../models/collectionExternalLinksNotations.js';
import { collectionExternalLinks } from '../models/external_links.js';

// Create a new notation template
export const createNotationTemplateService = async (templateData, userId) => {
  return await db.transaction(async (tx) => {
    // Create the template
    const [template] = await tx
      .insert(notationTemplates)
      .values({
        collectionExternalLinkId: templateData.collectionExternalLinkId,
        name: templateData.name,
        description: templateData.description,
        isActive: templateData.isActive ?? true,
        isPublicSubmissionTemplate: templateData.isPublicSubmissionTemplate ?? false,
        createdByUserId: userId,
      })
      .returning();

    // Create template fields if provided
    if (templateData.fields && templateData.fields.length > 0) {
      const fieldsToInsert = templateData.fields.map((field, index) => ({
        templateId: template.id,
        fieldKey: field.fieldKey,
        fieldLabel: field.fieldLabel,
        fieldType: field.fieldType,
        fieldOptions: field.fieldOptions || null,
        isRequired: field.isRequired ?? false,
        validationRules: field.validationRules || null,
        placeholderText: field.placeholderText || null,
        helpText: field.helpText || null,
        displayOrder: field.displayOrder ?? index,
      }));

      await tx.insert(notationTemplateFields).values(fieldsToInsert);
    }

    // Fetch the complete template with fields
    return await getNotationTemplateByIdService(template.id);
  });
};

// Get a notation template by ID with all fields
export const getNotationTemplateByIdService = async (templateId) => {
  const [template] = await db
    .select()
    .from(notationTemplates)
    .where(eq(notationTemplates.id, templateId));

  if (!template) {
    return null;
  }

  // Get all fields for this template
  const fields = await db
    .select()
    .from(notationTemplateFields)
    .where(eq(notationTemplateFields.templateId, templateId))
    .orderBy(asc(notationTemplateFields.displayOrder));

  return {
    ...template,
    fields,
  };
};

// Get all templates for a collection external link
export const getTemplatesByExternalLinkService = async (
  collectionExternalLinkId,
  includeInactive = false
) => {
  const conditions = [
    eq(notationTemplates.collectionExternalLinkId, collectionExternalLinkId),
  ];

  if (!includeInactive) {
    conditions.push(eq(notationTemplates.isActive, true));
  }

  const templates = await db
    .select()
    .from(notationTemplates)
    .where(and(...conditions))
    .orderBy(desc(notationTemplates.createdAt));

  // Get fields for all templates
  const templateIds = templates.map((t) => t.id);
  if (templateIds.length === 0) {
    return templates;
  }

  const allFields = await db
    .select()
    .from(notationTemplateFields)
    .where(inArray(notationTemplateFields.templateId, templateIds))
    .orderBy(asc(notationTemplateFields.displayOrder));

  // Attach fields to their respective templates
  return templates.map((template) => ({
    ...template,
    fields: allFields.filter((field) => field.templateId === template.id),
  }));
};

// Get public submission template for an external link
export const getPublicSubmissionTemplateService = async (
  collectionExternalLinkId
) => {
  const [template] = await db
    .select()
    .from(notationTemplates)
    .where(
      and(
        eq(notationTemplates.collectionExternalLinkId, collectionExternalLinkId),
        eq(notationTemplates.isPublicSubmissionTemplate, true),
        eq(notationTemplates.isActive, true)
      )
    );

  if (!template) {
    return null;
  }

  // Get all fields for this template
  const fields = await db
    .select()
    .from(notationTemplateFields)
    .where(eq(notationTemplateFields.templateId, template.id))
    .orderBy(asc(notationTemplateFields.displayOrder));

  return {
    ...template,
    fields,
  };
};

// Update a notation template
export const updateNotationTemplateService = async (
  templateId,
  updateData,
  userId
) => {
  return await db.transaction(async (tx) => {
    // Update the template
    const [updatedTemplate] = await tx
      .update(notationTemplates)
      .set({
        name: updateData.name,
        description: updateData.description,
        isActive: updateData.isActive,
        isPublicSubmissionTemplate: updateData.isPublicSubmissionTemplate,
        updatedAt: new Date(),
      })
      .where(eq(notationTemplates.id, templateId))
      .returning();

    // If fields are provided, update them
    if (updateData.fields !== undefined) {
      // Delete existing fields
      await tx
        .delete(notationTemplateFields)
        .where(eq(notationTemplateFields.templateId, templateId));

      // Insert new fields
      if (updateData.fields && updateData.fields.length > 0) {
        const fieldsToInsert = updateData.fields.map((field, index) => ({
          templateId: templateId,
          fieldKey: field.fieldKey,
          fieldLabel: field.fieldLabel,
          fieldType: field.fieldType,
          fieldOptions: field.fieldOptions || null,
          isRequired: field.isRequired ?? false,
          validationRules: field.validationRules || null,
          placeholderText: field.placeholderText || null,
          helpText: field.helpText || null,
          displayOrder: field.displayOrder ?? index,
        }));

        await tx.insert(notationTemplateFields).values(fieldsToInsert);
      }
    }

    // Return the updated template with fields
    return await getNotationTemplateByIdService(templateId);
  });
};

// Delete a notation template
export const deleteNotationTemplateService = async (templateId) => {
  const [deleted] = await db
    .delete(notationTemplates)
    .where(eq(notationTemplates.id, templateId))
    .returning();

  return deleted;
};

// Create a notation from a template
export const createNotationFromTemplateService = async (
  templateId,
  notationData,
  userId,
  isExternalSubmission = false,
  submissionMetadata = {}
) => {
  return await db.transaction(async (tx) => {
    // Get the template
    const template = await getNotationTemplateByIdService(templateId);
    if (!template) {
      throw new Error('Template not found');
    }

    // Validate required fields
    if (template.fields) {
      for (const field of template.fields) {
        if (field.isRequired && !notationData.customFields?.[field.fieldKey]) {
          throw new Error(`Required field '${field.fieldLabel}' is missing`);
        }

        // Validate field types and rules
        const fieldValue = notationData.customFields?.[field.fieldKey];
        if (fieldValue !== undefined && fieldValue !== null) {
          // Type validation
          switch (field.fieldType) {
            case 'number':
              if (isNaN(Number(fieldValue))) {
                throw new Error(`Field '${field.fieldLabel}' must be a number`);
              }
              break;
            case 'email':
              const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              if (!emailRegex.test(fieldValue)) {
                throw new Error(`Field '${field.fieldLabel}' must be a valid email`);
              }
              break;
            case 'url':
              try {
                new URL(fieldValue);
              } catch {
                throw new Error(`Field '${field.fieldLabel}' must be a valid URL`);
              }
              break;
            case 'select':
            case 'multiselect':
              if (field.fieldOptions) {
                const validOptions = field.fieldOptions.map((opt) => opt.value);
                const valuesToCheck = field.fieldType === 'multiselect' 
                  ? (Array.isArray(fieldValue) ? fieldValue : [fieldValue])
                  : [fieldValue];
                
                for (const val of valuesToCheck) {
                  if (!validOptions.includes(val)) {
                    throw new Error(`Invalid option for field '${field.fieldLabel}'`);
                  }
                }
              }
              break;
          }

          // Custom validation rules
          if (field.validationRules) {
            const rules = field.validationRules;
            const strValue = String(fieldValue);
            
            if (rules.minLength && strValue.length < rules.minLength) {
              throw new Error(
                `Field '${field.fieldLabel}' must be at least ${rules.minLength} characters`
              );
            }
            if (rules.maxLength && strValue.length > rules.maxLength) {
              throw new Error(
                `Field '${field.fieldLabel}' must be at most ${rules.maxLength} characters`
              );
            }
            if (rules.pattern) {
              const regex = new RegExp(rules.pattern);
              if (!regex.test(strValue)) {
                throw new Error(
                  `Field '${field.fieldLabel}' does not match required pattern`
                );
              }
            }
          }
        }
      }
    }

    // Create the notation
    const [notation] = await tx
      .insert(collectionExternalLinksNotations)
      .values({
        id: notationData.id || undefined, // Use provided ID or let DB generate
        collectionExternalLinkId: template.collectionExternalLinkId,
        templateId: templateId,
        title: notationData.title,
        description: notationData.description,
        notes: notationData.notes,
        category: notationData.category,
        status: notationData.status,
        visibility: notationData.visibility || 'private',
        userId: userId,
        customFields: notationData.customFields || {},
        submissionMetadata: isExternalSubmission ? submissionMetadata : {},
        date: notationData.date,
        startTime: notationData.startTime,
        endTime: notationData.endTime,
        timezone: notationData.timezone,
        type: notationData.type,
      })
      .returning();

    // If it's an external submission, track it
    if (isExternalSubmission) {
      await tx.insert(externalNotationSubmissions).values({
        notationId: notation.id,
        templateId: templateId,
        submitterEmail: submissionMetadata.submitterEmail,
        submitterName: submissionMetadata.submitterName,
        submissionSource: submissionMetadata.source || 'external',
        submissionIp: submissionMetadata.ip,
        submissionUserAgent: submissionMetadata.userAgent,
        submissionReferrer: submissionMetadata.referrer,
        approvalStatus: 'pending', // All external submissions start as pending
      });
    }

    return notation;
  });
};

// Validate custom fields against template
export const validateCustomFieldsService = (template, customFields) => {
  const errors = [];

  if (!template.fields) {
    return { isValid: true, errors: [] };
  }

  for (const field of template.fields) {
    const fieldValue = customFields?.[field.fieldKey];

    // Check required fields
    if (field.isRequired && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
      errors.push({
        field: field.fieldKey,
        message: `${field.fieldLabel} is required`,
      });
      continue;
    }

    // Skip validation if field is not required and empty
    if (!fieldValue) continue;

    // Type-specific validation
    switch (field.fieldType) {
      case 'number':
        if (isNaN(Number(fieldValue))) {
          errors.push({
            field: field.fieldKey,
            message: `${field.fieldLabel} must be a number`,
          });
        }
        break;

      case 'email':
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(fieldValue)) {
          errors.push({
            field: field.fieldKey,
            message: `${field.fieldLabel} must be a valid email address`,
          });
        }
        break;

      case 'url':
        try {
          new URL(fieldValue);
        } catch {
          errors.push({
            field: field.fieldKey,
            message: `${field.fieldLabel} must be a valid URL`,
          });
        }
        break;

      case 'select':
        if (field.fieldOptions) {
          const validOptions = field.fieldOptions.map((opt) => opt.value);
          if (!validOptions.includes(fieldValue)) {
            errors.push({
              field: field.fieldKey,
              message: `Invalid option selected for ${field.fieldLabel}`,
            });
          }
        }
        break;

      case 'multiselect':
        if (field.fieldOptions) {
          const validOptions = field.fieldOptions.map((opt) => opt.value);
          const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue];
          for (const val of values) {
            if (!validOptions.includes(val)) {
              errors.push({
                field: field.fieldKey,
                message: `Invalid option "${val}" for ${field.fieldLabel}`,
              });
              break;
            }
          }
        }
        break;
    }

    // Custom validation rules
    if (field.validationRules && fieldValue) {
      const rules = field.validationRules;
      const strValue = String(fieldValue);

      if (rules.minLength && strValue.length < rules.minLength) {
        errors.push({
          field: field.fieldKey,
          message: `${field.fieldLabel} must be at least ${rules.minLength} characters`,
        });
      }

      if (rules.maxLength && strValue.length > rules.maxLength) {
        errors.push({
          field: field.fieldKey,
          message: `${field.fieldLabel} must be at most ${rules.maxLength} characters`,
        });
      }

      if (rules.pattern) {
        try {
          const regex = new RegExp(rules.pattern);
          if (!regex.test(strValue)) {
            errors.push({
              field: field.fieldKey,
              message: rules.patternMessage || `${field.fieldLabel} format is invalid`,
            });
          }
        } catch (e) {
          console.error('Invalid regex pattern:', rules.pattern);
        }
      }

      if (rules.min !== undefined && field.fieldType === 'number') {
        if (Number(fieldValue) < rules.min) {
          errors.push({
            field: field.fieldKey,
            message: `${field.fieldLabel} must be at least ${rules.min}`,
          });
        }
      }

      if (rules.max !== undefined && field.fieldType === 'number') {
        if (Number(fieldValue) > rules.max) {
          errors.push({
            field: field.fieldKey,
            message: `${field.fieldLabel} must be at most ${rules.max}`,
          });
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Get external submissions for review
export const getExternalSubmissionsService = async (
  collectionExternalLinkId,
  filters = {}
) => {
  const conditions = [];

  // Get all notations that have external submissions for this external link
  const baseQuery = db
    .select({
      submission: externalNotationSubmissions,
      notation: collectionExternalLinksNotations,
      template: notationTemplates,
    })
    .from(externalNotationSubmissions)
    .innerJoin(
      collectionExternalLinksNotations,
      eq(externalNotationSubmissions.notationId, collectionExternalLinksNotations.id)
    )
    .leftJoin(
      notationTemplates,
      eq(externalNotationSubmissions.templateId, notationTemplates.id)
    )
    .where(
      eq(collectionExternalLinksNotations.collectionExternalLinkId, collectionExternalLinkId)
    );

  // Apply filters
  if (filters.approvalStatus) {
    conditions.push(eq(externalNotationSubmissions.approvalStatus, filters.approvalStatus));
  }

  if (filters.templateId) {
    conditions.push(eq(externalNotationSubmissions.templateId, filters.templateId));
  }

  if (conditions.length > 0) {
    return await baseQuery.where(and(...conditions));
  }

  return await baseQuery.orderBy(desc(externalNotationSubmissions.createdAt));
};

// Review an external submission (approve or reject)
export const reviewExternalSubmissionService = async (
  notationId,
  approvalStatus,
  reviewerId,
  reviewNotes = null
) => {
  if (!['approved', 'rejected'].includes(approvalStatus)) {
    throw new Error('Invalid approval status. Must be "approved" or "rejected"');
  }

  return await db.transaction(async (tx) => {
    // Update the submission status
    const [updatedSubmission] = await tx
      .update(externalNotationSubmissions)
      .set({
        approvalStatus,
        reviewedByUserId: reviewerId,
        reviewedAt: new Date(),
        reviewNotes,
        updatedAt: new Date(),
      })
      .where(eq(externalNotationSubmissions.notationId, notationId))
      .returning();

    if (!updatedSubmission) {
      throw new Error('External submission not found');
    }

    // Keep visibility as private for both approved and rejected
    // Users can manually change visibility in the frontend after approval
    // For rejected submissions, ensure they stay private
    if (approvalStatus === 'rejected') {
      await tx
        .update(collectionExternalLinksNotations)
        .set({
          visibility: 'private',
          updatedAt: new Date(),
        })
        .where(eq(collectionExternalLinksNotations.id, notationId));
    }
    // For approved submissions, just update the timestamp (visibility stays as is)

    return updatedSubmission;
  });
};

// Get submission details by notation ID
export const getExternalSubmissionByNotationIdService = async (notationId) => {
  const [submission] = await db
    .select()
    .from(externalNotationSubmissions)
    .where(eq(externalNotationSubmissions.notationId, notationId));

  return submission;
};

// Bulk approve/reject submissions
export const bulkReviewSubmissionsService = async (
  notationIds,
  approvalStatus,
  reviewerId,
  reviewNotes = null
) => {
  if (!['approved', 'rejected'].includes(approvalStatus)) {
    throw new Error('Invalid approval status. Must be "approved" or "rejected"');
  }

  return await db.transaction(async (tx) => {
    // Update all submissions
    const updatedSubmissions = await tx
      .update(externalNotationSubmissions)
      .set({
        approvalStatus,
        reviewedByUserId: reviewerId,
        reviewedAt: new Date(),
        reviewNotes,
        updatedAt: new Date(),
      })
      .where(inArray(externalNotationSubmissions.notationId, notationIds))
      .returning();

    // Update notation visibility based on approval status
    await tx
      .update(collectionExternalLinksNotations)
      .set({
        visibility: approvalStatus === 'approved' ? 'public' : 'private',
        updatedAt: new Date(),
      })
      .where(inArray(collectionExternalLinksNotations.id, notationIds));

    return updatedSubmissions;
  });
};

// Get submission statistics for an external link
export const getSubmissionStatisticsService = async (collectionExternalLinkId) => {
  const stats = await db
    .select({
      approvalStatus: externalNotationSubmissions.approvalStatus,
      count: sql`count(*)::int`,
    })
    .from(externalNotationSubmissions)
    .innerJoin(
      collectionExternalLinksNotations,
      eq(externalNotationSubmissions.notationId, collectionExternalLinksNotations.id)
    )
    .where(
      eq(collectionExternalLinksNotations.collectionExternalLinkId, collectionExternalLinkId)
    )
    .groupBy(externalNotationSubmissions.approvalStatus);

  // Format the statistics
  const formattedStats = {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
  };

  stats.forEach(({ approvalStatus, count }) => {
    formattedStats[approvalStatus] = count;
    formattedStats.total += count;
  });

  return formattedStats;
};