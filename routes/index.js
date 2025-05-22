// routes/index.js - CLEAN APPROACH
const express = require('express');
const router = express.Router();

const { generateClientConfig } = require('../utils/client-sdk');

// ✅ BETTER: Direct import from exception handler
const { asyncHandler, createOperationalError, createSystemError } = require('../middleware/exceptionHandler');

// Client SDK configuration endpoint
router.get('/client-config', 
  asyncHandler(async (req, res) => {
    try {
      const config = generateClientConfig(req);
      
      if (!config) {
        throw createOperationalError('Failed to generate client configuration', 500, 'CONFIG_GENERATION_FAILED');
      }
      
      res.json({
        success: true,
        config
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to generate client configuration', error);
    }
  })
);

// Health check endpoint
router.get('/health', 
  asyncHandler(async (req, res) => {
    const healthCheck = {
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.APP_VERSION || '1.0.0'
    };

    // Basic service checks
    try {
      // Check if required environment variables are set
      const requiredEnvVars = ['JWT_SECRET', 'DATABASE_URL'];
      const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        healthCheck.status = 'WARNING';
        healthCheck.warnings = [`Missing environment variables: ${missingVars.join(', ')}`];
      }

      res.json({
        success: true,
        health: healthCheck
      });
    } catch (error) {
      throw createSystemError('Health check failed', error);
    }
  })
);

// API information endpoint
router.get('/info', 
  asyncHandler(async (req, res) => {
    const apiInfo = {
      name: 'Chat API',
      version: process.env.APP_VERSION || '1.0.0',
      description: 'Real-time chat and messaging API',
      environment: process.env.NODE_ENV || 'development',
      endpoints: {
        auth: '/api/v1/auth',
        users: '/api/v1/users',
        conversations: '/api/v1/conversations',
        messages: '/api/v1/messages',
        notifications: '/api/v1/notifications'
      },
      documentation: '/api/docs',
      support: {
        email: process.env.SUPPORT_EMAIL || 'support@example.com',
        url: process.env.SUPPORT_URL || 'https://example.com/support'
      }
    };

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

// v1 API routes with error handling
router.use('/v1/auth', authRoutes);
router.use('/v1/users', userRoutes);
router.use('/v1/conversations', conversationRoutes);
router.use('/v1/messages', messageRoutes);
router.use('/v1/notifications', notificationRoutes);

// Legacy support (no version prefix) - with deprecation notice
router.use('/auth', (req, res, next) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Deprecation-Info', 'Please use /v1/auth instead');
  next();
}, authRoutes);

router.use('/users', (req, res, next) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Deprecation-Info', 'Please use /v1/users instead');
  next();
}, userRoutes);

router.use('/conversations', (req, res, next) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Deprecation-Info', 'Please use /v1/conversations instead');
  next();
}, conversationRoutes);

router.use('/messages', (req, res, next) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Deprecation-Info', 'Please use /v1/messages instead');
  next();
}, messageRoutes);

router.use('/notifications', (req, res, next) => {
  res.setHeader('X-API-Deprecated', 'true');
  res.setHeader('X-API-Deprecation-Info', 'Please use /v1/notifications instead');
  next();
}, notificationRoutes);

// Catch-all route for undefined endpoints
router.use('*', 
  asyncHandler(async (req, res) => {
    throw createOperationalError(
      `Route ${req.method} ${req.originalUrl} not found`, 
      404, 
      'ROUTE_NOT_FOUND'
    );
  })
);

module.exports = router;