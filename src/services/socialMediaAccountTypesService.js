import { db } from '../db/index.js';
import { socialMediaAccountTypes } from '../models/socialMediaAccountTypes.js';
import { eq, and, or, inArray, sql } from 'drizzle-orm';

// Get all social media account types visible to the user
export const getAllSocialMediaAccountTypesService = async (
  tenantIds,
  userId
) => {
  try {
    const accountTypes = await db
      .select()
      .from(socialMediaAccountTypes)
      .where(
        or(
          // Public account types are visible to everyone
          eq(socialMediaAccountTypes.visibility, 'public'),
          // Tenant account types are visible to users in the same tenant
          and(
            eq(socialMediaAccountTypes.visibility, 'tenant'),
            inArray(socialMediaAccountTypes.tenantId, tenantIds)
          ),
          // Private account types are only visible to the creator
          and(
            eq(socialMediaAccountTypes.visibility, 'private'),
            eq(socialMediaAccountTypes.addedByUserId, userId)
          ),
          // Include default types (no tenant)
          sql`${socialMediaAccountTypes.tenantId} IS NULL`
        )
      )
      .orderBy(socialMediaAccountTypes.name);

    return accountTypes;
  } catch (error) {
    console.error('Error fetching social media account types:', error);
    throw error;
  }
};

// Get a single social media account type by ID
export const getSocialMediaAccountTypeByIdService = async (
  id,
  tenantIds,
  userId
) => {
  try {
    const accountType = await db
      .select()
      .from(socialMediaAccountTypes)
      .where(
        and(
          eq(socialMediaAccountTypes.id, id),
          or(
            eq(socialMediaAccountTypes.visibility, 'public'),
            and(
              eq(socialMediaAccountTypes.visibility, 'tenant'),
              inArray(socialMediaAccountTypes.tenantId, tenantIds)
            ),
            and(
              eq(socialMediaAccountTypes.visibility, 'private'),
              eq(socialMediaAccountTypes.addedByUserId, userId)
            ),
            sql`${socialMediaAccountTypes.tenantId} IS NULL`
          )
        )
      )
      .limit(1);

    return accountType[0] || null;
  } catch (error) {
    console.error('Error fetching social media account type:', error);
    throw error;
  }
};

// Create a new social media account type
export const createSocialMediaAccountTypeService = async (
  data,
  tenantIds,
  userId
) => {
  try {
    const newAccountType = await db
      .insert(socialMediaAccountTypes)
      .values({
        ...data,
        addedByUserId: userId,
        tenantId: data.tenantId || tenantIds[0], // Default to first tenant if not provided
        visibility: data.visibility || 'tenant', // Default to tenant visibility
        isDefault: false, // User-created types are not default
      })
      .returning();

    return newAccountType[0];
  } catch (error) {
    console.error('Error creating social media account type:', error);
    throw error;
  }
};

// Update a social media account type
export const updateSocialMediaAccountTypeService = async (
  id,
  data,
  tenantIds
) => {
  try {
    // First check if the user has permission to update this account type
    const existing = await db
      .select()
      .from(socialMediaAccountTypes)
      .where(
        and(
          eq(socialMediaAccountTypes.id, id),
          inArray(socialMediaAccountTypes.tenantId, tenantIds)
        )
      )
      .limit(1);

    if (!existing[0]) {
      throw new Error('Social media account type not found or access denied');
    }

    // Don't allow updating default types
    if (existing[0].isDefault) {
      throw new Error('Cannot update default social media account types');
    }

    const updatedAccountType = await db
      .update(socialMediaAccountTypes)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(socialMediaAccountTypes.id, id))
      .returning();

    return updatedAccountType[0];
  } catch (error) {
    console.error('Error updating social media account type:', error);
    throw error;
  }
};

// Delete a social media account type
export const deleteSocialMediaAccountTypeService = async (id, tenantIds) => {
  try {
    // First check if the user has permission to delete this account type
    const existing = await db
      .select()
      .from(socialMediaAccountTypes)
      .where(
        and(
          eq(socialMediaAccountTypes.id, id),
          inArray(socialMediaAccountTypes.tenantId, tenantIds)
        )
      )
      .limit(1);

    if (!existing[0]) {
      throw new Error('Social media account type not found or access denied');
    }

    // Don't allow deleting default types
    if (existing[0].isDefault) {
      throw new Error('Cannot delete default social media account types');
    }

    await db
      .delete(socialMediaAccountTypes)
      .where(eq(socialMediaAccountTypes.id, id));

    return { success: true };
  } catch (error) {
    console.error('Error deleting social media account type:', error);
    throw error;
  }
};

// Get social media account types for a specific tenant
export const getSocialMediaAccountTypesByTenantService = async (tenantId) => {
  try {
    const accountTypes = await db
      .select()
      .from(socialMediaAccountTypes)
      .where(
        or(
          eq(socialMediaAccountTypes.tenantId, tenantId),
          eq(socialMediaAccountTypes.visibility, 'public'),
          sql`${socialMediaAccountTypes.tenantId} IS NULL`
        )
      )
      .orderBy(socialMediaAccountTypes.name);

    return accountTypes;
  } catch (error) {
    console.error(
      'Error fetching social media account types by tenant:',
      error
    );
    throw error;
  }
};
