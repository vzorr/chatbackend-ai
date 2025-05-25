// routes/auth.js - CLEAN APPROACH
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const router = express.Router();
const db = require('../db/models');  // Import the db module
const { Op } = require('sequelize');
const { validateUUID } = require('../utils/validation');
const logger = require('../utils/logger');
const authMiddleware = require('../middleware/authentication');

// ✅ BETTER: Direct import from exception handler
const { asyncHandler, createOperationalError, createSystemError } = require('../middleware/exceptionHandler');

const userSyncService = require('../services/sync/userSyncService');
const notificationManager = require('../services/notifications/notificationManager');

// Debug route to verify router is working
router.get('/test', asyncHandler(async (req, res) => {
  logger.info('Test route hit: /api/v1/auth/test');
  res.json({ 
    success: true, 
    message: 'Auth routes are working', 
    path: req.path,
    baseUrl: req.baseUrl,
    originalUrl: req.originalUrl,
    route: req.route.path
  });
}));

// Debug endpoint to check authentication
router.get('/debug-auth', asyncHandler(async (req, res) => {
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
}));

// Debug endpoint that requires authentication
router.get('/debug-auth-protected',
  authMiddleware.authenticate.bind(authMiddleware),
  asyncHandler(async (req, res) => {
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
  })
);

// Debug token endpoint
router.get('/debug-token', asyncHandler(async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    throw createOperationalError('No token provided', 400, 'NO_TOKEN');
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
    throw createOperationalError('Invalid token', 401, 'INVALID_TOKEN');
  }
}));

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
  asyncHandler(async (req, res) => {
    logger.info('API Key authentication passed for /sync route');
    const { userData, authToken, signature } = req.body;
    
    if (!userData) {
      throw createOperationalError('User data is required', 400, 'MISSING_USER_DATA');
    }
    
    if (!signature) {
      throw createOperationalError('Request signature is required', 400, 'MISSING_SIGNATURE');
    }
    
    try {
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
    } catch (error) {
      if (error.code === 'INVALID_SIGNATURE') {
        throw createOperationalError('Invalid request signature', 403, 'INVALID_SIGNATURE');
      }
      throw createSystemError('User sync failed', error);
    }
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
  asyncHandler(async (req, res) => {
    logger.info('API Key authentication passed for /batch-sync route');
    const { users, authToken } = req.body;
    
    if (!Array.isArray(users) || users.length === 0) {
      throw createOperationalError('Users array is required', 400, 'INVALID_USERS_ARRAY');
    }
    
    try {
      const result = await userSyncService.batchSyncUsers(users, authToken);
      
      logger.audit('batch_user_sync', {
        count: users.length,
        successful: result.summary.successful,
        failed: result.summary.failed,
        ip: req.ip
      });
      
      res.json(result);
    } catch (error) {
      throw createSystemError('Batch sync failed', error);
    }
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
  // Enhanced authentication middleware with user creation
  asyncHandler(async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      logger.warn('No token provided in authentication middleware');
      throw createOperationalError('Authentication token required', 401, 'NO_TOKEN');
    }
    
    let decoded;
    try {
      // Verify token
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      logger.info('Token verified', { 
        hasId: !!decoded.id,
        hasUserId: !!decoded.userId,
        hasSub: !!decoded.sub
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw createOperationalError('Authentication token has expired', 401, 'TOKEN_EXPIRED');
      }
      if (error.name === 'JsonWebTokenError') {
        throw createOperationalError('Invalid authentication token', 401, 'INVALID_TOKEN');
      }
      throw createSystemError('Token verification failed', error);
    }
    
    // Get user ID from token
    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) {
      logger.error('No user ID found in token');
      throw createOperationalError('No user ID in token', 401, 'INVALID_TOKEN_STRUCTURE');
    }

    // Wait for database initialization if needed
    if (typeof db.waitForInitialization === 'function') {
      await db.waitForInitialization();
    }
    
    // Check if models are available
    const models = typeof db.getModels === 'function' ? db.getModels() : db;
    const User = models.User;
    
    if (!User) {
      logger.error('User model not found in database models');
      throw createSystemError('Server configuration error - User model not found');
    }

    // Try to find user by ID first
    let user = null;
    try {
      // First try by ID
      user = await User.findByPk(userId);
      
      // If not found and externalId provided, try that
      if (!user && decoded.externalId) {
        user = await User.findOne({
          where: { externalId: decoded.externalId }
        });
        logger.info('User lookup by externalId', { 
          externalId: decoded.externalId, 
          found: !!user 
        });
      }
    } catch (dbError) {
      logger.error('Error finding user', {
        error: dbError.message,
        userId,
        externalId: decoded.externalId || 'not provided'
      });
      throw createSystemError('Database error during user lookup', dbError);
    }
    
    // If user not found, create one
    if (!user) {
      logger.warn('User not found in database, creating new user', {
        userId,
        externalId: decoded.externalId || userId
      });
      
      try {
        // Normalize role to match database ENUM
        let role = 'customer'; // Default
        if (decoded.role) {
          const normalizedRole = decoded.role.toLowerCase();
          if (['customer', 'usta', 'administrator'].includes(normalizedRole)) {
            role = normalizedRole;
          } else if (normalizedRole === 'admin') {
            role = 'administrator';
          }
        }
        
        // Create new user
        user = await User.create({
          id: userId,
          externalId: decoded.externalId || userId,
          name: decoded.name || decoded.displayName || 'User',
          phone: decoded.phone || '+00000000000',
          email: decoded.email || null,
          role: role,
          isOnline: true,
          lastSeen: new Date(),
          metaData: {
            source: 'device_registration',
            createdAt: new Date().toISOString(),
            tokenData: {
              iat: decoded.iat,
              exp: decoded.exp,
              role: decoded.role
            }
          }
        });
        
        logger.info('Created new user during device registration', {
          userId: user.id,
          externalId: user.externalId,
          role: user.role
        });
      } catch (createError) {
        logger.error('Failed to create user during device registration', {
          error: createError.message,
          stack: createError.stack,
          userId,
          code: createError.code || 'UNKNOWN'
        });
        
        if (createError.name === 'SequelizeUniqueConstraintError') {
          throw createOperationalError('User already exists with this ID', 409, 'USER_EXISTS');
        }
        
        if (createError.name === 'SequelizeValidationError') {
          throw createOperationalError('Invalid user data', 400, 'VALIDATION_ERROR');
        }
        
        throw createSystemError('Failed to create user account', createError);
      }
    }
    
    // Set user in request
    req.user = user;
    req.token = token;
    req.decodedToken = decoded;
    
    logger.info('User authenticated for device registration', {
      userId: user.id,
      userRole: user.role,
      externalId: user.externalId
    });
    
    next();
  }),
  // Log that authentication passed
  (req, res, next) => {
    logger.info('Authentication passed for /register-device route', {
      userId: req.user?.id,
      userRole: req.user?.role,
      hasUser: !!req.user
    });
    next();
  },
  // Main request handler
  asyncHandler(async (req, res) => {
    // Safety check
    if (!req.user || !req.user.id) {
      logger.error('User missing in request after authentication', {
        hasUser: !!req.user
      });
      throw createOperationalError('User authentication failed', 401, 'AUTH_FAILURE');
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
        hasDeviceId: !!deviceId,
        userId: req.user.id
      });
      
      throw createOperationalError('Token and deviceId are required', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    const userId = req.user.id;
    
    logger.info('Processing register-device request', {
      userId,
      deviceId,
      deviceType,
      platform
    });
    
    // Wait for database initialization if needed
    if (typeof db.waitForInitialization === 'function') {
      await db.waitForInitialization();
    }
    
    // Ensure models are available
    const models = typeof db.getModels === 'function' ? db.getModels() : db;
    const DeviceToken = models.DeviceToken;
    const TokenHistory = models.TokenHistory;
    
    if (!DeviceToken || !TokenHistory) {
      logger.error('Required models not found', {
        hasDeviceToken: !!DeviceToken,
        hasTokenHistory: !!TokenHistory
      });
      
      throw createSystemError('Server configuration error - Required models not found');
    }
    
    try {
      // Check if token already exists for this device
      const existingToken = await DeviceToken.findOne({
        where: { 
          userId: userId,
          deviceId: deviceId
        }
      });
      
      let action = 'REGISTERED';
      let previousToken = null;
      let deviceTokenRecord = null;
      
      if (existingToken) {
        logger.info('Found existing device token', {
          userId,
          deviceId,
          tokenId: existingToken.id
        });
        
        // Check if token value changed
        if (existingToken.token !== token) {
          previousToken = existingToken.token;
          action = 'RENEWED';
          
          logger.info('Renewing device token', {
            userId,
            deviceId,
            action
          });
        }
        
        // Update token
        await existingToken.update({
          token,
          platform,
          deviceType,
          lastUsed: new Date(),
          active: true
        });
        
        deviceTokenRecord = existingToken;
        
      } else {
        // Create new token
        deviceTokenRecord = await DeviceToken.create({
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
          tokenId: deviceTokenRecord.id
        });
      }
      
      // Log token history
      try {
        await TokenHistory.create({
          id: uuidv4(),
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
        // Continue despite history error - this is not critical
      }
      
      // Success response
      logger.info('Device token registration completed successfully', {
        userId,
        deviceId,
        action,
        platform
      });
      
      res.json({
        success: true,
        action,
        tokenId: deviceTokenRecord.id
      });
      
    } catch (error) {
      logger.error('Error in device registration process', {
        error: error.message,
        stack: error.stack,
        userId,
        deviceId,
        name: error.name,
        code: error.code || 'UNKNOWN'
      });
      
      // Handle specific database error types
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw createOperationalError('This token is already registered to another device', 409, 'TOKEN_EXISTS');
      }
      
      if (error.name === 'SequelizeForeignKeyConstraintError') {
        throw createOperationalError('Invalid user reference', 400, 'INVALID_USER');
      }
      
      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(`Invalid device token data: ${details}`, 400, 'VALIDATION_ERROR');
      }
      
      throw createSystemError('Failed to register device token', error);
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
  asyncHandler(async (req, res) => {
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
      throw createOperationalError('Device not found', 404, 'DEVICE_NOT_FOUND');
    }
    
    // Mark as inactive instead of deleting
    await deviceToken.update({ active: false });
    
    // Log revocation
    try {
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
    } catch (historyError) {
      logger.error('Failed to log token revocation', {
        error: historyError.message,
        userId,
        deviceId
      });
      // Continue despite history error
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
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    try {
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
    } catch (error) {
      throw createSystemError('Failed to retrieve devices', error);
    }
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
  asyncHandler(async (req, res) => {
    const { token, deviceInfo } = req.body;
    
    if (!token) {
      throw createOperationalError('Token is required', 400, 'MISSING_TOKEN');
    }
    
    let decoded;
    try {
      // Verify token
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw createOperationalError('Token has expired', 401, 'TOKEN_EXPIRED');
      }
      if (error.name === 'JsonWebTokenError') {
        throw createOperationalError('Invalid token', 401, 'INVALID_TOKEN');
      }
      throw createSystemError('Token verification failed', error);
    }
    
    try {
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
          // Continue despite device sync failure
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
      
      throw createSystemError('User sync failed during token verification', error);
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
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    try {
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
      
      if (!user) {
        throw createOperationalError('User profile not found', 404, 'USER_NOT_FOUND');
      }
      
      res.json({
        success: true,
        user
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve user profile', error);
    }
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
  asyncHandler(async (req, res) => {
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
    
    try {
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
    } catch (error) {
      throw createSystemError('Failed to retrieve token history', error);
    }
  })
);

// Debug endpoint to check what routes are registered
router.get('/debug-routes', asyncHandler(async (req, res) => {
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
}));

// Test whoami endpoint
router.get('/whoami', 
  authMiddleware.authenticate.bind(authMiddleware),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      user: {
        id: req.user?.id || 'undefined',
        name: req.user?.name || 'undefined',
        role: req.user?.role || 'undefined',
        hasUser: !!req.user
      }
    });
  })
);


/**
 * @route POST /api/v1/auth/register-user
 * @desc Register a new user in the chat server
 * @access Private (JWT)
 */
router.post('/register-user',
  (req, res, next) => {
    logger.info('Route hit: /api/v1/auth/register-user', {
      method: req.method,
      path: req.path,
      baseUrl: req.baseUrl,
      originalUrl: req.originalUrl,
      headers: Object.keys(req.headers)
    });
    next();
  },
  authMiddleware.authenticate.bind(authMiddleware),
  asyncHandler(async (req, res) => {
    logger.info('JWT authentication passed for /register-user route', {
      authenticatedUserId: req.user?.id,
      authenticatedUserRole: req.user?.role
    });
    
    const {
      id,
      externalId,
      name,
      phone,
      email,
      role,
      avatar
    } = req.body;
    
    // Validate required fields
    if (!externalId || !phone || !role) {
      throw createOperationalError(
        'Missing required fields: externalId, phone, and role are required',
        400,
        'MISSING_REQUIRED_FIELDS'
      );
    }
    
    // Validate UUID formats
    if (!validateUUID(externalId)) {
      throw createOperationalError(
        'Invalid externalId format. Must be a valid UUID',
        400,
        'INVALID_EXTERNAL_ID_FORMAT'
      );
    }
    
    // If id is provided, validate it's a valid UUID
    if (id && !validateUUID(id)) {
      throw createOperationalError(
        'Invalid id format. Must be a valid UUID',
        400,
        'INVALID_ID_FORMAT'
      );
    }
    
    // Validate phone format (basic validation - at least 10 characters)
    if (!phone || phone.length < 10) {
      throw createOperationalError(
        'Invalid phone number. Must be at least 10 characters',
        400,
        'INVALID_PHONE_FORMAT'
      );
    }
    
    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw createOperationalError(
          'Invalid email format',
          400,
          'INVALID_EMAIL_FORMAT'
        );
      }
    }
    
    // Validate and normalize role
    const validRoles = ['customer', 'usta', 'administrator'];
    const normalizedRole = role ? role.toLowerCase() : null;
    
    if (!normalizedRole || !validRoles.includes(normalizedRole)) {
      throw createOperationalError(
        `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        400,
        'INVALID_ROLE'
      );
    }
    
    // Validate avatar URL if provided
    if (avatar && typeof avatar === 'string' && avatar.trim().length > 0) {
      try {
        new URL(avatar); // This will throw if invalid URL
      } catch (error) {
        throw createOperationalError(
          'Invalid avatar URL format',
          400,
          'INVALID_AVATAR_URL'
        );
      }
    }
    
    try {
      // Wait for database initialization if needed
      if (typeof db.waitForInitialization === 'function') {
        await db.waitForInitialization();
      }
      
      // Get models
      const models = typeof db.getModels === 'function' ? db.getModels() : db;
      const User = models.User;
      
      if (!User) {
        logger.error('User model not found in database models');
        throw createSystemError('Server configuration error - User model not found');
      }
      
      // Check for existing users with same externalId, phone, or email
      const whereConditions = [
        { externalId: externalId },
        { phone: phone.trim() }
      ];
      
      // Only check email if provided
      if (email && email.trim()) {
        whereConditions.push({ email: email.toLowerCase().trim() });
      }
      
      logger.info('Checking for existing users', {
        externalId,
        phone: phone.trim(),
        email: email ? email.toLowerCase().trim() : 'not provided'
      });
      
      const existingUser = await User.findOne({
        where: { [Op.or]: whereConditions }
      });
      
      if (existingUser) {
        // Determine which field caused the conflict
        if (existingUser.externalId === externalId) {
          logger.warn('Registration failed - duplicate externalId', {
            externalId,
            existingUserId: existingUser.id
          });
          throw createOperationalError(
            'User with this external ID already exists',
            409,
            'DUPLICATE_EXTERNAL_ID'
          );
        }
        
        if (existingUser.phone === phone.trim()) {
          logger.warn('Registration failed - duplicate phone', {
            phone: phone.trim(),
            existingUserId: existingUser.id
          });
          throw createOperationalError(
            'User with this phone number already exists',
            409,
            'DUPLICATE_PHONE'
          );
        }
        
        if (email && existingUser.email === email.toLowerCase().trim()) {
          logger.warn('Registration failed - duplicate email', {
            email: email.toLowerCase().trim(),
            existingUserId: existingUser.id
          });
          throw createOperationalError(
            'User with this email already exists',
            409,
            'DUPLICATE_EMAIL'
          );
        }
      }
      
      // Determine user ID - use provided or generate new
      const userId = id && validateUUID(id) ? id : uuidv4();
      const isGeneratedId = !id || !validateUUID(id);
      
      logger.info('Creating new user', {
        userId,
        externalId,
        role: normalizedRole,
        isGeneratedId,
        registeredBy: req.user.id
      });
      
      // Create the user
      const newUser = await User.create({
        id: userId,
        externalId: externalId,
        name: name ? name.trim() : null,
        phone: phone.trim(),
        email: email ? email.toLowerCase().trim() : null,
        role: normalizedRole,
        avatar: avatar ? avatar.trim() : null,
        isOnline: false,
        lastSeen: null,
        socketId: null,
        metaData: {
          source: 'api_registration',
          registeredAt: new Date().toISOString(),
          registeredBy: req.user.id,
          registeredByRole: req.user.role,
          registeredByName: req.user.name
        }
      });
      
      logger.info('User registered successfully', {
        userId: newUser.id,
        externalId: newUser.externalId,
        role: newUser.role,
        isGeneratedId,
        registeredBy: req.user.id
      });
      
      // Audit log
      logger.audit('user_registration', {
        userId: newUser.id,
        externalId: newUser.externalId,
        role: newUser.role,
        source: 'api',
        registeredBy: req.user.id,
        registeredByRole: req.user.role,
        ip: req.ip
      });
      
      // Return success response
      res.status(201).json({
        success: true,
        user: {
          id: newUser.id,
          externalId: newUser.externalId,
          name: newUser.name,
          phone: newUser.phone,
          email: newUser.email,
          role: newUser.role,
          avatar: newUser.avatar
        },
        message: 'User registered successfully'
      });
      
    } catch (error) {
      logger.error('Error in user registration', {
        error: error.message,
        stack: error.stack,
        externalId,
        phone,
        email,
        role,
        registeredBy: req.user?.id
      });
      
      // Handle specific database errors
      if (error.name === 'SequelizeUniqueConstraintError') {
        const field = error.errors?.[0]?.path || 'field';
        throw createOperationalError(
          `A user with this ${field} already exists`,
          409,
          'DUPLICATE_FIELD'
        );
      }
      
      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(
          `Validation failed: ${details}`,
          400,
          'VALIDATION_ERROR'
        );
      }
      
      // If it's already an operational error, throw it as is
      if (error.isOperational) {
        throw error;
      }
      
      // Otherwise, wrap it as a system error
      throw createSystemError('Failed to register user', error);
    }
  })
);


module.exports = router;