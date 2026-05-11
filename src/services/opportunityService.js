import { db } from '../db/index.js';
import {
  opportunities,
  organizationOpportunities,
  opportunityApplications,
  opportunityMessages,
  opportunityTags,
  userSavedOpportunities,
} from '../models/opportunities.js';
import { organizations } from '../models/organizations.js';
import { users } from '../models/users.js';
import { tags } from '../models/tags.js';
import { tenants } from '../models/tenants.js';
import {
  eq,
  and,
  or,
  inArray,
  desc,
  asc,
  gte,
  lte,
  isNull,
  ne,
} from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { isUserAdvocateInTenant } from '../utils/authHelpers.js';

// Get opportunities with all relations
export const getOpportunitiesWithRelations = (qb, tenants, userId = null) => {
  return qb
    .select({
      id: opportunities.id,
      title: opportunities.title,
      description: opportunities.description,
      requirements: opportunities.requirements,
      responsibilities: opportunities.responsibilities,
      isVolunteer: opportunities.isVolunteer,
      compensationType: opportunities.compensationType,
      compensationAmount: opportunities.compensationAmount,
      compensationCurrency: opportunities.compensationCurrency,
      timeCommitment: opportunities.timeCommitment,
      frequency: opportunities.frequency,
      estimatedHours: opportunities.estimatedHours,
      duration: opportunities.duration,
      spotsAvailable: opportunities.spotsAvailable,
      // Calculate spotsFilled dynamically - only count approved applications, not pending/reviewing/rejected
      spotsFilled: sql`(
        SELECT COUNT(*)::int
        FROM opportunity_applications
        WHERE opportunity_id = opportunities.id
        AND status = 'approved'
      )`.as('spotsFilled'),
      isRemote: opportunities.isRemote,
      location: opportunities.location,
      applicationDeadline: opportunities.applicationDeadline,
      startDate: opportunities.startDate,
      endDate: opportunities.endDate,
      status: opportunities.status,
      visibility: opportunities.visibility,
      requiredSkills: opportunities.requiredSkills,
      preferredSkills: opportunities.preferredSkills,
      contactEmail: opportunities.contactEmail,
      applicationUrl: opportunities.applicationUrl,
      applicationInstructions: opportunities.applicationInstructions,
      createdByUserId: opportunities.createdByUserId,
      tenantId: opportunities.tenantId,
      createdAt: opportunities.createdAt,
      updatedAt: opportunities.updatedAt,
      organizations: sql`
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', o.id,
                'name', o.name,
                'acronym', o.acronym,
                'imageUrl', o.image_url,
                'imageKey', o.image_key,
                'isPrimary', oo.is_primary
              )
            )
            FROM organization_opportunities oo
            JOIN organizations o ON o.id = oo.organization_id
            WHERE oo.opportunity_id = opportunities.id
          ),
          '[]'::jsonb
        )
      `,
      tags: sql`
        COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'color', t.color,
                'description', t.description
              )
            )
            FROM opportunity_tags ot
            JOIN tags t ON t.id = ot.tag_id
            WHERE ot.opportunity_id = opportunities.id
          ),
          '[]'::jsonb
        )
      `.as('tags'),
      applicationCount: sql`(
        SELECT COUNT(*)::int
        FROM opportunity_applications
        WHERE opportunity_id = opportunities.id
      )`,
      hasApplied: userId
        ? sql`EXISTS (
          SELECT 1
          FROM opportunity_applications
          WHERE opportunity_id = opportunities.id
          AND user_id = ${userId}
        )`
        : sql`false`,
      isSaved: userId
        ? sql`EXISTS (
          SELECT 1
          FROM user_saved_opportunities
          WHERE opportunity_id = opportunities.id
          AND user_id = ${userId}
        )`
        : sql`false`,
    })
    .from(opportunities)
    .where(
      tenants && tenants.length > 0
        ? and(
            inArray(opportunities.tenantId, tenants),
            or(
              eq(opportunities.visibility, 'public'),
              userId ? eq(opportunities.createdByUserId, userId) : sql`false`
            )
          )
        : eq(opportunities.visibility, 'public') // Public access: only show public opportunities
    );
};

// Helper function to convert date strings to Date objects or null
function parseDate(dateValue) {
  if (
    !dateValue ||
    dateValue === '' ||
    dateValue === null ||
    dateValue === undefined
  ) {
    return null;
  }
  // If it's already a Date object, return it
  if (dateValue instanceof Date) {
    return dateValue;
  }
  // If it's a string, try to parse it
  if (typeof dateValue === 'string') {
    const parsed = new Date(dateValue);
    // Check if the date is valid
    if (isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }
  return null;
}

// Helper function to convert numeric strings to numbers or null
function parseNumeric(numericValue) {
  if (
    numericValue === '' ||
    numericValue === null ||
    numericValue === undefined
  ) {
    return null;
  }
  // If it's already a number, return it
  if (typeof numericValue === 'number') {
    return numericValue;
  }
  // If it's a string, try to parse it
  if (typeof numericValue === 'string') {
    const trimmed = numericValue.trim();
    if (trimmed === '') {
      return null;
    }
    const parsed = parseFloat(trimmed);
    // Check if the number is valid
    if (isNaN(parsed)) {
      return null;
    }
    return parsed;
  }
  return null;
}

// Helper function to convert integer strings to integers or null
function parseInteger(intValue) {
  if (intValue === '' || intValue === null || intValue === undefined) {
    return null;
  }
  // If it's already a number, return it
  if (typeof intValue === 'number') {
    return Math.floor(intValue);
  }
  // If it's a string, try to parse it
  if (typeof intValue === 'string') {
    const trimmed = intValue.trim();
    if (trimmed === '') {
      return null;
    }
    const parsed = parseInt(trimmed, 10);
    // Check if the number is valid
    if (isNaN(parsed)) {
      return null;
    }
    return parsed;
  }
  return null;
}

// Create a new opportunity
export async function createOpportunityService(data, userId, tenantIds) {
  try {
    return await db.transaction(async (tx) => {
      // Create the opportunity
      const [opportunity] = await tx
        .insert(opportunities)
        .values({
          title: data.title,
          description: data.description,
          requirements: data.requirements,
          responsibilities: data.responsibilities,
          isVolunteer: data.isVolunteer ?? true,
          compensationType: data.compensationType,
          compensationAmount: parseNumeric(data.compensationAmount),
          compensationCurrency: data.compensationCurrency || 'USD',
          timeCommitment: data.timeCommitment,
          frequency: data.frequency,
          estimatedHours: parseInteger(data.estimatedHours),
          duration: data.duration,
          spotsAvailable: data.spotsAvailable || 1,
          spotsFilled: 0,
          isRemote: data.isRemote ?? true,
          location: data.location,
          applicationDeadline: parseDate(data.applicationDeadline),
          startDate: parseDate(data.startDate),
          endDate: parseDate(data.endDate),
          status: data.status || 'active',
          visibility: data.visibility || 'private',
          requiredSkills: data.requiredSkills || [],
          preferredSkills: data.preferredSkills || [],
          contactEmail: data.contactEmail,
          applicationUrl: data.applicationUrl,
          applicationInstructions: data.applicationInstructions,
          createdByUserId: userId,
          tenantId: data.tenantId || tenantIds[0],
        })
        .returning();

      // Handle organizations
      if (data.organizations && data.organizations.length > 0) {
        await Promise.all(
          data.organizations.map((orgId, index) =>
            tx.insert(organizationOpportunities).values({
              opportunityId: opportunity.id,
              organizationId: orgId,
              isPrimary: index === 0, // First org is primary
            })
          )
        );
      }

      // Handle tags
      if (data.tags && data.tags.length > 0) {
        await Promise.all(
          data.tags.map((tagId) =>
            tx.insert(opportunityTags).values({
              opportunityId: opportunity.id,
              tagId,
            })
          )
        );
      }

      return opportunity;
    });
  } catch (error) {
    console.error('Error creating opportunity:', error);
    throw error;
  }
}

// Update an opportunity
export async function updateOpportunityService(id, data, userId, req = null) {
  try {
    return await db.transaction(async (tx) => {
      // First check if user can update
      const [existing] = await tx
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, id))
        .limit(1);

      if (!existing) {
        throw new Error('Opportunity not found');
      }

      // Check if user is the creator
      const isCreator = existing.createdByUserId === userId;

      // Check if user is admin or advocate
      let canEdit = isCreator;
      if (!canEdit && req) {
        // Admin can always edit
        if (req.auth?.isAdmin) {
          canEdit = true;
        }
        // Advocate in tenant can edit
        if (!canEdit && existing.tenantId) {
          canEdit = isUserAdvocateInTenant(req, existing.tenantId);
        }
      }

      if (!canEdit) {
        throw new Error('Unauthorized to update this opportunity');
      }

      // Prepare update data with proper parsing for dates and numeric fields
      const updateData = { ...data };
      if (data.applicationDeadline !== undefined) {
        updateData.applicationDeadline = parseDate(data.applicationDeadline);
      }
      if (data.startDate !== undefined) {
        updateData.startDate = parseDate(data.startDate);
      }
      if (data.endDate !== undefined) {
        updateData.endDate = parseDate(data.endDate);
      }
      if (data.compensationAmount !== undefined) {
        updateData.compensationAmount = parseNumeric(data.compensationAmount);
      }
      if (data.estimatedHours !== undefined) {
        updateData.estimatedHours = parseInteger(data.estimatedHours);
      }

      // Update the opportunity
      const [updated] = await tx
        .update(opportunities)
        .set({
          ...updateData,
          updatedAt: new Date(),
        })
        .where(eq(opportunities.id, id))
        .returning();

      // Update organizations if provided
      if (data.organizations !== undefined) {
        // Delete existing
        await tx
          .delete(organizationOpportunities)
          .where(eq(organizationOpportunities.opportunityId, id));

        // Add new
        if (data.organizations.length > 0) {
          await Promise.all(
            data.organizations.map((orgId, index) =>
              tx.insert(organizationOpportunities).values({
                opportunityId: id,
                organizationId: orgId,
                isPrimary: index === 0,
              })
            )
          );
        }
      }

      // Update tags if provided
      if (data.tags !== undefined) {
        // Delete existing
        await tx
          .delete(opportunityTags)
          .where(eq(opportunityTags.opportunityId, id));

        // Add new
        if (data.tags.length > 0) {
          await Promise.all(
            data.tags.map((tagId) =>
              tx.insert(opportunityTags).values({
                opportunityId: id,
                tagId,
              })
            )
          );
        }
      }

      return updated;
    });
  } catch (error) {
    console.error('Error updating opportunity:', error);
    throw error;
  }
}

// Get a single opportunity by ID
export async function getOpportunityByIdService(
  opportunityId,
  userId,
  tenantIds
) {
  try {
    const qb = db;
    let query = getOpportunitiesWithRelations(qb, tenantIds, userId);

    // Filter by opportunity ID
    query = query.where(eq(opportunities.id, opportunityId));

    const results = await query;
    return results[0] || null;
  } catch (error) {
    console.error('Error getting opportunity by ID:', error);
    throw error;
  }
}

// Get opportunities with filters
export async function getOpportunitiesService(filters, userId, tenantIds) {
  try {
    const qb = db;
    let query = getOpportunitiesWithRelations(qb, tenantIds || [], userId);

    // Apply filters
    const conditions = [];

    // Only filter by tenant if tenantIds are provided
    if (tenantIds && tenantIds.length > 0) {
      conditions.push(inArray(opportunities.tenantId, tenantIds));
    }

    // Status filter: if showPast is true, show filled/closed/completed, otherwise show active
    if (filters.showPast) {
      conditions.push(
        or(
          eq(opportunities.status, 'filled'),
          eq(opportunities.status, 'closed'),
          eq(opportunities.status, 'completed'),
          // Include opportunities where endDate has passed
          sql`${opportunities.endDate} IS NOT NULL AND ${opportunities.endDate} < NOW()`,
          // Include opportunities where all spots are filled (even if status is still 'active')
          // This handles cases where applications are approved but status hasn't been updated to 'filled'
          sql`(
            SELECT COUNT(*)::int
            FROM opportunity_applications
            WHERE opportunity_id = ${opportunities.id}
            AND status = 'approved'
          ) >= ${opportunities.spotsAvailable} AND ${opportunities.spotsAvailable} > 0`
        )
      );
    } else {
      // Default: show active opportunities that still have available spots
      // Exclude opportunities where all spots are filled (they should appear in "past")
      conditions.push(
        and(
          eq(opportunities.status, 'active'),
          // Only show if there are still spots available
          or(
            sql`(
              SELECT COUNT(*)::int
              FROM opportunity_applications
              WHERE opportunity_id = ${opportunities.id}
              AND status = 'approved'
            ) < ${opportunities.spotsAvailable}`,
            eq(opportunities.spotsAvailable, 0)
          )
        )
      );
    }

    if (filters.isVolunteer !== undefined) {
      conditions.push(eq(opportunities.isVolunteer, filters.isVolunteer));
    }

    if (filters.isRemote !== undefined) {
      conditions.push(eq(opportunities.isRemote, filters.isRemote));
    }

    if (filters.frequency) {
      conditions.push(eq(opportunities.frequency, filters.frequency));
    }

    if (filters.organizationId) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM organization_opportunities
          WHERE opportunity_id = ${opportunities.id}
          AND organization_id = ${filters.organizationId}
        )`
      );
    }

    // Only show opportunities with available spots
    if (filters.availableOnly) {
      conditions.push(
        sql`(
          SELECT COUNT(*)::int
          FROM opportunity_applications
          WHERE opportunity_id = ${opportunities.id}
          AND status = 'approved'
        ) < ${opportunities.spotsAvailable}`
      );
    }

    // Apply conditions if any exist
    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    // Add sorting
    if (filters.sortBy === 'deadline') {
      query = query.orderBy(asc(opportunities.applicationDeadline));
    } else if (filters.sortBy === 'newest') {
      query = query.orderBy(desc(opportunities.createdAt));
    } else {
      query = query.orderBy(desc(opportunities.createdAt));
    }

    // Add pagination
    if (filters.limit) {
      query = query.limit(filters.limit);
    }
    if (filters.offset) {
      query = query.offset(filters.offset);
    }

    const results = await query;
    return results;
  } catch (error) {
    console.error('Error getting opportunities:', error);
    throw error;
  }
}

// Apply to an opportunity
export async function applyToOpportunityService(
  opportunityId,
  applicationData,
  userId = null
) {
  try {
    return await db.transaction(async (tx) => {
      const applicantEmail = applicationData.applicantEmail;
      const applicantName = applicationData.applicantName;

      // Validate: either userId or applicantEmail must be provided
      if (!userId && !applicantEmail) {
        throw new Error(
          'Either user authentication or applicant email is required'
        );
      }

      // Check if already applied
      let existingApplication;
      if (userId) {
        // Check by userId
        [existingApplication] = await tx
          .select()
          .from(opportunityApplications)
          .where(
            and(
              eq(opportunityApplications.opportunityId, opportunityId),
              eq(opportunityApplications.userId, userId)
            )
          )
          .limit(1);
      } else {
        // Check by email
        [existingApplication] = await tx
          .select()
          .from(opportunityApplications)
          .where(
            and(
              eq(opportunityApplications.opportunityId, opportunityId),
              eq(opportunityApplications.applicantEmail, applicantEmail)
            )
          )
          .limit(1);
      }

      if (existingApplication) {
        throw new Error('You have already applied to this opportunity');
      }

      // Check if spots available
      const [opportunity] = await tx
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, opportunityId))
        .limit(1);

      if (!opportunity) {
        throw new Error('Opportunity not found');
      }

      // Check if spots are available by counting approved applications
      const [approvedCount] = await tx
        .select({ count: sql`COUNT(*)::int` })
        .from(opportunityApplications)
        .where(
          and(
            eq(opportunityApplications.opportunityId, opportunityId),
            eq(opportunityApplications.status, 'approved')
          )
        );

      if ((approvedCount?.count || 0) >= opportunity.spotsAvailable) {
        throw new Error('No spots available for this opportunity');
      }

      // Create application
      const [application] = await tx
        .insert(opportunityApplications)
        .values({
          opportunityId,
          userId: userId || null,
          applicantEmail: applicantEmail || null,
          applicantName: applicantName || null,
          status: 'pending',
          coverLetter: applicationData.coverLetter,
          resumeUrl: applicationData.resumeUrl,
          additionalInfo: applicationData.additionalInfo || {},
        })
        .returning();

      // Send notification and confirmation emails for all applications
      try {
        // Import email service dynamically to avoid circular dependencies
        const {
          sendOpportunityApplicationEmail,
          sendApplicationConfirmationEmail,
        } = await import('./emailService.js');

        // Get opportunity creator's email
        const [creator] = await tx
          .select({
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          })
          .from(users)
          .where(eq(users.id, opportunity.createdByUserId))
          .limit(1);

        // Get applicant info (either from userId or email)
        let applicantEmailToUse = applicantEmail;
        let applicantNameToUse = applicantName;

        if (userId && !applicantEmail) {
          // For signed-in users, get their email from the users table
          const [applicant] = await tx
            .select({
              email: users.email,
              firstName: users.firstName,
              lastName: users.lastName,
            })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          if (applicant) {
            applicantEmailToUse = applicant.email;
            applicantNameToUse =
              `${applicant.firstName || ''} ${applicant.lastName || ''}`.trim() ||
              null;
          }
        }

        // Send notification to opportunity creator
        if (creator && creator.email && applicantEmailToUse) {
          await sendOpportunityApplicationEmail({
            opportunity,
            application,
            applicantEmail: applicantEmailToUse,
            applicantName: applicantNameToUse,
            creatorEmail: creator.email,
            creatorName:
              `${creator.firstName || ''} ${creator.lastName || ''}`.trim() ||
              'Opportunity Creator',
          });
        }

        // Send confirmation email to applicant
        if (applicantEmailToUse) {
          await sendApplicationConfirmationEmail({
            opportunity,
            applicantEmail: applicantEmailToUse,
            applicantName: applicantNameToUse,
          });
        }
      } catch (emailError) {
        // Log error but don't fail the application submission
        console.error('Error sending application emails:', emailError);
      }

      return application;
    });
  } catch (error) {
    console.error('Error applying to opportunity:', error);
    throw error;
  }
}

// Review an application
export async function reviewApplicationService(
  applicationId,
  reviewData,
  reviewerId,
  req
) {
  try {
    return await db.transaction(async (tx) => {
      const [application] = await tx
        .select()
        .from(opportunityApplications)
        .where(eq(opportunityApplications.id, applicationId))
        .limit(1);

      if (!application) {
        throw new Error('Application not found');
      }

      // Check if reviewer is the opportunity creator, admin, or advocate
      const [opportunity] = await tx
        .select({
          id: opportunities.id,
          createdByUserId: opportunities.createdByUserId,
          tenantId: opportunities.tenantId,
        })
        .from(opportunities)
        .where(eq(opportunities.id, application.opportunityId))
        .limit(1);

      if (!opportunity) {
        throw new Error('Opportunity not found');
      }

      const isCreator = opportunity.createdByUserId === reviewerId;

      // Check if user is admin or advocate in the opportunity's tenant
      // Note: isUserAdvocateInTenant already checks for admin, so it covers both cases
      let canReview = isCreator;
      if (!canReview && req && opportunity.tenantId) {
        try {
          canReview = isUserAdvocateInTenant(req, opportunity.tenantId);
        } catch (error) {
          // If check fails, fall back to admin check
          canReview = req?.auth?.isAdmin || false;
        }
      }

      // Also check direct admin flag if tenant check didn't work
      if (!canReview) {
        canReview = req?.auth?.isAdmin || false;
      }

      if (!canReview) {
        throw new Error('Unauthorized to review this application');
      }

      // Get the old status to determine if we need to adjust spotsFilled
      const oldStatus = application.status;

      // Update application
      const [updated] = await tx
        .update(opportunityApplications)
        .set({
          status: reviewData.status,
          reviewedAt: new Date(),
          reviewedByUserId: reviewerId,
          reviewNotes: reviewData.notes,
          ...(reviewData.status === 'approved' && {
            assignedAt: new Date(),
            instructions: reviewData.instructions || null,
            instructionsLink: reviewData.instructionsLink || null,
          }),
        })
        .where(eq(opportunityApplications.id, applicationId))
        .returning();

      // Update spots filled based on status change
      // Only count approved applications toward spotsFilled
      if (oldStatus === 'approved' && reviewData.status !== 'approved') {
        // Was approved, now not approved - decrement
        await tx
          .update(opportunities)
          .set({
            spotsFilled: sql`GREATEST(${opportunities.spotsFilled} - 1, 0)`,
          })
          .where(eq(opportunities.id, application.opportunityId));
      } else if (oldStatus !== 'approved' && reviewData.status === 'approved') {
        // Was not approved, now approved - increment
        await tx
          .update(opportunities)
          .set({
            spotsFilled: sql`${opportunities.spotsFilled} + 1`,
          })
          .where(eq(opportunities.id, application.opportunityId));
      }

      return updated;
    });
  } catch (error) {
    console.error('Error reviewing application:', error);
    throw error;
  }
}

// Delete an application
export async function deleteApplicationService(applicationId, userId, req) {
  try {
    return await db.transaction(async (tx) => {
      const [application] = await tx
        .select()
        .from(opportunityApplications)
        .where(eq(opportunityApplications.id, applicationId))
        .limit(1);

      if (!application) {
        throw new Error('Application not found');
      }

      // Get opportunity details for permission check
      const [opportunity] = await tx
        .select({
          id: opportunities.id,
          createdByUserId: opportunities.createdByUserId,
          tenantId: opportunities.tenantId,
        })
        .from(opportunities)
        .where(eq(opportunities.id, application.opportunityId))
        .limit(1);

      if (!opportunity) {
        throw new Error('Opportunity not found');
      }

      // Check permissions: user can delete their own application, or admin/creator/advocate can delete any
      const isOwner = application.userId === userId;
      const isCreator = opportunity.createdByUserId === userId;

      let canDelete = isOwner || isCreator;

      // Check if user is admin or advocate in the opportunity's tenant
      if (!canDelete && req && opportunity.tenantId) {
        try {
          canDelete = isUserAdvocateInTenant(req, opportunity.tenantId);
        } catch (error) {
          canDelete = req?.auth?.isAdmin || false;
        }
      }

      // Also check direct admin flag
      if (!canDelete) {
        canDelete = req?.auth?.isAdmin || false;
      }

      if (!canDelete) {
        throw new Error('Unauthorized to delete this application');
      }

      // If the application was approved, decrement spotsFilled
      if (application.status === 'approved') {
        await tx
          .update(opportunities)
          .set({
            spotsFilled: sql`GREATEST(${opportunities.spotsFilled} - 1, 0)`,
          })
          .where(eq(opportunities.id, application.opportunityId));
      }

      // Delete the application
      await tx
        .delete(opportunityApplications)
        .where(eq(opportunityApplications.id, applicationId));

      return { success: true };
    });
  } catch (error) {
    console.error('Error deleting application:', error);
    throw error;
  }
}

// Save/bookmark an opportunity
export async function saveOpportunityService(opportunityId, userId) {
  try {
    const [saved] = await db
      .insert(userSavedOpportunities)
      .values({
        userId,
        opportunityId,
      })
      .onConflictDoNothing()
      .returning();

    return saved || { message: 'Already saved' };
  } catch (error) {
    console.error('Error saving opportunity:', error);
    throw error;
  }
}

// Unsave an opportunity
export async function unsaveOpportunityService(opportunityId, userId) {
  try {
    await db
      .delete(userSavedOpportunities)
      .where(
        and(
          eq(userSavedOpportunities.opportunityId, opportunityId),
          eq(userSavedOpportunities.userId, userId)
        )
      );

    return { message: 'Opportunity unsaved' };
  } catch (error) {
    console.error('Error unsaving opportunity:', error);
    throw error;
  }
}

// Get user's applications
export async function getUserApplicationsService(userId) {
  try {
    const applications = await db
      .select({
        id: opportunityApplications.id,
        opportunityId: opportunityApplications.opportunityId,
        status: opportunityApplications.status,
        appliedAt: opportunityApplications.appliedAt,
        reviewedAt: opportunityApplications.reviewedAt,
        assignedAt: opportunityApplications.assignedAt,
        completedAt: opportunityApplications.completedAt,
        instructions: opportunityApplications.instructions,
        instructionsLink: opportunityApplications.instructionsLink,
        opportunity: {
          id: opportunities.id,
          title: opportunities.title,
          description: opportunities.description,
          isVolunteer: opportunities.isVolunteer,
          timeCommitment: opportunities.timeCommitment,
          frequency: opportunities.frequency,
          startDate: opportunities.startDate,
          endDate: opportunities.endDate,
        },
      })
      .from(opportunityApplications)
      .leftJoin(
        opportunities,
        eq(opportunityApplications.opportunityId, opportunities.id)
      )
      .where(eq(opportunityApplications.userId, userId))
      .orderBy(desc(opportunityApplications.appliedAt));

    return applications;
  } catch (error) {
    console.error('Error getting user applications:', error);
    throw error;
  }
}

// Send a message about an opportunity
export async function sendOpportunityMessageService(messageData, senderId) {
  try {
    const [message] = await db
      .insert(opportunityMessages)
      .values({
        opportunityId: messageData.opportunityId,
        applicationId: messageData.applicationId,
        senderId,
        recipientId: messageData.recipientId,
        message: messageData.message,
        attachments: messageData.attachments || [],
      })
      .returning();

    return message;
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
}

// Get applications for an opportunity (only for admins and advocates)
export async function getOpportunityApplicationsService(
  opportunityId,
  userId,
  tenantIds,
  req = null
) {
  try {
    // Ensure tenantIds is an array
    const tenantIdsArray = Array.isArray(tenantIds) ? tenantIds : [];

    // First verify the user has permission (is admin or advocate for the opportunity's tenant)
    const [opportunity] = await db
      .select({
        id: opportunities.id,
        createdByUserId: opportunities.createdByUserId,
        tenantId: opportunities.tenantId,
      })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);

    if (!opportunity) {
      throw new Error('Opportunity not found');
    }

    // Check if user is admin (from Clerk metadata or tenant check)
    const isAdmin =
      req?.auth?.isAdmin ||
      (tenantIdsArray.length > 0 &&
        tenantIdsArray.some((tenantId) => tenantId === opportunity.tenantId));

    // Check if user is advocate (using req.auth if available, otherwise check tenant roles)
    let isAdvocate = false;
    if (req?.auth) {
      // Use auth helper if req is available
      isAdvocate = isUserAdvocateInTenant(req, opportunity.tenantId);
    } else {
      // Fallback: check tenant roles directly
      const { getUserTenantRoles } = await import('./userService.js');
      const tenantRoles = await getUserTenantRoles(userId);
      const rolesForTenant = tenantRoles[opportunity.tenantId];
      isAdvocate = rolesForTenant?.roles?.includes('advocate') || false;
    }

    // Only allow admin or advocate (removed creator check)
    if (!isAdmin && !isAdvocate) {
      throw new Error(
        'You do not have permission to view applications for this opportunity. Only admins and advocates can view applications.'
      );
    }

    let applications;
    try {
      applications = await db
        .select({
          id: opportunityApplications.id,
          userId: opportunityApplications.userId,
          applicantEmail: opportunityApplications.applicantEmail,
          applicantName: opportunityApplications.applicantName,
          status: opportunityApplications.status,
          coverLetter: opportunityApplications.coverLetter,
          resumeUrl: opportunityApplications.resumeUrl,
          additionalInfo: opportunityApplications.additionalInfo,
          appliedAt: opportunityApplications.appliedAt,
          reviewedAt: opportunityApplications.reviewedAt,
          reviewedByUserId: opportunityApplications.reviewedByUserId,
          reviewNotes: opportunityApplications.reviewNotes,
          assignedAt: opportunityApplications.assignedAt,
          completedAt: opportunityApplications.completedAt,
          hoursCompleted: opportunityApplications.hoursCompleted,
          instructions: opportunityApplications.instructions,
          instructionsLink: opportunityApplications.instructionsLink,
          userIdCol: users.id,
          userFirstName: users.firstName,
          userLastName: users.lastName,
          userEmail: users.email,
        })
        .from(opportunityApplications)
        .leftJoin(users, eq(opportunityApplications.userId, users.id))
        .where(eq(opportunityApplications.opportunityId, opportunityId))
        .orderBy(desc(opportunityApplications.appliedAt));
    } catch (queryError) {
      console.error('Error executing applications query:', queryError);
      throw new Error(`Failed to fetch applications: ${queryError.message}`);
    }

    // Map results to include user object, handling null values
    if (!applications || !Array.isArray(applications)) {
      console.warn(
        'Applications query returned non-array result:',
        typeof applications,
        applications
      );
      return [];
    }

    return applications
      .map((app) => {
        if (!app) {
          return null;
        }

        // If userId exists, use user data; otherwise use applicant email/name
        const user = app.userIdCol
          ? {
              id: app.userIdCol,
              firstName: app.userFirstName || null,
              lastName: app.userLastName || null,
              email: app.userEmail || null,
            }
          : app.applicantEmail
            ? {
                id: null,
                firstName: app.applicantName || null,
                lastName: null,
                email: app.applicantEmail || null,
                isAnonymous: true,
              }
            : null;

        return {
          id: app.id || null,
          userId: app.userId || null,
          applicantEmail: app.applicantEmail || null,
          applicantName: app.applicantName || null,
          status: app.status || 'pending',
          coverLetter: app.coverLetter || null,
          resumeUrl: app.resumeUrl || null,
          additionalInfo: app.additionalInfo || null,
          appliedAt: app.appliedAt || null,
          reviewedAt: app.reviewedAt || null,
          reviewedByUserId: app.reviewedByUserId || null,
          reviewNotes: app.reviewNotes || null,
          assignedAt: app.assignedAt || null,
          completedAt: app.completedAt || null,
          hoursCompleted: app.hoursCompleted || null,
          instructions: app.instructions || null,
          instructionsLink: app.instructionsLink || null,
          user,
        };
      })
      .filter((app) => app !== null);
  } catch (error) {
    console.error('Error getting opportunity applications:', error);
    throw error;
  }
}

// Get messages for an opportunity or application
export async function getOpportunityMessagesService(filters, userId) {
  try {
    const conditions = [];

    if (filters.opportunityId) {
      conditions.push(
        eq(opportunityMessages.opportunityId, filters.opportunityId)
      );
    }

    if (filters.applicationId) {
      conditions.push(
        eq(opportunityMessages.applicationId, filters.applicationId)
      );
    }

    // Only show messages where user is sender or recipient
    conditions.push(
      or(
        eq(opportunityMessages.senderId, userId),
        eq(opportunityMessages.recipientId, userId)
      )
    );

    const messages = await db
      .select({
        id: opportunityMessages.id,
        message: opportunityMessages.message,
        attachments: opportunityMessages.attachments,
        createdAt: opportunityMessages.createdAt,
        isRead: opportunityMessages.isRead,
        sender: {
          id: users.id,
          name: sql`${users.first_name} || ' ' || ${users.last_name}`,
          imageUrl: users.image_url,
        },
      })
      .from(opportunityMessages)
      .leftJoin(users, eq(opportunityMessages.senderId, users.id))
      .where(and(...conditions))
      .orderBy(asc(opportunityMessages.createdAt));

    // Mark messages as read
    await db
      .update(opportunityMessages)
      .set({
        isRead: true,
        readAt: new Date(),
      })
      .where(
        and(
          ...conditions,
          eq(opportunityMessages.recipientId, userId),
          eq(opportunityMessages.isRead, false)
        )
      );

    return messages;
  } catch (error) {
    console.error('Error getting messages:', error);
    throw error;
  }
}
