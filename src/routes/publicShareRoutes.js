import express from 'express';
import { publicShareController } from '../controllers/publicShareController.js';
import { publicApiRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// CORS middleware for public routes - allows any origin
const publicCorsMiddleware = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.header('X-Robots-Tag', 'noindex, nofollow, noarchive');

  // Handle preflight OPTIONS requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
};

// Apply CORS middleware to all public routes
router.use(publicCorsMiddleware);

// Apply rate limiting to all public routes
router.use(publicApiRateLimit);

// Health check endpoint
router.get('/health', publicShareController.healthCheck);

// Public collection endpoint - no auth required
router.get(
  '/collection/:collectionId',
  publicShareController.getPublicCollection
);

// Public external link endpoint - no auth required
router.get(
  '/external-link/:externalLinkId',
  publicShareController.getPublicExternalLink
);

export default router;
