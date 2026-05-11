import express from 'express';
import {
  getAllStarterPacks,
  getStarterPackById,
  createStarterPack,
  updateStarterPack,
  deleteStarterPack,
} from '../controllers/starterPackController.js';
import { requireUser } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', requireUser(), getAllStarterPacks);
router.get('/:id', requireUser(), getStarterPackById);
router.post('/', requireUser(), createStarterPack);
router.patch('/:id', requireUser(), updateStarterPack);
router.delete('/:id', requireUser(), deleteStarterPack);

export default router;
