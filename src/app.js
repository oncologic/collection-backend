import dotenv from 'dotenv';
// Load from .env.local file instead of default .env
dotenv.config({ path: '.env.local' });

import express from 'express';
import cors from 'cors';
import multer from 'multer';

import organizationRoutes from './routes/organizationRoutes.js';
import tagRoutes from './routes/tagRoutes.js';
import metadataRoutes from './routes/metadataRoutes.js';
import resourceRoutes from './routes/resourceRoutes.js';
import surveyRoutes from './routes/surveyRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import userRoutes from './routes/userRoutes.js';
import collectionRoutes from './routes/collectionRoutes.js';
import { clerkMiddleware, requireAuth } from '@clerk/express';
import { createClerkClient } from '@clerk/backend';
import sponsorshipRoutes from './routes/sponsorshipRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import attachmentRoutes from './routes/attachmentRoutes.js';
import sharedLinkRoutes from './routes/sharedLinksRoutes.js';
import folderRoutes from './routes/folderRoutes.js';
import starterPackRoutes from './routes/starterPackRoutes.js';
import creditRoutes from './routes/creditRoutes.js';
import pinnedRoutes from './routes/pinnedRoutes.js';
import socialMediaRoutes from './routes/socialMediaRoutes.js';
import socialMediaAccountTypesRoutes from './routes/socialMediaAccountTypesRoutes.js';
import clinicalTrialsRoutes from './routes/clinicalTrialsRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import invitationRoutes from './routes/invitationRoutes.js';
import publicShareRoutes from './routes/publicShareRoutes.js';
import collectionExternalLinkTagRoutes from './routes/collectionExternalLinkTags.js';
import systemRoutes from './routes/systemRoutes.js';
import webhookRoutes from './routes/webhookRoutes.js';
import googleCalendarRoutes from './routes/googleCalendarRoutes.js';
import { collectionExternalLinkResourceRoutes } from './routes/collectionExternalLinkResourceRoutes.js';
import importRoutes from './routes/importRoutes.js';
import smsRoutes from './routes/smsRoutes.js';
import notationTemplateRoutes from './routes/notationTemplateRoutes.js';
import notationAttachmentRoutes from './routes/notationAttachmentRoutes.js';
import notationRoutes from './routes/notationRoutes.js';
import directMetadataRoutes from './routes/directMetadataRoutes.js';
import slackRoutes from './routes/slackRoutes.js';
import tenantInviteRoutes from './routes/tenantInviteRoutes.js';
import tenantRoutes from './routes/tenantRoutes.js';
import opportunityRoutes from './routes/opportunityRoutes.js';

const app = express();

// Add this line after creating the Express app
app.set('trust proxy', 1);

// Configure CORS to allow multiple origins
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  ...(process.env.EXTERNAL_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) ||
    []),
].filter(Boolean);

// Normalize origins to handle protocol variations
const normalizeOrigin = (origin) => {
  if (!origin) return null;
  // Remove protocol if present
  const withoutProtocol = origin.replace(/^https?:\/\//, '');
  // Remove trailing slash
  return withoutProtocol.replace(/\/$/, '');
};

const isLocalHost = (hostname) => {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  );
};

const expandOriginVariants = (origin) => {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return [];

  try {
    const parsedUrl = new URL(
      origin.includes('://') ? origin : `https://${normalizedOrigin}`
    );
    const hostnames = new Set([parsedUrl.hostname]);

    // Treat apex and www hostnames as equivalent for the main frontend domains.
    if (!isLocalHost(parsedUrl.hostname)) {
      if (parsedUrl.hostname.startsWith('www.')) {
        hostnames.add(parsedUrl.hostname.slice(4));
      } else {
        hostnames.add(`www.${parsedUrl.hostname}`);
      }
    }

    return Array.from(hostnames).map((hostname) =>
      parsedUrl.port ? `${hostname}:${parsedUrl.port}` : hostname
    );
  } catch {
    return [normalizedOrigin];
  }
};

// Create normalized allowed origins set for quick lookup
const normalizedAllowedOrigins = new Set(
  allowedOrigins.flatMap((origin) => expandOriginVariants(origin))
);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);

      // Normalize the incoming origin
      const normalizedOrigin = normalizeOrigin(origin);

      // Check if the normalized origin matches any allowed origin
      if (normalizedAllowedOrigins.has(normalizedOrigin)) {
        callback(null, true);
      } else if (
        process.env.NODE_ENV !== 'production' &&
        origin &&
        origin.includes('localhost')
      ) {
        // In development, allow all localhost origins
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-api-key',
      'x-tenant-ids',
      'x-clerk-user-id',
      'Accept',
      'Origin',
      'X-Requested-With',
    ],
    exposedHeaders: ['Content-Range', 'X-Total-Count'],
    maxAge: 86400, // 24 hours
  })
);

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Add this BEFORE your regular express.json() middleware
app.use('/api/credits/webhook', express.raw({ type: 'application/json' }));

// Your regular middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add timeout middleware for upload routes
app.use('/api/attachments', (req, res, next) => {
  // Set a longer timeout for attachment uploads (5 minutes)
  req.setTimeout(300000); // 5 minutes
  res.setTimeout(300000); // 5 minutes
  next();
});

//Clerk middleware - adds `req.auth` to every request
app.use(clerkMiddleware());

// Direct metadata routes (for frontend compatibility)
app.use('/api', directMetadataRoutes);

app.use('/api/organizations', organizationRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/metadata', metadataRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/surveys', surveyRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/users', userRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/opportunities', opportunityRoutes);
app.use('/api/sponsorships', sponsorshipRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/attachments', attachmentRoutes);
app.use('/api/shared-links', sharedLinkRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/starter-packs', starterPackRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/pinned', pinnedRoutes);
app.use('/api/social-media', socialMediaRoutes);
app.use('/api/social-media/account-types', socialMediaAccountTypesRoutes);
app.use('/api/clinical-trials', clinicalTrialsRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/public', publicShareRoutes);
app.use('/api/collection-external-link-tags', collectionExternalLinkTagRoutes);
app.use('/api', collectionExternalLinkResourceRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/google-calendar', googleCalendarRoutes);
app.use('/api/import', importRoutes);
app.use('/api/sms', smsRoutes);
app.use('/api/notation-templates', notationTemplateRoutes);
app.use('/api', notationAttachmentRoutes);
app.use('/api', notationRoutes);
app.use('/api/slack', slackRoutes);
app.use('/api/tenant-invites', tenantInviteRoutes);
app.use('/api/tenants', tenantRoutes);

app.use((err, req, res, next) => {
  if (err.message === 'Unauthenticated') {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Handle other errors
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Move this BEFORE the error handler
// Import and initialize cron service
import cronService from './services/cronService.js';

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Initialize cron jobs
  cronService.init();
});
