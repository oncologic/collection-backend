import express from 'express';
import {
  fetchClinicalTrials,
  searchClinicalTrials,
  searchClinicalTrialsFullStudies,
  getTrialsByIds,
} from '../controllers/clinicalTrialsController.js';

const router = express.Router();

// Route to proxy requests to clinicaltrials.gov API
router.get('/', fetchClinicalTrials);

// Route to search clinical trials with specific parameters
router.get('/search', searchClinicalTrials);

// Route to search clinical trials using the full_studies endpoint
router.get('/full-studies', searchClinicalTrialsFullStudies);

// Route to get specific trials by NCT IDs for chat integration
router.post('/by-ids', getTrialsByIds);

export default router;
