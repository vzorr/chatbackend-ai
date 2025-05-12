// services/notifications/notificationManager.js
const fcmService = require('./fcm');
const apnService = require('./apn');
const { DeviceToken, TokenHistory, User, Message } = require('../../db/models');
const logger = require('../../utils/logger');
const queueService = require('../queue/queueService');
const { Op } = require('sequelize');

class NotificationManager {
  constructor() {
    this.initialized = false;
    this.providers = new Map();
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
      logger.info('Notification manager initialized', {
        providers: Array.from(this.providers.keys())
      });

      return true;
    } catch (error) {
      logger.error('Failed to initialize notification manager', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Send notification to a specific user
   */
  async sendNotification(userId, notification) {
    const operationId = require('uuid').v4();
    
    logger.info('Sending notification to user', {
      operationId,
      userId,
      type: notification.type
    });

    try {
      // Get user's active device tokens
      const deviceTokens = await DeviceToken.findAll({
        where: {
          userId,
          active: true
        }
      });

      if (deviceTokens.length === 0) {
        logger.warn('No active device tokens found', { userId });
        return { success: false, reason: 'no_tokens' };
      }

      const results = {
        sent: 0,
        failed: 0,
        errors: []
      };

      // Send to each device
      for (const deviceToken of deviceTokens) {
        try {
          await this.sendToDevice(
            deviceToken,
            notification,
            operationId
          );
          results.sent++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            token: deviceToken.id,
            error: error.message
          });
        }
      }

      logger.info('Notification sending completed', {
        operationId,
        userId,
        results
      });

      return {
        success: results.sent > 0,
        operationId,
        results
      };

    } catch (error) {
      logger.error('Failed to send notification', {
        operationId,
        userId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send notification to a specific device
   */
  async sendToDevice(deviceToken, notification, operationId) {
    const { token, platform, deviceId } = deviceToken;
    const provider = this.getProviderForPlatform(platform);

    if (!provider) {
      throw new Error(`No provider available for platform: ${platform}`);
    }

    try {
      // Prepare notification payload
      const payload = this.preparePayload(notification, platform);
      
      // Send notification
      const result = await provider.sendNotification(
        token,
        payload.title,
        payload.body,
        payload.data
      );

      // Log success
      await TokenHistory.create({
        userId: deviceToken.userId,
        token,
        tokenType: platform === 'ios' ? 'APN' : 'FCM',
        deviceId,
        action: 'USED',
        metadata: {
          operationId,
          notificationType: notification.type,
          result
        }
      });

      // Update last used timestamp
      await deviceToken.update({ lastUsed: new Date() });

      return result;

    } catch (error) {
      // Log failure
      await TokenHistory.logTokenFailure({
        userId: deviceToken.userId,
        token,
        tokenType: platform === 'ios' ? 'APN' : 'FCM',
        deviceId,
        error
      });

      // Handle invalid token
      if (this.isInvalidTokenError(error)) {
        await this.handleInvalidToken(deviceToken, error);
      }

      throw error;
    }
  }

  /**
   * Send message notification
   */
  async sendMessageNotification(message, recipients) {
    const sender = await User.findByPk(message.senderId);
    
    const notification = {
      type: 'new_message',
      title: `New message from ${sender.name}`,
      body: this.truncateMessage(message.content.text || 'New message'),
      data: {
        messageId: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: sender.name,
        type: 'chat_message'
      }
    };

    const results = [];

    for (const recipientId of recipients) {
      try {
        const result = await this.sendNotification(recipientId, notification);
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
  }

  /**
   * Handle invalid device token
   */
  async handleInvalidToken(deviceToken, error) {
    logger.warn('Invalid device token detected', {
      tokenId: deviceToken.id,
      platform: deviceToken.platform,
      error: error.message
    });

    // Mark token as inactive
    await deviceToken.update({ active: false });

    // Log revocation
    await TokenHistory.logTokenRevocation({
      userId: deviceToken.userId,
      token: deviceToken.token,
      tokenType: deviceToken.platform === 'ios' ? 'APN' : 'FCM',
      reason: 'invalid_token',
      revokedBy: 'system'
    });
  }

  /**
   * Prepare notification payload based on platform
   */
  preparePayload(notification, platform) {
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
        priority: 'high',
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
   * Truncate message for notification body
   */
  truncateMessage(text, maxLength = 100) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Batch send notifications
   */
  async batchSendNotifications(notifications) {
    const results = [];
    const batchSize = 100;

    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);
      
      const batchPromises = batch.map(notif => 
        this.sendNotification(notif.userId, notif.notification)
          .then(result => ({ userId: notif.userId, ...result }))
          .catch(error => ({ 
            userId: notif.userId, 
            success: false, 
            error: error.message 
          }))
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Clean up expired tokens
   */
  async cleanupExpiredTokens() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    const expiredTokens = await DeviceToken.findAll({
      where: {
        lastUsed: {
          [Op.lt]: thirtyDaysAgo
        },
        active: true
      }
    });

    logger.info('Cleaning up expired tokens', {
      count: expiredTokens.length
    });

    for (const token of expiredTokens) {
      await this.handleInvalidToken(token, { 
        message: 'Token expired due to inactivity' 
      });
    }

    return expiredTokens.length;
  }
}

module.exports = new NotificationManager();