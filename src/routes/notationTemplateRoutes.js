import express from 'express';
import { 
  createNotationTemplate,
  getNotationTemplates,
  getNotationTemplate,
  updateNotationTemplate,
  deleteNotationTemplate,
  getPublicSubmissionTemplate,
  submitExternalNotation,
  getExternalSubmissions,
  reviewExternalSubmission,
  approveExternalSubmission,
  rejectExternalSubmission,
  bulkReviewSubmissions,
  getSubmissionStatistics,
} from '../controllers/notationTemplateController.js';
import { requireUserAndTenants } from '../middleware/authMiddleware.js';
import { validateExternalApiAccess, configureExternalCors } from '../middleware/externalApiMiddleware.js';

const router = express.Router();

// Protected routes - require authentication
router.post('/external-links/:externalLinkId/templates', requireUserAndTenants(), createNotationTemplate);
router.get('/external-links/:externalLinkId/templates', requireUserAndTenants(), getNotationTemplates);
router.get('/templates/:templateId', requireUserAndTenants(), getNotationTemplate);
router.put('/templates/:templateId', requireUserAndTenants(), updateNotationTemplate);
router.delete('/templates/:templateId', requireUserAndTenants(), deleteNotationTemplate);

// Submission review routes - require authentication
router.get('/external-links/:externalLinkId/submissions', requireUserAndTenants(), getExternalSubmissions);
router.get('/external-links/:externalLinkId/submissions/statistics', requireUserAndTenants(), getSubmissionStatistics);
router.put('/notations/:notationId/review', requireUserAndTenants(), reviewExternalSubmission);
router.post('/notation-submissions/:notationId/approve', requireUserAndTenants(), approveExternalSubmission);
router.post('/notation-submissions/:notationId/reject', requireUserAndTenants(), rejectExternalSubmission);
router.post('/submissions/bulk-review', requireUserAndTenants(), bulkReviewSubmissions);

// Public routes - for external submissions
// These routes support both browser-based access and API key access
router.get('/external-links/:externalLinkId/public-template', configureExternalCors, getPublicSubmissionTemplate);

// Handle OPTIONS preflight for submit-notation
router.options('/external-links/:externalLinkId/submit-notation', configureExternalCors);

// External API submission endpoint - uses origin-based validation for trusted domains
router.post('/external-links/:externalLinkId/submit-notation', 
  configureExternalCors,
  (req, res, next) => {
    // Skip validation for OPTIONS requests
    if (req.method === 'OPTIONS') {
      return next();
    }
    
    // Get origin from request
    const origin = req.headers.origin || req.headers.referer;
    
    // Define trusted origins that don't need API keys
    const trustedOrigins = [
      'http://localhost:3000',
      'http://localhost:5173', 
      'http://localhost:5174',
      'https://katiekickscancer.com',
      'https://www.katiekickscancer.com',
      process.env.FRONTEND_URL,
      ...(process.env.TRUSTED_ORIGINS?.split(',').map(o => o.trim()) || [])
    ].filter(Boolean);
    
    // Check if origin is trusted
    const isTrustedOrigin = trustedOrigins.some(allowed => {
      if (!origin) return false;
      
      // Exact match
      if (origin === allowed) return true;
      
      // Handle URLs with trailing slashes
      const normalizedOrigin = origin.replace(/\/$/, '');
      const normalizedAllowed = allowed.replace(/\/$/, '');
      return normalizedOrigin === normalizedAllowed;
    });
    
    // In development, allow all localhost origins
    if (process.env.NODE_ENV !== 'production' && origin && origin.includes('localhost')) {
      return next();
    }
    
    // If trusted origin, allow without API key
    if (isTrustedOrigin) {
      console.log('Trusted origin access:', {
        origin,
        endpoint: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString()
      });
      return next();
    }
    
    // For non-trusted origins, require API key
    console.log('Untrusted origin, checking API key:', origin);
    return validateExternalApiAccess(req, res, next);
  },
  submitExternalNotation
);

export default router;