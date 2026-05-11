// Rate limiting configuration
export const rateLimitConfig = {
  // User authentication caching
  userCache: {
    ttl: 5 * 60 * 1000, // 5 minutes
    maxSize: 1000,
    cleanupInterval: 5 * 60 * 1000, // 5 minutes
  },

  // Request debouncing
  debouncing: {
    orderUpdates: 300, // 300ms delay for order updates
    typeUpdates: 300, // 300ms delay for type updates
  },

  // Rate limiting - high limits for production use
  rateLimit: {
    general: {
      maxRequests: 100000, // Very high - authenticated users shouldn't hit limits
      windowMs: 60 * 1000, // 1 minute
    },
    dragDrop: {
      maxRequests: 5000, // High limit for active drag/drop operations
      windowMs: 30 * 1000, // 30 seconds
    },
    cleanup: {
      interval: 5 * 60 * 1000, // 5 minutes
    },
  },

  // Clerk API optimizations
  clerk: {
    // Add any Clerk-specific rate limiting configs here if needed
    retryAttempts: 3,
    retryDelay: 1000, // 1 second
  },
};

export default rateLimitConfig;
