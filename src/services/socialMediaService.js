import { db } from '../db/index.js';
import { eq, and, or, inArray, sql } from 'drizzle-orm';
import {
  socialMediaPlatforms,
  socialMediaAccounts,
  socialMediaAssociations,
} from '../models/socialMedia.js';
import { socialMediaAccountTypes } from '../models/socialMediaAccountTypes.js';
import { organizations } from '../models/organizations.js';
import { collections } from '../models/collections.js';
import { generatePresignedCloudFrontUrl } from '../utils/cloudFrontSigner.js';
import { snakeToCamelCase } from '../utils/general.js';

const normalizePlatformName = (name = '') =>
  String(name).trim().replace(/\s+/g, ' ').toLowerCase();

const getPlatformPreferenceRank = (platform, preferredTenantIds = []) => {
  if (platform.tenantId === null || platform.tenantId === undefined) {
    return 0;
  }

  if (preferredTenantIds.includes(platform.tenantId)) {
    return 1;
  }

  return 2;
};

const dedupePlatformsByName = (platforms = [], preferredTenantIds = []) => {
  const sortedPlatforms = [...platforms].sort((a, b) => {
    const rankDiff =
      getPlatformPreferenceRank(a, preferredTenantIds) -
      getPlatformPreferenceRank(b, preferredTenantIds);

    if (rankDiff !== 0) {
      return rankDiff;
    }

    return (a.name || '').localeCompare(b.name || '');
  });

  const seenNames = new Set();
  const dedupedPlatforms = [];

  for (const platform of sortedPlatforms) {
    const normalizedName = normalizePlatformName(platform.name);
    if (!normalizedName || seenNames.has(normalizedName)) {
      continue;
    }

    seenNames.add(normalizedName);
    dedupedPlatforms.push(platform);
  }

  return dedupedPlatforms.sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );
};

// Platform services
export const getAllPlatformsService = async (tenantIds) => {
  try {
    const platforms = await db
      .select()
      .from(socialMediaPlatforms)
      .where(
        or(
          inArray(socialMediaPlatforms.tenantId, tenantIds),
          eq(socialMediaPlatforms.tenantId, null)
        )
      );
    return dedupePlatformsByName(platforms, tenantIds);
  } catch (error) {
    console.error('Error fetching social media platforms:', error);
    throw error;
  }
};

export const getPlatformCatalogService = async (preferredTenantIds = []) => {
  try {
    const platforms = await db.select().from(socialMediaPlatforms);
    return dedupePlatformsByName(platforms, preferredTenantIds);
  } catch (error) {
    console.error('Error fetching social media platform catalog:', error);
    throw error;
  }
};

export const getPlatformByIdService = async (id) => {
  try {
    const platform = await db
      .select()
      .from(socialMediaPlatforms)
      .where(eq(socialMediaPlatforms.id, id))
      .limit(1);
    return platform[0] || null;
  } catch (error) {
    console.error('Error fetching platform by ID:', error);
    throw error;
  }
};

export const createPlatformService = async (platformData) => {
  try {
    const [platform] = await db
      .insert(socialMediaPlatforms)
      .values(platformData)
      .returning();
    return platform;
  } catch (error) {
    console.error('Error creating platform:', error);
    throw error;
  }
};

export const createOrReusePlatformService = async ({
  tenantId,
  existingPlatformId,
  name,
  icon,
  urlPattern,
}) => {
  try {
    const allPlatforms = await db.select().from(socialMediaPlatforms);

    if (existingPlatformId) {
      const sourcePlatform = allPlatforms.find(
        (platform) => platform.id === existingPlatformId
      );

      if (!sourcePlatform) {
        throw new Error('Platform not found');
      }

      const matchingPlatforms = allPlatforms.filter(
        (platform) =>
          normalizePlatformName(platform.name) ===
          normalizePlatformName(sourcePlatform.name)
      );

      const currentTenantOrSharedPlatform = matchingPlatforms.find(
        (platform) =>
          platform.tenantId === null || platform.tenantId === tenantId
      );

      if (currentTenantOrSharedPlatform) {
        return currentTenantOrSharedPlatform;
      }

      const [sharedPlatform] = await db
        .insert(socialMediaPlatforms)
        .values({
          name: sourcePlatform.name,
          icon: sourcePlatform.icon,
          urlPattern: sourcePlatform.urlPattern,
          tenantId: null,
        })
        .returning();

      return sharedPlatform;
    }

    const normalizedName = normalizePlatformName(name);
    const trimmedName = name?.trim();

    if (!normalizedName || !trimmedName || !icon) {
      throw new Error('Name and icon are required');
    }

    const matchingPlatforms = allPlatforms.filter(
      (platform) => normalizePlatformName(platform.name) === normalizedName
    );

    const currentTenantOrSharedPlatform = matchingPlatforms.find(
      (platform) => platform.tenantId === null || platform.tenantId === tenantId
    );

    if (currentTenantOrSharedPlatform) {
      return currentTenantOrSharedPlatform;
    }

    if (matchingPlatforms.length > 0) {
      const sourcePlatform = matchingPlatforms[0];

      const [sharedPlatform] = await db
        .insert(socialMediaPlatforms)
        .values({
          name: sourcePlatform.name,
          icon: sourcePlatform.icon,
          urlPattern: sourcePlatform.urlPattern,
          tenantId: null,
        })
        .returning();

      return sharedPlatform;
    }

    const [platform] = await db
      .insert(socialMediaPlatforms)
      .values({
        name: trimmedName,
        icon,
        urlPattern: urlPattern?.trim() || null,
        tenantId: null,
      })
      .returning();

    return platform;
  } catch (error) {
    console.error('Error creating or reusing platform:', error);
    throw error;
  }
};

export const updatePlatformService = async (id, platformData) => {
  try {
    const [updatedPlatform] = await db
      .update(socialMediaPlatforms)
      .set({
        ...platformData,
        updatedAt: new Date(),
      })
      .where(eq(socialMediaPlatforms.id, id))
      .returning();
    return updatedPlatform;
  } catch (error) {
    console.error('Error updating platform:', error);
    throw error;
  }
};

export const deletePlatformService = async (id) => {
  try {
    const [deletedPlatform] = await db
      .delete(socialMediaPlatforms)
      .where(eq(socialMediaPlatforms.id, id))
      .returning();
    return deletedPlatform;
  } catch (error) {
    console.error('Error deleting platform:', error);
    throw error;
  }
};

// Social Media Account services
export const getAllAccountsService = async (
  tenantIds,
  platformId = null,
  userId = null
) => {
  try {
    let query = db
      .select({
        ...socialMediaAccounts,
        platformName: socialMediaPlatforms.name,
        platformIcon: socialMediaPlatforms.icon,
        organizationName: organizations.name,
        organizationImageKey: organizations.imageKey,
        accountTypeName: socialMediaAccountTypes.name,
        accountTypeDescription: socialMediaAccountTypes.description,
        accountTypeColor: socialMediaAccountTypes.color,
        accountTypeIcon: socialMediaAccountTypes.icon,
        // Get collection hashtags if a collection is linked
        hashtags: sql`
          (SELECT c.hashtags 
           FROM collections c 
           WHERE c.name = ${socialMediaAccounts.name} 
           AND c.type = 'social_media' 
           AND c.user_id = ${socialMediaAccounts.userId}
           LIMIT 1)
        `,
        collectionId: sql`
          (SELECT c.id 
           FROM collections c 
           WHERE c.name = ${socialMediaAccounts.name} 
           AND c.type = 'social_media' 
           AND c.user_id = ${socialMediaAccounts.userId}
           LIMIT 1)
        `,
      })
      .from(socialMediaAccounts)
      .leftJoin(
        socialMediaPlatforms,
        eq(socialMediaAccounts.platformId, socialMediaPlatforms.id)
      )
      .leftJoin(
        organizations,
        eq(socialMediaAccounts.organizationId, organizations.id)
      )
      .leftJoin(
        socialMediaAccountTypes,
        eq(socialMediaAccounts.accountTypeId, socialMediaAccountTypes.id)
      )
      .where(
        and(
          // Security filter: Only show public accounts OR private accounts owned by the user
          or(
            eq(socialMediaAccounts.visibility, 'public'),
            and(
              eq(socialMediaAccounts.visibility, 'private'),
              userId ? eq(socialMediaAccounts.userId, userId) : sql`false`
            )
          ),
          // Tenant filter (only applies if account passes visibility check)
          inArray(socialMediaAccounts.tenantId, tenantIds),
          platformId
            ? eq(socialMediaAccounts.platformId, platformId)
            : undefined
        )
      );

    const accounts = await query;

    // Convert hashtags from comma-separated string to array and generate presigned URL for organization image if present
    return accounts.map((account) => {
      return {
        ...account,
        hashtags: account.hashtags ? account.hashtags.split(',') : [],
        organizationImageUrl: account.organizationImageKey
          ? generatePresignedCloudFrontUrl(account.organizationImageKey)
          : null,
      };
    });
  } catch (error) {
    console.error('Error fetching social media accounts:', error);
    throw error;
  }
};

export const getAccountsByTypeService = async (
  tenantIds,
  platformId,
  accountTypeId,
  userId = null
) => {
  try {
    const accounts = await db
      .select({
        ...socialMediaAccounts,
        platformName: socialMediaPlatforms.name,
        platformIcon: socialMediaPlatforms.icon,
        organizationName: organizations.name,
        organizationImageKey: organizations.imageKey,
        accountTypeName: socialMediaAccountTypes.name,
        accountTypeDescription: socialMediaAccountTypes.description,
        accountTypeColor: socialMediaAccountTypes.color,
        accountTypeIcon: socialMediaAccountTypes.icon,
      })
      .from(socialMediaAccounts)
      .leftJoin(
        socialMediaPlatforms,
        eq(socialMediaAccounts.platformId, socialMediaPlatforms.id)
      )
      .leftJoin(
        organizations,
        eq(socialMediaAccounts.organizationId, organizations.id)
      )
      .leftJoin(
        socialMediaAccountTypes,
        eq(socialMediaAccounts.accountTypeId, socialMediaAccountTypes.id)
      )
      .where(
        and(
          // Security filter: Only show public accounts OR private accounts owned by the user
          or(
            eq(socialMediaAccounts.visibility, 'public'),
            and(
              eq(socialMediaAccounts.visibility, 'private'),
              userId ? eq(socialMediaAccounts.userId, userId) : sql`false`
            )
          ),
          // Tenant filter
          inArray(socialMediaAccounts.tenantId, tenantIds),
          eq(socialMediaAccounts.platformId, platformId),
          eq(socialMediaAccounts.accountTypeId, accountTypeId)
        )
      );

    // Add organization image URL if available
    return accounts.map((account) => ({
      ...account,
      organizationImageUrl: account.organizationImageKey
        ? generatePresignedCloudFrontUrl(account.organizationImageKey)
        : null,
    }));
  } catch (error) {
    console.error('Error fetching accounts by type:', error);
    throw error;
  }
};

export const getAccountByIdService = async (
  id,
  userId = null,
  tenantIds = []
) => {
  try {
    const account = await db
      .select({
        ...socialMediaAccounts,
        platformName: socialMediaPlatforms.name,
        platformIcon: socialMediaPlatforms.icon,
        organizationName: organizations.name,
        organizationImageKey: organizations.imageKey,
        accountTypeName: socialMediaAccountTypes.name,
        accountTypeDescription: socialMediaAccountTypes.description,
        accountTypeColor: socialMediaAccountTypes.color,
        accountTypeIcon: socialMediaAccountTypes.icon,
      })
      .from(socialMediaAccounts)
      .leftJoin(
        socialMediaPlatforms,
        eq(socialMediaAccounts.platformId, socialMediaPlatforms.id)
      )
      .leftJoin(
        organizations,
        eq(socialMediaAccounts.organizationId, organizations.id)
      )
      .leftJoin(
        socialMediaAccountTypes,
        eq(socialMediaAccounts.accountTypeId, socialMediaAccountTypes.id)
      )
      .where(eq(socialMediaAccounts.id, id))
      .limit(1);

    if (!account[0]) {
      return null;
    }

    // Security check: Only allow access if account is public OR user owns it AND is in same tenant
    const acc = account[0];
    if (acc.visibility === 'private') {
      // For private accounts, user must be the owner AND in the same tenant
      if (
        !userId ||
        acc.userId !== userId ||
        !tenantIds.includes(acc.tenantId)
      ) {
        return null;
      }
    } else if (acc.visibility === 'public') {
      // For public accounts, user must be in the same tenant
      if (!tenantIds.includes(acc.tenantId)) {
        return null;
      }
    }

    // Add organization image URL if available
    return {
      ...account[0],
      organizationImageUrl: account[0].organizationImageKey
        ? generatePresignedCloudFrontUrl(account[0].organizationImageKey)
        : null,
    };
  } catch (error) {
    console.error('Error fetching account by ID:', error);
    throw error;
  }
};

export const getSocialMediaAccountsByIdsService = async (
  accountIds,
  userId,
  tenantIds
) => {
  try {
    if (!accountIds || accountIds.length === 0) {
      return [];
    }

    const accounts = await db
      .select({
        ...socialMediaAccounts,
        platformName: socialMediaPlatforms.name,
        platformIcon: socialMediaPlatforms.icon,
        organizationName: organizations.name,
        organizationImageKey: organizations.imageKey,
        accountTypeName: socialMediaAccountTypes.name,
        accountTypeDescription: socialMediaAccountTypes.description,
        accountTypeColor: socialMediaAccountTypes.color,
        accountTypeIcon: socialMediaAccountTypes.icon,
      })
      .from(socialMediaAccounts)
      .leftJoin(
        socialMediaPlatforms,
        eq(socialMediaAccounts.platformId, socialMediaPlatforms.id)
      )
      .leftJoin(
        organizations,
        eq(socialMediaAccounts.organizationId, organizations.id)
      )
      .leftJoin(
        socialMediaAccountTypes,
        eq(socialMediaAccounts.accountTypeId, socialMediaAccountTypes.id)
      )
      .where(
        and(
          inArray(socialMediaAccounts.id, accountIds),
          // Security filter: Only show public accounts OR private accounts owned by the user
          or(
            eq(socialMediaAccounts.visibility, 'public'),
            and(
              eq(socialMediaAccounts.visibility, 'private'),
              userId ? eq(socialMediaAccounts.userId, userId) : sql`false`
            )
          ),
          // Tenant filter
          inArray(socialMediaAccounts.tenantId, tenantIds)
        )
      );

    // Add organization image URLs if available
    return accounts.map((account) => ({
      ...account,
      organizationImageUrl: account.organizationImageKey
        ? generatePresignedCloudFrontUrl(account.organizationImageKey)
        : null,
    }));
  } catch (error) {
    console.error('Error fetching accounts by IDs:', error);
    throw error;
  }
};

export const createAccountService = async (accountData, isAdmin = false) => {
  try {
    // Security check: Only admins can create public accounts
    if (accountData.visibility === 'public' && !isAdmin) {
      throw new Error(
        'Only administrators can create public social media accounts'
      );
    }

    // If not admin and no visibility specified, default to private
    if (!isAdmin && !accountData.visibility) {
      accountData.visibility = 'private';
    }

    const [account] = await db
      .insert(socialMediaAccounts)
      .values(accountData)
      .returning();
    return account;
  } catch (error) {
    console.error('Error creating account:', error);
    throw error;
  }
};

export const updateAccountService = async (
  id,
  accountData,
  userId = null,
  isAdmin = false,
  tenantIds = []
) => {
  try {
    // First, fetch the existing account to check ownership and current visibility
    const [existingAccount] = await db
      .select()
      .from(socialMediaAccounts)
      .where(eq(socialMediaAccounts.id, id))
      .limit(1);

    if (!existingAccount) {
      throw new Error('Account not found');
    }

    // Security check: User must own the account or be an admin in the same tenant
    if (
      !isAdmin &&
      (!userId ||
        existingAccount.userId !== userId ||
        !tenantIds.includes(existingAccount.tenantId))
    ) {
      throw new Error('Unauthorized to update this account');
    }

    // Security check: Only admins can change visibility to public
    if (accountData.visibility === 'public' && !isAdmin) {
      throw new Error(
        'Only administrators can set account visibility to public'
      );
    }

    const [updatedAccount] = await db
      .update(socialMediaAccounts)
      .set({
        ...accountData,
        updatedAt: new Date(),
      })
      .where(eq(socialMediaAccounts.id, id))
      .returning();
    return updatedAccount;
  } catch (error) {
    console.error('Error updating account:', error);
    throw error;
  }
};

export const deleteAccountService = async (id) => {
  try {
    const [deletedAccount] = await db
      .delete(socialMediaAccounts)
      .where(eq(socialMediaAccounts.id, id))
      .returning();
    return deletedAccount;
  } catch (error) {
    console.error('Error deleting account:', error);
    throw error;
  }
};

// Format accounts response for the frontend
export const formatSocialMediaAccountsResponse = (accounts) => {
  const formattedAccounts = {};

  accounts.forEach((account) => {
    // Create platform if it doesn't exist
    if (!formattedAccounts[account.platformName.toLowerCase()]) {
      formattedAccounts[account.platformName.toLowerCase()] = {
        accountTypes: {}, // Dynamic account types instead of fixed structure
        hashtags: [], // Add hashtags at platform level
      };
    }

    const platform = formattedAccounts[account.platformName.toLowerCase()];
    const formattedAccount = {
      id: account.id,
      name: account.name,
      handle: account.handle,
      url: account.url,
      description: account.description,
      title: account.title,
      visibility: account.visibility,
      accountTypeId: account.accountTypeId,
      accountTypeName: account.accountTypeName,
      accountTypeColor: account.accountTypeColor,
      accountTypeIcon: account.accountTypeIcon,
      userId: account.userId,
      // Add hashtags at the account level if collection is linked
      hashtags: account.hashtags ? account.hashtags : [],
      // Add organization image URL if available
      organizationImageUrl: account.organizationImageUrl || null,
    };

    // Add to appropriate category based on account type
    if (account.accountTypeName) {
      const typeKey = account.accountTypeName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_');
      if (!platform.accountTypes[typeKey]) {
        platform.accountTypes[typeKey] = {
          name: account.accountTypeName,
          accounts: [],
          color: account.accountTypeColor,
          icon: account.accountTypeIcon,
        };
      }
      platform.accountTypes[typeKey].accounts.push(formattedAccount);
    }

    // Add hashtags from accounts to platform level for easier filtering
    if (formattedAccount.hashtags && formattedAccount.hashtags.length > 0) {
      formattedAccount.hashtags.forEach((hashtag) => {
        if (!platform.hashtags.includes(hashtag)) {
          platform.hashtags.push(hashtag);
        }
      });
    }
  });

  return formattedAccounts;
};

// Get social media associations by entity
export const getAssociationsByEntityService = async (
  associatedId,
  associatedType,
  userId = null,
  tenantIds = []
) => {
  try {
    const associations = await db
      .select({
        id: socialMediaAssociations.id,
        socialMediaAccountId: socialMediaAssociations.socialMediaAccountId,
        associatedId: socialMediaAssociations.associatedId,
        associatedType: socialMediaAssociations.associatedType,
        createdAt: socialMediaAssociations.createdAt,
        // Account details
        accountId: socialMediaAccounts.id,
        accountName: socialMediaAccounts.name,
        accountHandle: socialMediaAccounts.handle,
        accountUrl: socialMediaAccounts.url,
        accountDescription: socialMediaAccounts.description,
        accountTypeId: socialMediaAccounts.accountTypeId,
        accountTitle: socialMediaAccounts.title,
        accountVisibility: socialMediaAccounts.visibility,
        // Account type details
        accountTypeName: socialMediaAccountTypes.name,
        accountTypeColor: socialMediaAccountTypes.color,
        accountTypeIcon: socialMediaAccountTypes.icon,
        // Platform details
        platformId: socialMediaPlatforms.id,
        platformName: socialMediaPlatforms.name,
        platformIcon: socialMediaPlatforms.icon,
        // Organization details
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationImageKey: organizations.imageKey,
      })
      .from(socialMediaAssociations)
      .innerJoin(
        socialMediaAccounts,
        eq(socialMediaAssociations.socialMediaAccountId, socialMediaAccounts.id)
      )
      .leftJoin(
        socialMediaPlatforms,
        eq(socialMediaAccounts.platformId, socialMediaPlatforms.id)
      )
      .leftJoin(
        organizations,
        eq(socialMediaAccounts.organizationId, organizations.id)
      )
      .leftJoin(
        socialMediaAccountTypes,
        eq(socialMediaAccounts.accountTypeId, socialMediaAccountTypes.id)
      )
      .where(
        and(
          eq(socialMediaAssociations.associatedId, associatedId),
          eq(socialMediaAssociations.associatedType, associatedType),
          // Security filter: Only show public accounts OR private accounts owned by the user
          or(
            eq(socialMediaAccounts.visibility, 'public'),
            and(
              eq(socialMediaAccounts.visibility, 'private'),
              userId ? eq(socialMediaAccounts.userId, userId) : sql`false`
            )
          ),
          // Tenant filter
          inArray(socialMediaAccounts.tenantId, tenantIds)
        )
      );

    // Format the response with organization image URLs
    return associations.map((association) => ({
      id: association.id,
      socialMediaAccountId: association.socialMediaAccountId,
      associatedId: association.associatedId,
      associatedType: association.associatedType,
      createdAt: association.createdAt,
      account: {
        id: association.accountId,
        name: association.accountName,
        handle: association.accountHandle,
        url: association.accountUrl,
        description: association.accountDescription,
        accountTypeId: association.accountTypeId,
        accountTypeName: association.accountTypeName,
        accountTypeColor: association.accountTypeColor,
        accountTypeIcon: association.accountTypeIcon,
        title: association.accountTitle,
        visibility: association.accountVisibility,
        platform: {
          id: association.platformId,
          name: association.platformName,
          icon: association.platformIcon,
        },
        organization: association.organizationId
          ? {
              id: association.organizationId,
              name: association.organizationName,
              imageUrl: association.organizationImageKey
                ? generatePresignedCloudFrontUrl(
                    association.organizationImageKey
                  )
                : null,
            }
          : null,
      },
    }));
  } catch (error) {
    console.error('Error fetching associations by entity:', error);
    throw error;
  }
};

// Get associations by social media account ID
export const getAssociationsBySocialMediaAccountService = async (
  socialMediaAccountId
) => {
  try {
    const associations = await db
      .select({
        id: socialMediaAssociations.id,
        socialMediaAccountId: socialMediaAssociations.socialMediaAccountId,
        associatedId: socialMediaAssociations.associatedId,
        associatedType: socialMediaAssociations.associatedType,
        createdAt: socialMediaAssociations.createdAt,
      })
      .from(socialMediaAssociations)
      .where(
        eq(socialMediaAssociations.socialMediaAccountId, socialMediaAccountId)
      );

    // For each association, fetch the associated entity details
    const associationsWithDetails = await Promise.all(
      associations.map(async (association) => {
        let associatedName = 'Unknown';

        if (association.associatedType === 'organization') {
          const [org] = await db
            .select({ name: organizations.name })
            .from(organizations)
            .where(eq(organizations.id, association.associatedId))
            .limit(1);
          if (org) associatedName = org.name;
        } else if (association.associatedType === 'collection') {
          const [coll] = await db
            .select({ name: collections.name })
            .from(collections)
            .where(eq(collections.id, association.associatedId))
            .limit(1);
          if (coll) associatedName = coll.name;
        }

        return {
          ...association,
          associatedName,
        };
      })
    );

    return snakeToCamelCase(associationsWithDetails);
  } catch (error) {
    console.error(
      'Error fetching associations by social media account:',
      error
    );
    throw error;
  }
};

// Create association
export const createAssociationService = async (data) => {
  try {
    const [existingAssociation] = await db
      .select()
      .from(socialMediaAssociations)
      .where(
        and(
          eq(
            socialMediaAssociations.socialMediaAccountId,
            data.socialMediaAccountId
          ),
          eq(socialMediaAssociations.associatedId, data.associatedId),
          eq(socialMediaAssociations.associatedType, data.associatedType)
        )
      )
      .limit(1);

    if (existingAssociation) {
      return snakeToCamelCase(existingAssociation);
    }

    const [association] = await db
      .insert(socialMediaAssociations)
      .values({
        socialMediaAccountId: data.socialMediaAccountId,
        associatedId: data.associatedId,
        associatedType: data.associatedType,
        ...(data.tenantId && { tenantId: data.tenantId }),
      })
      .returning();

    return snakeToCamelCase(association);
  } catch (error) {
    console.error('Error creating association:', error);
    console.error('Failed with data:', data);
    throw error;
  }
};

// Delete association
export const deleteAssociationService = async (data) => {
  try {
    const deleted = await db
      .delete(socialMediaAssociations)
      .where(
        and(
          eq(
            socialMediaAssociations.socialMediaAccountId,
            data.socialMediaAccountId
          ),
          eq(socialMediaAssociations.associatedId, data.associatedId),
          eq(socialMediaAssociations.associatedType, data.associatedType)
        )
      )
      .returning();

    return deleted.length > 0 ? snakeToCamelCase(deleted[0]) : null;
  } catch (error) {
    console.error('Error deleting association:', error);
    throw error;
  }
};
