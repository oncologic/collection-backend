import express from 'express';
import upload, { memoryUpload } from '../middleware/upload.js';
import { notationAttachmentController } from '../controllers/notationAttachmentController.js';
import {
  requireUser,
  requireUserAndTenants,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Auto-save draft
router.post(
  '/notations/:notationId/draft',
  requireUser(),
  notationAttachmentController.saveDraft
);

// Upload inline image for notation - using memory storage for inline images
router.post(
  '/notations/:notationId/inline-image',
  requireUserAndTenants(),
  memoryUpload.single('attachment'),
  notationAttachmentController.uploadInlineImage
);

// Process OCR for existing inline image
router.post(
  '/notations/:notationId/attachments/:attachmentId/ocr',
  requireUser(),
  notationAttachmentController.processOCR
);

// Get all inline attachments for a notation
router.get(
  '/notations/:notationId/inline-attachments',
  requireUser(),
  notationAttachmentController.getInlineAttachments
);

// Remove inline attachment
router.delete(
  '/notations/:notationId/attachments/:attachmentId',
  requireUser(),
  notationAttachmentController.removeInlineAttachment
);

export default router;