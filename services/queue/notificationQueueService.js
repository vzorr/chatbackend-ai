// services/queue/notificationQueueProcessor.js
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const logger = require('../../utils/logger');
const notificationService = require('../notifications/notificationService');

class NotificationQueueService {
  constructor() {
    this.isProcessing = false;
  }

  async ensureDbInitialized() {
    if (!db.isInitialized()) {
      logger.info('NotificationQueueProcessor: Database not initialized, waiting...');
      await db.waitForInitialization();
    }
  }

  async processNotificationQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    
    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      
      // Find queued notifications
      const notifications = await models.NotificationLog.findAll({
        where: { status: 'queued' },
        limit: 50,
        order: [['createdAt', 'ASC']]
      });
      
      if (notifications.length === 0) {
        this.isProcessing = false;
        return;
      }
      
      logger.info(`Processing ${notifications.length} notifications from queue`);
      
      // Process each notification
      for (const notification of notifications) {
        await this.processNotification(notification);
      }
    } catch (error) {
      logger.error('Error processing notification queue', {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing = false;
    }
  }
  
  async processNotification(notification) {
    const logId = notification.id;
    
    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      
      // Get user's device tokens
      const deviceTokens = await models.DeviceToken.findAll({
        where: {
          userId: notification.userId,
          active: true
        }
      });
      
      if (deviceTokens.length === 0) {
        await models.NotificationLog.update(
          { 
            status: 'failed',
            errorDetails: {
              reason: 'no_active_tokens',
              timestamp: new Date()
            }
          },
          { where: { id: logId } }
        );
        return;
      }
      
      // Update notification status to 'sending'
      await models.NotificationLog.update(
        { 
          status: 'sent',
          sentAt: new Date()
        },
        { where: { id: logId } }
      );
      
      // Send to each device
      const results = {
        success: 0,
        failed: 0,
        errors: []
      };
      
      for (const deviceToken of deviceTokens) {
        try {
          await notificationService.sendToDevice(
            {
              token: deviceToken.token,
              platform: deviceToken.platform,
              deviceId: deviceToken.deviceId
            },
            {
              title: notification.title,
              body: notification.body,
              data: notification.payload || {}
            }
          );
          
          results.success++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            deviceId: deviceToken.deviceId,
            error: error.message
          });
        }
      }
      
      // Update notification with results
      if (results.failed > 0 && results.success === 0) {
        await models.NotificationLog.update(
          {
            status: 'failed',
            errorDetails: {
              errors: results.errors,
              timestamp: new Date()
            }
          },
          { where: { id: logId } }
        );
      } else if (results.success > 0) {
        // Even if some failed, if at least one succeeded we mark as sent
        await models.NotificationLog.update(
          {
            status: 'sent',
            sentAt: new Date(),
            errorDetails: results.failed > 0 ? {
              partialFailure: true,
              errors: results.errors,
              timestamp: new Date()
            } : null
          },
          { where: { id: logId } }
        );
      }
      
      logger.info(`Notification ${logId} processed`, {
        success: results.success,
        failed: results.failed
      });
    } catch (error) {
      logger.error(`Error processing notification ${logId}`, {
        error: error.message,
        stack: error.stack
      });
      
      // Update notification as failed
      await this.ensureDbInitialized();
      const models = db.getModels();
      
      await models.NotificationLog.update(
        {
          status: 'failed',
          errorDetails: {
            message: error.message,
            timestamp: new Date()
          }
        },
        { where: { id: logId } }
      );
    }
  }
}

module.exports = new NotificationQueueService();