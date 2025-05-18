// routes/auth.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db/models');  // Import the db module
const { Op } = require('sequelize');
const { validateUUID } = require('../utils/validation');
const logger = require('../utils/logger');
const authMiddleware = require('../middleware/authentication');
const exceptionHandler = require('../middleware/exceptionHandler');
const userSyncService = require('../services/sync/userSyncService');
const notificationManager = require('../services/notifications/notificationManager');

// Debug route to verify router is working
router.get('/test', (req, res) => {
  logger.info('Test route hit: /api/v1/auth/test');
  res.json({ 
    success: true, 
    message: 'Auth routes are working', 
    path: req.path,
    baseUrl: req.baseUrl,
    originalUrl: req.originalUrl,
    route: req.route.path
  });
});

// Debug endpoint to check authentication
router.get('/debug-auth', (req, res) => {
  res.json({
    success: true,
    headers: {
      authorization: req.headers.authorization ? 'Present (redacted)' : 'Missing',
      contentType: req.headers['content-type']
    },
    body: req.body ? 'Present' : 'Missing',
    user: req.user ? {
      hasId: !!req.user.id,
      id: req.user.id || 'missing',
      role: req.user.role || 'missing'
    } : 'No user in request'
  });
});

// Debug endpoint that requires authentication
router.get('/debug-auth-protected',
  authMiddleware.authenticate.bind(authMiddleware),
  (req, res) => {
    res.json({
      success: true,
      authenticated: true,
      user: req.user ? {
        id: req.user.id || 'missing',
        role: req.user.role || 'missing',
        name: req.user.name || 'missing'
      } : 'No user in request',
      authenticationWorked: !!req.user
    });
  }
);

// Debug token endpoint
router.get('/debug-token', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(400).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({
      success: true,
      decoded: {
        ...decoded,
        iat: new Date(decoded.iat * 1000).toISOString(),
        exp: new Date(decoded.exp * 1000).toISOString()
      },
      possibleIdFields: {
        id: decoded.id || 'missing',
        userId: decoded.userId || 'missing',
        sub: decoded.sub || 'missing'
      }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route POST /api/v1/auth/sync
 * @desc Sync user from main application
 * @access Service-to-Service (API Key)
 */
router.post('/sync', 
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/sync', {
      method: req.method,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      headers: Object.keys(req.headers)
    });
    next();
  },
  authMiddleware.authenticateApiKey.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
    logger.info('API Key authentication passed for /sync route');
    const { userData, authToken, signature } = req.body;
    
    // Validate request signature
    userSyncService.validateSyncRequest(userData, signature);
    
    // Perform sync
    const result = await userSyncService.syncUserFromMainApp(userData, authToken);
    
    // Log audit
    logger.audit('user_sync', {
      userId: result.user.id,
      externalId: result.user.externalId,
      source: 'main_app',
      ip: req.ip
    });
    
    res.json(result);
  })
);

/**
 * @route POST /api/v1/auth/batch-sync
 * @desc Batch sync multiple users
 * @access Service-to-Service (API Key)
 */
router.post('/batch-sync',
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/batch-sync', {
      method: req.method,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl
    });
    next();
  },
  authMiddleware.authenticateApiKey.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
    logger.info('API Key authentication passed for /batch-sync route');
    const { users, authToken } = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Users array is required'
        }
      });
    }
    
    const result = await userSyncService.batchSyncUsers(users, authToken);
    
    logger.audit('batch_user_sync', {
      count: users.length,
      successful: result.summary.successful,
      failed: result.summary.failed,
      ip: req.ip
    });
    
    res.json(result);
  })
);

/**
 * @route POST /api/v1/auth/register-device
 * @desc Register or update device token
 * @access Private
 */
router.post('/register-device', 
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/register-device', {
      method: req.method,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      headers: Object.keys(req.headers),
      body: Object.keys(req.body),
      hasAuth: !!req.headers.authorization
    });
    next();
  },
  // Use a direct middleware function for authentication
  async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        logger.warn('No token provided in authentication middleware');
        return res.status(401).json({
          success: false, 
          error: { 
            code: 'NO_TOKEN',
            message: 'Authentication token required'
          }
        });
      }
      
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      logger.info('Token verified', { 
        hasId: !!decoded.id,
        hasUserId: !!decoded.userId,
        hasSub: !!decoded.sub,
        tokenData: JSON.stringify(decoded)
      });
      
      // Get user ID from token
      const userId = decoded.id || decoded.userId || decoded.sub;
      if (!userId) {
        logger.error('No user ID found in token');
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'No user ID in token'
          }
        });
      }
      
      // Try to find user by ID first
      let user = null;
      try {
        if (db.User) {
          user = await db.User.findOne({ 
            where: { id: userId }
          });
          
          if (!user && decoded.externalId) {
            // Try by externalId if available
            user = await db.User.findOne({
              where: { externalId: decoded.externalId }
            });
          }
        } else {
          logger.error('User model not found in db');
        }
      } catch (dbError) {
        logger.error('Error finding user', {
          error: dbError.message,
          userId,
          externalId: decoded.externalId
        });
      }
      
      if (!user) {
        logger.warn('User not found in database', {
          userId,
          externalId: decoded.externalId
        });
        return res.status(401).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }
      
      // Set user in request
      req.user = user;
      req.token = token;
      req.decodedToken = decoded;
      
      logger.info('User authenticated', {
        hasUser: !!req.user,
        userId: req.user.id,
        userRole: req.user.role
      });
      next();
    } catch (error) {
      logger.error('Authentication error', {
        error: error.message,
        stack: error.stack
      });
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Authentication failed: ' + error.message
        }
      });
    }
  },
  (req, res, next) => {
    logger.info('Authentication passed for /register-device route', {
      userId: req.user?.id,
      userRole: req.user?.role,
      hasUser: !!req.user
    });
    next();
  },
  exceptionHandler.asyncHandler(async (req, res) => {
    // Safety check
    if (!req.user || !req.user.id) {
      logger.error('User missing in request after authentication', {
        hasUser: !!req.user
      });
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_FAILURE',
          message: 'User authentication failed'
        }
      });
    }

    const { 
      token, 
      deviceId,
      deviceType = 'mobile', 
      platform,
      deviceModel,
      deviceOS,
      appVersion 
    } = req.body;
    
    // Request validation
    if (!token || !deviceId) {
      logger.warn('Missing required fields in register-device request', {
        hasToken: !!token,
        hasDeviceId: !!deviceId
      });
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Token and deviceId are required'
        }
      });
    }
    
    const userId = req.user.id;
    
    logger.info('Processing register-device request', {
      userId,
      hasToken: !!token,
      hasDeviceId: !!deviceId,
      deviceType,
      platform
    });
    
    // Ensure db is initialized
    try {
      if (typeof db.initialize === 'function') {
        await db.initialize();
      }
      
      logger.info('Database models status', {
        hasDeviceToken: !!db.DeviceToken,
        hasTokenHistory: !!db.TokenHistory,
        hasUser: !!db.User,
        availableModels: Object.keys(db).filter(k => 
          k !== 'initialize' && k !== 'getDbInstance' && k !== 'sync'
        )
      });
      
      // Check for existing token
      let deviceToken = null;
      
      try {
        deviceToken = await db.DeviceToken.findOne({
          where: { deviceId, userId }
        });
      } catch (findError) {
        logger.error('Error finding device token', {
          error: findError.message,
          stack: findError.stack,
          userId,
          deviceId
        });
      }
      
      let action = 'REGISTERED';
      let previousToken = null;
      
      if (deviceToken) {
        logger.info('Found existing device token', {
          userId,
          deviceId,
          tokenId: deviceToken.id
        });
        
        // Token renewal
        if (deviceToken.token !== token) {
          previousToken = deviceToken.token;
          action = 'RENEWED';
          logger.info('Renewing device token', {
            userId,
            deviceId,
            oldToken: previousToken.substring(0, 10) + '...',
            newToken: token.substring(0, 10) + '...'
          });
        }
        
        await deviceToken.update({
          token,
          platform,
          lastUsed: new Date(),
          active: true
        });
        
        logger.info('Updated existing device token', {
          userId,
          deviceId,
          action
        });
      } else {
        // New token registration
        try {
          deviceToken = await db.DeviceToken.create({
            id: uuidv4(),
            userId,
            token,
            deviceType,
            platform,
            deviceId,
            lastUsed: new Date(),
            active: true
          });
          
          logger.info('Created new device token', {
            userId,
            deviceId,
            tokenId: deviceToken.id
          });
        } catch (createError) {
          logger.error('Error creating device token', {
            error: createError.message,
            stack: createError.stack,
            userId,
            deviceId
          });
          throw createError;
        }
      }
      
      // Log token history
      try {
        await db.TokenHistory.create({
          userId,
          token,
          tokenType: platform === 'ios' ? 'APN' : 'FCM',
          deviceId,
          deviceModel,
          deviceOS,
          appVersion,
          action,
          previousToken,
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          metadata: {
            source: 'api',
            authenticated: true
          }
        });
        
        logger.info('Created token history record', {
          userId,
          deviceId,
          action
        });
      } catch (historyError) {
        logger.error('Error creating token history', {
          userId,
          deviceId,
          error: historyError.message,
          stack: historyError.stack
        });
        // Continue despite history error
      }
      
      // Validate token with provider
      try {
        if (notificationManager && notificationManager.sendToDevice) {
          await notificationManager.sendToDevice(deviceToken, {
            type: 'test',
            title: 'Device Registered',
            body: 'Your device has been registered for notifications'
          });
          
          logger.info('Test notification sent successfully', {
            userId,
            deviceId
          });
        } else {
          logger.warn('Notification manager not available', {
            hasManager: !!notificationManager,
            hasSendMethod: notificationManager && !!notificationManager.sendToDevice
          });
        }
      } catch (notificationError) {
        logger.warn('Token validation failed', {
          userId,
          deviceId,
          error: notificationError.message,
          stack: notificationError.stack
        });
        // Continue despite notification error
      }
      
      logger.info('Device token registration completed successfully', {
        userId,
        deviceId,
        action,
        platform
      });
      
      res.json({
        success: true,
        action,
        tokenId: deviceToken.id
      });
    } catch (error) {
      logger.error('Error in device registration process', {
        error: error.message,
        stack: error.stack,
        userId
      });
      
      res.status(500).json({
        success: false,
        error: {
          code: 'REGISTRATION_FAILED',
          message: 'Failed to register device token'
        }
      });
    }
  })
);

/**
 * @route DELETE /api/v1/auth/device/:deviceId
 * @desc Remove device token
 * @access Private
 */
router.delete('/device/:deviceId',
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/device/:deviceId', {
      method: req.method,
      path: req.path,
      deviceId: req.params.deviceId,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl
    });
    next();
  },
  authMiddleware.authenticate.bind(authMiddleware),
  (req, res, next) => {
    logger.info('Authentication passed for /device/:deviceId route', {
      userId: req.user?.id,
      deviceId: req.params.deviceId
    });
    next();
  },
  exceptionHandler.asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const userId = req.user.id;
    
    const deviceToken = await db.DeviceToken.findOne({
      where: { deviceId, userId }
    });
    
    if (!deviceToken) {
      logger.warn('Device not found', {
        userId,
        deviceId
      });
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found'
        }
      });
    }
    
    // Mark as inactive instead of deleting
    await deviceToken.update({ active: false });
    
    // Log revocation
    if (db.TokenHistory.logTokenRevocation) {
      await db.TokenHistory.logTokenRevocation({
        userId,
        token: deviceToken.token,
        tokenType: deviceToken.platform === 'ios' ? 'APN' : 'FCM',
        reason: 'user_request',
        revokedBy: userId
      });
    } else {
      await db.TokenHistory.create({
        userId,
        token: deviceToken.token,
        tokenType: deviceToken.platform === 'ios' ? 'APN' : 'FCM',
        deviceId,
        action: 'REVOKED',
        metadata: {
          reason: 'user_request',
          revokedBy: userId
        }
      });
    }
    
    logger.info('Device token revoked', {
      userId,
      deviceId
    });
    
    res.json({
      success: true,
      message: 'Device token revoked'
    });
  })
);

/**
 * @route GET /api/v1/auth/devices
 * @desc Get user's registered devices
 * @access Private
 */
router.get('/devices',
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/devices', {
      method: req.method,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl
    });
    next();
  },
  authMiddleware.authenticate.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    const devices = await db.DeviceToken.findAll({
      where: { userId, active: true },
      attributes: [
        'id', 
        'deviceId', 
        'platform', 
        'deviceType',
        'lastUsed',
        'createdAt'
      ],
      order: [['lastUsed', 'DESC']]
    });
    
    res.json({
      success: true,
      devices
    });
  })
);

/**
 * @route POST /api/v1/auth/verify-token
 * @desc Verify and sync user from main app token
 * @access Public
 */
router.post('/verify-token',
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/verify-token', {
      method: req.method,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl
    });
    next();
  },
  exceptionHandler.asyncHandler(async (req, res) => {
    const { token, deviceInfo } = req.body;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Token is required'
        }
      });
    }
    
    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Sync user from main app
      const syncData = {
        appUserId: decoded.id || decoded.userId || decoded.sub,
        name: decoded.name,
        email: decoded.email,
        phone: decoded.phone,
        avatar: decoded.avatar,
        role: decoded.role || 'client',
        ...decoded.userData
      };
      
      const syncResult = await userSyncService.syncUserFromMainApp(syncData, token);
      
      // Register device token if provided
      if (deviceInfo && deviceInfo.token) {
        try {
          await userSyncService.syncDeviceToken(
            syncResult.user.id,
            deviceInfo,
            {
              ip: req.ip,
              userAgent: req.get('user-agent')
            }
          );
        } catch (error) {
          logger.error('Device token sync failed', {
            userId: syncResult.user.id,
            error: error.message
          });
        }
      }
      
      // Generate chat-specific token
      const chatToken = jwt.sign(
        {
          id: syncResult.user.id,
          externalId: syncResult.user.externalId,
          name: syncResult.user.name,
          role: syncResult.user.role,
          chatUser: true
        },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );
      
      logger.audit('token_verification', {
        userId: syncResult.user.id,
        externalId: syncResult.user.externalId,
        success: true,
        ip: req.ip
      });
      
      res.json({
        success: true,
        token: chatToken,
        user: syncResult.user,
        operationId: syncResult.operationId
      });
      
    } catch (error) {
      logger.audit('token_verification', {
        success: false,
        error: error.message,
        ip: req.ip
      });
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Token has expired'
          }
        });
      }
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid token'
          }
        });
      }
      
      throw error;
    }
  })
);

/**
 * @route GET /api/v1/auth/profile
 * @desc Get authenticated user profile
 * @access Private
 */
router.get('/profile',
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/profile', {
      method: req.method,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl
    });
    next();
  },
  authMiddleware.authenticate.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    const user = await db.User.findByPk(userId, {
      attributes: [
        'id',
        'externalId',
        'name',
        'email',
        'phone',
        'avatar',
        'role',
        'isOnline',
        'lastSeen',
        'metaData'
      ]
    });
    
    res.json({
      success: true,
      user
    });
  })
);

/**
 * @route POST /api/v1/auth/token-history
 * @desc Get token history for audit
 * @access Private (Admin)
 */
router.post('/token-history',
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/token-history', {
      method: req.method,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl
    });
    next();
  },
  authMiddleware.authenticate.bind(authMiddleware),
  authMiddleware.authorize('admin'),
  exceptionHandler.asyncHandler(async (req, res) => {
    const { userId, deviceId, startDate, endDate, limit = 50 } = req.body;
    
    const where = {};
    
    if (userId) {
      where.userId = userId;
    }
    
    if (deviceId) {
      where.deviceId = deviceId;
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        where.createdAt[Op.lte] = new Date(endDate);
      }
    }
    
    const history = await db.TokenHistory.findAll({
      where,
      include: [
        {
          model: db.User,
          as: 'user',
          attributes: ['id', 'name', 'externalId']
        }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit)
    });
    
    res.json({
      success: true,
      history,
      count: history.length
    });
  })
);

// Debug endpoint to check what routes are registered
router.get('/debug-routes', (req, res) => {
  const routes = [];
  
  // Function to explore router stack
  const exploreRoutes = (stack, basePath = '') => {
    stack.forEach(layer => {
      if (layer.route) {
        // Routes registered directly on this router
        const methods = Object.keys(layer.route.methods)
          .filter(method => layer.route.methods[method])
          .map(method => method.toUpperCase());
        
        routes.push({
          path: basePath + layer.route.path,
          methods,
          middleware: layer.route.stack
            .map(handler => handler.name || 'anonymous')
            .filter(name => name !== 'bound dispatch')
        });
      } else if (layer.name === 'router' && layer.handle.stack) {
        // Nested routers
        const path = layer.regexp.source
          .replace('^\\/','/')
          .replace('(?=\\/|$)', '')
          .replace(/\\\//g, '/');
        
        exploreRoutes(layer.handle.stack, basePath + path);
      }
    });
  };
  
  // Get parent router stack if available
  let parentRouter = null;
  if (req.app && req.app._router) {
    parentRouter = req.app._router;
  }
  
  // Check parent router for our auth routes
  if (parentRouter) {
    const stack = parentRouter.stack;
    exploreRoutes(stack);
  } else {
    routes.push({ warning: 'Could not access parent router stack' });
  }
  
  // Return local routes
  const localRoutes = [];
  router.stack.forEach(layer => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .filter(method => layer.route.methods[method])
        .map(method => method.toUpperCase());
      
      localRoutes.push({
        path: layer.route.path,
        methods,
        middleware: layer.route.stack
          .map(handler => handler.name || 'anonymous')
          .filter(name => name !== 'bound dispatch')
      });
    }
  });
  
  res.json({
    baseUrl: req.baseUrl,
    parentRoutes: routes,
    localRoutes: localRoutes,
    mountPath: req.baseUrl,
    app: Object.keys(req.app)
  });
});

// Test whoami endpoint
router.get('/whoami', 
  authMiddleware.authenticate.bind(authMiddleware),
  (req, res) => {
    res.json({
      success: true,
      user: {
        id: req.user?.id || 'undefined',
        name: req.user?.name || 'undefined',
        role: req.user?.role || 'undefined',
        hasUser: !!req.user
      }
    });
  }
);

module.exports = router;