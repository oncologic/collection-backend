import express from 'express';
import upload from '../middleware/upload.js';

import { eventController } from '../controllers/eventController.js';
import {
  requireAdmin,
  requireUser,
  requireUserAndTenants,
  optionalAuthAndTenants,
} from '../middleware/authMiddleware.js';
import { publicApiRateLimit } from '../middleware/rateLimitMiddleware.js';

const router = express.Router();

router.post('/', requireUserAndTenants(), eventController.createEvent);
router.post('/bulk', requireUserAndTenants(), eventController.bulkCreateEvents);
// Public routes for events - allow public access if tenant allows it
router.get(
  '/',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  eventController.getAllEvents
);
router.get(
  '/paginated',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  eventController.getAllEventsPaginated
);
router.get(
  '/search',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  eventController.searchEvents
);
router.get(
  '/subscriptions',
  requireUserAndTenants(),
  eventController.getEventsBySubscriptions
);
router.get('/organization/:id', eventController.getEventsByOrganizationId);
router.get(
  '/:id',
  publicApiRateLimit,
  optionalAuthAndTenants(),
  eventController.getEventById
);
router.patch('/:id', requireUserAndTenants(), eventController.updateEvent);
router.delete('/:id', requireUserAndTenants(), eventController.deleteEvent);

export default router;
