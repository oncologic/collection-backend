import express from 'express';
import rateLimit from 'express-rate-limit';
import { aiController } from '../controllers/aiController.js';
import { opportunityAIController } from '../controllers/opportunityAIController.js';
import {
  requireAdmin,
  requireUser,
  requireUserAndTenants,
} from '../middleware/authMiddleware.js';

const router = express.Router();

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50000, // High limit for production - users making many AI requests
  message: 'Too many requests, please try again later',
});

// Generic endpoint that accepts a provider parameter
router.post(
  '/generate-description',
  aiLimiter,
  aiController.generateDescription
);

router.post('/generate-description/ocr', aiLimiter, (req, res) => {
  req.body.provider = 'ocr';
  aiController.generateDescription(req, res);
});

// Backward compatibility: map /openai to OCR service
router.post('/generate-description/openai', aiLimiter, (req, res) => {
  req.body.provider = 'ocr';
  aiController.generateDescription(req, res);
});

router.post('/generate-description/claude', aiLimiter, (req, res) => {
  req.body.provider = 'claude';
  aiController.generateDescription(req, res);
});

// For cost purposes, disabling this endpoint until demo time
// New endpoint for chatting with resource data
router.post(
  '/generate-resource-chat',
  requireUserAndTenants(),
  aiLimiter,
  aiController.generateResourceChat
);

// New endpoint for generating summaries
router.post(
  '/generate-summaries',
  requireUserAndTenants(),
  aiLimiter,
  aiController.generateSummaries
);

// Endpoint for processing multiple data types
router.post(
  '/process-items',
  requireUserAndTenants(),
  aiLimiter,
  aiController.processItems
);

// Add search endpoint
router.post(
  '/search',
  requireUserAndTenants(),
  aiLimiter,
  aiController.searchContent
);

// Add OCR endpoint
router.post(
  '/process-image',
  requireUserAndTenants(),
  aiLimiter,
  aiController.processImage
);

// New endpoint for generating structured notations
// router.post(
//   '/generate-structured-notations',
//   requireUserAndTenants(),
//   aiLimiter,
//   aiController.generateStructuredNotations
// );

// New endpoint for previewing structured notations (no DB save)
router.post(
  '/preview-structured-notations',
  requireUserAndTenants(),
  aiLimiter,
  aiController.previewStructuredNotations
);

// New endpoint for confirming and creating multiple notations
router.post(
  '/confirm-structured-notations',
  requireUserAndTenants(),
  aiController.confirmStructuredNotations
);

// New endpoint for previewing bulk notation updates (no DB save)
router.post(
  '/preview-bulk-notation-updates',
  requireUserAndTenants(),
  aiLimiter,
  aiController.previewBulkNotationUpdates
);

// New endpoint for confirming and applying bulk notation updates
router.post(
  '/confirm-bulk-notation-updates',
  requireUserAndTenants(),
  aiController.confirmBulkNotationUpdates
);

// New endpoint for previewing structured events (no DB save)
router.post(
  '/preview-structured-events',
  requireUserAndTenants(),
  aiLimiter,
  aiController.previewStructuredEvents
);

// New endpoint for confirming and creating multiple events
router.post(
  '/confirm-structured-events',
  requireUserAndTenants(),
  aiController.confirmStructuredEvents
);

// New endpoint for previewing structured resources (no DB save)
router.post(
  '/preview-structured-resources',
  requireUserAndTenants(),
  aiLimiter,
  aiController.previewStructuredResources
);

// New endpoint for confirming and creating multiple resources
router.post(
  '/confirm-structured-resources',
  requireUserAndTenants(),
  aiController.confirmStructuredResources
);

// New endpoint for previewing structured social media accounts (no DB save)
router.post(
  '/preview-structured-social-media',
  requireUserAndTenants(),
  aiLimiter,
  aiController.previewStructuredSocialMedia
);

// New endpoint for confirming and creating social media accounts
router.post(
  '/confirm-structured-social-media',
  requireUserAndTenants(),
  aiController.confirmStructuredSocialMedia
);

// New endpoint for previewing structured external links (no DB save)
router.post(
  '/preview-structured-external-links',
  requireUserAndTenants(),
  aiLimiter,
  aiController.previewStructuredExternalLinks
);

// New endpoint for confirming and creating external links
router.post(
  '/confirm-structured-external-links',
  requireUserAndTenants(),
  aiController.confirmStructuredExternalLinks
);

// New endpoints for structured opportunities generation
router.post(
  '/preview-structured-opportunities',
  requireUserAndTenants(),
  aiLimiter,
  opportunityAIController.previewStructuredOpportunities
);

router.post(
  '/confirm-structured-opportunities',
  requireUserAndTenants(),
  opportunityAIController.confirmStructuredOpportunities
);

export default router;
