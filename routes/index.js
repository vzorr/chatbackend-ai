// routes/index.js - Enhanced with SSL support
const express = require('express');
const router = express.Router();
const config = require('../config/config');

const { generateClientConfig } = require('../utils/client-sdk');

// ✅ BETTER: Direct import from exception handler
const { asyncHandler, createOperationalError, createSystemError } = require('../middleware/exceptionHandler');

// Helper function to get public URL with SSL awareness
const getPublicUrl = (req) => {
  // Use configured public URL if available
  if (config.app?.url) {
    return config.app.url;
  }
  
  // Build URL based on request
  const protocol = req.isSecure ? 'https' : 'http';
  const host = req.get('host');
  return `${protocol}://${host}`;
};

// Client SDK configuration endpoint with SSL context
router.get('/client-config', 
  asyncHandler(async (req, res) => {
    try {
      const config = generateClientConfig(req);
      
      if (!config) {
        throw createOperationalError('Failed to generate client configuration', 500, 'CONFIG_GENERATION_FAILED');
      }
      
      // Enhanced config with SSL context
      const enhancedConfig = {
        ...config,
        security: {
          secure: req.isSecure,
          protocol: req.protocol,
          requireHttps: process.env.NODE_ENV === 'production'
        },
        endpoints: {
          ...config.endpoints,
          // Ensure WebSocket URL uses correct protocol
          websocket: config.endpoints?.websocket?.replace(/^http/, req.isSecure ? 'https' : 'http')
        }
      };
      
      res.json({
        success: true,
        config: enhancedConfig
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to generate client configuration', error);
    }
  })
);

// Enhanced health check endpoint with SSL status
router.get('/health', 
  asyncHandler(async (req, res) => {
    const baseUrl = getPublicUrl(req);
    
    const healthCheck = {
      name: process.env.APP_NAME || 'VortexHive Chat Server',
      status: 'online',
      version: process.env.APP_VERSION || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      // Enhanced SSL/security status
      security: {
        secure: req.isSecure,
        protocol: req.protocol,
        ssl: {
          enabled: config.ssl?.enabled || false,
          behindProxy: config.security?.trustProxy || false,
          hsts: config.security?.ssl?.hsts?.enabled || false
        },
        headers: {
          forwardedProto: req.get('x-forwarded-proto'),
          realIp: req.get('x-real-ip'),
          forwardedFor: req.get('x-forwarded-for')
        }
      },
      // Enhanced features with SSL context
      features: {
        ...config.features,
        ssl: config.ssl?.enabled || config.security?.trustProxy,
        secureWebSockets: req.isSecure
      },
      // Service URLs with correct protocol
      health: `${baseUrl}/health`
    };

    // Basic service checks
    try {
      // Check if required environment variables are set
      const requiredEnvVars = ['JWT_SECRET'];
      if (config.server.nodeEnv === 'production') {
        requiredEnvVars.push('APP_URL', 'DOMAIN');
      }
      
      const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        healthCheck.status = 'WARNING';
        healthCheck.warnings = [`Missing environment variables: ${missingVars.join(', ')}`];
      }

      // SSL warnings for production
      if (config.server.nodeEnv === 'production' && !req.isSecure) {
        healthCheck.status = 'WARNING';
        healthCheck.warnings = healthCheck.warnings || [];
        healthCheck.warnings.push('Insecure connection detected in production environment');
      }

      res.json(healthCheck);
    } catch (error) {
      throw createSystemError('Health check failed', error);
    }
  })
);

// Enhanced API information endpoint
router.get('/info', 
  asyncHandler(async (req, res) => {
    const baseUrl = getPublicUrl(req);
    const wsProtocol = req.isSecure ? 'wss' : 'ws';
    
    const apiInfo = {
      name: 'VortexHive Chat API',
      version: process.env.APP_VERSION || '1.0.0',
      description: 'Real-time chat and messaging API with SSL support',
      environment: process.env.NODE_ENV || 'development',
      security: {
        secure: req.isSecure,
        requiresHttps: config.server.nodeEnv === 'production',
        corsOrigin: config.cors?.origin || config.server.corsOrigin
      },
      endpoints: {
        api: `${baseUrl}/api`,
        auth: `${baseUrl}/api/v1/auth`,
        users: `${baseUrl}/api/v1/users`,
        conversations: `${baseUrl}/api/v1/conversations`,
        messages: `${baseUrl}/api/v1/messages`,
        notifications: `${baseUrl}/api/v1/notifications`,
        websocket: `${wsProtocol}://${req.get('host')}${config.server.socketPath || '/socket.io'}`,
        health: `${baseUrl}/health`
      },
      documentation: `${baseUrl}/api-docs`,
      support: {
        email: process.env.SUPPORT_EMAIL || 'support@myusta.al',
        url: process.env.SUPPORT_URL || 'https://myusta.al/support'
      },
      rateLimit: {
        windowMs: config.rateLimiting?.windowMs || 60000,
        max: config.rateLimiting?.max || 100
      }
    };

    // Add admin endpoints if user is authenticated and authorized
    if (req.user?.role === 'administrator') {
      apiInfo.endpoints.admin = `${baseUrl}/api/v1/admin`;
    }

    res.json({
      success: true,
      info: apiInfo
    });
  })
);

// Import route modules
const authRoutes = require('./auth');
const userRoutes = require('./user');
const conversationRoutes = require('./conversation');
const messageRoutes = require('./message');
const notificationRoutes = require('./notification');
const adminRoutes = require('./admin');

// v1 API routes with error handling
router.use('/v1/auth', authRoutes);
router.use('/v1/users', userRoutes);
router.use('/v1/conversations', conversationRoutes);
router.use('/v1/messages', messageRoutes);
router.use('/v1/notifications', notificationRoutes);
router.use('/v1/admin', adminRoutes);

// Legacy support (no version prefix) - with deprecation notice and SSL warning
const addDeprecationHeaders = (req, res, next) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Deprecation-Info', 'Please use /v1/ versioned endpoints');
  
  // SSL warning for legacy endpoints in production
  if (config.server.nodeEnv === 'production' && !req.isSecure) {
    res.setHeader('X-Security-Warning', 'HTTPS required for production API access');
  }
  
  next();
};

router.use('/auth', addDeprecationHeaders, authRoutes);
router.use('/users', addDeprecationHeaders, userRoutes);
router.use('/conversations', addDeprecationHeaders, conversationRoutes);
router.use('/messages', addDeprecationHeaders, messageRoutes);
router.use('/notifications', addDeprecationHeaders, notificationRoutes);
router.use('/admin', addDeprecationHeaders, adminRoutes);

// Security endpoint for SSL/TLS information
router.get('/security', 
  asyncHandler(async (req, res) => {
    const securityInfo = {
      secure: req.isSecure,
      protocol: req.protocol,
      timestamp: new Date().toISOString(),
      ssl: {
        enabled: config.ssl?.enabled || false,
        behindProxy: config.security?.trustProxy || false,
        hsts: {
          enabled: config.security?.ssl?.hsts?.enabled || false,
          maxAge: config.security?.ssl?.hsts?.maxAge,
          includeSubDomains: config.security?.ssl?.hsts?.includeSubDomains
        }
      },
      headers: {
        host: req.get('host'),
        origin: req.get('origin'),
        userAgent: req.get('user-agent'),
        forwardedProto: req.get('x-forwarded-proto'),
        forwardedFor: req.get('x-forwarded-for'),
        realIp: req.get('x-real-ip')
      },
      recommendations: []
    };

    // Security recommendations
    if (!req.isSecure && config.server.nodeEnv === 'production') {
      securityInfo.recommendations.push('Use HTTPS for secure communication');
    }
    
    if (!req.get('origin')) {
      securityInfo.recommendations.push('Include Origin header for CORS validation');
    }

    res.json({
      success: true,
      security: securityInfo
    });
  })
);

// Catch-all route for undefined endpoints with SSL context
router.use('*', 
  asyncHandler(async (req, res) => {
    const error = createOperationalError(
      `Route ${req.method} ${req.originalUrl} not found`, 
      404, 
      'ROUTE_NOT_FOUND'
    );
    
    // Add SSL context to error
    error.context = {
      secure: req.isSecure,
      protocol: req.protocol,
      method: req.method,
      path: req.originalUrl
    };
    
    throw error;
  })
);

module.exports = router;