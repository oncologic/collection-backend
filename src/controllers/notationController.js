import { db } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { collectionExternalLinksNotations } from '../models/collectionExternalLinksNotations.js';
import { collectionExternalLinks } from '../models/external_links.js';
import { collections } from '../models/collections.js';
import { triggerNewNotationNotification } from '../services/slackNotificationHelper.js';
import { updateNotationEmbeddings } from '../services/vectorService.js';
import {
  addTagsToNotationService,
  removeTagsFromNotationService,
  updateNotationTagsService,
} from '../services/notationService.js';
import { syncNotationAttachmentVisibility } from '../services/notationAttachmentService.js';
import {
  buildDateRangeCreateFields,
  buildDateRangeUpdateFields,
} from '../utils/dateRanges.js';

/**
 * Create a new notation for an external link
 */
export const createNotation = async (req, res) => {
  try {
    const {
      collectionExternalLinkId,
      title,
      description,
      notes,
      category,
      status,
      visibility = 'private',
      date,
      startTime,
      endTime,
      timezone,
      type,
      customFields,
      tags, // Array of tag IDs
    } = req.body;
    const dateRangeFields = buildDateRangeCreateFields(req.body);

    const userId = req.user?.id;

    if (!collectionExternalLinkId) {
      return res.status(400).json({
        error: 'Collection external link ID is required',
      });
    }

    // Create the notation
    const notation = await db
      .insert(collectionExternalLinksNotations)
      .values({
        collectionExternalLinkId,
        title,
        description,
        notes,
        category,
        status,
        visibility,
        userId,
        ...dateRangeFields,
        startTime,
        endTime,
        timezone,
        type,
        customFields,
        highlighted: false,
        listOrder: 0, // You might want to calculate this based on existing notations
      })
      .returning();

    // Add tags if provided
    if (tags && tags.length > 0) {
      await addTagsToNotationService(notation[0].id, tags);
    }

    // Trigger Slack notification (runs in background)
    triggerNewNotationNotification(
      notation[0],
      collectionExternalLinkId,
      userId
    );

    // Update embeddings for the notation (async, don't wait)
    updateNotationEmbeddings(notation[0].id).catch((error) => {
      console.error(
        `Failed to update embeddings for notation ${notation[0].id}:`,
        error
      );
    });

    res.status(201).json({
      success: true,
      notation: notation[0],
    });
  } catch (error) {
    console.error('Error creating notation:', error);
    res.status(500).json({
      error: 'Failed to create notation',
    });
  }
};

/**
 * Update an existing notation
 */
export const updateNotation = async (req, res) => {
  try {
    const { notationId } = req.params;
    const userId = req.user?.id;
    const updateData = req.body;

    // Check if user has permission to update
    const existing = await db
      .select({
        notation: collectionExternalLinksNotations,
        userId: collectionExternalLinks.userId,
      })
      .from(collectionExternalLinksNotations)
      .leftJoin(
        collectionExternalLinks,
        eq(
          collectionExternalLinksNotations.collectionExternalLinkId,
          collectionExternalLinks.id
        )
      )
      .where(eq(collectionExternalLinksNotations.id, notationId))
      .limit(1);

    if (!existing[0]) {
      return res.status(404).json({
        error: 'Notation not found',
      });
    }

    // Check permission (owner of notation or external link)
    if (
      existing[0].notation.userId !== userId &&
      existing[0].userId !== userId
    ) {
      return res.status(403).json({
        error: 'You do not have permission to update this notation',
      });
    }

    const dateRangeFields = buildDateRangeUpdateFields(updateData);

    // Update the notation
    const updated = await db
      .update(collectionExternalLinksNotations)
      .set({
        ...updateData,
        ...dateRangeFields,
        updatedAt: new Date(),
      })
      .where(eq(collectionExternalLinksNotations.id, notationId))
      .returning();

    if (updateData.visibility) {
      await syncNotationAttachmentVisibility(notationId, updateData.visibility);
    }

    // Handle tags if provided
    if (updateData.tags !== undefined) {
      await updateNotationTagsService(notationId, updateData.tags);
    }

    // Update embeddings if text fields changed
    if (
      updateData.title ||
      updateData.description ||
      updateData.notes ||
      updateData.category
    ) {
      updateNotationEmbeddings(notationId).catch((error) => {
        console.error(
          `Failed to update embeddings for notation ${notationId}:`,
          error
        );
      });
    }

    res.json({
      success: true,
      notation: updated[0],
    });
  } catch (error) {
    console.error('Error updating notation:', error);
    res.status(500).json({
      error: 'Failed to update notation',
    });
  }
};

/**
 * Delete a notation
 */
export const deleteNotation = async (req, res) => {
  try {
    const { notationId } = req.params;
    const userId = req.user?.id;

    // Check if user has permission to delete
    const existing = await db
      .select({
        notation: collectionExternalLinksNotations,
        userId: collectionExternalLinks.userId,
      })
      .from(collectionExternalLinksNotations)
      .leftJoin(
        collectionExternalLinks,
        eq(
          collectionExternalLinksNotations.collectionExternalLinkId,
          collectionExternalLinks.id
        )
      )
      .where(eq(collectionExternalLinksNotations.id, notationId))
      .limit(1);

    if (!existing[0]) {
      return res.status(404).json({
        error: 'Notation not found',
      });
    }

    // Check permission
    if (
      existing[0].notation.userId !== userId &&
      existing[0].userId !== userId
    ) {
      return res.status(403).json({
        error: 'You do not have permission to delete this notation',
      });
    }

    // Delete the notation (tags will be cascade deleted)
    await db
      .delete(collectionExternalLinksNotations)
      .where(eq(collectionExternalLinksNotations.id, notationId));

    res.json({
      success: true,
      message: 'Notation deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting notation:', error);
    res.status(500).json({
      error: 'Failed to delete notation',
    });
  }
};

/**
 * Add tags to a notation
 */
export const addTagsToNotation = async (req, res) => {
  try {
    const { notationId } = req.params;
    const { tagIds } = req.body;

    if (!tagIds || !Array.isArray(tagIds)) {
      return res.status(400).json({
        error: 'Tag IDs must be provided as an array',
      });
    }

    const result = await addTagsToNotationService(notationId, tagIds);

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('Error adding tags to notation:', error);
    res.status(500).json({
      error: 'Failed to add tags to notation',
    });
  }
};

/**
 * Remove tags from a notation
 */
export const removeTagsFromNotation = async (req, res) => {
  try {
    const { notationId } = req.params;
    const { tagIds } = req.body;

    if (!tagIds || !Array.isArray(tagIds)) {
      return res.status(400).json({
        error: 'Tag IDs must be provided as an array',
      });
    }

    const result = await removeTagsFromNotationService(notationId, tagIds);

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('Error removing tags from notation:', error);
    res.status(500).json({
      error: 'Failed to remove tags from notation',
    });
  }
};
