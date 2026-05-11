import { db } from '../db/index.js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { notationAttachments } from '../models/notationAttachments.js';
import { attachments } from '../models/attachments.js';
import { collectionExternalLinksNotations } from '../models/collectionExternalLinksNotations.js';
import {
  collectionExternalLinks,
  externalLinks,
} from '../models/external_links.js';
import { collections } from '../models/collections.js';
import { collectionCollaborators } from '../models/collectionCollaborators.js';
import { collectionExternalLinkCollaborators } from '../models/collectionExternalLinkCollaborators.js';
import { processImageService } from './aiService.js';

export async function getNotationAttachmentAccessContext(notationId, userId) {
  const [context] = await db
    .select({
      notationId: collectionExternalLinksNotations.id,
      notationUserId: collectionExternalLinksNotations.userId,
      visibility: collectionExternalLinksNotations.visibility,
      collectionExternalLinkId:
        collectionExternalLinksNotations.collectionExternalLinkId,
      externalLinkId: collectionExternalLinks.externalLinkId,
      externalLinkOwnerId: externalLinks.addedByUserId,
      collectionOwnerId: collections.userId,
      externalLinkCollaboratorRole:
        collectionExternalLinkCollaborators.role,
      collectionCollaboratorRole: collectionCollaborators.role,
    })
    .from(collectionExternalLinksNotations)
    .innerJoin(
      collectionExternalLinks,
      eq(
        collectionExternalLinksNotations.collectionExternalLinkId,
        collectionExternalLinks.id
      )
    )
    .innerJoin(
      externalLinks,
      eq(collectionExternalLinks.externalLinkId, externalLinks.id)
    )
    .innerJoin(
      collections,
      eq(collectionExternalLinks.collectionId, collections.id)
    )
    .leftJoin(
      collectionExternalLinkCollaborators,
      and(
        eq(
          collectionExternalLinkCollaborators.collectionExternalLinkId,
          collectionExternalLinks.id
        ),
        eq(collectionExternalLinkCollaborators.userId, userId)
      )
    )
    .leftJoin(
      collectionCollaborators,
      and(
        eq(collectionCollaborators.collectionId, collections.id),
        eq(collectionCollaborators.userId, userId)
      )
    )
    .where(eq(collectionExternalLinksNotations.id, notationId))
    .limit(1);

  if (!context) {
    return null;
  }

  const collaboratorRole =
    context.externalLinkCollaboratorRole || context.collectionCollaboratorRole;
  const isNotationOwner = context.notationUserId === userId;
  const isExternalLinkOwner = context.externalLinkOwnerId === userId;
  const isCollectionOwner = context.collectionOwnerId === userId;
  const canCollaboratorEdit = ['admin', 'editor'].includes(
    collaboratorRole || ''
  );
  const canCollaboratorView = Boolean(collaboratorRole);

  return {
    ...context,
    canEdit:
      isNotationOwner ||
      isExternalLinkOwner ||
      isCollectionOwner ||
      canCollaboratorEdit,
    canView:
      isNotationOwner ||
      isExternalLinkOwner ||
      isCollectionOwner ||
      context.visibility === 'public' ||
      (context.visibility === 'unlisted' && canCollaboratorView),
  };
}

/**
 * Save a draft of a notation (auto-save)
 */
export async function saveNotationDraft({
  notationId,
  draftContent,
  userId,
}) {
  try {
    const context = await getNotationAttachmentAccessContext(notationId, userId);

    if (!context) {
      throw new Error('Notation not found');
    }

    if (!context.canEdit) {
      throw new Error('Insufficient permissions to edit this notation');
    }

    // Update the notation with draft content
    const [updated] = await db
      .update(collectionExternalLinksNotations)
      .set({
        draftContent,
        lastAutoSavedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(collectionExternalLinksNotations.id, notationId))
      .returning();

    if (!updated) {
      throw new Error('Failed to update notation');
    }

    return updated;
  } catch (error) {
    console.error('Error saving notation draft:', error);
    throw new Error(`Failed to save draft: ${error.message}`);
  }
}

/**
 * Add an inline attachment to a notation
 */
export async function addInlineAttachment({
  notationId,
  attachmentId,
  position,
  inlineMetadata = {},
  userId,
}) {
  try {
    const context = await getNotationAttachmentAccessContext(notationId, userId);

    if (!context?.canEdit) {
      throw new Error('Notation not found or access denied');
    }

    // Create the notation attachment link
    const [notationAttachment] = await db
      .insert(notationAttachments)
      .values({
        notationId,
        attachmentId,
        position,
        inlineMetadata,
        isInline: true,
      })
      .returning();

    return notationAttachment;
  } catch (error) {
    console.error('Error adding inline attachment:', error);
    throw new Error(`Failed to add inline attachment: ${error.message}`);
  }
}

/**
 * Process OCR for an inline image
 */
export async function processInlineImageOCR({
  notationId,
  attachmentId,
  imageUrl,
  prompt,
  userId,
}) {
  try {
    const context = await getNotationAttachmentAccessContext(notationId, userId);

    if (!context?.canEdit) {
      throw new Error('Notation not found or access denied');
    }

    // Process the image with OCR
    const ocrResult = await processImageService(imageUrl, prompt);

    // Update the notation attachment with OCR results
    const [updated] = await db
      .update(notationAttachments)
      .set({
        ocrText: ocrResult.text,
        inlineMetadata: sql`
          COALESCE(inline_metadata, '{}'::jsonb) ||
          ${JSON.stringify({
            ocrAnswer: ocrResult.answer,
            ocrPrompt: prompt,
          })}::jsonb
        `,
        ocrProcessedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notationAttachments.notationId, notationId),
          eq(notationAttachments.attachmentId, attachmentId)
        )
      )
      .returning();

    if (!updated) {
      throw new Error('Inline attachment not found');
    }

    return {
      ...updated,
      ocrResult,
    };
  } catch (error) {
    console.error('Error processing inline image OCR:', error);
    throw new Error(`Failed to process OCR: ${error.message}`);
  }
}

/**
 * Get all inline attachments for a notation
 */
export async function getNotationAttachments(notationId, userId) {
  try {
    const context = await getNotationAttachmentAccessContext(notationId, userId);

    if (!context?.canView) {
      throw new Error('Notation not found or access denied');
    }

    const attachmentsList = await db
      .select({
        notationAttachment: notationAttachments,
        attachment: attachments,
      })
      .from(notationAttachments)
      .innerJoin(
        attachments,
        eq(notationAttachments.attachmentId, attachments.id)
      )
      .innerJoin(
        collectionExternalLinksNotations,
        eq(notationAttachments.notationId, collectionExternalLinksNotations.id)
      )
      .where(
        eq(notationAttachments.notationId, notationId)
      )
      .orderBy(notationAttachments.position);

    return attachmentsList;
  } catch (error) {
    console.error('Error getting notation attachments:', error);
    throw new Error(`Failed to get attachments: ${error.message}`);
  }
}

/**
 * Remove an inline attachment from a notation
 */
export async function removeInlineAttachment({
  notationId,
  attachmentId,
  userId,
}) {
  try {
    const context = await getNotationAttachmentAccessContext(notationId, userId);

    if (!context?.canEdit) {
      throw new Error('Notation not found or access denied');
    }

    // Remove the link
    await db
      .delete(notationAttachments)
      .where(
        and(
          eq(notationAttachments.notationId, notationId),
          eq(notationAttachments.attachmentId, attachmentId)
        )
      );

    return { success: true };
  } catch (error) {
    console.error('Error removing inline attachment:', error);
    throw new Error(`Failed to remove attachment: ${error.message}`);
  }
}

export async function syncNotationAttachmentVisibility(notationId, visibility) {
  if (!notationId || !visibility) {
    return;
  }

  const linkedAttachments = await db
    .select({
      attachmentId: notationAttachments.attachmentId,
    })
    .from(notationAttachments)
    .where(eq(notationAttachments.notationId, notationId));

  if (!linkedAttachments.length) {
    return;
  }

  await db
    .update(attachments)
    .set({
      visibility,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        attachments.id,
        linkedAttachments.map((attachment) => attachment.attachmentId)
      )
    );
}
