// routes/notification.js - CLEAN APPROACH
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticate, authorize } = require('../middleware/authentication');
const notificationService = require('../services/notifications/notificationService');
const logger = require('../utils/logger');
const db = require('../db/models');

// ✅ BETTER: Direct import from exception handler
const { asyncHandler, createOperationalError, createSystemError } = require('../middleware/exceptionHandler');

/**
 * @route GET /api/v1/notifications/templates
 * @desc Get notification templates
 * @access Private
 */
router.get('/templates', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { appId } = req.query;
    
    if (!appId) {
      throw createOperationalError('App ID is required', 400, 'MISSING_APP_ID');
    }
    
    try {
      const templates = await notificationService.getTemplates(appId);
      
      res.json({
        success: true,
        templates
      });
    } catch (error) {
      throw createSystemError('Failed to retrieve notification templates', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/templates/:eventId
 * @desc Get notification template by event ID
 * @access Private
 */
router.get('/templates/:eventId', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const { appId } = req.query;
    
    if (!appId) {
      throw createOperationalError('App ID is required', 400, 'MISSING_APP_ID');
    }
    
    if (!eventId) {
      throw createOperationalError('Event ID is required', 400, 'MISSING_EVENT_ID');
    }
    
    try {
      const template = await notificationService.getTemplate(appId, eventId);
      
      if (!template) {
        throw createOperationalError('Notification template not found', 404, 'TEMPLATE_NOT_FOUND');
      }
      
      res.json({
        success: true,
        template
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve notification template', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/templates
 * @desc Create or update notification template
 * @access Private (Admin only)
 */
router.post('/templates', 
  authenticate, 
  authorize('administrator'), 
  asyncHandler(async (req, res) => {
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
      throw createOperationalError('Missing required fields: appId, eventId, eventName, title, body', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    // Validate platforms if provided
    if (platforms && (!Array.isArray(platforms) || platforms.some(p => !['ios', 'android'].includes(p)))) {
      throw createOperationalError('Platforms must be an array containing only "ios" and/or "android"', 400, 'INVALID_PLATFORMS');
    }
    
    // Validate priority if provided
    if (priority && !['low', 'normal', 'high'].includes(priority)) {
      throw createOperationalError('Priority must be one of: low, normal, high', 400, 'INVALID_PRIORITY');
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
    
    try {
      const [template, created] = await notificationService.upsertTemplate(templateData);
      
      logger.info('Notification template operation completed', {
        eventId,
        appId,
        created,
        userId: req.user.id
      });
      
      res.status(created ? 201 : 200).json({
        success: true,
        template,
        created
      });
    } catch (error) {
      logger.error('Failed to create/update notification template', {
        eventId,
        appId,
        error: error.message,
        userId: req.user.id
      });
      
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw createOperationalError('Template with this eventId already exists for this app', 409, 'TEMPLATE_EXISTS');
      }
      
      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(`Validation failed: ${details}`, 400, 'VALIDATION_ERROR');
      }
      
      throw createSystemError('Failed to create or update notification template', error);
    }
  })
);

/**
 * @route DELETE /api/v1/notifications/templates/:eventId
 * @desc Delete notification template
 * @access Private (Admin only)
 */
router.delete('/templates/:eventId', 
  authenticate, 
  authorize('administrator'), 
  asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const { appId } = req.query;
    
    if (!appId) {
      throw createOperationalError('App ID is required', 400, 'MISSING_APP_ID');
    }
    
    if (!eventId) {
      throw createOperationalError('Event ID is required', 400, 'MISSING_EVENT_ID');
    }
    
    try {
      // Wait for database initialization if needed
      if (typeof db.waitForInitialization === 'function') {
        await db.waitForInitialization();
      }
      
      const models = typeof db.getModels === 'function' ? db.getModels() : db;
      const NotificationTemplate = models.NotificationTemplate;
      
      if (!NotificationTemplate) {
        throw createSystemError('NotificationTemplate model not found');
      }
      
      const deleted = await NotificationTemplate.destroy({
        where: { appId, eventId }
      });
      
      if (deleted === 0) {
        throw createOperationalError('Notification template not found', 404, 'TEMPLATE_NOT_FOUND');
      }
      
      logger.info('Notification template deleted', {
        eventId,
        appId,
        userId: req.user.id
      });
      
      res.json({
        success: true,
        message: 'Template deleted successfully'
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to delete notification template', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/preferences
 * @desc Get user notification preferences
 * @access Private
 */
router.get('/preferences', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { appId } = req.query;
    const userId = req.user.id;
    
    if (!appId) {
      throw createOperationalError('App ID is required', 400, 'MISSING_APP_ID');
    }
    
    try {
      const preferences = await notificationService.getUserPreferences(userId, appId);
      
      res.json({
        success: true,
        preferences
      });
    } catch (error) {
      throw createSystemError('Failed to retrieve user notification preferences', error);
    }
  })
);

/**
 * @route PUT /api/v1/notifications/preferences/:eventId
 * @desc Update notification preference
 * @access Private
 */
router.put('/preferences/:eventId', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { eventId } = req.params;
    const { appId, enabled, channels } = req.body;
    const userId = req.user.id;
    
    if (!appId) {
      throw createOperationalError('App ID is required', 400, 'MISSING_APP_ID');
    }
    
    if (!eventId) {
      throw createOperationalError('Event ID is required', 400, 'MISSING_EVENT_ID');
    }
    
    if (enabled === undefined) {
      throw createOperationalError('Enabled status is required', 400, 'MISSING_ENABLED_STATUS');
    }
    
    if (typeof enabled !== 'boolean') {
      throw createOperationalError('Enabled must be a boolean value', 400, 'INVALID_ENABLED_TYPE');
    }
    
    // Validate channels if provided
    if (channels && (!Array.isArray(channels) || channels.some(c => !['push', 'email', 'sms'].includes(c)))) {
      throw createOperationalError('Channels must be an array containing only "push", "email", and/or "sms"', 400, 'INVALID_CHANNELS');
    }
    
    try {
      const preference = await notificationService.updateUserPreference(
        userId,
        appId,
        eventId,
        enabled,
        channels
      );
      
      logger.info('User notification preference updated', {
        userId,
        eventId,
        appId,
        enabled,
        channels
      });
      
      res.json({
        success: true,
        preference
      });
    } catch (error) {
      throw createSystemError('Failed to update notification preference', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/send
 * @desc Trigger notification manually
 * @access Private (Admin or API key)
 */
router.post('/send', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const {
      appId,
      eventId,
      userId,
      data = {}
    } = req.body;
    
    // Validate required fields
    if (!appId || !eventId || !userId) {
      throw createOperationalError('Missing required fields: appId, eventId, userId', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    // Validate userId format (assuming UUID)
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      throw createOperationalError('Invalid userId format', 400, 'INVALID_USER_ID');
    }
    
    // Validate data is an object
    if (data !== null && typeof data !== 'object') {
      throw createOperationalError('Data must be an object', 400, 'INVALID_DATA_TYPE');
    }
    
    try {
      const result = await notificationService.processNotification(
        appId,
        eventId,
        userId,
        data
      );
      
      logger.info('Manual notification sent', {
        appId,
        eventId,
        userId,
        operationId: result.operationId,
        triggeredBy: req.user.id
      });
      
      res.json({
        success: true,
        result
      });
    } catch (error) {
      logger.error('Failed to send manual notification', {
        appId,
        eventId,
        userId,
        error: error.message,
        triggeredBy: req.user.id
      });
      
      if (error.code === 'TEMPLATE_NOT_FOUND') {
        throw createOperationalError('Notification template not found', 404, 'TEMPLATE_NOT_FOUND');
      }
      
      if (error.code === 'USER_NOT_FOUND') {
        throw createOperationalError('Target user not found', 404, 'USER_NOT_FOUND');
      }
      
      throw createSystemError('Failed to process notification', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications
 * @desc Get user's notifications
 * @access Private
 */
router.get('/', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { limit = 20, offset = 0, unreadOnly = false } = req.query;
    
    // Validate query parameters
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw createOperationalError('Limit must be a number between 1 and 100', 400, 'INVALID_LIMIT');
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw createOperationalError('Offset must be a non-negative number', 400, 'INVALID_OFFSET');
    }
    
    const options = {
      limit: parsedLimit,
      offset: parsedOffset,
      unreadOnly: unreadOnly === 'true'
    };
    
    try {
      const { rows: notifications, count } = await notificationService.getUserNotifications(
        userId,
        options
      );
      
      res.json({
        success: true,
        notifications,
        total: count,
        limit: options.limit,
        offset: options.offset,
        hasMore: (options.offset + notifications.length) < count
      });
    } catch (error) {
      throw createSystemError('Failed to retrieve user notifications', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/:id/read
 * @desc Mark notification as read
 * @access Private
 */
router.post('/:id/read', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Notification ID is required', 400, 'MISSING_NOTIFICATION_ID');
    }
    
    try {
      const result = await notificationService.markAsRead(id, userId);
      
      if (!result) {
        throw createOperationalError('Notification not found or already read', 404, 'NOTIFICATION_NOT_FOUND');
      }
      
      logger.info('Notification marked as read', {
        notificationId: id,
        userId
      });
      
      res.json({
        success: true,
        message: 'Notification marked as read'
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to mark notification as read', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/device
 * @desc Register device token
 * @access Private
 */
router.post('/device', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { token, deviceId, platform, deviceModel, appVersion } = req.body;
    const userId = req.user.id;
    
    // Validate required fields
    if (!token || !deviceId || !platform) {
      throw createOperationalError('Token, deviceId, and platform are required', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    // Validate platform
    if (!['ios', 'android'].includes(platform.toLowerCase())) {
      throw createOperationalError('Platform must be either "ios" or "android"', 400, 'INVALID_PLATFORM');
    }
    
    // Validate token format (basic check)
    if (typeof token !== 'string' || token.trim().length < 10) {
      throw createOperationalError('Invalid device token format', 400, 'INVALID_TOKEN_FORMAT');
    }
    
    try {
      // Wait for database initialization if needed
      if (typeof db.waitForInitialization === 'function') {
        await db.waitForInitialization();
      }
      
      const models = typeof db.getModels === 'function' ? db.getModels() : db;
      const DeviceToken = models.DeviceToken;
      const TokenHistory = models.TokenHistory;
      
      if (!DeviceToken) {
        throw createSystemError('DeviceToken model not found');
      }
      
      const [deviceToken, created] = await DeviceToken.findOrCreate({
        where: { deviceId, userId },
        defaults: {
          id: uuidv4(),
          token,
          deviceType: 'mobile',
          platform: platform.toLowerCase(),
          active: true,
          lastUsed: new Date()
        }
      });
      
      let previousToken = null;
      if (!created) {
        previousToken = deviceToken.token;
        await deviceToken.update({
          token,
          platform: platform.toLowerCase(),
          active: true,
          lastUsed: new Date()
        });
      }
      
      // Log token registration
      if (TokenHistory) {
        try {
          await TokenHistory.create({
            id: uuidv4(),
            userId,
            token,
            tokenType: platform.toLowerCase() === 'ios' ? 'APN' : 'FCM',
            deviceId,
            deviceModel: deviceModel || null,
            deviceOS: platform.toLowerCase(),
            appVersion: appVersion || null,
            action: created ? 'REGISTERED' : 'RENEWED',
            previousToken,
            ipAddress: req.ip,
            userAgent: req.get('user-agent'),
            metadata: {
              source: 'notification_api',
              created: created
            }
          });
        } catch (historyError) {
          logger.error('Failed to log token history', {
            userId,
            deviceId,
            error: historyError.message
          });
          // Continue despite history error
        }
      }
      
      logger.info('Device token registered for notifications', {
        userId,
        deviceId,
        platform,
        created,
        tokenId: deviceToken.id
      });
      
      res.json({
        success: true,
        deviceToken: {
          id: deviceToken.id,
          deviceId,
          platform: platform.toLowerCase(),
          created
        }
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw createOperationalError('Device token already registered', 409, 'TOKEN_EXISTS');
      }
      
      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(`Validation failed: ${details}`, 400, 'VALIDATION_ERROR');
      }
      
      throw createSystemError('Failed to register device token', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/trigger-event
 * @desc Trigger notification for a business event
 * @access Private
 */
router.post('/trigger-event', 
  authenticate,
  asyncHandler(async (req, res) => {
    const {
      appId,
      eventId,
      recipients,  // array of userIds
      data,        // event-specific data for template variables
      metadata     // additional data
    } = req.body;
    
    // Validate required fields
    if (!appId || !eventId || !recipients || !Array.isArray(recipients)) {
      throw createOperationalError('appId, eventId, and recipients array are required', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    // Validate recipients array
    if (recipients.length === 0) {
      throw createOperationalError('Recipients array cannot be empty', 400, 'EMPTY_RECIPIENTS');
    }
    
    if (recipients.length > 1000) {
      throw createOperationalError('Cannot send to more than 1000 recipients at once', 400, 'TOO_MANY_RECIPIENTS');
    }
    
    // Validate recipient format
    for (const userId of recipients) {
      if (typeof userId !== 'string' || userId.trim().length === 0) {
        throw createOperationalError('All recipients must be valid user IDs', 400, 'INVALID_RECIPIENT_FORMAT');
      }
    }
    
    // Validate data is an object if provided
    if (data !== undefined && (data === null || typeof data !== 'object')) {
      throw createOperationalError('Data must be an object', 400, 'INVALID_DATA_TYPE');
    }
    
    logger.info('Received notification trigger request', {
      appId,
      eventId,
      recipientCount: recipients.length,
      triggeredBy: req.user.id
    });
    
    try {
      // Process each recipient
      const results = [];
      const errors = [];
      
      for (const userId of recipients) {
        try {
          const result = await notificationService.processNotification(
            appId,
            eventId,
            userId,
            data || {}
          );
          
          results.push({
            userId,
            success: true,
            operationId: result.operationId
          });
        } catch (error) {
          logger.error('Failed to process notification for user', {
            userId,
            eventId,
            error: error.message
          });
          
          const errorResult = {
            userId,
            success: false,
            error: error.message,
            code: error.code || 'PROCESSING_ERROR'
          };
          
          results.push(errorResult);
          errors.push(errorResult);
        }
      }
      
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      
      logger.info('Notification trigger batch completed', {
        appId,
        eventId,
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        triggeredBy: req.user.id
      });
      
      // If all failed, return error status
      if (successful.length === 0) {
        throw createOperationalError('Failed to send notifications to any recipients', 500, 'ALL_NOTIFICATIONS_FAILED');
      }
      
      res.json({
        success: true,
        eventId,
        processed: results.length,
        successful: successful.length,
        failed: failed.length,
        results,
        ...(failed.length > 0 && { 
          partialFailure: true,
          failedRecipients: failed.map(f => ({ userId: f.userId, error: f.error }))
        })
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      
      logger.error('Failed to trigger notification event', {
        appId,
        eventId,
        recipientCount: recipients.length,
        error: error.message,
        triggeredBy: req.user.id
      });
      
      throw createSystemError('Failed to trigger notification event', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/bulk-read
 * @desc Mark multiple notifications as read
 * @access Private
 */
router.post('/bulk-read', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { notificationIds } = req.body;
    const userId = req.user.id;
    
    if (!notificationIds || !Array.isArray(notificationIds)) {
      throw createOperationalError('notificationIds array is required', 400, 'MISSING_NOTIFICATION_IDS');
    }
    
    if (notificationIds.length === 0) {
      throw createOperationalError('notificationIds array cannot be empty', 400, 'EMPTY_NOTIFICATION_IDS');
    }
    
    if (notificationIds.length > 100) {
      throw createOperationalError('Cannot mark more than 100 notifications as read at once', 400, 'TOO_MANY_NOTIFICATIONS');
    }
    
    try {
      const result = await notificationService.bulkMarkAsRead(notificationIds, userId);
      
      logger.info('Bulk notifications marked as read', {
        userId,
        count: result.updated,
        notificationIds: notificationIds.slice(0, 10) // Log first 10 IDs
      });
      
      res.json({
        success: true,
        message: `${result.updated} notifications marked as read`,
        updated: result.updated
      });
    } catch (error) {
      throw createSystemError('Failed to bulk mark notifications as read', error);
    }
  })
);

module.exports = router;