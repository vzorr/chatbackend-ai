// services/notifications/notificationService.js
const handlebars = require('handlebars');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const logger = require('../../utils/logger');
const fcmService = require('./fcm');
const apnService = require('./apn');
const queueService = require('../queue/queueService');

class NotificationService {
  constructor() {
    this.initialized = false;
    this.providers = new Map();
  }

  async ensureDbInitialized() {
    if (!db.isInitialized()) {
      logger.info('NotificationService: Database not initialized, waiting...');
      await db.waitForInitialization();
    }
  }

  async initialize() {
    try {
      // Initialize FCM
      const fcmInitialized = await fcmService.initialize();
      if (fcmInitialized) {
        this.providers.set('FCM', fcmService);
      }

      // Initialize APN (if configured)
      const apnInitialized = await apnService.initialize();
      if (apnInitialized) {
        this.providers.set('APN', apnService);
      }

      this.initialized = true;
      logger.info('Notification service initialized', {
        providers: Array.from(this.providers.keys())
      });

      return true;
    } catch (error) {
      logger.error('Failed to initialize notification service', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get a notification template by event ID
   */
  async getTemplate(appId, eventId) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    return await models.NotificationTemplate.findOne({
      where: { appId, eventId }
    });
  }

  /**
   * Get all notification templates for an app
   */
  async getTemplates(appId) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    return await models.NotificationTemplate.findAll({
      where: { appId },
      order: [['eventName', 'ASC']]
    });
  }

  /**
   * Create or update a notification template
   */
  async upsertTemplate(templateData) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    return await models.NotificationTemplate.upsert(templateData);
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId, appId) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    const preferences = await models.NotificationPreference.findAll({
      where: { userId, appId }
    });
    
    return preferences;
  }

  /**
   * Update user notification preference
   */
  async updateUserPreference(userId, appId, eventId, enabled, channels = null) {
    await this.ensureDbInitialized();
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

  /**
   * Process a notification event and send to user
   */
  async processNotification(appId, eventId, userId, data = {}, options = {}) {
    const operationId = uuidv4();
    
    logger.info('Processing notification', {
      operationId,
      appId,
      eventId,
      userId
    });

    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      
      // Get template
      const template = await this.getTemplate(appId, eventId);
      if (!template) {
        throw new Error(`Template not found for event: ${eventId}`);
      }
      
      // Check user preference
      const preference = await models.NotificationPreference.findOne({
        where: { userId, appId, eventId }
      });
      
      const enabled = preference ? preference.enabled : template.defaultEnabled;
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
      
      // Get user's active device tokens
      const deviceTokens = await models.DeviceToken.findAll({
        where: {
          userId,
          active: true
        }
      });

      if (deviceTokens.length === 0) {
        logger.warn('No active device tokens found', { userId });
        return { success: false, reason: 'no_tokens', operationId };
      }
      
      // Compile templates
      const compiledTitle = this.compileTemplate(template.title, data);
      const compiledBody = this.compileTemplate(template.body, data);
      const compiledPayload = this.compilePayload(template.payload, data);
      
      // Create notification log entry
      const logEntry = await models.NotificationLog.create({
        id: uuidv4(),
        userId,
        eventId,
        appId,
        title: compiledTitle,
        body: compiledBody,
        payload: compiledPayload,
        status: 'queued',
        channel: 'push'
      });
      
      // Queue notification for sending
      await queueService.enqueueNotification({
        logId: logEntry.id,
        userId,
        deviceTokens: deviceTokens.map(dt => ({
          token: dt.token,
          platform: dt.platform,
          deviceId: dt.deviceId
        })),
        notification: {
          title: compiledTitle,
          body: compiledBody,
          data: compiledPayload,
          priority: template.priority,
          ...options
        }
      });
      
      return {
        success: true,
        operationId,
        logId: logEntry.id
      };
    } catch (error) {
      logger.error('Failed to process notification', {
        operationId,
        appId,
        eventId,
        userId,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Send notification directly to a device
   */
  async sendToDevice(deviceToken, notification) {
    const { token, platform } = deviceToken;
    const provider = this.getProviderForPlatform(platform);

    if (!provider) {
      throw new Error(`No provider available for platform: ${platform}`);
    }

    try {
      // Prepare notification payload
      const payload = this.preparePlatformPayload(notification, platform);
      
      // Send notification
      return await provider.sendNotification(
        token,
        payload.title,
        payload.body,
        payload.data
      );
    } catch (error) {
      // Handle invalid token
      if (this.isInvalidTokenError(error)) {
        await this.handleInvalidToken(deviceToken, error);
      }

      throw error;
    }
  }

  /**
   * Mark notification as delivered
   */
  async markAsDelivered(logId) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    await models.NotificationLog.update(
      { status: 'delivered', deliveredAt: new Date() },
      { where: { id: logId } }
    );
  }

  /**
   * Get all notifications with filters
   */
  async getAllNotifications(options = {}) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    const { limit = 50, offset = 0, filters = {} } = options;
    
    const where = {};
    
    if (filters.appId) {
      where.appId = filters.appId;
    }
    
    if (filters.userId) {
      where.userId = filters.userId;
    }

    if (filters.eventId) {
      where.eventId = filters.eventId;
    }
    
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

  /**
   * Mark notification as read by notification ID and user ID
   * @param {string} logId - Notification ID
   * @param {string} userId - User ID for security
   * @returns {boolean} - Whether the notification was marked as read
   */
  async markAsRead(logId, userId) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    const where = { 
      id: logId,
      userId // Ensure user can only mark their own notifications
    };
    
    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { where }
    );
    
    return updatedCount > 0;
  }

  /**
   * Bulk mark notifications as read
   * @param {string[]} notificationIds - Array of notification IDs
   * @param {string} userId - User ID
   * @returns {Object} - Result with updated count
   */
  async bulkMarkAsRead(notificationIds, userId) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { 
        where: {
          id: { [models.Sequelize.Op.in]: notificationIds },
          userId, // Ensure user can only mark their own notifications
          readAt: null // Only unread notifications
        }
      }
    );
    
    return { updated: updatedCount };
  }

  /**
   * Get notifications by category
   * @param {string} userId - User ID
   * @param {string} category - Category name ('activity', 'contracts', 'reminders')
   * @param {Object} options - Pagination and filter options
   * @returns {Object} - Notifications with pagination info
   */
  async getNotificationsByCategory(userId, category, options = {}) {
    await this.ensureDbInitialized();
    const models = db.getModels();
    
    const { limit = 20, offset = 0, unreadOnly = false } = options;
    
    // Map category to event IDs
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
      order: [['createdAt', 'DESC']],
      attributes: [
        'id', 'title', 'body', 'eventId', 'payload', 'status', 
        'channel', 'platform', 'sentAt', 'deliveredAt', 'readAt', 'createdAt'
      ]
    });

    return {
      success: true,
      notifications: result.rows,
      total: result.count,
      hasMore: (offset + limit) < result.count
    };
  }

  /**
   * Get unread notification counts by category
   * @param {string} userId - User ID
   * @returns {Object} - Categorized unread counts
   */
  async getUnreadCounts(userId) {
    await this.ensureDbInitialized();
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

  /**
   * Mark all notifications as read for a user (optionally by category)
   * @param {string} userId - User ID
   * @param {string} category - Optional category filter
   * @returns {Object} - Result with updated count
   */
  async markAllAsRead(userId, category = null) {
    await this.ensureDbInitialized();
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

  /**
   * Get notification statistics for a user
   * @param {string} userId - User ID
   * @returns {Object} - User's notification statistics
   */
  async getNotificationStats(userId) {
    await this.ensureDbInitialized();
    const models = db.getModels();

    // Get total counts
    const totalCount = await models.NotificationLog.count({
      where: { userId }
    });

    const unreadCount = await models.NotificationLog.count({
      where: { userId, readAt: null }
    });

    const deliveredCount = await models.NotificationLog.count({
      where: { userId, status: 'delivered' }
    });

    // Get recent activity (last 7 days)
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

  /**
   * Get notifications for a user
   */
  async getUserNotifications(userId, options = {}) {
    await this.ensureDbInitialized();
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

  /**
   * Helper method to get category from event ID
   * @param {string} eventId - Event ID
   * @returns {string} - Category name
   */
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

  /**
   * Helper method to get event IDs by category
   * @param {string} category - Category name
   * @returns {string[]} - Array of event IDs
   */
  getEventIdsByCategory(category) {
    const eventMap = {
      activity: [
        'job_application_received',
        'job_application_sent',
        'job_completed', 
        'milestone_completed',
        'new_review',
        'profile_verified',
        'job_posted',
        'application_accepted',
        'application_rejected',
        'new_application_received'
      ],
      contracts: [
        'contract_signed',
        'contract_updated',
        'contract_cancelled',
        'payment_received',
        'payment_processed',
        'payment_released',
        'milestone_payment',
        'invoice_generated'
      ],
      reminders: [
        'payment_due',
        'profile_incomplete',
        'account_security', 
        'verification_required',
        'deadline_approaching',
        'payment_overdue'
      ]
    };
    
    return eventMap[category] || [];
  }

  /**
   * Compile template with placeholders
   */
  compileTemplate(template, data) {
    try {
      const compiled = handlebars.compile(template);
      return compiled(data);
    } catch (error) {
      logger.error('Template compilation error', {
        error: error.message,
        template
      });
      return template; // Return original as fallback
    }
  }

  /**
   * Compile payload with placeholders
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

  /**
   * Prepare platform-specific payload
   */
  preparePlatformPayload(notification, platform) {
    const { title, body, data } = notification;

    if (platform === 'ios') {
      return {
        title,
        body,
        data: {
          ...data,
          aps: {
            alert: {
              title,
              body
            },
            badge: data.badge || 1,
            sound: data.sound || 'default'
          }
        }
      };
    }

    // Android/FCM payload
    return {
      title,
      body,
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        priority: notification.priority || 'high',
        ttl: '86400s'
      }
    };
  }

  /**
   * Get provider for platform
   */
  getProviderForPlatform(platform) {
    if (platform === 'ios') {
      return this.providers.get('APN');
    }
    return this.providers.get('FCM');
  }

  /**
   * Handle invalid device token
   */
  async handleInvalidToken(deviceToken, error) {
    logger.warn('Invalid device token detected', {
      token: deviceToken.token.substring(0, 8) + '...',
      platform: deviceToken.platform,
      error: error.message
    });

    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      const { DeviceToken, TokenHistory } = models;

      // Find and update token
      const token = await DeviceToken.findOne({
        where: { token: deviceToken.token }
      });

      if (token) {
        // Mark token as inactive
        await token.update({ active: false });

        // Log revocation if TokenHistory is available
        if (TokenHistory) {
          await TokenHistory.create({
            userId: token.userId,
            token: token.token,
            tokenType: token.platform === 'ios' ? 'APN' : 'FCM',
            deviceId: token.deviceId,
            action: 'REVOKED',
            metadata: {
              reason: 'invalid_token',
              error: error.message,
              revokedBy: 'system'
            }
          });
        }
      }
    } catch (dbError) {
      logger.error('Failed to handle invalid token', {
        error: dbError.message
      });
    }
  }

  /**
   * Check if error indicates invalid token
   */
  isInvalidTokenError(error) {
    const invalidTokenCodes = [
      'messaging/invalid-registration-token',
      'messaging/registration-token-not-registered',
      'InvalidRegistration',
      'NotRegistered'
    ];

    return invalidTokenCodes.includes(error.code);
  }

  /**
   * Shutdown notification service
   */
  async shutdown() {
    if (this.providers.has('APN')) {
      await this.providers.get('APN').shutdown();
    }
    // Any other cleanup
    logger.info('Notification service shut down');
    this.initialized = false;
  }
}

module.exports = new NotificationService();