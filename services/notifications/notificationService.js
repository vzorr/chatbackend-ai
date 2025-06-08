// services/notifications/notificationService.js - FIXED VERSION
const handlebars = require('handlebars');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const logger = require('../../utils/logger');
const fcmService = require('./fcm');

class NotificationService {
  constructor() {
    this.initialized = false;
    this.initPromise = null;
    this.providers = new Map(); 
  }

  async ensureInitialized() {
    if (this.initialized) {
      return true;
    }

    if (this.initPromise) {
      return await this.initPromise;
    }

    this.initPromise = this.initialize();
    return await this.initPromise;
  }

  async initialize() {
    try {
      logger.info('Initializing notification service...');

      // Initialize database
      if (!db.isInitialized()) {
        logger.info('Waiting for database initialization...');
        await db.waitForInitialization();
      }

      // Initialize FCM
      const fcmInitialized = await fcmService.initialize();
      if (!fcmInitialized) {
        logger.warn('FCM service failed to initialize - push notifications may not work');
      } else {
        this.providers.set('FCM', fcmService); // For compatibility
      }

      this.initialized = true;
      logger.info('Notification service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize notification service', {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  /**
   * MAIN METHOD: Process a notification event and send to user
   * This is what the route calls and where the error originates
   */
  async processNotification(appId, eventId, userId, data = {}) {
    const operationId = uuidv4();
    
    logger.info('Processing notification', {
      operationId,
      appId,
      eventId,
      userId
    });

    try {
      // Ensure service is initialized
      await this.ensureInitialized();
      
      const models = db.getModels();
      if (!models) {
        throw new Error('Database models not available');
      }

      // Step 1: Get notification template
      const template = await this.getTemplate(appId, eventId);
      if (!template) {
        throw new Error(`Template not found for appId: ${appId}, eventId: ${eventId}`);
      }

      logger.debug('Template found', {
        operationId,
        templateId: template.id,
        eventId,
        title: template.title
      });

      // Step 2: Check user preferences (skip for now if model doesn't exist)
      let enabled = template.defaultEnabled;
      try {
        const preference = await models.NotificationPreference?.findOne({
          where: { userId, appId, eventId }
        });
        if (preference) {
          enabled = preference.enabled;
        }
      } catch (prefError) {
        logger.warn('Could not check user preferences, using template default', {
          operationId,
          error: prefError.message
        });
      }

      if (!enabled) {
        logger.info('Notification disabled by user preference', {
          operationId,
          userId,
          eventId
        });
        return {
          success: false,
          reason: 'disabled',
          operationId
        };
      }

      // Step 3: Get user's device tokens
      const deviceTokens = await this.getUserDeviceTokens(userId);
      if (deviceTokens.length === 0) {
        logger.warn('No active device tokens found', { 
          operationId,
          userId 
        });
        return { 
          success: false, 
          reason: 'no_tokens', 
          operationId 
        };
      }

      logger.debug('Device tokens found', {
        operationId,
        userId,
        tokenCount: deviceTokens.length,
        platforms: deviceTokens.map(dt => dt.platform)
      });

      // Step 4: Compile notification content
      const compiledTitle = this.compileTemplate(template.title, data);
      const compiledBody = this.compileTemplate(template.body, data);
      const compiledPayload = this.compilePayload(template.payload, data);

      logger.debug('Notification compiled', {
        operationId,
        title: compiledTitle,
        body: compiledBody
      });

      // Step 5: Create notification log entry
      let logEntry = null;
      try {
        logEntry = await models.NotificationLog?.create({
          id: uuidv4(),
          userId,
          eventId,
          appId,
          title: compiledTitle,
          body: compiledBody,
          payload: compiledPayload,
          status: 'processing',
          channel: 'push'
        });

        logger.debug('Notification log created', {
          operationId,
          logId: logEntry?.id
        });
      } catch (logError) {
        logger.warn('Could not create notification log', {
          operationId,
          error: logError.message
        });
      }

      // Step 6: Send notifications to devices
      const sendResults = await this.sendToDevices(deviceTokens, {
        title: compiledTitle,
        body: compiledBody,
        data: compiledPayload,
        priority: template.priority || 'high'
      });

      // Step 7: Update log status
      if (logEntry) {
        try {
          const finalStatus = sendResults.success > 0 ? 'delivered' : 'failed';
          await logEntry.update({
            status: finalStatus,
            sentAt: new Date(),
            deliveredAt: sendResults.success > 0 ? new Date() : null
          });
        } catch (updateError) {
          logger.warn('Could not update notification log', {
            operationId,
            error: updateError.message
          });
        }
      }

      logger.info('Notification processing completed', {
        operationId,
        userId,
        eventId,
        sent: sendResults.success,
        failed: sendResults.failed
      });

      return {
        success: sendResults.success > 0,
        operationId,
        logId: logEntry?.id,
        results: sendResults
      };

    } catch (error) {
      logger.error('Failed to process notification', {
        operationId,
        appId,
        eventId,
        userId,
        error: error.message,
        stack: error.stack
      });
      
      // Return more specific error information
      if (error.message.includes('Template not found')) {
        error.code = 'TEMPLATE_NOT_FOUND';
      } else if (error.message.includes('Database models not available')) {
        error.code = 'DATABASE_ERROR';
      } else if (error.message.includes('not initialized')) {
        error.code = 'SERVICE_NOT_INITIALIZED';
      }
      
      throw error;
    }
  }

  /**
   * Get notification template by appId and eventId
   */
  async getTemplate(appId, eventId) {
    try {
      const models = db.getModels();
      if (!models?.NotificationTemplate) {
        logger.warn('NotificationTemplate model not available');
        return null;
      }

      const template = await models.NotificationTemplate.findOne({
        where: { appId, eventId }
      });

      if (!template) {
        logger.warn('Template not found', { appId, eventId });
      }

      return template;
    } catch (error) {
      logger.error('Error fetching template', {
        appId,
        eventId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get user's active device tokens
   */
  async getUserDeviceTokens(userId) {
    try {
      const models = db.getModels();
      if (!models?.DeviceToken) {
        logger.warn('DeviceToken model not available');
        return [];
      }

      const tokens = await models.DeviceToken.findAll({
        where: {
          userId,
          active: true
        }
      });

      return tokens || [];
    } catch (error) {
      logger.error('Error fetching device tokens', {
        userId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Send notification to multiple devices
   */
  async sendToDevices(deviceTokens, notification) {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    // Group tokens by platform
    const fcmTokens = [];
    const apnTokens = [];

    deviceTokens.forEach(device => {
      if (device.platform === 'android') {
        fcmTokens.push(device.token);
      } else if (device.platform === 'ios') {
        apnTokens.push(device.token);
      }
    });

    // Send FCM notifications (Android)
    if (fcmTokens.length > 0) {
      try {
        for (const token of fcmTokens) {
          try {
            await fcmService.sendNotification(
              token,
              notification.title,
              notification.body,
              notification.data
            );
            results.success++;
          } catch (fcmError) {
            logger.error('FCM notification failed', {
              token: token.substring(0, 8) + '...',
              error: fcmError.message
            });
            results.failed++;
            results.errors.push({
              platform: 'android',
              error: fcmError.message
            });
          }
        }
      } catch (batchError) {
        logger.error('FCM batch error', { error: batchError.message });
        results.failed += fcmTokens.length;
      }
    }

    // APN notifications would go here (iOS)
    if (apnTokens.length > 0) {
      logger.warn('APN not implemented, skipping iOS notifications', {
        tokenCount: apnTokens.length
      });
      results.failed += apnTokens.length;
    }

    return results;
  }

  /**
   * Compile template with handlebars
   */
  compileTemplate(template, data) {
    try {
      if (!template) return '';
      const compiled = handlebars.compile(template);
      return compiled(data || {});
    } catch (error) {
      logger.error('Template compilation error', {
        error: error.message,
        template
      });
      return template; // Return original as fallback
    }
  }

  /**
   * Compile payload object with handlebars
   */
  compilePayload(payloadTemplate, data) {
    if (!payloadTemplate) return {};
    
    try {
      const result = {};
      
      Object.entries(payloadTemplate).forEach(([key, value]) => {
        if (typeof value === 'string') {
          result[key] = this.compileTemplate(value, data);
        } else if (typeof value === 'object' && value !== null) {
          result[key] = this.compilePayload(value, data);
        } else {
          result[key] = value;
        }
      });
      
      return result;
    } catch (error) {
      logger.error('Payload compilation error', {
        error: error.message
      });
      return payloadTemplate; // Return original as fallback
    }
  }

  // ===== TEMPLATE MANAGEMENT METHODS =====

  async getTemplates(appId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    return await models.NotificationTemplate.findAll({
      where: { appId },
      order: [['eventName', 'ASC']]
    });
  }

  async upsertTemplate(templateData) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    return await models.NotificationTemplate.upsert(templateData);
  }

  // ===== USER PREFERENCE METHODS =====

  async getUserPreferences(userId, appId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    if (!models.NotificationPreference) {
      return [];
    }
    
    const preferences = await models.NotificationPreference.findAll({
      where: { userId, appId }
    });
    
    return preferences;
  }

  async updateUserPreference(userId, appId, eventId, enabled, channels = null) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const [preference, created] = await models.NotificationPreference.findOrCreate({
      where: { userId, appId, eventId },
      defaults: {
        id: uuidv4(),
        enabled,
        channels,
        updatedBy: 'user'
      }
    });
    
    if (!created) {
      await preference.update({
        enabled,
        ...(channels && { channels }),
        updatedBy: 'user'
      });
    }
    
    return preference;
  }

  // ===== NOTIFICATION RETRIEVAL METHODS =====

  async getAllNotifications(options = {}) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const { limit = 50, offset = 0, filters = {} } = options;
    
    const where = {};
    
    if (filters.appId) where.appId = filters.appId;
    if (filters.userId) where.userId = filters.userId;
    if (filters.eventId) where.eventId = filters.eventId;
    if (filters.read !== undefined) {
      where.readAt = filters.read ? { [models.Sequelize.Op.not]: null } : null;
    }
    
    return await models.NotificationLog.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
  }

  async getUserNotifications(userId, options = {}) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const { limit = 20, offset = 0, unreadOnly = false } = options;
    
    const where = { userId };
    if (unreadOnly) {
      where.readAt = null;
    }
    
    return await models.NotificationLog.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });
  }

  async markAsRead(logId, userId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { 
        where: { 
          id: logId,
          userId // Security: ensure user can only mark their own notifications
        }
      }
    );
    
    return updatedCount > 0;
  }

  async bulkMarkAsRead(notificationIds, userId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { 
        where: {
          id: { [models.Sequelize.Op.in]: notificationIds },
          userId,
          readAt: null // Only unread notifications
        }
      }
    );
    
    return { updated: updatedCount };
  }

  async markAllAsRead(userId, category = null) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const where = {
      userId,
      readAt: null
    };

    if (category) {
      const eventIds = this.getEventIdsByCategory(category);
      where.eventId = { [models.Sequelize.Op.in]: eventIds };
    }

    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { where }
    );

    return { updated: updatedCount };
  }

  // ===== CATEGORY & STATISTICS METHODS =====

  getCategoryFromEventId(eventId) {
    const categoryMap = {
      // Activity events
      'job_application_received': 'activity',
      'job_application_sent': 'activity',
      'job_completed': 'activity',
      'milestone_completed': 'activity',
      'new_review': 'activity',
      'profile_verified': 'activity',
      'job_posted': 'activity',
      'application_accepted': 'activity',
      'application_rejected': 'activity',
      'new_application_received': 'activity',
      
      // Contract events
      'contract_signed': 'contracts',
      'contract_updated': 'contracts',
      'contract_cancelled': 'contracts',
      'payment_received': 'contracts',
      'payment_processed': 'contracts',
      'payment_released': 'contracts',
      'milestone_payment': 'contracts',
      'invoice_generated': 'contracts',
      
      // Reminder events
      'payment_due': 'reminders',
      'profile_incomplete': 'reminders',
      'account_security': 'reminders',
      'verification_required': 'reminders',
      'deadline_approaching': 'reminders',
      'payment_overdue': 'reminders'
    };
    
    return categoryMap[eventId] || 'activity';
  }

  getEventIdsByCategory(category) {
    const eventMap = {
      activity: [
        'job_application_received', 'job_application_sent', 'job_completed', 
        'milestone_completed', 'new_review', 'profile_verified', 'job_posted',
        'application_accepted', 'application_rejected', 'new_application_received'
      ],
      contracts: [
        'contract_signed', 'contract_updated', 'contract_cancelled',
        'payment_received', 'payment_processed', 'payment_released',
        'milestone_payment', 'invoice_generated'
      ],
      reminders: [
        'payment_due', 'profile_incomplete', 'account_security', 
        'verification_required', 'deadline_approaching', 'payment_overdue'
      ]
    };
    
    return eventMap[category] || [];
  }

  async getNotificationsByCategory(userId, category, options = {}) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const { limit = 20, offset = 0, unreadOnly = false } = options;
    
    const eventIds = this.getEventIdsByCategory(category);
    
    const where = {
      userId,
      eventId: { [models.Sequelize.Op.in]: eventIds }
    };
    
    if (unreadOnly) {
      where.readAt = null;
    }
    
    const result = await models.NotificationLog.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']]
    });

    return {
      notifications: result.rows,
      total: result.count,
      hasMore: (offset + limit) < result.count
    };
  }

  async getUnreadCounts(userId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const unreadNotifications = await models.NotificationLog.findAll({
      where: {
        userId,
        readAt: null
      },
      attributes: ['eventId'],
      raw: true
    });

    const categorizedCounts = {
      activity: 0,
      contracts: 0,
      reminders: 0,
      total: unreadNotifications.length
    };

    unreadNotifications.forEach(notification => {
      const category = this.getCategoryFromEventId(notification.eventId);
      if (categorizedCounts.hasOwnProperty(category)) {
        categorizedCounts[category]++;
      }
    });

    return { counts: categorizedCounts };
  }

  async getNotificationStats(userId) {
    await this.ensureInitialized();
    const models = db.getModels();

    const totalCount = await models.NotificationLog.count({
      where: { userId }
    });

    const unreadCount = await models.NotificationLog.count({
      where: { userId, readAt: null }
    });

    const deliveredCount = await models.NotificationLog.count({
      where: { userId, status: 'delivered' }
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCount = await models.NotificationLog.count({
      where: {
        userId,
        createdAt: { [models.Sequelize.Op.gte]: sevenDaysAgo }
      }
    });

    return {
      stats: {
        total: totalCount,
        unread: unreadCount,
        delivered: deliveredCount,
        recent: recentCount,
        readRate: totalCount > 0 ? ((totalCount - unreadCount) / totalCount * 100).toFixed(1) : '0.0'
      }
    };
  }

  // ===== DEBUG METHODS =====

  async createBulkNotifications(userId, notificationData) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const notifications = notificationData.map(data => ({
      id: data.id || uuidv4(),
      userId,
      eventId: data.eventId,
      appId: data.appId || 'freelance-app',
      title: data.title,
      body: data.body,
      payload: data.payload || {},
      status: data.status || 'delivered',
      channel: data.channel || 'push',
      platform: data.platform || 'mobile',
      createdAt: data.createdAt || new Date(),
      sentAt: data.sentAt || new Date(),
      deliveredAt: data.deliveredAt || new Date(),
      readAt: data.readAt || null
    }));

    return await models.NotificationLog.bulkCreate(notifications);
  }

  async getRawNotificationData(userId, limit = 50) {
    await this.ensureInitialized();
    const models = db.getModels();

    const rawNotifications = await models.NotificationLog.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit,
      raw: true
    });

    const totalCount = await models.NotificationLog.count({
      where: { userId }
    });

    return {
      debug: {
        userId,
        totalNotifications: totalCount,
        rawNotifications: rawNotifications.slice(0, 10),
        returnedCount: rawNotifications.length
      }
    };
  }

  async clearUserNotifications(userId, appId = null) {
    await this.ensureInitialized();
    const models = db.getModels();

    const whereClause = { userId };
    if (appId) {
      whereClause.appId = appId;
    }

    const beforeCount = await models.NotificationLog.count({
      where: whereClause
    });

    const deletedCount = await models.NotificationLog.destroy({
      where: whereClause
    });

    return {
      beforeCount,
      deletedCount
    };
  }

  async getDetailedNotificationStats(userId) {
    // Implementation from original file...
    return await this.getNotificationStats(userId);
  }

  // ===== SOCKET/MESSAGE COMPATIBILITY METHODS =====
  
  /**
   * Send message notification (for socket compatibility)
   
   */
  async sendMessageNotification(message, recipients) {
    try {
      const results = [];
      
      // Ensure service is initialized
      await this.ensureInitialized();
      
      // Get sender info for notification
      const models = db.getModels();
      const sender = await models.User?.findByPk(message.senderId);
      
      if (!sender) {
        throw new Error('Sender not found');
      }
      
      // Create notification data
      const eventId = 'new_message';
      const appId = 'freelance-app'; // or get from config
      const data = {
        messageId: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: sender.name,
        messageContent: this.truncateMessage(message.content?.text || 'New message', 100),
        type: 'chat_message'
      };

      // Send to each recipient
      for (const recipientId of recipients) {
        try {
          const result = await this.processNotification(
            appId,
            eventId,
            recipientId,
            data
          );
          
          results.push({
            recipientId,
            success: result.success,
            operationId: result.operationId
          });
        } catch (error) {
          logger.error('Failed to send message notification', {
            recipientId,
            messageId: message.id,
            error: error.message
          });
          results.push({
            recipientId,
            success: false,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      logger.error('Failed to send message notification', {
        messageId: message.id,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send general notification (for socket compatibility)
   
   */
  async sendNotification(userId, notification) {
    try {
      // Map the notification object to processNotification format
      const appId = notification.appId || 'freelance-app';
      const eventId = notification.type || notification.eventId || 'general_notification';
      const data = {
        title: notification.title,
        body: notification.body,
        ...notification.data
      };

      return await this.processNotification(appId, eventId, userId, data);
    } catch (error) {
      logger.error('Failed to send notification', {
        userId,
        notification: notification.type,
        error: error.message
      });
      throw error;
    }
  }

  /**
   
   */
  async ensureDbInitialized() {
    return await this.ensureInitialized();
  }

  /**
   
   */
  async shutdown() {
    try {
      if (this.providers.has('APN')) {
        // APN shutdown logic would go here
      }
      
      this.initialized = false;
      this.providers.clear();
      logger.info('Notification service shut down');
    } catch (error) {
      logger.error('Error during notification service shutdown', {
        error: error.message
      });
    }
  }

  /**
   * Truncate message helper
   */
  truncateMessage(text, maxLength = 100) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}

module.exports = new NotificationService();