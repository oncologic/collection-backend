import express from 'express';
import multer from 'multer';
import { requireUser } from '../middleware/authMiddleware.js';
import {
  previewImport,
  executeImport,
  updateImportData,
  parseTSVFile,
  backfillResourceEmbeddings,
  getResourceEmbeddingBackfillStatus,
  getResourceDuplicates,
  deleteResourceDuplicates,
} from '../controllers/tsvImportController.js';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// All import routes require authentication
router.use(requireUser());

// Parse TSV file and preview data
router.post('/parse', upload.single('file'), parseTSVFile);

// Preview import data from TSV content
router.post('/preview', previewImport);

// Update/edit import data
router.put('/update', updateImportData);

// Execute the final import
router.post('/execute', executeImport);

// Scan and clean up duplicate resources by title for a tenant
router.get('/resource-duplicates', getResourceDuplicates);
router.delete('/resource-duplicates', deleteResourceDuplicates);

// Queue resource embedding backfill for the selected tenant
router.post('/resource-embeddings/backfill', backfillResourceEmbeddings);
router.get('/resource-embeddings/status', getResourceEmbeddingBackfillStatus);

export default router;
