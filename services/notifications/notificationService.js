// services/notifications/notificationService.js - FIXED VERSION
const handlebars = require('handlebars');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const logger = require('../../utils/logger');
const fcmService = require('./fcm');
const { BUSINESS_ENTITY_TYPES, NOTIFICATION_EVENTS, APP_IDS } = require('../../config/notifiction-constants');

class NotificationService {
  constructor() {
    this.initialized = false;
    this.initPromise = null;
    this.providers = new Map();
    this.SYSTEM_USER_UUID = '00000000-0000-0000-0000-000000000001';
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

      if (!db.isInitialized()) {
        logger.info('Waiting for database initialization...');
        await db.waitForInitialization();
      }

      const fcmInitialized = await fcmService.initialize();
      if (!fcmInitialized) {
        logger.warn('FCM service failed to initialize - push notifications may not work');
      } else {
        this.providers.set('FCM', fcmService);
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

  sanitizeTriggeredBy(triggeredBy) {
    if (!triggeredBy) {
      return this.SYSTEM_USER_UUID;
    }
    
    if (triggeredBy === 'system') {
      return this.SYSTEM_USER_UUID;
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(triggeredBy)) {
      logger.warn('Invalid triggeredBy UUID format, using system UUID', {
        originalValue: triggeredBy
      });
      return this.SYSTEM_USER_UUID;
    }
    
    return triggeredBy;
  }

  async processNotification(appId, eventKey, recipientId, data = {}, businessContext = {}) {
    const operationId = uuidv4();
    
    logger.info('Processing notification', {
      operationId,
      appId,
      eventKey,
      recipientId,
      businessEntityType: businessContext.businessEntityType,
      businessEntityId: businessContext.businessEntityId
    });

    let logEntry = null;

    try {
      const sanitizedTriggeredBy = this.sanitizeTriggeredBy(businessContext.triggeredBy);

      await this.ensureInitialized();
      const models = db.getModels();

      const event = await models.NotificationEvent.findOne({
        where: { eventKey, isActive: true },
        include: [
          { 
            model: models.NotificationCategory, 
            as: 'category',
            where: { isActive: true }
          },
          { 
            model: models.NotificationTemplate, 
            where: { appId },
            as: 'templates',
            required: true
          }
        ]
      });

      if (!event || !event.templates || event.templates.length === 0) {
        throw new Error(`Template not found for eventKey: ${eventKey}, app: ${appId}`);
      }

      const template = event.templates[0];

      let compiledTitle, compiledBody, compiledPayload;
      
      try {
        compiledTitle = this.compileTemplate(template.title, data);
        compiledBody = this.compileTemplate(template.body, data);
        compiledPayload = this.compilePayload(template.payload, data);
      } catch (templateError) {
        logger.warn('Template compilation failed, using fallbacks', {
          eventKey,
          error: templateError.message,
          providedData: Object.keys(data)
        });
        compiledTitle = template.title || 'Notification';
        compiledBody = template.body || 'You have a new notification';
        compiledPayload = {};
      }

      logEntry = await models.NotificationLog.create({
        id: uuidv4(),
        recipientId,
        triggeredBy: sanitizedTriggeredBy,
        eventId: event.id,
        templateId: template.id,
        categoryId: event.categoryId,
        businessEntityType: businessContext.businessEntityType,
        businessEntityId: businessContext.businessEntityId,
        appId,
        title: compiledTitle,
        body: compiledBody,
        payload: {
          ...compiledPayload,
          businessContext: {
            triggeredBy: sanitizedTriggeredBy,
            businessEntityType: businessContext.businessEntityType,
            businessEntityId: businessContext.businessEntityId,
            metadata: businessContext.metadata || {}
          },
          templateData: data,
          processingMetadata: {
            operationId,
            processedAt: new Date().toISOString()
          }
        },
        status: 'processing',
        channel: 'push'
      });

      const deviceTokens = await this.getUserDeviceTokens(recipientId);

      if (deviceTokens.length === 0) {
        logger.warn('No device tokens found for user', { recipientId });
        await logEntry.update({ 
          status: 'failed',
          errorDetails: { error: 'No device tokens found' }
        });
        return {
          success: false,
          operationId,
          logId: logEntry.id,
          error: 'No device tokens found',
          categoryKey: event.category.categoryKey
        };
      }

      const notification = {
        title: compiledTitle,
        body: compiledBody,
        data: compiledPayload
      };

      // CRITICAL FIX: Handle invalid tokens
      const sendResults = await this.sendToDevices(deviceTokens, notification);

      const finalStatus = sendResults.success > 0 ? 'delivered' : 'failed';
      await logEntry.update({
        status: finalStatus,
        sentAt: new Date(),
        deliveredAt: sendResults.success > 0 ? new Date() : null,
        errorDetails: sendResults.failed > 0 ? { errors: sendResults.errors } : null
      });

      logger.info('Notification processed', {
        operationId,
        eventKey,
        recipientId,
        success: sendResults.success,
        failed: sendResults.failed,
        tokensRemoved: sendResults.tokensRemoved || 0
      });

      return {
        success: sendResults.success > 0,
        operationId,
        logId: logEntry.id,
        results: sendResults,
        categoryKey: event.category.categoryKey
      };

    } catch (error) {
      if (logEntry) {
        try {
          await logEntry.update({
            status: 'failed',
            errorDetails: { error: error.message }
          });
        } catch (updateError) {
          logger.error('Failed to update log entry with error', {
            logId: logEntry.id,
            error: updateError.message
          });
        }
      }

      logger.error('Failed to process notification', {
        operationId,
        appId,
        eventKey,
        recipientId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async getTemplate(appId, eventKey) {
    try {
      const models = db.getModels();
      if (!models?.NotificationTemplate || !models?.NotificationEvent) {
        logger.warn('Notification models not available');
        return null;
      }

      const template = await models.NotificationTemplate.findOne({
        where: { appId },
        include: [
          {
            model: models.NotificationEvent,
            as: 'event',
            where: { eventKey, isActive: true },
            required: true
          }
        ]
      });

      if (!template) {
        logger.warn('Template not found', { appId, eventKey });
      }

      return template;
    } catch (error) {
      logger.error('Error fetching template', {
        appId,
        eventKey,
        error: error.message
      });
      throw error;
    }
  }

  async getUserDeviceTokens(recipientId) {
    try {
      const models = db.getModels();
      if (!models?.DeviceToken) {
        logger.warn('DeviceToken model not available');
        return [];
      }

      const tokens = await models.DeviceToken.findAll({
        where: {
          userId: recipientId,
          active: true
        }
      });

      return tokens || [];
    } catch (error) {
      logger.error('Error fetching device tokens', {
        recipientId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * CRITICAL FIX: Remove invalid tokens from database
   */
  async removeInvalidToken(token) {
    try {
      const models = db.getModels();
      if (!models?.DeviceToken) {
        console.error('DeviceToken model not available for cleanup');
        return false;
      }

      const deleted = await models.DeviceToken.destroy({
        where: { token: token }
      });

      if (deleted > 0) {
        console.log(`Removed ${deleted} invalid FCM token(s) from database`);
      }

      return deleted > 0;
    } catch (error) {
      console.error('Failed to remove invalid token:', {
        error: error.message,
        token: token.substring(0, 10) + '...'
      });
      return false;
    }
  }

  /**
   * CRITICAL FIX: Send to devices with token cleanup
   */
  async sendToDevices(deviceTokens, notification) {
    const results = {
      success: 0,
      failed: 0,
      tokensRemoved: 0,
      errors: []
    };

    const fcmTokens = [];
    const apnTokens = [];

    deviceTokens.forEach(device => {
      if (device.platform === 'android') {
        fcmTokens.push(device.token);
      } else if (device.platform === 'ios') {
        apnTokens.push(device.token);
      }
    });

    if (fcmTokens.length > 0) {
      try {
        for (const token of fcmTokens) {
          try {
            const result = await fcmService.sendNotification(
              token,
              notification.title,
              notification.body,
              notification.data
            );

            if (result.success) {
              results.success++;
            } else {
              results.failed++;
              
              // CRITICAL FIX: Remove invalid tokens
              if (result.tokenValid === false) {
                await this.removeInvalidToken(token);
                results.tokensRemoved++;
              } else {
                results.errors.push({
                  platform: 'android',
                  error: result.error
                });
              }
            }
          } catch (fcmError) {
            // Should not happen with new FCM implementation, but just in case
            console.error('Unexpected FCM error:', fcmError.message);
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

    if (apnTokens.length > 0) {
      logger.warn('APN not implemented, skipping iOS notifications', {
        tokenCount: apnTokens.length
      });
      results.failed += apnTokens.length;
    }

    return results;
  }

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
      return template;
    }
  }

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
      return payloadTemplate;
    }
  }

  async getTemplates(appId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    return await models.NotificationTemplate.findAll({
      where: { appId },
      include: [
        {
          model: models.NotificationEvent,
          as: 'event',
          include: [
            {
              model: models.NotificationCategory,
              as: 'category'
            }
          ]
        }
      ],
      order: [['event', 'eventName', 'ASC']]
    });
  }

  async upsertTemplate(templateData) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    if (templateData.eventId) {
      const event = await models.NotificationEvent.findByPk(templateData.eventId);
      if (!event) {
        throw new Error(`Event with ID ${templateData.eventId} not found`);
      }
    }
    
    return await models.NotificationTemplate.upsert(templateData);
  }

  async getUserPreferences(recipientId, appId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    if (!models.NotificationPreference) {
      return [];
    }
    
    const preferences = await models.NotificationPreference.findAll({
      where: { 
        userId: recipientId,
        appId 
      },
      include: [
        {
          model: models.NotificationEvent,
          as: 'event',
          attributes: ['eventKey', 'eventName']
        }
      ]
    });
    
    return preferences;
  }

  async updateUserPreference(recipientId, appId, eventKey, enabled, channels = null) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const event = await models.NotificationEvent.findOne({
      where: { eventKey, isActive: true }
    });
    
    if (!event) {
      throw new Error(`Event not found: ${eventKey}`);
    }
    
    const [preference, created] = await models.NotificationPreference.findOrCreate({
      where: { 
        userId: recipientId,
        appId, 
        eventId: event.id
      },
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

  async getUserNotifications(recipientId, options = {}) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const { 
      limit = 20, 
      offset = 0, 
      unreadOnly = false,
      appId,
      read,
      eventKey,
      startDate,
      endDate
    } = options;
    
    const where = { recipientId: recipientId };
    
    if (unreadOnly || read === false) {
      where.readAt = null;
    } else if (read === true) {
      where.readAt = { [models.Sequelize.Op.not]: null };
    }
    
    if (appId) {
      where.appId = appId;
    }
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt[models.Sequelize.Op.gte] = new Date(startDate);
      }
      if (endDate) {
        where.createdAt[models.Sequelize.Op.lte] = new Date(endDate);
      }
    }
    
    const include = [
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
        attributes: ['appId'],
        required: false
      }
    ];
    
    if (eventKey) {
      include[0].where = { eventKey };
      include[0].required = true;
    }
    
    try {
      return await models.NotificationLog.findAndCountAll({
        where,
        include,
        limit,
        offset,
        order: [['createdAt', 'DESC']],
        distinct: true
      });
    } catch (error) {
      logger.error('Error in getUserNotifications', {
        recipientId,
        options,
        error: error.message
      });
      throw error;
    }
  }

  async getNotificationsByCategory(recipientId, categoryKey, options = {}) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      const { 
        limit = 20, 
        offset = 0, 
        unreadOnly = false,
        appId,
        read,
        eventKey
      } = options;
      
      const category = await models.NotificationCategory.findOne({
        where: { categoryKey, isActive: true }
      });

      if (!category) {
        throw new Error(`Category not found: ${categoryKey}`);
      }

      const where = {
        recipientId,
        categoryId: category.id
      };
      
      if (unreadOnly || read === false) {
        where.readAt = null;
      } else if (read === true) {
        where.readAt = { [models.Sequelize.Op.not]: null };
      }
      
      if (appId) {
        where.appId = appId;
      }
      
      const include = [
        {
          model: models.NotificationEvent,
          as: 'event',
          attributes: ['eventKey', 'eventName']
        },
        {
          model: models.NotificationTemplate,
          as: 'template',
          attributes: ['appId'],
          required: false
        }
      ];
      
      if (eventKey) {
        include[0].where = { eventKey };
        include[0].required = true;
      }
      
      const result = await models.NotificationLog.findAndCountAll({
        where,
        include,
        limit,
        offset,
        order: [['createdAt', 'DESC']],
        distinct: true
      });

      return {
        notifications: result.rows,
        total: result.count,
        hasMore: (offset + limit) < result.count,
        category: {
          key: category.categoryKey,
          name: category.name,
          icon: category.icon,
          color: category.color
        }
      };

    } catch (error) {
      logger.error('Error fetching notifications by category', {
        recipientId,
        categoryKey,
        options,
        error: error.message
      });
      throw error;
    }
  }

  async getAllNotifications(options = {}) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const { limit = 50, offset = 0, filters = {} } = options;
    
    const where = {};
    const include = [
      {
        model: models.NotificationEvent,
        as: 'event',
        attributes: ['eventKey', 'eventName'],
        include: [
          {
            model: models.NotificationCategory,
            as: 'category',
            attributes: ['categoryKey', 'name']
          }
        ]
      },
      {
        model: models.NotificationTemplate,
        as: 'template',
        attributes: ['appId']
      }
    ];
    
    if (filters.appId) where.appId = filters.appId;
    if (filters.recipientId) where.recipientId = filters.recipientId;
    if (filters.businessEntityType) where.businessEntityType = filters.businessEntityType;
    if (filters.businessEntityId) where.businessEntityId = filters.businessEntityId;
    
    if (filters.read !== undefined) {
      where.readAt = filters.read ? { [models.Sequelize.Op.not]: null } : null;
    }
    
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) {
        where.createdAt[models.Sequelize.Op.gte] = new Date(filters.startDate);
      }
      if (filters.endDate) {
        where.createdAt[models.Sequelize.Op.lte] = new Date(filters.endDate);
      }
    }
    
    if (filters.eventKey) {
      include[0].where = { eventKey: filters.eventKey };
      include[0].required = true;
    }
    
    if (filters.categoryKey) {
      include[0].include[0].where = { categoryKey: filters.categoryKey };
      include[0].include[0].required = true;
      include[0].required = true;
    }
    
    return await models.NotificationLog.findAndCountAll({
      where,
      include,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
      distinct: true
    });
  }

  async markAsRead(logId, recipientId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { 
        where: { 
          id: logId,
          recipientId: recipientId
        }
      }
    );
    
    return updatedCount > 0;
  }

  async bulkMarkAsRead(notificationIds, recipientId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { 
        where: {
          id: { [models.Sequelize.Op.in]: notificationIds },
          recipientId: recipientId,
          readAt: null
        }
      }
    );
    
    return { updated: updatedCount };
  }

  async markAllAsRead(recipientId, categoryKey = null) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const where = {
      recipientId: recipientId,
      readAt: null
    };

    if (categoryKey) {
      const category = await models.NotificationCategory.findOne({
        where: { categoryKey, isActive: true }
      });
      
      if (category) {
        where.categoryId = category.id;
      }
    }

    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { where }
    );

    return { updated: updatedCount };
  }

  async getUnreadCounts(recipientId) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      const categories = await models.NotificationCategory.findAll({
        where: { isActive: true },
        order: [['displayOrder', 'ASC']]
      });

      const countQuery = `
        SELECT nc.category_key, COUNT(*) as unread_count
        FROM notification_logs nl
        JOIN notification_categories nc ON nl.category_id = nc.id
        WHERE nl.recipient_id = :recipientId 
          AND nl.read_at IS NULL
          AND nc.is_active = true
        GROUP BY nc.category_key, nc.id
      `;

      const unreadResults = await models.sequelize.query(countQuery, {
        replacements: { recipientId },
        type: models.sequelize.QueryTypes.SELECT
      });

      const counts = {};
      let total = 0;

      categories.forEach(category => {
        const result = unreadResults.find(r => r.category_key === category.categoryKey);
        const count = result ? parseInt(result.unread_count) : 0;
        counts[category.categoryKey] = count;
        total += count;
      });

      counts.total = total;

      return { counts };

    } catch (error) {
      logger.error('Error getting unread counts', {
        recipientId,
        error: error.message
      });
      throw error;
    }
  }

  async getNotificationStats(recipientId) {
    await this.ensureInitialized();
    const models = db.getModels();

    const totalCount = await models.NotificationLog.count({
      where: { recipientId }
    });

    const unreadCount = await models.NotificationLog.count({
      where: { recipientId, readAt: null }
    });

    const deliveredCount = await models.NotificationLog.count({
      where: { recipientId, status: 'delivered' }
    });

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCount = await models.NotificationLog.count({
      where: {
        recipientId,
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

  async getAllCategories() {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      return await models.NotificationCategory.findAll({
        where: { isActive: true },
        order: [['displayOrder', 'ASC']],
        include: [
          {
            model: models.NotificationEvent,
            as: 'events',
            where: { isActive: true },
            required: false
          }
        ]
      });
    } catch (error) {
      logger.error('Error getting all categories', {
        error: error.message
      });
      throw error;
    }
  }

  async getAllEvents(categoryId = null) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      const where = { isActive: true };
      if (categoryId) {
        where.categoryId = categoryId;
      }
      
      return await models.NotificationEvent.findAll({
        where,
        include: [
          {
            model: models.NotificationCategory,
            as: 'category'
          }
        ],
        order: [['eventName', 'ASC']]
      });
    } catch (error) {
      logger.error('Error getting all events', {
        categoryId,
        error: error.message
      });
      throw error;
    }
  }

  async sendMessageNotification(message, recipients) {
    try {
      const results = [];
      await this.ensureInitialized();
      
      const models = db.getModels();
      const sender = await models.User?.findByPk(message.senderId);
      
      if (!sender) {
        throw new Error('Sender not found');
      }
      
      const eventKey = 'chat.new_message';
      const data = {
        messageId: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: sender.name || sender.fullName,
        messageContent: this.truncateMessage(message.content?.text || 'New message', 100),
        type: 'chat_message'
      };

      const businessContext = {
        triggeredBy: message.senderId,
        businessEntityType: BUSINESS_ENTITY_TYPES.CHAT,
        businessEntityId: message.conversationId,
        metadata: {
          source: 'chat_service',
          messageType: 'chat_message'
        }
      };

      for (const recipientId of recipients) {
        try {
          const recipient = await models.User.findByPk(recipientId);
          if (!recipient) {
            results.push({
              recipientId,
              success: false,
              error: 'Recipient not found'
            });
            continue;
          }

          const appId = recipient.role === 'customer' ? APP_IDS.CUSTOMER_APP : APP_IDS.USTA_APP;

          const result = await this.processNotification(
            appId,
            eventKey,
            recipientId,
            data,
            businessContext
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

  async sendNotification(recipientId, notification) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      let appId = notification.appId;
      
      if (!appId) {
        const recipient = await models.User.findByPk(recipientId);
        if (recipient) {
          appId = recipient.role === 'customer' ? APP_IDS.CUSTOMER_APP : APP_IDS.USTA_APP;
        } else {
          appId = APP_IDS.CUSTOMER_APP;
        }
      }
      
      const eventKey = notification.type || notification.eventKey || 'system.announcement';
      
      const data = {
        title: notification.title,
        body: notification.body,
        ...notification.data
      };

      const businessContext = {
        triggeredBy: this.sanitizeTriggeredBy(notification.triggeredBy || 'system'),
        businessEntityType: notification.businessEntityType || BUSINESS_ENTITY_TYPES.SYSTEM,
        businessEntityId: notification.businessEntityId || 'legacy_notification',
        metadata: {
          source: 'legacy_send_notification',
          type: 'backward_compatibility'
        }
      };

      return await this.processNotification(appId, eventKey, recipientId, data, businessContext);
    } catch (error) {
      logger.error('Failed to send legacy notification', {
        recipientId,
        notification: notification.type,
        error: error.message
      });
      throw error;
    }
  }

  truncateMessage(text, maxLength = 100) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  async ensureDbInitialized() {
    return await this.ensureInitialized();
  }

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
}

module.exports = new NotificationService();