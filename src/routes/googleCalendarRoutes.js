import express from 'express';
import { googleCalendarController } from '../controllers/googleCalendarControllerV2.js';
import { requireUser } from '../middleware/authMiddleware.js';

const router = express.Router();

// OAuth flow
router.get('/auth', requireUser(), googleCalendarController.initiateAuth);
router.get('/callback', googleCalendarController.handleCallback); // No auth required for callback

// Integration management
router.get(
  '/status',
  requireUser(),
  googleCalendarController.getIntegrationStatus
);
router.get('/calendars', requireUser(), googleCalendarController.listCalendars);
router.put(
  '/settings',
  requireUser(),
  googleCalendarController.updateSyncSettings
);
router.post('/disconnect', requireUser(), googleCalendarController.disconnect);

// Export operations (one-way: platform -> Google Calendar)
router.post(
  '/export/:entityType/:entityId',
  requireUser(),
  googleCalendarController.exportEntity
);
router.get(
  '/calendar-items',
  requireUser(),
  googleCalendarController.getCalendarItems
);
router.get(
  '/sync-history',
  requireUser(),
  googleCalendarController.getSyncHistory
);

export default router;
