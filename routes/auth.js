// routes/auth.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { User, DeviceToken, TokenHistory } = require('../db/models');
const { validateUUID } = require('../utils/validation');
const logger = require('../utils/logger');
const authMiddleware = require('../middleware/authentication');
const exceptionHandler = require('../middleware/exceptionHandler');
const userSyncService = require('../services/sync/userSyncService');
const notificationManager = require('../services/notifications/notificationManager');

/**
 * @route POST /api/v1/auth/sync
 * @desc Sync user from main application
 * @access Service-to-Service (API Key)
 */
router.post('/sync', 
  authMiddleware.authenticateApiKey.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
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
  authMiddleware.authenticateApiKey.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
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
  authMiddleware.authenticate.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
    const { 
      token, 
      deviceId,
      deviceType = 'mobile', 
      platform,
      deviceModel,
      deviceOS,
      appVersion 
    } = req.body;
    
    const userId = req.user.id;
    
    if (!token || !deviceId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Token and deviceId are required'
        }
      });
    }
    
    // Check for existing token
    let deviceToken = await DeviceToken.findOne({
      where: { deviceId, userId }
    });
    
    let action = 'REGISTERED';
    let previousToken = null;
    
    if (deviceToken) {
      // Token renewal
      if (deviceToken.token !== token) {
        previousToken = deviceToken.token;
        action = 'RENEWED';
      }
      
      await deviceToken.update({
        token,
        platform,
        lastUsed: new Date(),
        active: true
      });
    } else {
      // New token registration
      deviceToken = await DeviceToken.create({
        id: uuidv4(),
        userId,
        token,
        deviceType,
        platform,
        deviceId,
        lastUsed: new Date(),
        active: true
      });
    }
    
    // Log token history
    await TokenHistory.create({
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
    
    // Validate token with provider
    try {
      await notificationManager.sendToDevice(deviceToken, {
        type: 'test',
        title: 'Device Registered',
        body: 'Your device has been registered for notifications'
      });
    } catch (error) {
      logger.warn('Token validation failed', {
        userId,
        deviceId,
        error: error.message
      });
    }
    
    logger.info('Device token registered', {
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
  })
);

/**
 * @route DELETE /api/v1/auth/device/:deviceId
 * @desc Remove device token
 * @access Private
 */
router.delete('/device/:deviceId',
  authMiddleware.authenticate.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
    const { deviceId } = req.params;
    const userId = req.user.id;
    
    const deviceToken = await DeviceToken.findOne({
      where: { deviceId, userId }
    });
    
    if (!deviceToken) {
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
    await TokenHistory.logTokenRevocation({
      userId,
      token: deviceToken.token,
      tokenType: deviceToken.platform === 'ios' ? 'APN' : 'FCM',
      reason: 'user_request',
      revokedBy: userId
    });
    
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
  authMiddleware.authenticate.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    const devices = await DeviceToken.findAll({
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
  authMiddleware.authenticate.bind(authMiddleware),
  exceptionHandler.asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    const user = await User.findByPk(userId, {
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
    
    const history = await TokenHistory.findAll({
      where,
      include: [
        {
          model: User,
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

module.exports = router;