import { db } from '../db/index.js';
import {
  organizationMembers,
  organizations,
  organizationTags,
  organizationResources,
} from '../models/organizations.js';
import { tags } from '../models/tags.js';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { users } from '../models/users.js';
import { constructS3Url } from '../utils/s3Utils.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { autoUpdateOrganizationEmbedding } from './vectorService.js';
import { organizationEvents } from '../models/events.js';
import { organizationSurveys } from '../models/surveys.js';
import {
  socialMediaAssociations,
  socialMediaAccounts,
  socialMediaPlatforms,
} from '../models/socialMedia.js';

export async function createOrganizationService(data) {
  try {
    return await db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values(data)
        .returning();

      if (data.tags) {
        const tagIds = data.tags.split(',').map((id) => parseInt(id));
        await tx.insert(organizationTags).values(
          tagIds.map((tagId) => ({
            organizationId: organization.id,
            tagId,
          }))
        );
      }

      // Auto-update embeddings after successful creation (non-blocking)
      // Use setTimeout to make it asynchronous and non-blocking
      setTimeout(() => {
        autoUpdateOrganizationEmbedding(organization.id).catch(
          (embeddingError) => {
            console.warn(
              'Failed to update organization embeddings:',
              embeddingError
            );
          }
        );
      }, 0);

      return organization;
    });
  } catch (error) {
    console.error('Error creating organization:', error);
    throw new Error('Failed to create organization');
  }
}

export async function deleteOrganizationService(organizationId) {
  try {
    // First, check for related items outside the transaction
    const relatedItems = await checkOrganizationDependencies(organizationId);

    if (relatedItems.hasRelatedItems) {
      const error = new Error('Cannot delete organization with related items');
      error.statusCode = 409;
      error.relatedItems = relatedItems;
      throw error;
    }

    return await db.transaction(async (tx) => {
      // Delete related tags first
      const deletedTags = await tx
        .delete(organizationTags)
        .where(eq(organizationTags.organizationId, organizationId));

      // Delete organization members
      await tx
        .delete(organizationMembers)
        .where(eq(organizationMembers.organizationId, organizationId));

      // Then delete the organization
      const [organization] = await tx
        .delete(organizations)
        .where(and(eq(organizations.id, organizationId)))
        .returning();

      if (!organization) {
        throw new Error('Organization not found');
      }

      return { organization, deletedTags };
    });
  } catch (error) {
    console.error('Error in deleteOrganizationService:', error);
    throw error;
  }
}

// Helper function to check for dependencies
export async function checkOrganizationDependencies(organizationId) {
  const relatedItems = {
    hasRelatedItems: false,
    events: 0,
    resources: 0,
    surveys: 0,
    members: 0,
    details: [],
  };

  // Check for events
  const [eventCount] = await db
    .select({ count: sql`cast(count(*) as integer)` })
    .from(organizationEvents)
    .where(eq(organizationEvents.organizationId, organizationId));

  if (eventCount?.count > 0) {
    relatedItems.hasRelatedItems = true;
    relatedItems.events = eventCount.count;
    relatedItems.details.push(`${eventCount.count} event(s)`);
  }

  // Check for resources
  const [resourceCount] = await db
    .select({ count: sql`cast(count(*) as integer)` })
    .from(organizationResources)
    .where(eq(organizationResources.organizationId, organizationId));

  if (resourceCount?.count > 0) {
    relatedItems.hasRelatedItems = true;
    relatedItems.resources = resourceCount.count;
    relatedItems.details.push(`${resourceCount.count} resource(s)`);
  }

  // Check for surveys
  const [surveyCount] = await db
    .select({ count: sql`cast(count(*) as integer)` })
    .from(organizationSurveys)
    .where(eq(organizationSurveys.organizationId, organizationId));

  if (surveyCount?.count > 0) {
    relatedItems.hasRelatedItems = true;
    relatedItems.surveys = surveyCount.count;
    relatedItems.details.push(`${surveyCount.count} survey(s)`);
  }

  // Check for members (excluding the creator)
  const [memberCount] = await db
    .select({ count: sql`cast(count(*) as integer)` })
    .from(organizationMembers)
    .where(eq(organizationMembers.organizationId, organizationId));

  if (memberCount?.count > 1) {
    // More than just the creator
    relatedItems.hasRelatedItems = true;
    relatedItems.members = memberCount.count - 1; // Subtract the creator
    relatedItems.details.push(`${memberCount.count - 1} member(s)`);
  }

  return relatedItems;
}

export async function updateOrganizationService(organizationId, data) {
  try {
    return await db.transaction(async (tx) => {
      // Extract tags and remove non-column fields
      const {
        tags,
        id,
        logo,
        industry,
        logoUrl,
        imageUrl,
        ...organizationData
      } = data;

      // Filter out any non-column fields and undefined values
      const validFields = {};
      const columnNames = [
        'name',
        'acronym',
        'description',
        'website',
        'email',
        'phone',
        'address',
        'city',
        'state',
        'postal',
        'country',
        'category',
        'imageKey',
        'primaryContactName',
        'primaryContactEmail',
        'primaryContactPhone',
        'clerkOrganizationId',
        'professional',
        'tenantId',
        'userId',
      ];

      for (const field of columnNames) {
        if (organizationData[field] !== undefined) {
          // Convert string 'null' to actual null
          if (organizationData[field] === 'null') {
            validFields[field] = null;
          }
          // Convert string booleans to actual booleans
          else if (
            field === 'professional' &&
            typeof organizationData[field] === 'string'
          ) {
            validFields[field] = organizationData[field] === 'true';
          }
          // Otherwise use the value as is
          else {
            validFields[field] = organizationData[field];
          }
        }
      }

      // Check if there are any fields to update
      if (Object.keys(validFields).length === 0 && tags === undefined) {
        throw new Error('No valid fields to update');
      }

      let organization;
      if (Object.keys(validFields).length > 0) {
        // Add updatedAt timestamp
        validFields.updatedAt = new Date();

        const [updated] = await tx
          .update(organizations)
          .set(validFields)
          .where(eq(organizations.id, organizationId))
          .returning();
        organization = updated;
      } else {
        // If only tags are being updated, fetch the current organization
        const [current] = await tx
          .select()
          .from(organizations)
          .where(eq(organizations.id, organizationId));
        organization = current;
      }

      if (tags !== undefined) {
        // Delete existing tags
        await tx
          .delete(organizationTags)
          .where(eq(organizationTags.organizationId, organizationId));

        if (tags) {
          // Insert new tags
          const tagIds = tags.split(',').map((id) => parseInt(id));
          await tx.insert(organizationTags).values(
            tagIds.map((tagId) => ({
              organizationId: organizationId,
              tagId,
            }))
          );
        }
      }

      // Auto-update embeddings after successful update (non-blocking)
      // Use setTimeout to make it asynchronous and non-blocking
      setTimeout(() => {
        autoUpdateOrganizationEmbedding(organization.id).catch(
          (embeddingError) => {
            console.warn(
              'Failed to update organization embeddings:',
              embeddingError
            );
          }
        );
      }, 0);

      return organization;
    });
  } catch (error) {
    console.error('Error in updateOrganizationService:', error);
    throw error;
  }
}

export async function getAllOrganizations(tenantIds, userId = null) {
  try {
    // Build visibility condition for Community tenant
    // Community tenant organizations are only visible to their creator
    const communityTenantId = process.env.COMMUNITY_TENANT;

    // Fetch organizations (excluding embedding fields)
    const organizationsData = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        acronym: organizations.acronym,
        description: organizations.description,
        website: organizations.website,
        email: organizations.email,
        phone: organizations.phone,
        address: organizations.address,
        city: organizations.city,
        state: organizations.state,
        postal: organizations.postal,
        country: organizations.country,
        category: organizations.category,
        imageUrl: organizations.imageUrl,
        imageKey: organizations.imageKey,
        primaryContactName: organizations.primaryContactName,
        primaryContactEmail: organizations.primaryContactEmail,
        primaryContactPhone: organizations.primaryContactPhone,
        clerkOrganizationId: organizations.clerkOrganizationId,
        professional: organizations.professional,
        tenantId: organizations.tenantId,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        userId: organizations.userId,
        // Explicitly exclude embedding fields:
        // nameEmbedding, descriptionEmbedding, categoryEmbedding, combinedEmbedding, vectorUpdatedAt
      })
      .from(organizations)
      .where(
        and(
          inArray(organizations.tenantId, tenantIds),
          // Community tenant organizations are only visible to their creator
          userId
            ? sql`(
                CASE 
                  WHEN ${organizations.tenantId} = ${communityTenantId}::uuid THEN ${organizations.userId} = ${userId}
                  ELSE true
                END
              )`
            : sql`${organizations.tenantId} != ${communityTenantId}::uuid`
        )
      );

    if (organizationsData.length === 0) {
      return [];
    }
    organizationsData.forEach((org) => {
      org.imageUrl = org.imageKey
        ? generatePresignedCloudFrontUrl(org.imageKey)
        : null;
    });

    // Fetch tags linked to organizations
    const tagsData = await db
      .select({
        organizationId: organizationTags.organizationId,
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(organizationTags)
      .leftJoin(tags, eq(organizationTags.tagId, tags.id));

    // Fetch social media associations for organizations
    const socialMediaData = await db
      .select({
        organizationId: socialMediaAssociations.associatedId,
        accountId: socialMediaAccounts.id,
        accountName: socialMediaAccounts.name,
        accountHandle: socialMediaAccounts.handle,
        accountUrl: socialMediaAccounts.url,
        accountDescription: socialMediaAccounts.description,
        accountTypeId: socialMediaAccounts.accountTypeId,
        platformId: socialMediaPlatforms.id,
        platformName: socialMediaPlatforms.name,
        platformIcon: socialMediaPlatforms.icon,
      })
      .from(socialMediaAssociations)
      .innerJoin(
        socialMediaAccounts,
        eq(socialMediaAssociations.socialMediaAccountId, socialMediaAccounts.id)
      )
      .innerJoin(
        socialMediaPlatforms,
        eq(socialMediaAccounts.platformId, socialMediaPlatforms.id)
      )
      .where(
        and(
          eq(socialMediaAssociations.associatedType, 'organization'),
          inArray(
            socialMediaAssociations.associatedId,
            organizationsData.map((org) => org.id)
          )
        )
      );

    // Combine tags and social media with organizations
    const organizationsWithTagsAndSocialMedia = organizationsData.map((org) => {
      const orgTags = tagsData
        .filter((tag) => tag.organizationId === org.id)
        .map((t) => ({ id: t.tagId, name: t.tagName }));

      const orgSocialMedia = socialMediaData
        .filter((sm) => sm.organizationId === org.id)
        .map((sm) => ({
          id: sm.accountId,
          name: sm.accountName,
          handle: sm.accountHandle,
          url: sm.accountUrl,
          description: sm.accountDescription,
          accountTypeId: sm.accountTypeId,
          platform: {
            id: sm.platformId,
            name: sm.platformName,
            icon: sm.platformIcon,
          },
        }));

      return {
        ...org,
        tags: orgTags,
        socialMediaAccounts: orgSocialMedia,
      };
    });

    return organizationsWithTagsAndSocialMedia;
  } catch (error) {
    console.error('Error fetching organizations:', error);
    throw new Error('Failed to fetch organizations');
  }
}

export async function getOrganizationById(id, tenantIds, userId = null) {
  try {
    const communityTenantId = process.env.COMMUNITY_TENANT;

    const results = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        acronym: organizations.acronym,
        description: organizations.description,
        website: organizations.website,
        email: organizations.email,
        phone: organizations.phone,
        address: organizations.address,
        city: organizations.city,
        state: organizations.state,
        postal: organizations.postal,
        country: organizations.country,
        category: organizations.category,
        imageUrl: organizations.imageUrl,
        imageKey: organizations.imageKey,
        primaryContactName: organizations.primaryContactName,
        primaryContactEmail: organizations.primaryContactEmail,
        primaryContactPhone: organizations.primaryContactPhone,
        clerkOrganizationId: organizations.clerkOrganizationId,
        professional: organizations.professional,
        tenantId: organizations.tenantId,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        userId: organizations.userId,
        // Explicitly exclude embedding fields:
        // nameEmbedding, descriptionEmbedding, categoryEmbedding, combinedEmbedding, vectorUpdatedAt
      })
      .from(organizations)
      .where(
        and(
          eq(organizations.id, id),
          inArray(organizations.tenantId, tenantIds),
          // Community tenant organizations are only visible to their creator
          userId
            ? sql`(
                CASE 
                  WHEN ${organizations.tenantId} = ${communityTenantId}::uuid THEN ${organizations.userId} = ${userId}
                  ELSE true
                END
              )`
            : sql`${organizations.tenantId} != ${communityTenantId}::uuid`
        )
      );

    const organization = results[0];
    if (!organization) {
      return null;
    }

    const organizationWithImage = {
      ...organization,
      imageUrl: organization.imageKey
        ? generatePresignedCloudFrontUrl(organization.imageKey)
        : null,
    };

    // Fetch tags for this organization
    const tagsData = await db
      .select({
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(organizationTags)
      .leftJoin(tags, eq(organizationTags.tagId, tags.id))
      .where(eq(organizationTags.organizationId, id));

    // Add tags to organization
    return {
      ...organizationWithImage,
      tags: tagsData.map((t) => ({ id: t.tagId, name: t.tagName })),
    };
  } catch (error) {
    console.error('Error fetching organization by ID:', error);
    throw new Error(`Failed to fetch organization with ID: ${id}`);
  }
}

export async function getOrganizationMembersService(organizationId) {
  try {
    const members = await db
      .select({
        userId: organizationMembers.userId,
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        updatedAt: organizationMembers.updatedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(organizationMembers)
      .leftJoin(users, eq(organizationMembers.userId, users.id))
      .where(eq(organizationMembers.organizationId, organizationId));
    return members;
  } catch (error) {
    console.error('Error fetching organization members:', error);
    throw new Error('Failed to fetch organization members');
  }
}

export async function getOrganizationsByIdsService(
  organizationIds,
  tenantIds,
  userId = null
) {
  try {
    const communityTenantId = process.env.COMMUNITY_TENANT;

    const listOfOrganizations = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        acronym: organizations.acronym,
        description: organizations.description,
        website: organizations.website,
        email: organizations.email,
        phone: organizations.phone,
        address: organizations.address,
        city: organizations.city,
        state: organizations.state,
        postal: organizations.postal,
        country: organizations.country,
        category: organizations.category,
        imageUrl: organizations.imageUrl,
        imageKey: organizations.imageKey,
        primaryContactName: organizations.primaryContactName,
        primaryContactEmail: organizations.primaryContactEmail,
        primaryContactPhone: organizations.primaryContactPhone,
        clerkOrganizationId: organizations.clerkOrganizationId,
        professional: organizations.professional,
        tenantId: organizations.tenantId,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        userId: organizations.userId,
        // Explicitly exclude embedding fields:
        // nameEmbedding, descriptionEmbedding, categoryEmbedding, combinedEmbedding, vectorUpdatedAt
      })
      .from(organizations)
      .where(
        and(
          inArray(organizations.id, organizationIds),
          inArray(organizations.tenantId, tenantIds),
          // Community tenant organizations are only visible to their creator
          userId
            ? sql`(
                CASE 
                  WHEN ${organizations.tenantId} = ${communityTenantId}::uuid THEN ${organizations.userId} = ${userId}
                  ELSE true
                END
              )`
            : sql`${organizations.tenantId} != ${communityTenantId}::uuid`
        )
      );

    // get the image url for each organization
    listOfOrganizations.forEach((org) => {
      org.imageUrl = org.imageKey
        ? generatePresignedCloudFrontUrl(org.imageKey)
        : null;
    });
    return listOfOrganizations;
  } catch (error) {
    console.error('Error fetching organizations by IDs:', error);
    throw new Error('Failed to fetch organizations by IDs');
  }
}

export async function subscribeToOrganization(userId, organizationId, role) {
  try {
    // First check if the user is already subscribed
    const existingSubscription = await db
      .select()
      .from(organizationMembers)
      .where(
        sql`${organizationMembers.userId} = ${userId} AND ${organizationMembers.organizationId} = ${organizationId}`
      )
      .limit(1);

    // If already subscribed, update the role
    if (existingSubscription.length > 0) {
      const [updatedSubscription] = await db
        .update(organizationMembers)
        .set({
          role,
          updatedAt: new Date(),
        })
        .where(
          sql`${organizationMembers.userId} = ${userId} AND ${organizationMembers.organizationId} = ${organizationId}`
        )
        .returning();

      return updatedSubscription;
    }

    // Otherwise create a new subscription
    const [subscription] = await db
      .insert(organizationMembers)
      .values({
        userId,
        organizationId,
        role,
      })
      .returning();

    return subscription;
  } catch (error) {
    console.error('Error subscribing to organization:', error);
    throw new Error('Failed to subscribe to organization');
  }
}

export async function unsubscribeFromOrganization(userId, organizationId) {
  try {
    const [unsubscribed] = await db
      .delete(organizationMembers)
      .where(
        sql`${organizationMembers.userId} = ${userId} AND ${organizationMembers.organizationId} = ${organizationId}`
      )
      .returning();

    if (!unsubscribed) {
      throw new Error('Subscription not found');
    }

    return unsubscribed;
  } catch (error) {
    console.error('Error unsubscribing from organization:', error);
    throw error;
  }
}

export async function getUserSubscribedOrganizations(userId, tenantIds) {
  try {
    const subscribedOrgs = await db
      .select({
        organization: organizations,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .leftJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id)
      )
      .where(
        and(
          eq(organizationMembers.userId, userId),
          inArray(organizations.tenantId, tenantIds)
        )
      );

    // Fetch tags for all subscribed organizations
    const orgIds = subscribedOrgs.map(({ organization }) => organization.id);
    const tagsData = await db
      .select({
        organizationId: organizationTags.organizationId,
        tagId: tags.id,
        tagName: tags.name,
      })
      .from(organizationTags)
      .leftJoin(tags, eq(organizationTags.tagId, tags.id))
      .where(inArray(organizationTags.organizationId, orgIds));

    // Map the results to include image URLs and format the response
    return subscribedOrgs.map(({ organization, role }) => ({
      ...organization,
      role,
      tags: tagsData
        .filter((tag) => tag.organizationId === organization.id)
        .map((t) => ({ id: t.tagId, name: t.tagName })),
      logoUrl: organization.imageKey
        ? constructS3Url(organization.imageKey)
        : null,
    }));
  } catch (error) {
    console.error('Error fetching user subscribed organizations:', error);
    throw new Error('Failed to fetch subscribed organizations');
  }
}

export async function getAllOrganizationMembersService() {
  try {
    const members = await db
      .select({
        userId: organizationMembers.userId,
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
        updatedAt: organizationMembers.updatedAt,
        // User details
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        // Organization details
        organizationName: organizations.name,
        organizationDescription: organizations.description,
        organizationImageKey: organizations.imageKey,
      })
      .from(organizationMembers)
      .leftJoin(users, eq(organizationMembers.userId, users.id))
      .leftJoin(
        organizations,
        eq(organizationMembers.organizationId, organizations.id)
      );

    // Transform the results to include the logo URL
    return members.map((member) => ({
      ...member,
      organizationLogoUrl: member.organizationImageKey
        ? constructS3Url(member.organizationImageKey)
        : null,
    }));
  } catch (error) {
    console.error('Error fetching all organization members:', error);
    throw new Error('Failed to fetch all organization members');
  }
}
