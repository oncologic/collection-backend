import { db } from '../db/index.js';
import { users } from '../models/users.js';
import { subscriptionPlans } from '../models/subscriptionPlans.js';
import { collections } from '../models/collections.js';
import { attachments } from '../models/attachments.js';
import { collectionCollaborators } from '../models/collectionCollaborators.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import {
  collectionExternalLinks,
  externalLinks,
} from '../models/external_links.js';
import { eq, and, count, inArray } from 'drizzle-orm';

export const subscriptionService = {
  // Get user's subscription plan details
  async getUserSubscriptionPlan(userId) {
    const result = await db
      .select({
        user: users,
        plan: subscriptionPlans,
      })
      .from(users)
      .leftJoin(
        subscriptionPlans,
        eq(users.subscriptionPlan, subscriptionPlans.name)
      )
      .where(eq(users.id, userId))
      .limit(1);

    if (!result[0]) {
      throw new Error('User not found');
    }

    return {
      user: result[0].user,
      plan: result[0].plan || {
        name: 'basic',
        displayName: 'Basic',
        maxExternalCollections: 20,
        maxRegularCollections: -1,
        canAddCollaborators: false,
        maxCollaboratorsPerCollection: 0,
        maxAttachments: 25,
        maxAttachmentSizeMB: 10,
      },
    };
  },

  // Check if user can create external collections
  async canCreateExternalCollection(userId, tenantIds) {
    const { plan } = await this.getUserSubscriptionPlan(userId);

    // If unlimited external collections
    if (plan.maxExternalCollections === -1) {
      return { allowed: true };
    }

    // Build where conditions
    const whereConditions = [
      eq(collections.userId, userId),
      eq(collections.type, 'external'),
    ];

    // Add tenant filtering if tenantIds are provided
    if (tenantIds && tenantIds.length > 0) {
      whereConditions.push(inArray(collections.tenantId, tenantIds));
    }

    // Count current external collections
    const currentCount = await db
      .select({ count: count() })
      .from(collections)
      .where(and(...whereConditions));

    const current = currentCount[0]?.count || 0;
    const allowed = current < plan.maxExternalCollections;

    return {
      allowed,
      current,
      limit: plan.maxExternalCollections,
      remaining: plan.maxExternalCollections - current,
    };
  },

  // Check if user can add collaborators
  async canAddCollaborators(userId) {
    const { plan } = await this.getUserSubscriptionPlan(userId);

    return {
      allowed: plan.canAddCollaborators,
      maxCollaboratorsPerCollection: plan.maxCollaboratorsPerCollection,
    };
  },

  // Check if user can create attachments
  async canCreateAttachment(userId, tenantIds) {
    const { plan } = await this.getUserSubscriptionPlan(userId);

    // If unlimited attachments
    if (plan.maxAttachments === -1) {
      return { allowed: true };
    }

    // Build where conditions
    const whereConditions = [eq(attachments.userId, userId)];

    // Add tenant filtering if tenantIds are provided
    if (tenantIds && tenantIds.length > 0) {
      whereConditions.push(inArray(attachments.tenantId, tenantIds));
    }

    // Count current attachments
    const currentCount = await db
      .select({ count: count() })
      .from(attachments)
      .where(and(...whereConditions));

    const current = currentCount[0]?.count || 0;
    const allowed = current < plan.maxAttachments;

    return {
      allowed,
      current,
      limit: plan.maxAttachments,
      remaining: plan.maxAttachments - current,
    };
  },

  // Get all available subscription plans
  async getAllPlans() {
    return await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(subscriptionPlans.sortOrder);
  },

  // Update user's subscription plan
  async updateUserSubscriptionPlan(
    userId,
    planName,
    subscriptionEndDate = null
  ) {
    const plan = await db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.name, planName),
          eq(subscriptionPlans.isActive, true)
        )
      )
      .limit(1);

    if (!plan[0]) {
      throw new Error('Invalid subscription plan');
    }

    const updateData = {
      subscriptionPlan: planName,
      subscriptionStatus: 'active',
      subscriptionStartDate: new Date(),
      subscriptionEndDate: subscriptionEndDate
        ? new Date(subscriptionEndDate)
        : null,
      updatedAt: new Date(),
    };

    // Basic plan access does not expire.
    if (planName === 'basic') {
      updateData.subscriptionEndDate = null;
    }

    const [updatedUser] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();

    return updatedUser;
  },

  // Check if user's subscription is active
  async isSubscriptionActive(userId) {
    const user = await db
      .select({
        subscriptionStatus: users.subscriptionStatus,
        subscriptionEndDate: users.subscriptionEndDate,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return false;
    }

    const { subscriptionStatus, subscriptionEndDate } = user[0];

    if (subscriptionStatus !== 'active') {
      return false;
    }

    // If there's an end date, check if it's in the future
    if (subscriptionEndDate && new Date() > subscriptionEndDate) {
      // Update status to expired
      await db
        .update(users)
        .set({
          subscriptionStatus: 'expired',
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      return false;
    }

    return true;
  },

  // Get subscription usage statistics for a user
  async getUsageStats(userId, tenantIds) {
    const { plan } = await this.getUserSubscriptionPlan(userId);

    // Build where conditions for external collections
    const externalCollectionConditions = [
      eq(collections.userId, userId),
      eq(collections.type, 'external'),
    ];

    if (tenantIds && tenantIds.length > 0) {
      externalCollectionConditions.push(
        inArray(collections.tenantId, tenantIds)
      );
    }

    // Build where conditions for attachments
    const attachmentConditions = [eq(attachments.userId, userId)];

    if (tenantIds && tenantIds.length > 0) {
      attachmentConditions.push(inArray(attachments.tenantId, tenantIds));
    }

    // Count external collections
    const externalCollectionsCount = await db
      .select({ count: count() })
      .from(collections)
      .where(and(...externalCollectionConditions));

    // Count attachments
    const attachmentsCount = await db
      .select({ count: count() })
      .from(attachments)
      .where(and(...attachmentConditions));

    return {
      plan: {
        name: plan.name,
        displayName: plan.displayName,
      },
      externalCollections: {
        current: externalCollectionsCount[0]?.count || 0,
        limit: plan.maxExternalCollections,
        unlimited: plan.maxExternalCollections === -1,
      },
      attachments: {
        current: attachmentsCount[0]?.count || 0,
        limit: plan.maxAttachments,
        unlimited: plan.maxAttachments === -1,
      },
      features: {
        canAddCollaborators: plan.canAddCollaborators,
        maxCollaboratorsPerCollection: plan.maxCollaboratorsPerCollection,
        canCreateFolders: plan.canCreateFolders,
        canExportData: plan.canExportData,
        prioritySupport: plan.prioritySupport,
      },
    };
  },

  // Validate if user can change to a new plan
  async validatePlanChange(userId, newPlanName) {
    const { user, plan: currentPlan } =
      await this.getUserSubscriptionPlan(userId);

    // Get the new plan details
    const newPlan = await db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.name, newPlanName),
          eq(subscriptionPlans.isActive, true)
        )
      )
      .limit(1);

    if (!newPlan[0]) {
      throw new Error('Invalid subscription plan');
    }

    // Check if user is already on this plan
    if (currentPlan.name === newPlanName) {
      return {
        allowed: false,
        reason: 'ALREADY_ON_PLAN',
        message: `You are already subscribed to the ${currentPlan.displayName} plan`,
        currentPlan: currentPlan.name,
        requestedPlan: newPlanName,
      };
    }

    // Determine if this is an upgrade or downgrade
    const planHierarchy = {
      basic: 0,
      premium: 1,
      professional: 2,
      enterprise: 3,
    };
    const currentLevel = planHierarchy[currentPlan.name] || 0;
    const newLevel = planHierarchy[newPlanName] || 0;

    const isUpgrade = newLevel > currentLevel;
    const isDowngrade = newLevel < currentLevel;

    // For downgrades, check if user's current usage exceeds new plan limits
    if (isDowngrade) {
      const usageValidation = await this.validateDowngradeUsage(
        userId,
        newPlan[0]
      );
      if (!usageValidation.allowed) {
        return {
          allowed: false,
          reason: 'USAGE_EXCEEDS_LIMITS',
          message: usageValidation.message,
          currentPlan: currentPlan.name,
          requestedPlan: newPlanName,
          usageIssues: usageValidation.issues,
        };
      }
    }

    return {
      allowed: true,
      changeType: isUpgrade ? 'upgrade' : isDowngrade ? 'downgrade' : 'lateral',
      currentPlan: currentPlan.name,
      requestedPlan: newPlanName,
    };
  },

  // Validate if user's current usage allows downgrade to a specific plan
  async validateDowngradeUsage(userId, newPlan, tenantIds = []) {
    const issues = [];

    // Check external collections limit
    if (newPlan.maxExternalCollections !== -1) {
      const externalCollectionCheck = await this.canCreateExternalCollection(
        userId,
        tenantIds
      );
      if (externalCollectionCheck.current > newPlan.maxExternalCollections) {
        issues.push({
          type: 'external_collections',
          current: externalCollectionCheck.current,
          newLimit: newPlan.maxExternalCollections,
          message: `You have ${externalCollectionCheck.current} external collections, but the ${newPlan.displayName} plan only allows ${newPlan.maxExternalCollections}`,
        });
      }
    }

    // Check attachments limit
    if (newPlan.maxAttachments !== -1) {
      const attachmentCheck = await this.canCreateAttachment(userId, tenantIds);
      if (attachmentCheck.current > newPlan.maxAttachments) {
        issues.push({
          type: 'attachments',
          current: attachmentCheck.current,
          newLimit: newPlan.maxAttachments,
          message: `You have ${attachmentCheck.current} attachments, but the ${newPlan.displayName} plan only allows ${newPlan.maxAttachments}`,
        });
      }
    }

    // Check collaborator features
    if (!newPlan.canAddCollaborators) {
      // Here you would check if user has any collections with collaborators
      // This would require a new query to check for existing collaborators
      // For now, we'll add a placeholder
      const hasCollaborators = await this.userHasCollaborators(
        userId,
        tenantIds
      );
      if (hasCollaborators) {
        issues.push({
          type: 'collaborators',
          message: `You have collections with collaborators, but the ${newPlan.displayName} plan doesn't support collaboration features`,
        });
      }
    }

    return {
      allowed: issues.length === 0,
      issues,
      message:
        issues.length > 0
          ? `Cannot downgrade due to usage limits: ${issues.map((i) => i.message).join('; ')}`
          : 'Downgrade allowed',
    };
  },

  // Check if user has any collaborators
  async userHasCollaborators(userId, tenantIds = []) {
    try {
      // Check collection collaborators where this user is the creator
      const collectionCollabCount = await db
        .select({ count: count(collectionCollaborators.id) })
        .from(collectionCollaborators)
        .innerJoin(
          collections,
          eq(collectionCollaborators.collectionId, collections.id)
        )
        .where(
          and(
            eq(collections.userId, userId),
            ...(tenantIds.length > 0
              ? [inArray(collections.tenantId, tenantIds)]
              : [])
          )
        );

      if (collectionCollabCount[0]?.count > 0) {
        return true;
      }

      // Check external link collaborators where this user created the external link
      const externalLinkCollabCount = await db
        .select({ count: count(collectionExternalLinkCollaborators.id) })
        .from(collectionExternalLinkCollaborators)
        .innerJoin(
          collectionExternalLinks,
          eq(
            collectionExternalLinkCollaborators.collectionExternalLinkId,
            collectionExternalLinks.id
          )
        )
        .innerJoin(
          externalLinks,
          eq(collectionExternalLinks.externalLinkId, externalLinks.id)
        )
        .where(
          and(
            eq(externalLinks.addedByUserId, userId),
            ...(tenantIds.length > 0
              ? [inArray(externalLinks.tenantId, tenantIds)]
              : [])
          )
        );

      return externalLinkCollabCount[0]?.count > 0;
    } catch (error) {
      console.error('Error checking user collaborators:', error);
      return false;
    }
  },

  // Get plan comparison for UI display
  async getPlanComparison(currentPlanName, targetPlanName) {
    const plans = await db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          inArray(subscriptionPlans.name, [currentPlanName, targetPlanName]),
          eq(subscriptionPlans.isActive, true)
        )
      );

    const currentPlan = plans.find((p) => p.name === currentPlanName);
    const targetPlan = plans.find((p) => p.name === targetPlanName);

    if (!currentPlan || !targetPlan) {
      throw new Error('Invalid plan comparison');
    }

    const features = [
      {
        name: 'External Collections',
        current:
          currentPlan.maxExternalCollections === -1
            ? 'Unlimited'
            : currentPlan.maxExternalCollections,
        target:
          targetPlan.maxExternalCollections === -1
            ? 'Unlimited'
            : targetPlan.maxExternalCollections,
        better:
          targetPlan.maxExternalCollections === -1 ||
          (currentPlan.maxExternalCollections !== -1 &&
            targetPlan.maxExternalCollections >
              currentPlan.maxExternalCollections),
      },
      {
        name: 'Attachments',
        current:
          currentPlan.maxAttachments === -1
            ? 'Unlimited'
            : currentPlan.maxAttachments,
        target:
          targetPlan.maxAttachments === -1
            ? 'Unlimited'
            : targetPlan.maxAttachments,
        better:
          targetPlan.maxAttachments === -1 ||
          (currentPlan.maxAttachments !== -1 &&
            targetPlan.maxAttachments > currentPlan.maxAttachments),
      },
      {
        name: 'Collaborators',
        current: currentPlan.canAddCollaborators ? 'Yes' : 'No',
        target: targetPlan.canAddCollaborators ? 'Yes' : 'No',
        better:
          targetPlan.canAddCollaborators && !currentPlan.canAddCollaborators,
      },
      {
        name: 'Data Export',
        current: currentPlan.canExportData ? 'Yes' : 'No',
        target: targetPlan.canExportData ? 'Yes' : 'No',
        better: targetPlan.canExportData && !currentPlan.canExportData,
      },
      {
        name: 'Priority Support',
        current: currentPlan.prioritySupport ? 'Yes' : 'No',
        target: targetPlan.prioritySupport ? 'Yes' : 'No',
        better: targetPlan.prioritySupport && !currentPlan.prioritySupport,
      },
    ];

    return {
      currentPlan: {
        name: currentPlan.name,
        displayName: currentPlan.displayName,
        price: currentPlan.price,
      },
      targetPlan: {
        name: targetPlan.name,
        displayName: targetPlan.displayName,
        price: targetPlan.price,
      },
      features,
      priceChange: parseFloat(targetPlan.price) - parseFloat(currentPlan.price),
    };
  },

  // Get cleanup suggestions for downgrade
  async getDowngradeCleanupSuggestions(userId, targetPlanName, tenantIds = []) {
    const targetPlan = await db
      .select()
      .from(subscriptionPlans)
      .where(
        and(
          eq(subscriptionPlans.name, targetPlanName),
          eq(subscriptionPlans.isActive, true)
        )
      )
      .limit(1);

    if (!targetPlan[0]) {
      throw new Error('Invalid target plan');
    }

    const suggestions = [];

    // Check external collections
    if (targetPlan[0].maxExternalCollections !== -1) {
      const externalCollectionCheck = await this.canCreateExternalCollection(
        userId,
        tenantIds
      );
      const excess =
        externalCollectionCheck.current - targetPlan[0].maxExternalCollections;

      if (excess > 0) {
        suggestions.push({
          type: 'external_collections',
          action: 'delete',
          count: excess,
          message: `Delete ${excess} external collection${excess > 1 ? 's' : ''} to fit within the ${targetPlan[0].displayName} plan limit of ${targetPlan[0].maxExternalCollections}`,
          priority: 'high',
        });
      }
    }

    // Check attachments
    if (targetPlan[0].maxAttachments !== -1) {
      const attachmentCheck = await this.canCreateAttachment(userId, tenantIds);
      const excess = attachmentCheck.current - targetPlan[0].maxAttachments;

      if (excess > 0) {
        suggestions.push({
          type: 'attachments',
          action: 'delete',
          count: excess,
          message: `Delete ${excess} attachment${excess > 1 ? 's' : ''} to fit within the ${targetPlan[0].displayName} plan limit of ${targetPlan[0].maxAttachments}`,
          priority: 'high',
        });
      }
    }

    // Check collaborators
    if (!targetPlan[0].canAddCollaborators) {
      const hasCollaborators = await this.userHasCollaborators(
        userId,
        tenantIds
      );
      if (hasCollaborators) {
        suggestions.push({
          type: 'collaborators',
          action: 'remove',
          message: `Remove all collaborators from your collections as the ${targetPlan[0].displayName} plan doesn't support collaboration`,
          priority: 'medium',
        });
      }
    }

    return {
      targetPlan: {
        name: targetPlan[0].name,
        displayName: targetPlan[0].displayName,
      },
      suggestions,
      canDowngrade: suggestions.length === 0,
      message:
        suggestions.length === 0
          ? 'You can downgrade to this plan without any changes'
          : 'Please complete the following actions before downgrading',
    };
  },
};
