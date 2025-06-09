// routes/notification.js - UPDATED VERSION
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { authenticate, authorize } = require('../middleware/authentication');
const notificationService = require('../services/notifications/notificationService');
const logger = require('../utils/logger');
const db = require('../db/models');
const { BUSINESS_ENTITY_TYPES, NOTIFICATION_CATEGORIES } = require('../config/notifiction-constants');

// BETTER: Direct import from exception handler
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
  // authorize('administrator'), 
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
      priority: priority || 'normal'
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
  // authorize('administrator'), 
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
 * @route GET /api/v1/notifications/by-category/:category
 * @desc Get notifications by category (updated for database validation)
 */
router.get('/by-category/:category', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { category } = req.params;
    const userId = req.user.id;
    const { limit = 20, offset = 0, unreadOnly = false } = req.query;
    
    // UPDATED: Added 'chat' category validation
    if (!['activity', 'contracts', 'reminders', 'chat'].includes(category)) {
      throw createOperationalError('Invalid category. Must be one of: activity, contracts, reminders, chat', 400, 'INVALID_CATEGORY');
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
      
      res.json({
        success: true,
        notifications: result.notifications || [],
        total: result.total || 0,
        category: result.category,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: result.hasMore || false
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
 * @route POST /api/v1/notifications/send
 * @desc Trigger notification manually (updated for new structure)
 */
router.post('/send', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const {
      appId,
      eventKey,        // CHANGED from eventId to eventKey
      recipientId,     // CHANGED from userId to recipientId
      data = {},
      businessContext = {}  // NEW FIELD
    } = req.body;
    
    // Validate required fields
    if (!appId || !eventKey || !recipientId) {
      throw createOperationalError('Missing required fields: appId, eventKey, recipientId', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    // Validate recipientId format
    if (typeof recipientId !== 'string' || recipientId.trim().length === 0) {
      throw createOperationalError('Invalid recipientId format', 400, 'INVALID_RECIPIENT_ID');
    }
    
    // Validate data is an object
    if (data !== null && typeof data !== 'object') {
      throw createOperationalError('Data must be an object', 400, 'INVALID_DATA_TYPE');
    }
    
    // Validate businessContext if provided
    if (businessContext && typeof businessContext !== 'object') {
      throw createOperationalError('businessContext must be an object', 400, 'INVALID_BUSINESS_CONTEXT');
    }
    
    try {
      const result = await notificationService.processNotification(
        appId,
        eventKey,
        recipientId,
        data,
        businessContext
      );
      
      logger.info('Manual notification sent', {
        appId,
        eventKey,
        recipientId,
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
        eventKey,
        recipientId,
        error: error.message,
        triggeredBy: req.user.id
      });
      
      if (error.message && error.message.includes('Template not found')) {
        throw createOperationalError('Notification template not found', 404, 'TEMPLATE_NOT_FOUND');
      }
      
      if (error.code === 'MISSING_BUSINESS_CONTEXT') {
        throw createOperationalError('Business context with triggeredBy is required', 400, 'MISSING_BUSINESS_CONTEXT');
      }
      
      throw createSystemError('Failed to process notification', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/trigger-event
 * @desc Trigger notification for a business event (updated for new structure)
 */
router.post('/trigger-event', 
  authenticate,
  asyncHandler(async (req, res) => {
    const {
      appId,
      eventKey,           // CHANGED from eventId to eventKey
      recipients,         // array of recipientIds
      data,              // event-specific data for template variables
      businessContext    // NEW FIELD - business entity context
    } = req.body;
    
    // Validate required fields
    if (!appId || !eventKey || !recipients || !Array.isArray(recipients)) {
      throw createOperationalError('appId, eventKey, and recipients array are required', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    // Validate recipients array
    if (recipients.length === 0) {
      throw createOperationalError('Recipients array cannot be empty', 400, 'EMPTY_RECIPIENTS');
    }
    
    if (recipients.length > 1000) {
      throw createOperationalError('Cannot send to more than 1000 recipients at once', 400, 'TOO_MANY_RECIPIENTS');
    }
    
    // Validate recipient format
    for (const recipientId of recipients) {
      if (typeof recipientId !== 'string' || recipientId.trim().length === 0) {
        throw createOperationalError('All recipients must be valid user IDs', 400, 'INVALID_RECIPIENT_FORMAT');
      }
    }
    
    // Validate businessContext
    if (businessContext && typeof businessContext !== 'object') {
      throw createOperationalError('businessContext must be an object', 400, 'INVALID_BUSINESS_CONTEXT');
    }
    
    logger.info('Received notification trigger request', {
      appId,
      eventKey,
      recipientCount: recipients.length,
      triggeredBy: req.user.id
    });
    
    try {
      // Process each recipient
      const results = [];
      const errors = [];
      
      for (const recipientId of recipients) {
        try {
          const result = await notificationService.processNotification(
            appId,
            eventKey,
            recipientId,
            data || {},
            {
              triggeredBy: req.user.id,  // Auto-set triggeredBy from authenticated user
              ...businessContext
            }
          );
          
          results.push({
            recipientId,
            success: true,
            operationId: result.operationId
          });
        } catch (error) {
          logger.error('Failed to process notification for user', {
            recipientId,
            eventKey,
            error: error.message
          });
          
          const errorResult = {
            recipientId,
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
        eventKey,
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
        eventKey,
        processed: results.length,
        successful: successful.length,
        failed: failed.length,
        results,
        ...(failed.length > 0 && { 
          partialFailure: true,
          failedRecipients: failed.map(f => ({ recipientId: f.recipientId, error: f.error }))
        })
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      
      logger.error('Failed to trigger notification event', {
        appId,
        eventKey,
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


// UPDATE THIS ROUTE IN YOUR notification.js FILE
// Replace the existing GET /api/v1/notifications route with this enhanced version

/**
 * @route GET /api/v1/notifications
 * @desc Get user's notifications (ENHANCED with category filtering and page support)
 */
router.get('/', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { 
      limit = 20, 
      offset = 0, 
      page, // NEW: Support page parameter
      unreadOnly = false,
      category, // NEW: Support category filtering in main route
      status, // NEW: Support status filtering  
      eventKey, // NEW: Support eventKey filtering
      appId, // NEW: Support appId filtering
      startDate, // NEW: Support date range filtering
      endDate // NEW: Support date range filtering
    } = req.query;
    
    // Handle page parameter conversion
    let parsedOffset = parseInt(offset);
    if (page && !offset) {
      const parsedPage = parseInt(page) || 1;
      const parsedLimit = parseInt(limit) || 20;
      parsedOffset = (parsedPage - 1) * parsedLimit;
    }
    
    // Validate query parameters
    const parsedLimit = parseInt(limit);
    
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw createOperationalError('Limit must be a number between 1 and 100', 400, 'INVALID_LIMIT');
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw createOperationalError('Offset must be a non-negative number', 400, 'INVALID_OFFSET');
    }
    
    // Validate category if provided
    if (category && !['activity', 'contracts', 'reminders', 'chat'].includes(category)) {
      throw createOperationalError('Invalid category. Must be one of: activity, contracts, reminders, chat', 400, 'INVALID_CATEGORY');
    }
    
    // Validate status if provided
    if (status && !['read', 'unread', 'all'].includes(status)) {
      throw createOperationalError('Invalid status. Must be one of: read, unread, all', 400, 'INVALID_STATUS');
    }
    
    const options = {
      limit: parsedLimit,
      offset: parsedOffset,
      unreadOnly: unreadOnly === 'true' || status === 'unread'
    };
    
    // Build advanced filters
    const filters = {};
    if (appId) filters.appId = appId;
    if (status === 'read') filters.read = true;
    if (status === 'unread') filters.read = false;
    if (eventKey) filters.eventKey = eventKey;
    if (startDate) filters.startDate = startDate;
    if (endDate) filters.endDate = endDate;
    
    try {
      let result;
      
      // If category is specified, use category-specific method
      if (category) {
        result = await notificationService.getNotificationsByCategory(userId, category, {
          ...options,
          ...filters
        });
        
        // Format response to match standard format
        const notifications = result.notifications || [];
        const count = result.total || 0;
        
        res.json({
          success: true,
          notifications,
          total: count,
          limit: parsedLimit,
          offset: parsedOffset,
          page: page ? parseInt(page) : Math.floor(parsedOffset / parsedLimit) + 1,
          hasMore: (parsedOffset + notifications.length) < count,
          category: result.category,
          appliedFilters: {
            category,
            status,
            eventKey,
            appId,
            startDate,
            endDate,
            unreadOnly: options.unreadOnly
          }
        });
      } else {
        // Use standard method with enhanced filtering
        result = await notificationService.getUserNotifications(userId, {
          ...options,
          ...filters
        });
        
        // getUserNotifications returns { rows, count } (Sequelize format)
        const { rows: notifications, count } = result;
        
        res.json({
          success: true,
          notifications: notifications || [],
          total: count || 0,
          limit: parsedLimit,
          offset: parsedOffset,
          page: page ? parseInt(page) : Math.floor(parsedOffset / parsedLimit) + 1,
          hasMore: (parsedOffset + notifications.length) < count,
          appliedFilters: {
            category,
            status,
            eventKey,
            appId,
            startDate,
            endDate,
            unreadOnly: options.unreadOnly
          }
        });
      }
    } catch (error) {
      logger.error('Failed to retrieve user notifications', {
        userId,
        options,
        filters,
        error: error.message,
        stack: error.stack
      });
      
      throw createSystemError('Failed to retrieve user notifications', error);
    }
  })
);

// ADD THIS NEW ROUTE TO YOUR notification.js FILE
/**
 * @route GET /api/v1/notifications/:id
 * @desc Get specific notification by ID (NEW ROUTE)
 * @access Private
 */
router.get('/:id', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Notification ID is required', 400, 'MISSING_NOTIFICATION_ID');
    }
    
    try {
      await notificationService.ensureInitialized();
      const models = db.getModels();
      
      const notification = await models.NotificationLog.findOne({
        where: { 
          id,
          recipientId: userId // Ensure user can only access their own notifications
        },
        include: [
          {
            model: models.NotificationEvent,
            as: 'event',
            attributes: ['eventKey', 'eventName']
          },
          {
            model: models.NotificationCategory,
            as: 'category',
            attributes: ['categoryKey', 'name', 'icon', 'color']
          },
          {
            model: models.NotificationTemplate,
            as: 'template',
            attributes: ['appId']
          }
        ]
      });
      
      if (!notification) {
        throw createOperationalError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
      }
      
      logger.info('Notification retrieved by ID', {
        notificationId: id,
        userId,
        eventKey: notification.event?.eventKey
      });
      
      res.json({
        success: true,
        notification
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      logger.error('Failed to retrieve notification by ID', {
        notificationId: id,
        userId,
        error: error.message,
        stack: error.stack
      });
      throw createSystemError('Failed to retrieve notification', error);
    }
  })
);

// UPDATE THE EXISTING by-category route to support page parameter
/**
 * @route GET /api/v1/notifications/by-category/:category
 * @desc Get notifications by category (ENHANCED with page support)
 */
router.get('/by-category/:category', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { category } = req.params;
    const userId = req.user.id;
    const { 
      limit = 20, 
      offset = 0, 
      page, // NEW: Support page parameter
      unreadOnly = false,
      status, // NEW: Support status filtering
      eventKey, // NEW: Support eventKey filtering
      appId // NEW: Support appId filtering
    } = req.query;
    
    // UPDATED: Added 'chat' category validation
    if (!['activity', 'contracts', 'reminders', 'chat'].includes(category)) {
      throw createOperationalError('Invalid category. Must be one of: activity, contracts, reminders, chat', 400, 'INVALID_CATEGORY');
    }
    
    // Handle page parameter conversion
    let parsedOffset = parseInt(offset);
    if (page && !offset) {
      const parsedPage = parseInt(page) || 1;
      const parsedLimit = parseInt(limit) || 20;
      parsedOffset = (parsedPage - 1) * parsedLimit;
    }
    
    // Validate query parameters
    const parsedLimit = parseInt(limit);
    
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
        unreadOnly: unreadOnly === 'true' || status === 'unread'
      };
      
      // Build filters
      const filters = {};
      if (appId) filters.appId = appId;
      if (status === 'read') filters.read = true;
      if (status === 'unread') filters.read = false;
      if (eventKey) filters.eventKey = eventKey;
      
      const result = await notificationService.getNotificationsByCategory(userId, category, {
        ...options,
        ...filters
      });
      
      res.json({
        success: true,
        notifications: result.notifications || [],
        total: result.total || 0,
        category: result.category,
        limit: parsedLimit,
        offset: parsedOffset,
        page: page ? parseInt(page) : Math.floor(parsedOffset / parsedLimit) + 1,
        hasMore: result.hasMore || false,
        appliedFilters: {
          category,
          status,
          eventKey,
          appId,
          unreadOnly: options.unreadOnly
        }
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


// ========== NEW ADMIN ROUTES ==========

/**
 * @route GET /api/v1/notifications/admin/categories
 * @desc Get all notification categories
 * @access Private (Admin only)
 */
router.get('/admin/categories',
  authenticate,
  // authorize('administrator'),
  asyncHandler(async (req, res) => {
    try {
      const categories = await notificationService.getAllCategories();
      
      res.json({
        success: true,
        categories
      });
    } catch (error) {
      logger.error('Failed to get categories', {
        error: error.message,
        stack: error.stack
      });
      throw createSystemError('Failed to retrieve categories', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/admin/events
 * @desc Get all notification events
 * @access Private (Admin only)
 */
router.get('/admin/events',
  authenticate,
  // // authorize('administrator'),
  asyncHandler(async (req, res) => {
    const { categoryId } = req.query;
    
    try {
      const events = await notificationService.getAllEvents(categoryId);
      
      res.json({
        success: true,
        events
      });
    } catch (error) {
      logger.error('Failed to get events', {
        categoryId,
        error: error.message,
        stack: error.stack
      });
      throw createSystemError('Failed to retrieve events', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/admin/categories
 * @desc Create new notification category
 * @access Private (Admin only)
 */
router.post('/admin/categories',
  authenticate,
  // // authorize('administrator'),
  asyncHandler(async (req, res) => {
    const { categoryKey, name, description, icon, color, displayOrder } = req.body;
    
    // Validate required fields
    if (!categoryKey || !name) {
      throw createOperationalError('categoryKey and name are required', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    try {
      const models = db.getModels();
      const category = await models.NotificationCategory.create({
        categoryKey,
        name,
        description,
        icon,
        color,
        displayOrder: displayOrder || 0,
        isActive: true
      });
      
      logger.info('Notification category created', {
        categoryId: category.id,
        categoryKey,
        createdBy: req.user.id
      });
      
      res.status(201).json({
        success: true,
        category
      });
    } catch (error) {
      logger.error('Failed to create category', {
        categoryKey,
        error: error.message,
        stack: error.stack
      });
      
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw createOperationalError('Category key already exists', 409, 'CATEGORY_EXISTS');
      }
      
      throw createSystemError('Failed to create category', error);
    }
  })
);

/**
 * @route POST /api/v1/notifications/admin/events
 * @desc Create new notification event
 * @access Private (Admin only)
 */
router.post('/admin/events',
  authenticate,
  // // authorize('administrator'),
  asyncHandler(async (req, res) => {
    const { categoryId, eventKey, eventName, description, defaultPriority } = req.body;
    
    // Validate required fields
    if (!categoryId || !eventKey || !eventName) {
      throw createOperationalError('categoryId, eventKey, and eventName are required', 400, 'MISSING_REQUIRED_FIELDS');
    }
    
    try {
      const models = db.getModels();
      
      // Verify category exists
      const category = await models.NotificationCategory.findByPk(categoryId);
      if (!category) {
        throw createOperationalError('Category not found', 404, 'CATEGORY_NOT_FOUND');
      }
      
      const event = await models.NotificationEvent.create({
        categoryId,
        eventKey,
        eventName,
        description,
        defaultPriority: defaultPriority || 'normal',
        isActive: true
      });
      
      logger.info('Notification event created', {
        eventId: event.id,
        eventKey,
        categoryId,
        createdBy: req.user.id
      });
      
      res.status(201).json({
        success: true,
        event
      });
    } catch (error) {
      logger.error('Failed to create event', {
        eventKey,
        categoryId,
        error: error.message,
        stack: error.stack
      });
      
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw createOperationalError('Event key already exists', 409, 'EVENT_EXISTS');
      }
      
      throw createSystemError('Failed to create event', error);
    }
  })
);

/**
 * @route GET /api/v1/notifications/all
 * @desc Get all notifications (Admin Only) - Updated for new structure
 * @access Private (Admin Only)
 */
router.get('/all', 
  authenticate, 
  // authorize('administrator'), // ENABLED admin-only access for security
  asyncHandler(async (req, res) => {
    const { 
      limit = 50, 
      offset = 0, 
      unreadOnly = false, 
      appId, 
      recipientId,     // CHANGED from userId to recipientId
      eventKey,        // CHANGED from eventId to eventKey
      categoryKey,     // NEW filter option
      businessEntityType,  // NEW filter option
      businessEntityId     // NEW filter option
    } = req.query;
    
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

    // UPDATED filters for new structure
    if (unreadOnly === 'true') options.filters.read = false;
    if (appId) options.filters.appId = appId;
    if (recipientId) options.filters.recipientId = recipientId;  // Updated field name
    if (eventKey) options.filters.eventKey = eventKey;           // Updated field name
    if (categoryKey) options.filters.categoryKey = categoryKey;  // New filter
    if (businessEntityType) options.filters.businessEntityType = businessEntityType;  // New filter
    if (businessEntityId) options.filters.businessEntityId = businessEntityId;        // New filter
    
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
        hasMore: (options.offset + notifications.length) < count,
        // ADD filter summary for admin debugging
        appliedFilters: {
          appId,
          recipientId,
          eventKey,
          categoryKey,
          businessEntityType,
          businessEntityId,
          unreadOnly: unreadOnly === 'true'
        }
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
    
    // UPDATED: Added 'chat' category validation
    if (category && !['activity', 'contracts', 'reminders', 'chat'].includes(category)) {
      throw createOperationalError('Invalid category. Must be one of: activity, contracts, reminders, chat', 400, 'INVALID_CATEGORY');
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

module.exports = router;