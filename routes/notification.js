// routes/notification.js - COMPLETE FIXED VERSION
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
 * @desc Get notification templates (filtered by appId if provided)
 * @access Private
 */
router.get('/templates', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { appId } = req.query;

    try {
      if (typeof db.waitForInitialization === 'function') {
        await db.waitForInitialization();
      }

      const models = typeof db.getModels === 'function' ? db.getModels() : db;
      const NotificationTemplate = models.NotificationTemplate;

      if (!NotificationTemplate) {
        throw createSystemError('NotificationTemplate model not found');
      }

      let whereCondition = {};
      if (appId) {
        whereCondition = { appId };
      }

      const templates = await NotificationTemplate.findAll({
        where: whereCondition
      });

      res.json({
        success: true,
        templates
      });
    } catch (error) {
      logger.error('Failed to retrieve notification templates', {
        appId,
        error: error.message,
        stack: error.stack
      });
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
      logger.error('Failed to retrieve notification template', {
        appId,
        eventId,
        error: error.message,
        stack: error.stack
      });
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
      logger.error('Failed to delete notification template', {
        appId,
        eventId,
        error: error.message,
        stack: error.stack
      });
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
      logger.error('Failed to retrieve user notification preferences', {
        userId,
        appId,
        error: error.message,
        stack: error.stack
      });
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
      logger.error('Failed to update notification preference', {
        userId,
        eventId,
        appId,
        error: error.message,
        stack: error.stack
      });
      throw createSystemError('Failed to update notification preference', error);
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
      
      logger.error('Failed to register device token', {
        userId,
        deviceId,
        platform,
        error: error.message,
        stack: error.stack
      });
      throw createSystemError('Failed to register device token', error);
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
      
      if (error.message && error.message.includes('Template not found')) {
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
 * @route GET /api/v1/notifications/unread/count
 * @desc Get unread notification count by category
 * @access Private
 */
router.get('/unread/count', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    try {
      const result = await notificationService.getUnreadCounts(userId);
      
      // The service method returns { counts: { ... } }
      res.json({
        success: true,
        counts: result.counts || {}
      });
    } catch (error) {
      logger.error('Failed to get unread notification counts', {
        userId,
        error: error.message,
        stack: error.stack
      });
      throw createSystemError('Failed to get unread notification counts', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/stats
 * @desc Get notification statistics for user
 * @access Private
 */
router.get('/stats', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    try {
      const result = await notificationService.getNotificationStats(userId);
      
      // The service method returns { stats: { ... } }
      res.json({
        success: true,
        stats: result.stats || {}
      });
    } catch (error) {
      logger.error('Failed to get notification statistics', {
        userId,
        error: error.message,
        stack: error.stack
      });
      throw createSystemError('Failed to get notification statistics', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/by-category/:category
 * @desc Get notifications by category (activity, contracts, reminders)
 * @access Private
 */
router.get('/by-category/:category', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { category } = req.params;
    const userId = req.user.id;
    const { limit = 20, offset = 0, unreadOnly = false } = req.query;
    
    // Validate category
    if (!['activity', 'contracts', 'reminders'].includes(category)) {
      throw createOperationalError('Invalid category. Must be one of: activity, contracts, reminders', 400, 'INVALID_CATEGORY');
    }
    
    // Validate query parameters
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw createOperationalError('Limit must be a number between 1 and 100', 400, 'INVALID_LIMIT');
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw createOperationalError('Offset must be a non-negative number', 400, 'INVALID_OFFSET');
    }
    
    try {
      const options = {
        limit: parsedLimit,
        offset: parsedOffset,
        unreadOnly: unreadOnly === 'true'
      };
      
      const result = await notificationService.getNotificationsByCategory(userId, category, options);
      
      // The service method returns { success: true, notifications: [...], total: X, hasMore: boolean }
      const { notifications, total, hasMore } = result;
      
      res.json({
        success: true,
        notifications: notifications || [],
        total: total || 0,
        category,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: hasMore || false
      });
    } catch (error) {
      logger.error('Failed to retrieve notifications by category', {
        category,
        userId,
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError(`Failed to retrieve ${category} notifications`, error);
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
      const result = await notificationService.getUserNotifications(userId, options);
      
      // getUserNotifications returns { rows, count } (Sequelize format)
      const { rows: notifications, count } = result;
      
      res.json({
        success: true,
        notifications: notifications || [],
        total: count || 0,
        limit: options.limit,
        offset: options.offset,
        hasMore: (options.offset + notifications.length) < count
      });
    } catch (error) {
      logger.error('Failed to retrieve user notifications', {
        userId,
        options,
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to retrieve user notifications', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/all
 * @desc Get all notifications (Admin Only)
 * @access Private (Admin Only)
 */
router.get('/all', 
  authenticate, 
  // authorize('administrator'), // Uncomment if you want admin-only access
  asyncHandler(async (req, res) => {
    const { limit = 50, offset = 0, unreadOnly = false, appId, userId, eventId } = req.query;
    
    // Validation
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);

    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw createOperationalError('Limit must be a number between 1 and 200', 400, 'INVALID_LIMIT');
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw createOperationalError('Offset must be a non-negative number', 400, 'INVALID_OFFSET');
    }

    const options = {
      limit: parsedLimit,
      offset: parsedOffset,
      filters: {}
    };

    if (unreadOnly === 'true') options.filters.read = false;
    if (appId) options.filters.appId = appId;
    if (userId) options.filters.userId = userId;
    if (eventId) options.filters.eventId = eventId;
    
    try {
      const result = await notificationService.getAllNotifications(options);
      
      // getAllNotifications returns { rows, count } (Sequelize format)
      const { rows: notifications, count } = result;
      
      res.json({
        success: true,
        notifications: notifications || [],
        total: count || 0,
        limit: options.limit,
        offset: options.offset,
        hasMore: (options.offset + notifications.length) < count
      });
    } catch (error) {
      logger.error('Failed to retrieve all notifications', {
        options,
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to retrieve all notifications', error);
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
      logger.error('Failed to mark notification as read', {
        notificationId: id,
        userId,
        error: error.message,
        stack: error.stack
      });
      throw createSystemError('Failed to mark notification as read', error);
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
        requestedCount: notificationIds.length,
        updatedCount: result.updated
      });

      res.json({
        success: true,
        message: `${result.updated} notifications marked as read`,
        updatedCount: result.updated
      });
    } catch (error) {
      logger.error('Failed to bulk mark notifications as read', {
        userId,
        notificationIds: notificationIds.slice(0, 5), // Log first 5 IDs only
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to bulk mark notifications as read', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/read-all
 * @desc Mark all notifications as read for user
 * @access Private
 */
router.post('/read-all', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { category } = req.body; // Optional: mark only specific category as read
    
    // Validate category if provided
    if (category && !['activity', 'contracts', 'reminders'].includes(category)) {
      throw createOperationalError('Invalid category. Must be one of: activity, contracts, reminders', 400, 'INVALID_CATEGORY');
    }
    
    try {
      const result = await notificationService.markAllAsRead(userId, category);
      
      logger.info('All notifications marked as read', {
        userId,
        category: category || 'all',
        updatedCount: result.updated
      });

      res.json({
        success: true,
        message: `${result.updated} notifications marked as read`,
        updatedCount: result.updated,
        category: category || 'all'
      });
    } catch (error) {
      logger.error('Failed to mark all notifications as read', {
        userId,
        category: category || 'all',
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to mark all notifications as read', error);
    }
  })
);

// Add these debug routes to your existing notification.js file
// Insert them before the final module.exports = router;

/**
 * @route POST /api/v1/notifications/debug/create-test-data
 * @desc Create test notification data for debugging with various categories and events
 * @access Private
 */
router.post('/debug/create-test-data', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { count = 10, categories = ['activity', 'contracts', 'reminders'] } = req.body;
    
    try {
      await notificationService.ensureDbInitialized();
      const models = db.getModels ? db.getModels() : db;
      const { NotificationLog } = models;
      
      if (!NotificationLog) {
        throw createSystemError('NotificationLog model not found');
      }
      
      // Define realistic notification events with their data
      const notificationEvents = {
        activity: [
          {
            eventId: 'job_application_received',
            title: 'New Application for {{jobTitle}}',
            body: '{{applicantName}} has applied for your job posting',
            payload: {
              jobId: 'job-{{randomId}}',
              applicantId: 'user-{{randomId}}',
              applicantName: '{{applicantName}}',
              jobTitle: '{{jobTitle}}',
              action: 'view_application',
              screen: 'ApplicationDetails'
            }
          },
          {
            eventId: 'application_accepted',
            title: 'Application Accepted! 🎉',
            body: 'Your application for {{jobTitle}} has been accepted',
            payload: {
              jobId: 'job-{{randomId}}',
              clientName: '{{clientName}}',
              jobTitle: '{{jobTitle}}',
              action: 'view_job',
              screen: 'JobDetails'
            }
          },
          {
            eventId: 'application_rejected',
            title: 'Application Update',
            body: 'Your application for {{jobTitle}} was not selected this time',
            payload: {
              jobId: 'job-{{randomId}}',
              jobTitle: '{{jobTitle}}',
              action: 'view_feedback',
              screen: 'ApplicationFeedback'
            }
          },
          {
            eventId: 'job_completed',
            title: 'Job Completed Successfully',
            body: 'Congratulations! You completed {{jobTitle}}',
            payload: {
              jobId: 'job-{{randomId}}',
              jobTitle: '{{jobTitle}}',
              earnedAmount: '{{amount}}',
              action: 'leave_review',
              screen: 'ReviewClient'
            }
          },
          {
            eventId: 'new_review',
            title: 'New Review Received ⭐',
            body: '{{clientName}} left you a {{rating}}-star review',
            payload: {
              reviewId: 'review-{{randomId}}',
              clientName: '{{clientName}}',
              rating: '{{rating}}',
              action: 'view_review',
              screen: 'ReviewDetails'
            }
          },
          {
            eventId: 'milestone_completed',
            title: 'Milestone Achieved',
            body: 'Milestone "{{milestoneName}}" completed for {{jobTitle}}',
            payload: {
              jobId: 'job-{{randomId}}',
              milestoneId: 'milestone-{{randomId}}',
              milestoneName: '{{milestoneName}}',
              jobTitle: '{{jobTitle}}',
              action: 'view_milestone',
              screen: 'MilestoneDetails'
            }
          }
        ],
        contracts: [
          {
            eventId: 'contract_signed',
            title: 'Contract Signed 📝',
            body: 'Contract for {{projectTitle}} has been signed',
            payload: {
              contractId: 'contract-{{randomId}}',
              projectTitle: '{{projectTitle}}',
              clientName: '{{clientName}}',
              amount: '{{amount}}',
              action: 'view_contract',
              screen: 'ContractDetails'
            }
          },
          {
            eventId: 'payment_received',
            title: 'Payment Received 💰',
            body: 'You received {{amount}} for {{projectTitle}}',
            payload: {
              paymentId: 'payment-{{randomId}}',
              amount: '{{amount}}',
              projectTitle: '{{projectTitle}}',
              contractId: 'contract-{{randomId}}',
              action: 'view_payment',
              screen: 'PaymentDetails'
            }
          },
          {
            eventId: 'payment_released',
            title: 'Payment Released',
            body: 'Payment of {{amount}} has been released for {{projectTitle}}',
            payload: {
              paymentId: 'payment-{{randomId}}',
              amount: '{{amount}}',
              projectTitle: '{{projectTitle}}',
              action: 'view_wallet',
              screen: 'Wallet'
            }
          },
          {
            eventId: 'milestone_payment',
            title: 'Milestone Payment',
            body: 'Payment of {{amount}} for milestone "{{milestoneName}}"',
            payload: {
              paymentId: 'payment-{{randomId}}',
              milestoneId: 'milestone-{{randomId}}',
              milestoneName: '{{milestoneName}}',
              amount: '{{amount}}',
              action: 'view_milestone_payment',
              screen: 'MilestonePayment'
            }
          },
          {
            eventId: 'contract_updated',
            title: 'Contract Updated',
            body: 'Contract for {{projectTitle}} has been updated',
            payload: {
              contractId: 'contract-{{randomId}}',
              projectTitle: '{{projectTitle}}',
              updateType: '{{updateType}}',
              action: 'review_changes',
              screen: 'ContractChanges'
            }
          }
        ],
        reminders: [
          {
            eventId: 'payment_due',
            title: 'Payment Due Reminder 📅',
            body: 'Payment of {{amount}} is due on {{dueDate}}',
            payload: {
              invoiceId: 'invoice-{{randomId}}',
              amount: '{{amount}}',
              dueDate: '{{dueDate}}',
              action: 'pay_invoice',
              screen: 'PaymentScreen'
            }
          },
          {
            eventId: 'deadline_approaching',
            title: 'Deadline Approaching ⏰',
            body: 'Project {{projectTitle}} deadline is in {{daysLeft}} days',
            payload: {
              projectId: 'project-{{randomId}}',
              projectTitle: '{{projectTitle}}',
              daysLeft: '{{daysLeft}}',
              deadline: '{{deadline}}',
              action: 'view_project',
              screen: 'ProjectDetails'
            }
          },
          {
            eventId: 'profile_incomplete',
            title: 'Complete Your Profile',
            body: 'Complete your profile to increase your chances of getting hired',
            payload: {
              completionPercentage: '{{completionPercentage}}',
              missingFields: '{{missingFields}}',
              action: 'complete_profile',
              screen: 'ProfileEdit'
            }
          },
          {
            eventId: 'verification_required',
            title: 'Verification Required 🔐',
            body: 'Please verify your {{verificationType}} to continue',
            payload: {
              verificationType: '{{verificationType}}',
              action: 'verify_account',
              screen: 'Verification'
            }
          },
          {
            eventId: 'payment_overdue',
            title: 'Payment Overdue ⚠️',
            body: 'Payment of {{amount}} is {{daysOverdue}} days overdue',
            payload: {
              invoiceId: 'invoice-{{randomId}}',
              amount: '{{amount}}',
              daysOverdue: '{{daysOverdue}}',
              action: 'pay_overdue',
              screen: 'OverduePayment'
            }
          }
        ]
      };
      
      // Sample data for template replacement
      const sampleData = {
        applicantNames: ['John Smith', 'Sarah Johnson', 'Mike Chen', 'Emma Davis', 'Alex Rodriguez'],
        clientNames: ['TechCorp Inc', 'StartupXYZ', 'Design Studio', 'Digital Agency', 'E-commerce Co'],
        jobTitles: ['React Developer', 'UI/UX Designer', 'Content Writer', 'Mobile App Developer', 'Digital Marketer'],
        projectTitles: ['E-commerce Website', 'Mobile App Design', 'Brand Identity', 'Web Application', 'Marketing Campaign'],
        milestoneNames: ['Initial Design', 'Frontend Development', 'Backend Integration', 'Testing Phase', 'Final Delivery'],
        amounts: ['$500', '$1,200', '$800', '$2,000', '$1,500'],
        ratings: ['5', '4', '5', '4', '5'],
        verificationTypes: ['email address', 'phone number', 'identity document'],
        updateTypes: ['scope change', 'timeline update', 'payment terms'],
        missingFields: ['skills', 'portfolio', 'bio']
      };
      
      // Create test notifications
      const testNotifications = [];
      const now = new Date();
      
      for (let i = 0; i < count; i++) {
        // Select category (cycle through or use provided categories)
        const categoryIndex = i % categories.length;
        const category = categories[categoryIndex];
        const events = notificationEvents[category];
        const eventTemplate = events[i % events.length];
        
        // Generate random data
        const randomId = Math.random().toString(36).substr(2, 9);
        const applicantName = sampleData.applicantNames[Math.floor(Math.random() * sampleData.applicantNames.length)];
        const clientName = sampleData.clientNames[Math.floor(Math.random() * sampleData.clientNames.length)];
        const jobTitle = sampleData.jobTitles[Math.floor(Math.random() * sampleData.jobTitles.length)];
        const projectTitle = sampleData.projectTitles[Math.floor(Math.random() * sampleData.projectTitles.length)];
        const milestoneName = sampleData.milestoneNames[Math.floor(Math.random() * sampleData.milestoneNames.length)];
        const amount = sampleData.amounts[Math.floor(Math.random() * sampleData.amounts.length)];
        const rating = sampleData.ratings[Math.floor(Math.random() * sampleData.ratings.length)];
        const verificationType = sampleData.verificationTypes[Math.floor(Math.random() * sampleData.verificationTypes.length)];
        const updateType = sampleData.updateTypes[Math.floor(Math.random() * sampleData.updateTypes.length)];
        const missingFields = sampleData.missingFields[Math.floor(Math.random() * sampleData.missingFields.length)];
        
        // Calculate dates
        const createdAt = new Date(now.getTime() - (i * 3600000) - Math.random() * 7 * 24 * 3600000); // Random within last week
        const dueDate = new Date(now.getTime() + Math.random() * 30 * 24 * 3600000); // Random within next month
        const deadline = new Date(now.getTime() + Math.random() * 14 * 24 * 3600000); // Random within next 2 weeks
        const daysLeft = Math.ceil((deadline - now) / (24 * 3600000));
        const daysOverdue = Math.ceil(Math.random() * 10) + 1;
        const completionPercentage = Math.floor(Math.random() * 40) + 40; // 40-80%
        
        // Replace template variables
        const templateData = {
          randomId,
          applicantName,
          clientName,
          jobTitle,
          projectTitle,
          milestoneName,
          amount,
          rating,
          verificationType,
          updateType,
          missingFields,
          dueDate: dueDate.toLocaleDateString(),
          deadline: deadline.toLocaleDateString(),
          daysLeft: daysLeft.toString(),
          daysOverdue: daysOverdue.toString(),
          completionPercentage: completionPercentage.toString()
        };
        
        // Compile title and body
        let compiledTitle = eventTemplate.title;
        let compiledBody = eventTemplate.body;
        let compiledPayload = JSON.parse(JSON.stringify(eventTemplate.payload));
        
        // Replace variables in title, body, and payload
        Object.entries(templateData).forEach(([key, value]) => {
          const regex = new RegExp(`{{${key}}}`, 'g');
          compiledTitle = compiledTitle.replace(regex, value);
          compiledBody = compiledBody.replace(regex, value);
          compiledPayload = JSON.parse(JSON.stringify(compiledPayload).replace(regex, value));
        });
        
        // Determine if notification should be read (30% chance)
        const isRead = Math.random() < 0.3;
        
        const notification = {
          id: uuidv4(),
          userId,
          eventId: eventTemplate.eventId,
          appId: 'freelance-app',
          title: compiledTitle,
          body: compiledBody,
          payload: compiledPayload,
          status: 'delivered',
          channel: 'push',
          platform: 'mobile',
          createdAt,
          sentAt: createdAt,
          deliveredAt: new Date(createdAt.getTime() + 1000), // 1 second after creation
          readAt: isRead ? new Date(createdAt.getTime() + Math.random() * 24 * 3600000) : null // Random read time within 24h
        };
        
        testNotifications.push(notification);
      }
      
      // Insert notifications into database
      await NotificationLog.bulkCreate(testNotifications);
      
      // Calculate summary statistics
      const summary = {
        total: testNotifications.length,
        byCategory: {},
        byEventId: {},
        readCount: testNotifications.filter(n => n.readAt).length,
        unreadCount: testNotifications.filter(n => !n.readAt).length
      };
      
      // Group by category
      categories.forEach(category => {
        const categoryEvents = notificationEvents[category].map(e => e.eventId);
        const categoryNotifications = testNotifications.filter(n => categoryEvents.includes(n.eventId));
        summary.byCategory[category] = {
          total: categoryNotifications.length,
          read: categoryNotifications.filter(n => n.readAt).length,
          unread: categoryNotifications.filter(n => !n.readAt).length
        };
      });
      
      // Group by event ID
      testNotifications.forEach(n => {
        if (!summary.byEventId[n.eventId]) {
          summary.byEventId[n.eventId] = 0;
        }
        summary.byEventId[n.eventId]++;
      });
      
      logger.info('Test notification data created', {
        userId,
        count: testNotifications.length,
        categories,
        summary
      });
      
      res.json({
        success: true,
        message: `Created ${testNotifications.length} test notifications`,
        summary,
        notifications: testNotifications.map(n => ({
          id: n.id,
          eventId: n.eventId,
          title: n.title,
          read: !!n.readAt,
          category: notificationService.getCategoryFromEventId(n.eventId),
          createdAt: n.createdAt
        })).slice(0, 10) // Return first 10 for preview
      });
    } catch (error) {
      logger.error('Failed to create test notification data', {
        userId,
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to create test notification data', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/debug/raw-data
 * @desc Get raw notification data for debugging
 * @access Private
 */
router.get('/debug/raw-data', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    try {
      await notificationService.ensureDbInitialized();
      const models = db.getModels ? db.getModels() : db;
      const { NotificationLog } = models;
      
      if (!NotificationLog) {
        throw createSystemError('NotificationLog model not found');
      }
      
      // Get raw data from database
      const rawNotifications = await NotificationLog.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 50,
        raw: true
      });
      
      // Get counts by category using the service helper methods
      const activityEvents = notificationService.getEventIdsByCategory('activity');
      const contractEvents = notificationService.getEventIdsByCategory('contracts');
      const reminderEvents = notificationService.getEventIdsByCategory('reminders');
      
      const activityCount = await NotificationLog.count({
        where: { userId, eventId: activityEvents }
      });
      
      const contractCount = await NotificationLog.count({
        where: { userId, eventId: contractEvents }
      });
      
      const reminderCount = await NotificationLog.count({
        where: { userId, eventId: reminderEvents }
      });
      
      const unreadCount = await NotificationLog.count({
        where: { userId, readAt: null }
      });
      
      const totalCount = await NotificationLog.count({
        where: { userId }
      });
      
      // Group notifications by event type
      const eventCounts = {};
      rawNotifications.forEach(notification => {
        eventCounts[notification.eventId] = (eventCounts[notification.eventId] || 0) + 1;
      });
      
      res.json({
        success: true,
        debug: {
          userId,
          totalNotifications: totalCount,
          unreadCount,
          categoryCounts: {
            activity: activityCount,
            contracts: contractCount,
            reminders: reminderCount
          },
          eventCounts,
          rawNotifications: rawNotifications.slice(0, 10), // First 10 for inspection
          sampleTransformed: rawNotifications.slice(0, 3).map(n => ({
            id: n.id,
            title: n.title,
            body: n.body,
            eventId: n.eventId,
            category: notificationService.getCategoryFromEventId(n.eventId),
            read: !!n.readAt,
            createdAt: n.createdAt,
            payload: n.payload
          })),
          databaseStructure: {
            tableExists: true,
            hasData: totalCount > 0,
            oldestNotification: rawNotifications.length > 0 ? rawNotifications[rawNotifications.length - 1].createdAt : null,
            newestNotification: rawNotifications.length > 0 ? rawNotifications[0].createdAt : null
          }
        }
      });
    } catch (error) {
      logger.error('Failed to get raw notification data', {
        userId,
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to get raw notification data', error);
    }
  })
);

/**
 * @route DELETE /api/v1/notifications/debug/clear-data
 * @desc Clear test notification data
 * @access Private
 */
router.delete('/debug/clear-data', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { appId = 'freelance-app' } = req.query;
    
    try {
      await notificationService.ensureDbInitialized();
      const models = db.getModels ? db.getModels() : db;
      const { NotificationLog } = models;
      
      if (!NotificationLog) {
        throw createSystemError('NotificationLog model not found');
      }
      
      // Count before deletion
      const beforeCount = await NotificationLog.count({
        where: { userId, appId }
      });
      
      // Delete all notifications for this user and app
      const deleted = await NotificationLog.destroy({
        where: { userId, appId }
      });
      
      logger.info('Test notification data cleared', {
        userId,
        appId,
        deletedCount: deleted
      });
      
      res.json({
        success: true,
        message: `Cleared ${deleted} test notifications`,
        beforeCount,
        deletedCount: deleted
      });
    } catch (error) {
      logger.error('Failed to clear test notification data', {
        userId,
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to clear test notification data', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/debug/event-types
 * @desc Get all available notification event types and categories
 * @access Private
 */
router.get('/debug/event-types', 
  authenticate, 
  asyncHandler(async (req, res) => {
    try {
      const eventsByCategory = {
        activity: [
          { eventId: 'job_application_received', description: 'When someone applies for a job' },
          { eventId: 'application_accepted', description: 'When an application is accepted' },
          { eventId: 'application_rejected', description: 'When an application is rejected' },
          { eventId: 'job_completed', description: 'When a job is completed successfully' },
          { eventId: 'new_review', description: 'When a new review is received' },
          { eventId: 'milestone_completed', description: 'When a project milestone is completed' }
        ],
        contracts: [
          { eventId: 'contract_signed', description: 'When a contract is signed' },
          { eventId: 'payment_received', description: 'When payment is received' },
          { eventId: 'payment_released', description: 'When payment is released from escrow' },
          { eventId: 'milestone_payment', description: 'When milestone payment is made' },
          { eventId: 'contract_updated', description: 'When contract terms are updated' }
        ],
        reminders: [
          { eventId: 'payment_due', description: 'Payment due date reminder' },
          { eventId: 'deadline_approaching', description: 'Project deadline approaching' },
          { eventId: 'profile_incomplete', description: 'Profile completion reminder' },
          { eventId: 'verification_required', description: 'Account verification required' },
          { eventId: 'payment_overdue', description: 'Payment overdue notice' }
        ]
      };
      
      res.json({
        success: true,
        eventTypes: eventsByCategory,
        totalEventTypes: Object.values(eventsByCategory).flat().length,
        categories: Object.keys(eventsByCategory)
      });
    } catch (error) {
      logger.error('Failed to get event types', {
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to get event types', error);
    }
  })
);

// Add cache-control headers to prevent 304 responses during debugging
router.use('/debug/*', (req, res, next) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  next();
});

module.exports = router;
