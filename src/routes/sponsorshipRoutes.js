import express from 'express';
import { getSponsorTiersByEventId } from '../controllers/sponsorshipController.js';

const router = express.Router();

// router.get("/", sponsorshipController.getAllSponsorships);

router.get('/events/:id', getSponsorTiersByEventId);

// router.get("/organization/:id", sponsorshipController.getSponsorsByOrganizationId);

export default router;
