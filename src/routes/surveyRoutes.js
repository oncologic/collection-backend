import express from 'express';
import { surveyController } from '../controllers/surveyController.js';
import {
  requireUser,
  requireAdmin,
  requireUserAndTenants,
} from '../middleware/authMiddleware.js';

const router = express.Router();

// Get survey by id
router.get('/:id', requireUserAndTenants(), surveyController.getSurveyById);

router.get(
  '/:id/responses',
  requireAdmin(),
  surveyController.getResponsesBySurveyId
);

// Update survey
router.patch('/:id', requireUserAndTenants(), surveyController.updateSurvey);

//get all surveys
router.get('/', requireUserAndTenants(), surveyController.getAllSurveys);

router.post(
  '/:id/response',
  requireUser(),
  surveyController.createSurveyResponse
);

router.put(
  '/:id/response',
  requireUser(),
  surveyController.updateSurveyResponse
);

router.post('/', requireUserAndTenants(), surveyController.createSurvey);

router.delete('/:id', requireAdmin(), surveyController.deleteSurvey);

export default router;
