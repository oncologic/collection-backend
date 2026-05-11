import express from 'express';
import { metadataController } from '../controllers/metadataController.js';
import { optionalAuthAndTenants } from '../middleware/authMiddleware.js';
import { publicApiRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

// Direct metadata routes (without /metadata prefix) for frontend compatibility
// These routes will be mounted directly under /api

router.get(
  '/resource-types',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  metadataController.getAllResourceTypes
);

router.get(
  '/sensitivity-levels',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  metadataController.getAllSensitivityLevels
);

router.get(
  '/expertise-levels',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  metadataController.getAllExpertiseLevels
);

export default router;