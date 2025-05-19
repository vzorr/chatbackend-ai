// routes/notification.js
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticate, authorize } = require('../middleware/authentication');
const notificationService = require('../services/notifications/notificationService');
const logger = require('../utils/logger');

/**
 * @route GET /api/v1/notifications/templates
 * @desc Get notification templates
 * @access Private
 */
router.get('/templates', authenticate, async (req, res, next) => {
  try {
    const { appId } = req.query;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_APP_ID',
          message: 'App ID is required'
        }
      });
    }
    
    const templates = await notificationService.getTemplates(appId);
    
    res.json({
      success: true,
      templates
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/notifications/templates/:eventId
 * @desc Get notification template by event ID
 * @access Private
 */
router.get('/templates/:eventId', authenticate, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { appId } = req.query;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_APP_ID',
          message: 'App ID is required'
        }
      });
    }
    
    const template = await notificationService.getTemplate(appId, eventId);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TEMPLATE_NOT_FOUND',
          message: 'Notification template not found'
        }
      });
    }
    
    res.json({
      success: true,
      template
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/notifications/templates
 * @desc Create or update notification template
 * @access Private (Admin only)
 */
router.post('/templates', 
  authenticate, 
  authorize('administrator'), 
  async (req, res, next) => {
    try {
      const {
        appId,
        eventId,
        eventName,
        title,
        body,
        payload,
        category,
        description,
        defaultEnabled,
        platforms,
        priority
      } = req.body;
      
      // Validate required fields
      if (!appId || !eventId || !eventName || !title || !body) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'Missing required fields'
          }
        });
      }
      
      const templateData = {
        id: uuidv4(),
        appId,
        eventId,
        eventName,
        title,
        body,
        payload: payload || {},
        category: category || null,
        description: description || null,
        defaultEnabled: defaultEnabled !== undefined ? defaultEnabled : true,
        platforms: platforms || ['ios', 'android'],
        priority: priority || 'high'
      };
      
      const [template, created] = await notificationService.upsertTemplate(templateData);
      
      res.status(created ? 201 : 200).json({
        success: true,
        template,
        created
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route DELETE /api/v1/notifications/templates/:eventId
 * @desc Delete notification template
 * @access Private (Admin only)
 */
router.delete('/templates/:eventId', 
  authenticate, 
  authorize('administrator'), 
  async (req, res, next) => {
    try {
      const { eventId } = req.params;
      const { appId } = req.query;
      
      if (!appId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_APP_ID',
            message: 'App ID is required'
          }
        });
      }
      
      await this.ensureDbInitialized();
      const models = db.getModels();
      
      const deleted = await models.NotificationTemplate.destroy({
        where: { appId, eventId }
      });
      
      if (deleted === 0) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'TEMPLATE_NOT_FOUND',
            message: 'Notification template not found'
          }
        });
      }
      
      res.json({
        success: true,
        message: 'Template deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route GET /api/v1/notifications/preferences
 * @desc Get user notification preferences
 * @access Private
 */
router.get('/preferences', authenticate, async (req, res, next) => {
  try {
    const { appId } = req.query;
    const userId = req.user.id;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_APP_ID',
          message: 'App ID is required'
        }
      });
    }
    
    const preferences = await notificationService.getUserPreferences(userId, appId);
    
    res.json({
      success: true,
      preferences
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/v1/notifications/preferences/:eventId
 * @desc Update notification preference
 * @access Private
 */
router.put('/preferences/:eventId', authenticate, async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { appId, enabled, channels } = req.body;
    const userId = req.user.id;
    
    if (!appId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_APP_ID',
          message: 'App ID is required'
        }
      });
    }
    
    if (enabled === undefined) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Enabled status is required'
        }
      });
    }
    
    const preference = await notificationService.updateUserPreference(
      userId,
      appId,
      eventId,
      enabled,
      channels
    );
    
    res.json({
      success: true,
      preference
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/notifications/send
 * @desc Trigger notification manually
 * @access Private (Admin or API key)
 */
router.post('/send', authenticate, async (req, res, next) => {
  try {
    const {
      appId,
      eventId,
      userId,
      data = {}
    } = req.body;
    
    // Validate required fields
    if (!appId || !eventId || !userId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Missing required fields'
        }
      });
    }
    
    const result = await notificationService.processNotification(
      appId,
      eventId,
      userId,
      data
    );
    
    res.json({
      success: true,
      result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/notifications
 * @desc Get user's notifications
 * @access Private
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { limit = 20, offset = 0, unreadOnly = false } = req.query;
    
    const options = {
      limit: parseInt(limit),
      offset: parseInt(offset),
      unreadOnly: unreadOnly === 'true'
    };
    
    const { rows: notifications, count } = await notificationService.getUserNotifications(
      userId,
      options
    );
    
    res.json({
      success: true,
      notifications,
      total: count,
      limit: options.limit,
      offset: options.offset
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/notifications/:id/read
 * @desc Mark notification as read
 * @access Private
 */
router.post('/:id/read', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    await notificationService.markAsRead(id);
    
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/notifications/device
 * @desc Register device token
 * @access Private
 */
router.post('/device', authenticate, async (req, res, next) => {
  try {
    const { token, deviceId, platform, deviceModel, appVersion } = req.body;
    const userId = req.user.id;
    
    // Validate required fields
    if (!token || !deviceId || !platform) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Token, deviceId, and platform are required'
        }
      });
    }
    
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    const [deviceToken, created] = await models.DeviceToken.findOrCreate({
      where: { deviceId, userId },
      defaults: {
        id: uuidv4(),
        token,
        deviceType: platform === 'ios' ? 'mobile' : 'mobile',
        platform,
        active: true,
        lastUsed: new Date()
      }
    });
    
    if (!created) {
      await deviceToken.update({
        token,
        platform,
        active: true,
        lastUsed: new Date()
      });
    }
    
    // Log token registration
    if (models.TokenHistory) {
      await models.TokenHistory.create({
        userId,
        token,
        tokenType: platform === 'ios' ? 'APN' : 'FCM',
        deviceId,
        deviceModel,
        deviceOS: platform,
        appVersion,
        action: created ? 'REGISTERED' : 'RENEWED',
        previousToken: !created ? deviceToken.token : null,
        metadata: {
          ipAddress: req.ip,
          userAgent: req.get('user-agent')
        }
      });
    }
    
    res.json({
      success: true,
      deviceToken: {
        id: deviceToken.id,
        deviceId,
        platform,
        created
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;