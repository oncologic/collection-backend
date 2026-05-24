import rateLimit from 'express-rate-limit';
import { rateLimitConfig } from '../config/rateLimiting.js';

// Rate limiter for public endpoints - high limits for production
export const publicApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50000, // High limit - users navigating many pages with multiple requests each
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip successful requests to only count errors
  skipSuccessfulRequests: false,
  // Key generator to identify unique clients
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

// More restrictive rate limiter for public endpoints if needed - high limits for production
export const strictPublicApiRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10000, // High limit for active users
  message: {
    error: 'Rate limit exceeded',
    message: 'Too many requests. Please wait before making more requests.',
    retryAfter: '5 minutes',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for resource suggestions - reasonable limit for active users
export const resourceSuggestionRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // Generous limit for users making many suggestions
  message: {
    error: 'Too many resource suggestions',
    message:
      'You have submitted too many resource suggestions. Please try again later.',
    retryAfter: '1 hour',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip || req.connection.remoteAddress;
  },
});

// Rate limiting middleware for high-frequency operations
const requestCounts = new Map();
const { general, dragDrop, cleanup } = rateLimitConfig.rateLimit;

// Cleanup old entries
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  const sizeBefore = requestCounts.size;
  for (const [key, data] of requestCounts.entries()) {
    if (now - data.windowStart > general.windowMs) {
      requestCounts.delete(key);
    }
  }
  const sizeAfter = requestCounts.size;
  if (sizeBefore !== sizeAfter) {
    console.log(
      `[RateLimit] Cleaned up ${sizeBefore - sizeAfter} expired entries. Active: ${sizeAfter}`
    );
  }
}, cleanup.interval);
cleanupInterval.unref?.();

export const rateLimitByUser = (
  maxRequests = general.maxRequests,
  windowMs = general.windowMs,
  label = 'API'
) => {
  return (req, res, next) => {
    const userId = req.auth?.dbUserId;

    if (!userId) {
      return next(); // Skip rate limiting if no user ID
    }

    const now = Date.now();
    const key = `${userId}-${label}`;

    let userRequests = requestCounts.get(key);

    if (!userRequests || now - userRequests.windowStart > windowMs) {
      // Reset window
      userRequests = {
        count: 1,
        windowStart: now,
      };
    } else {
      userRequests.count++;
    }

    requestCounts.set(key, userRequests);

    if (userRequests.count > maxRequests) {
      console.warn(
        `[RateLimit] User ${userId} exceeded ${label} rate limit: ${userRequests.count}/${maxRequests} requests`
      );
      return res.status(429).json({
        error: 'Too many requests',
        message: `Rate limit exceeded for ${label}. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
        retryAfter: Math.ceil(
          (userRequests.windowStart + windowMs - now) / 1000
        ),
      });
    }

    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': Math.max(0, maxRequests - userRequests.count),
      'X-RateLimit-Reset': new Date(
        userRequests.windowStart + windowMs
      ).toISOString(),
      'X-RateLimit-Type': label,
    });

    // Log if approaching limit
    if (userRequests.count > maxRequests * 0.8) {
      console.log(
        `[RateLimit] User ${userId} approaching ${label} limit: ${userRequests.count}/${maxRequests} requests`
      );
    }

    next();
  };
};

// Specific rate limiter for drag-and-drop operations
export const dragDropRateLimit = rateLimitByUser(
  dragDrop.maxRequests,
  dragDrop.windowMs,
  'DragDrop'
);

// General API rate limiter
export const generalRateLimit = rateLimitByUser(
  general.maxRequests,
  general.windowMs,
  'General'
);
