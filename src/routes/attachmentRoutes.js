import express from 'express';
import upload from '../middleware/upload.js';
import { attachmentController } from '../controllers/attachmentController.js';
import {
  requireUser,
  requireUserAndTenants,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Change to upload.array for multiple file uploads
router.post(
  '/',
  requireUserAndTenants(),
  upload.array('attachment', 50), // 10 is the max number of files
  attachmentController.createAttachment
);

router.get(
  '/search',
  requireUserAndTenants(),
  attachmentController.searchAttachments
);

router.post(
  '/upload-intent',
  requireUserAndTenants(),
  attachmentController.createUploadIntent
);

router.post(
  '/upload-complete',
  requireUserAndTenants(),
  attachmentController.completeUpload
);

router.patch(
  '/:id',
  requireUserAndTenants(),
  attachmentController.updateAttachment
);

router.delete(
  '/:id',
  requireUserAndTenants(),
  attachmentController.deleteAttachment
);

// Image view proxy endpoint (permanent URLs)
router.get(
  '/view/:imageKey',
  requireUserAndTenants(),
  attachmentController.viewImage
);

// Image download proxy endpoint with CORS
router.get(
  '/download/:imageKey',
  requireUserAndTenants(),
  attachmentController.downloadImage
);

// Refresh image URL endpoint
router.get(
  '/refresh-url/:imageKey',
  requireUserAndTenants(),
  attachmentController.refreshImageUrl
);

// Handle OPTIONS request for CORS preflight
router.options('/download/:imageKey', (req, res) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
  ].filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  } else if (process.env.NODE_ENV !== 'production') {
    res.header('Access-Control-Allow-Origin', '*');
  }

  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  res.sendStatus(200);
});

export default router;
