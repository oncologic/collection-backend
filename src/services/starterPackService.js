import { db } from '../db/index.js';
import { starterPacks } from '../models/starterPacks.js';
import { eq, and } from 'drizzle-orm';

export async function getAllStarterPacksService() {
  try {
    const result = await db
      .select()
      .from(starterPacks)
      .orderBy(starterPacks.createdAt);
    return result;
  } catch (error) {
    console.error('Error fetching all starter packs:', error);
    throw new Error('Failed to fetch all starter packs');
  }
}

export async function getStarterPackByIdService(id) {
  try {
    const result = await db
      .select()
      .from(starterPacks)
      .where(eq(starterPacks.id, id))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('Error fetching starter pack by id:', error);
    throw new Error('Failed to fetch starter pack by id');
  }
}

export async function createStarterPackService({
  name,
  description,
  type,
  userId,
  groupedItems,
}) {
  try {
    const result = await db
      .insert(starterPacks)
      .values({
        name,
        description,
        type,
        userId,
        items: groupedItems,
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Error creating starter pack:', error);
    throw new Error('Failed to create starter pack');
  }
}

export async function updateStarterPackService({
  id,
  name,
  description,
  type,
  userId,
  items,
}) {
  try {
    const result = await db
      .update(starterPacks)
      .set({
        name,
        description,
        type,
        items,
        updatedAt: new Date(),
      })
      .where(and(eq(starterPacks.id, id), eq(starterPacks.userId, userId)))
      .returning();
    return result[0] || null;
  } catch (error) {
    console.error('Error updating starter pack:', error);
    throw new Error('Failed to update starter pack');
  }
}

export async function deleteStarterPackService(id, userId) {
  try {
    const result = await db
      .delete(starterPacks)
      .where(and(eq(starterPacks.id, id), eq(starterPacks.userId, userId)))
      .returning();
    return result[0] || null;
  } catch (error) {
    console.error('Error deleting starter pack:', error);
    throw new Error('Failed to delete starter pack');
  }
}
