import express from 'express';
import { handleSponsorshipInquiry } from '../controllers/emailController.js';

const router = express.Router();

router.post('/sponsorship-inquiry', handleSponsorshipInquiry);

export default router;
