// services/notifications/notificationService.js - UPDATED VERSION
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

  /**
   * Process notification using eventKey (API) → eventId (UUID) lookup
   */
  async processNotification(appId, eventKey, recipientId, data = {}, businessContext = {}) {
    const operationId = uuidv4();
    
    logger.info('Processing notification with eventKey lookup', {
      operationId,
      appId,
      eventKey,
      recipientId,
      businessContext
    });

    let logEntry = null;

    try {
      // Validate required business context
      const { triggeredBy, businessEntityType, businessEntityId } = businessContext;
      
      if (!triggeredBy) {
        throw new Error('triggeredBy is required in businessContext');
      }

      await this.ensureInitialized();
      const models = db.getModels();

      // Step 1: Get event with category and template using eventKey
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

      // Step 2: Compile template
      const compiledTitle = this.compileTemplate(template.title, data);
      const compiledBody = this.compileTemplate(template.body, data);
      const compiledPayload = this.compilePayload(template.payload, data);

      // Step 3: Create log entry with UUID eventId
      logEntry = await models.NotificationLog.create({
        id: uuidv4(),
        recipientId,
        triggeredBy,
        eventId: event.id,        // UUID foreign key
        templateId: template.id,
        categoryId: event.categoryId,
        businessEntityType,
        businessEntityId,
        appId,
        title: compiledTitle,
        body: compiledBody,
        payload: compiledPayload,
        status: 'processing',
        channel: 'push'
      });

      // Step 4: Get user device tokens
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

      // Step 5: Send notifications
      const notification = {
        title: compiledTitle,
        body: compiledBody,
        data: compiledPayload
      };

      const sendResults = await this.sendToDevices(deviceTokens, notification);

      // Step 6: Update log status
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
        failed: sendResults.failed
      });

      return {
        success: sendResults.success > 0,
        operationId,
        logId: logEntry.id,
        results: sendResults,
        categoryKey: event.category.categoryKey
      };

    } catch (error) {
      // Update log entry with error if it exists
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

  /**
   * Get notification template by appId and eventKey
   */
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

  /**
   * Get user's active device tokens
   */
  async getUserDeviceTokens(recipientId) {
    try {
      const models = db.getModels();
      if (!models?.DeviceToken) {
        logger.warn('DeviceToken model not available');
        return [];
      }

      const tokens = await models.DeviceToken.findAll({
        where: {
          userId: recipientId,  // ✅ FIELD NAME: Keep as 'userId' for DeviceToken model
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

  /**
   * Get templates with event information
   */
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

  /**
   * Create or update template (SINGLE METHOD - removed duplicate)
   */
  async upsertTemplate(templateData) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    // Validate that eventId exists
    if (templateData.eventId) {
      const event = await models.NotificationEvent.findByPk(templateData.eventId);
      if (!event) {
        throw new Error(`Event with ID ${templateData.eventId} not found`);
      }
    }
    
    return await models.NotificationTemplate.upsert(templateData);
  }

  // ===== USER PREFERENCE METHODS =====

  async getUserPreferences(recipientId, appId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    if (!models.NotificationPreference) {
      return [];
    }
    
    const preferences = await models.NotificationPreference.findAll({
      where: { 
        userId: recipientId,  // ✅ FIELD NAME: Keep as 'userId' for NotificationPreference model
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

  /**
   * Update user preference using eventKey
   */
  async updateUserPreference(recipientId, appId, eventKey, enabled, channels = null) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    // Get event ID from eventKey
    const event = await models.NotificationEvent.findOne({
      where: { eventKey, isActive: true }
    });
    
    if (!event) {
      throw new Error(`Event not found: ${eventKey}`);
    }
    
    const [preference, created] = await models.NotificationPreference.findOrCreate({
      where: { 
        userId: recipientId,  // ✅ FIELD NAME: Keep as 'userId' for NotificationPreference model
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

  // ===== NOTIFICATION RETRIEVAL METHODS =====

  /**
   * Get all notifications with advanced filtering
   */
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
    
    // Apply filters
    if (filters.appId) where.appId = filters.appId;
    if (filters.recipientId) where.recipientId = filters.recipientId;
    if (filters.businessEntityType) where.businessEntityType = filters.businessEntityType;
    if (filters.businessEntityId) where.businessEntityId = filters.businessEntityId;
    
    if (filters.read !== undefined) {
      where.readAt = filters.read ? { [models.Sequelize.Op.not]: null } : null;
    }
    
    // Filter by event key
    if (filters.eventKey) {
      include[0].where = { eventKey: filters.eventKey };
      include[0].required = true;
    }
    
    // Filter by category key
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


  // UPDATE THESE METHODS IN YOUR notificationService.js FILE

/**
 * Get user notifications with enhanced filtering
 * REPLACE the existing getUserNotifications method with this enhanced version
 */
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
  
  // Build where clause
  const where = { recipientId: recipientId };
  
  // Handle read/unread status
  if (unreadOnly || read === false) {
    where.readAt = null;
  } else if (read === true) {
    where.readAt = { [models.Sequelize.Op.not]: null };
  }
  
  // Filter by appId
  if (appId) {
    where.appId = appId;
  }
  
  // Filter by date range
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt[models.Sequelize.Op.gte] = new Date(startDate);
    }
    if (endDate) {
      where.createdAt[models.Sequelize.Op.lte] = new Date(endDate);
    }
  }
  
  // Build include array
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
  
  // Filter by eventKey if provided
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
    logger.error('Error in getUserNotifications with enhanced filtering', {
      recipientId,
      options,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get notifications by category with enhanced filtering
 * REPLACE the existing getNotificationsByCategory method with this enhanced version
 */
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
    
    // Get category ID
    const category = await models.NotificationCategory.findOne({
      where: { categoryKey, isActive: true }
    });

    if (!category) {
      throw new Error(`Category not found: ${categoryKey}`);
    }

    // Build where clause with enhanced filtering
    const where = {
      recipientId,
      categoryId: category.id
    };
    
    // Handle read/unread status
    if (unreadOnly || read === false) {
      where.readAt = null;
    } else if (read === true) {
      where.readAt = { [models.Sequelize.Op.not]: null };
    }
    
    // Filter by appId
    if (appId) {
      where.appId = appId;
    }
    
    // Build include array
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
    
    // Filter by eventKey if provided
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
    logger.error('Error fetching notifications by category with enhanced filtering', {
      recipientId,
      categoryKey,
      options,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get all notifications with enhanced admin filtering
 * REPLACE the existing getAllNotifications method with this enhanced version
 */
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
  
  // Apply filters
  if (filters.appId) where.appId = filters.appId;
  if (filters.recipientId) where.recipientId = filters.recipientId;
  if (filters.businessEntityType) where.businessEntityType = filters.businessEntityType;
  if (filters.businessEntityId) where.businessEntityId = filters.businessEntityId;
  
  // Handle read status
  if (filters.read !== undefined) {
    where.readAt = filters.read ? { [models.Sequelize.Op.not]: null } : null;
  }
  
  // Filter by date range
  if (filters.startDate || filters.endDate) {
    where.createdAt = {};
    if (filters.startDate) {
      where.createdAt[models.Sequelize.Op.gte] = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.createdAt[models.Sequelize.Op.lte] = new Date(filters.endDate);
    }
  }
  
  // Filter by event key
  if (filters.eventKey) {
    include[0].where = { eventKey: filters.eventKey };
    include[0].required = true;
  }
  
  // Filter by category key
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

  /**
   * Mark notification as read
   */
  async markAsRead(logId, recipientId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { 
        where: { 
          id: logId,
          recipientId: recipientId  // ✅ CONSISTENT: Use recipientId
        }
      }
    );
    
    return updatedCount > 0;
  }

  /**
   * Bulk mark notifications as read
   */
  async bulkMarkAsRead(notificationIds, recipientId) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const [updatedCount] = await models.NotificationLog.update(
      { readAt: new Date() },
      { 
        where: {
          id: { [models.Sequelize.Op.in]: notificationIds },
          recipientId: recipientId,  // ✅ CONSISTENT: Use recipientId
          readAt: null
        }
      }
    );
    
    return { updated: updatedCount };
  }

  /**
   * Mark all notifications as read for user
   */
  async markAllAsRead(recipientId, categoryKey = null) {
    await this.ensureInitialized();
    const models = db.getModels();
    
    const where = {
      recipientId: recipientId,  // ✅ CONSISTENT: Use recipientId
      readAt: null
    };

    if (categoryKey) {
      // Get category ID from database
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

  // ===== CATEGORY & STATISTICS METHODS =====

  /**
   * Get notifications by category using direct database filtering
   */
  async getNotificationsByCategory(recipientId, categoryKey, options = {}) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      const { limit = 20, offset = 0, unreadOnly = false } = options;
      
      // Get category ID
      const category = await models.NotificationCategory.findOne({
        where: { categoryKey, isActive: true }
      });

      if (!category) {
        throw new Error(`Category not found: ${categoryKey}`);
      }

      // Build where clause with direct category ID filter
      const where = {
        recipientId,  // ✅ CONSISTENT: Use recipientId
        categoryId: category.id
      };
      
      if (unreadOnly) {
        where.readAt = null;
      }
      
      const result = await models.NotificationLog.findAndCountAll({
        where,
        include: [
          {
            model: models.NotificationEvent,
            as: 'event',
            attributes: ['eventKey', 'eventName']
          },
          {
            model: models.NotificationTemplate,
            as: 'template',
            attributes: ['appId']
          }
        ],
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
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get unread notification counts by category using optimized SQL
   */
  async getUnreadCounts(recipientId) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      // Get all categories
      const categories = await models.NotificationCategory.findAll({
        where: { isActive: true },
        order: [['displayOrder', 'ASC']]
      });

      // Get unread counts per category in single query
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

      // Build response with all categories
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

  /**
   * Get event by eventKey
   */
  async getEventByKey(eventKey) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      return await models.NotificationEvent.findOne({
        where: { eventKey, isActive: true },
        include: [
          { 
            model: models.NotificationCategory, 
            as: 'category',
            where: { isActive: true }
          }
        ]
      });
    } catch (error) {
      logger.error('Error getting event by key', {
        eventKey,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get category by category key
   */
  async getCategoryByKey(categoryKey) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      return await models.NotificationCategory.findOne({
        where: { categoryKey, isActive: true }
      });
    } catch (error) {
      logger.error('Error getting category by key', {
        categoryKey,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get template for specific event and app
   */
  async getTemplateForEvent(eventId, appId) {
    try {
      await this.ensureInitialized();
      const models = db.getModels();
      
      return await models.NotificationTemplate.findOne({
        where: { eventId, appId }
      });
    } catch (error) {
      logger.error('Error getting template for event', {
        eventId,
        appId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get all categories
   */
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

  /**
   * Get all events (optionally filtered by category)
   */
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

  /**
   * Get notification statistics
   */
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

  /**
   * Clear user notifications
   */
  async clearUserNotifications(recipientId, appId = null) {
    await this.ensureInitialized();
    const models = db.getModels();

    const whereClause = { recipientId };
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

  /**
   * Get detailed notification statistics
   */
  async getDetailedNotificationStats(recipientId) {
    return await this.getNotificationStats(recipientId);
  }

  // ===== SOCKET/MESSAGE COMPATIBILITY METHODS =====

  /**
   * Send message notification using eventKey
   */
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

  /**
   * Send notification using eventKey (legacy compatibility)
   */
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
        triggeredBy: notification.triggeredBy || 'system',
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

  /**
   * Ensure database initialized (alias)
   */
  async ensureDbInitialized() {
    return await this.ensureInitialized();
  }

  /**
   * Shutdown service
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