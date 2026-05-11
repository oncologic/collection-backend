// Middleware for validating external API access
export const validateExternalApiAccess = (req, res, next) => {
  try {
    // Get API key from headers
    const providedApiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    
    // Get allowed API keys from environment variables
    // You can have multiple keys separated by commas: KEY1,KEY2,KEY3
    const allowedApiKeys = process.env.EXTERNAL_API_KEYS?.split(',').map(key => key.trim()) || [];
    
    // Check if API key is required (only in production)
    if (process.env.NODE_ENV === 'production' && allowedApiKeys.length === 0) {
      console.error('No external API keys configured in environment variables');
      return res.status(500).json({ 
        error: 'Server configuration error',
        message: 'External API access is not properly configured' 
      });
    }

    // In development, optionally allow requests without API key
    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_EXTERNAL_WITHOUT_KEY === 'true') {
      return next();
    }

    // Validate API key
    if (!providedApiKey) {
      return res.status(401).json({ 
        error: 'API key required',
        message: 'Please provide an API key in the x-api-key header' 
      });
    }

    if (!allowedApiKeys.includes(providedApiKey)) {
      return res.status(401).json({ 
        error: 'Invalid API key',
        message: 'The provided API key is not authorized' 
      });
    }

    // Check allowed origins/domains
    const origin = req.headers.origin || req.headers.referer;
    const allowedOrigins = process.env.EXTERNAL_ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];
    
    if (allowedOrigins.length > 0 && !allowedOrigins.includes('*')) {
      if (!origin) {
        return res.status(403).json({ 
          error: 'Origin required',
          message: 'Request must include an origin header' 
        });
      }

      const isAllowedOrigin = allowedOrigins.some(allowed => {
        if (allowed === origin) return true;
        
        // Support wildcard subdomains (*.example.com)
        if (allowed.startsWith('*.')) {
          const baseDomain = allowed.slice(2);
          return origin.includes(baseDomain);
        }
        
        // Support partial matching for development
        if (process.env.NODE_ENV !== 'production') {
          return origin.includes(allowed) || allowed.includes(origin);
        }
        
        return false;
      });

      if (!isAllowedOrigin) {
        return res.status(403).json({ 
          error: 'Origin not allowed',
          message: `Origin ${origin} is not authorized to use this API` 
        });
      }
    }

    // Log the request for monitoring (without exposing the key)
    console.log('External API request:', {
      endpoint: req.originalUrl,
      method: req.method,
      origin: origin,
      ip: req.ip,
      timestamp: new Date().toISOString(),
      // Only log last 4 characters of API key for debugging
      keyIdentifier: `...${providedApiKey.slice(-4)}`,
    });

    // Add metadata to request
    req.externalApi = {
      authenticated: true,
      origin: origin,
      ip: req.ip,
    };

    next();
  } catch (error) {
    console.error('Error validating external API access:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      message: 'An error occurred while validating API access' 
    });
  }
};

// Middleware for CORS configuration for external APIs
export const configureExternalCors = (req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.EXTERNAL_ALLOWED_ORIGINS?.split(',').map(o => o.trim()) || [];
  
  // Also allow your frontend URL
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl && !allowedOrigins.includes(frontendUrl)) {
    allowedOrigins.push(frontendUrl);
  }
  
  // In development, also allow localhost origins
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000');
    allowedOrigins.push('http://localhost:5173');
    allowedOrigins.push('http://localhost:5174');
  }

  // Check if origin is allowed
  const isAllowedOrigin = origin && allowedOrigins.some(allowed => {
    // Exact match
    if (allowed === origin) return true;
    
    // Support wildcard subdomains (*.example.com)
    if (allowed.startsWith('*.')) {
      const baseDomain = allowed.slice(2);
      return origin.includes(baseDomain);
    }
    
    return false;
  });

  // Always set CORS headers for allowed origins or in development
  if (allowedOrigins.includes('*') || process.env.NODE_ENV !== 'production') {
    res.header('Access-Control-Allow-Origin', origin || '*');
  } else if (isAllowedOrigin) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  // Public endpoints should only allow GET and POST
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
};