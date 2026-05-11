import { db } from '../db/index.js';
import { tags } from '../models/tags.js';
import { eq, inArray, and, or, ne, sql } from 'drizzle-orm';

export const getAllTagsService = async (tenantIds, userId) => {
  try {
    if (!tenantIds || tenantIds.length === 0) {
      return [];
    }

    const conditions = [];

    conditions.push(
      and(eq(tags.visibility, 'public'), inArray(tags.tenantId, tenantIds))
    );

    conditions.push(
      and(eq(tags.visibility, 'tenant'), inArray(tags.tenantId, tenantIds))
    );

    if (userId) {
      conditions.push(
        and(
          eq(tags.visibility, 'private'),
          eq(tags.addedByUserId, userId),
          inArray(tags.tenantId, tenantIds)
        )
      );
    }

    const result = await db
      .select()
      .from(tags)
      .where(or(...conditions));

    return result;
  } catch (error) {
    console.error('Error fetching tags:', error);
    throw new Error(`Failed to fetch tags: ${error.message}`);
  }
};

const findDuplicateTagByName = async ({ name, tenantId, excludeId = null }) => {
  if (!name?.trim() || !tenantId) {
    return null;
  }

  const conditions = [
    eq(tags.tenantId, tenantId),
    sql`LOWER(${tags.name}) = LOWER(${name.trim()})`,
  ];

  if (excludeId !== null) {
    conditions.push(ne(tags.id, excludeId));
  }

  const [duplicate] = await db
    .select({
      id: tags.id,
      name: tags.name,
    })
    .from(tags)
    .where(and(...conditions))
    .limit(1);

  return duplicate || null;
};

export const createTagService = async (tagData, tenantIds, userId) => {
  try {
    const tenantId =
      tagData.tenantId ||
      (tenantIds && tenantIds.length > 0 ? tenantIds[0] : null);

    if (!tenantId) {
      throw new Error('Tenant ID is required to create a tag');
    }

    if (!tenantIds || !tenantIds.includes(tenantId)) {
      throw new Error('Unauthorized to create a tag for this tenant');
    }

    const duplicate = await findDuplicateTagByName({
      name: tagData.name,
      tenantId,
    });

    if (duplicate) {
      throw new Error('A tag with this name already exists for this tenant');
    }

    const result = await db
      .insert(tags)
      .values({
        name: tagData.name?.trim(),
        description: tagData.description,
        color: tagData.color,
        tenantId: tenantId,
        addedByUserId: userId,
        visibility: tagData.visibility || 'tenant', // Default to tenant visibility
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Error creating tag:', error);
    throw new Error(`Failed to create tag: ${error.message}`);
  }
};

export const updateTagService = async (id, tagData, tenantIds) => {
  try {
    // Verify the tag belongs to one of the user's tenants
    const existingTag = await db
      .select()
      .from(tags)
      .where(eq(tags.id, id))
      .limit(1);

    if (!existingTag.length) {
      throw new Error('Tag not found');
    }

    if (!tenantIds || !tenantIds.includes(existingTag[0].tenantId)) {
      throw new Error('Unauthorized to update this tag');
    }

    const duplicate = await findDuplicateTagByName({
      name: tagData.name,
      tenantId: existingTag[0].tenantId,
      excludeId: Number(id),
    });

    if (duplicate) {
      throw new Error('A tag with this name already exists for this tenant');
    }

    const result = await db
      .update(tags)
      .set({
        name: tagData.name?.trim(),
        description: tagData.description,
        color: tagData.color,
        visibility: tagData.visibility ?? existingTag[0].visibility,
        updatedAt: new Date(),
      })
      .where(eq(tags.id, id))
      .returning();

    return result[0];
  } catch (error) {
    console.error('Error updating tag:', error);
    throw new Error(`Failed to update tag: ${error.message}`);
  }
};

export const deleteTagService = async (id, tenantIds) => {
  try {
    // Verify the tag belongs to one of the user's tenants
    const existingTag = await db
      .select()
      .from(tags)
      .where(eq(tags.id, id))
      .limit(1);

    if (!existingTag.length) {
      throw new Error('Tag not found');
    }

    // Check authorization
    if (!tenantIds || !tenantIds.includes(existingTag[0].tenantId)) {
      throw new Error('Unauthorized to delete this tag');
    }

    const result = await db.delete(tags).where(eq(tags.id, id));

    return result;
  } catch (error) {
    console.error('Error deleting tag:', error);
    throw new Error(`Failed to delete tag: ${error.message}`);
  }
};
