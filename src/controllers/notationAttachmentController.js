import {
  saveNotationDraft,
  addInlineAttachment,
  processInlineImageOCR,
  getNotationAttachments,
  removeInlineAttachment,
  getNotationAttachmentAccessContext,
} from '../services/notationAttachmentService.js';
import { createAttachmentService } from '../services/attachmentService.js';
import { s3Uploader } from '../utils/s3Uploader.js';
import { generatePresignedUrl } from '../utils/s3.js';
import { v4 as uuidv4 } from 'uuid';

export const notationAttachmentController = {
  /**
   * Auto-save notation draft
   */
  async saveDraft(req, res) {
    try {
      const { notationId } = req.params;
      const { draftContent } = req.body;
      const userId = req.auth.dbUserId;

      const updatedNotation = await saveNotationDraft({
        notationId,
        draftContent,
        userId,
      });

      res.status(200).json({
        success: true,
        notation: updatedNotation,
        savedAt: updatedNotation.lastAutoSavedAt,
      });
    } catch (error) {
      console.error('Error saving draft:', error);
      res.status(500).json({
        error: error.message || 'Failed to save draft',
      });
    }
  },

  /**
   * Upload and attach inline image to notation
   */
  async uploadInlineImage(req, res) {
    try {
      const { notationId } = req.params;
      const userId = req.auth.dbUserId;
      const tenantIds = req.tenantIds;
      const file = req.file;
      const { position, processOCR, ocrPrompt } = req.body;

      if (!file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const notationContext = await getNotationAttachmentAccessContext(
        notationId,
        userId
      );

      if (!notationContext?.canEdit) {
        return res.status(403).json({
          error: 'You do not have permission to modify this notation',
        });
      }

      // Upload to S3 - s3Uploader expects buffer, file path, or stream
      const imageKey = `notation-images/${uuidv4()}-${file.originalname}`;

      // Use buffer if available (memory storage), otherwise use path (disk storage)
      const fileData = file.buffer || file.path;
      if (!fileData) {
        throw new Error('File data not available. Check multer configuration.');
      }

      await s3Uploader(fileData, imageKey, file.mimetype);

      // Generate presigned URL for the uploaded image
      const presignedUrl = await generatePresignedUrl(imageKey);

      // Create attachment record
      const attachment = await createAttachmentService({
        title: file.originalname,
        description: `Inline image for notation ${notationId}`,
        type: 'image',
        imageKey,
        visibility: notationContext.visibility || 'private',
        externalLinkId: notationContext.externalLinkId,
        userId,
        tenantId: tenantIds[0],
      });

      // Link to notation
      const notationAttachment = await addInlineAttachment({
        notationId,
        attachmentId: attachment.id,
        position: position || 0,
        inlineMetadata: {
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
        },
        userId,
      });

      let ocrResult = null;
      // Process OCR if requested
      if (processOCR === 'true' || processOCR === true) {
        try {
          const result = await processInlineImageOCR({
            notationId,
            attachmentId: attachment.id,
            imageUrl: presignedUrl,
            prompt: ocrPrompt || 'Extract all text from this image',
            userId,
          });
          ocrResult = result.ocrResult;
        } catch (ocrError) {
          console.error('OCR processing failed:', ocrError);
          // Don't fail the whole request if OCR fails
        }
      }

      res.status(200).json({
        success: true,
        attachment: {
          ...attachment,
          presignedUrl,
          accessUrl: `${
            process.env.NEXT_PUBLIC_API_URL || process.env.FRONTEND_URL || ''
          }/api/attachments/view/${encodeURIComponent(imageKey)}`,
        },
        notationAttachment,
        ocrResult,
      });
    } catch (error) {
      console.error('Error uploading inline image:', error);
      res.status(500).json({
        error: error.message || 'Failed to upload inline image',
      });
    }
  },

  /**
   * Process OCR for existing inline image
   */
  async processOCR(req, res) {
    try {
      const { notationId, attachmentId } = req.params;
      const { imageUrl, prompt } = req.body;
      const userId = req.auth.dbUserId;

      const result = await processInlineImageOCR({
        notationId,
        attachmentId,
        imageUrl,
        prompt,
        userId,
      });

      res.status(200).json({
        success: true,
        ocrResult: result.ocrResult,
        attachment: result,
      });
    } catch (error) {
      console.error('Error processing OCR:', error);
      res.status(500).json({
        error: error.message || 'Failed to process OCR',
      });
    }
  },

  /**
   * Get all inline attachments for a notation
   */
  async getInlineAttachments(req, res) {
    try {
      const { notationId } = req.params;
      const userId = req.auth.dbUserId;

      const attachments = await getNotationAttachments(notationId, userId);
      const hydratedAttachments = await Promise.all(
        attachments.map(async ({ attachment, notationAttachment }) => {
          const presignedUrl = attachment.imageKey
            ? await generatePresignedUrl(attachment.imageKey, 86400)
            : null;

          return {
            ...attachment,
            notationAttachmentId: notationAttachment.id,
            position: notationAttachment.position,
            inlineMetadata: notationAttachment.inlineMetadata,
            isInline: notationAttachment.isInline,
            ocrText: notationAttachment.ocrText,
            ocrProcessedAt: notationAttachment.ocrProcessedAt,
            presignedUrl,
            accessUrl: attachment.imageKey
              ? `${
                  process.env.NEXT_PUBLIC_API_URL ||
                  process.env.FRONTEND_URL ||
                  ''
                }/api/attachments/view/${encodeURIComponent(
                  attachment.imageKey
                )}`
              : null,
          };
        })
      );

      res.status(200).json({
        success: true,
        attachments: hydratedAttachments,
      });
    } catch (error) {
      console.error('Error getting inline attachments:', error);
      res.status(500).json({
        error: error.message || 'Failed to get attachments',
      });
    }
  },

  /**
   * Remove inline attachment from notation
   */
  async removeInlineAttachment(req, res) {
    try {
      const { notationId, attachmentId } = req.params;
      const userId = req.auth.dbUserId;

      await removeInlineAttachment({
        notationId,
        attachmentId,
        userId,
      });

      res.status(200).json({
        success: true,
        message: 'Attachment removed successfully',
      });
    } catch (error) {
      console.error('Error removing inline attachment:', error);
      res.status(500).json({
        error: error.message || 'Failed to remove attachment',
      });
    }
  },
};
