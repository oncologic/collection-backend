import express from 'express';
import {
  getAllTags,
  createTag,
  updateTag,
  deleteTag,
} from '../controllers/tagController.js';
import { requireUserAndTenants, optionalAuthAndTenants } from '../middleware/authMiddleware.js';
import { publicApiRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

router.get('/', publicApiRateLimit, optionalAuthAndTenants(), getAllTags);
router.post('/', requireUserAndTenants(), createTag);
router.put('/:id', requireUserAndTenants(), updateTag);
router.delete('/:id', requireUserAndTenants(), deleteTag);

export default router;
