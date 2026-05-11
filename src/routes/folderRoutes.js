import express from 'express';

import { collectionController } from '../controllers/collectionController.js';
import { requireUserAndTenants } from '../middleware/authMiddleware.js';
const router = express.Router();

router.post('/', requireUserAndTenants(), collectionController.createFolder);
router.get('/', requireUserAndTenants(), collectionController.getAllFolders);
router.delete(
  '/:id',
  requireUserAndTenants(),
  collectionController.deleteFolder
);
router.post(
  '/:id/collections',
  requireUserAndTenants(),
  collectionController.addCollectionToFolder
);
router.delete(
  '/:id/collections/:collectionId',
  requireUserAndTenants(),
  collectionController.removeCollectionFromFolder
);

export default router;
