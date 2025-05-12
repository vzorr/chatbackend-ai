// services/notifications/apn.js
const apn = require('apn');
const logger = require('../../utils/logger');
const fs = require('fs');

class ApnNotificationService {
  constructor() {
    this.initialized = false;
    this.provider = null;
  }

  async initialize() {
    try {
      if (this.initialized) {
        return true;
      }

      const keyPath = process.env.APN_KEY_PATH;
      const keyId = process.env.APN_KEY_ID;
      const teamId = process.env.APN_TEAM_ID;

      if (!keyPath || !keyId || !teamId) {
        logger.warn('APN configuration missing');
        return false;
      }

      // Check if key file exists
      if (!fs.existsSync(keyPath)) {
        logger.error('APN key file not found', { keyPath });
        return false;
      }

      const options = {
        token: {
          key: keyPath,
          keyId: keyId,
          teamId: teamId
        },
        production: process.env.NODE_ENV === 'production'
      };

      this.provider = new apn.Provider(options);
      this.initialized = true;
      
      logger.info('APN notification service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize APN service', { error: error.message });
      return false;
    }
  }

  async sendNotification(token, title, body, data = {}) {
    if (!this.initialized) {
      throw new Error('APN service not initialized');
    }

    const notification = new apn.Notification();
    
    notification.expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    notification.badge = data.badge || 1;
    notification.sound = data.sound || 'default';
    notification.alert = {
      title,
      body
    };
    notification.payload = {
      ...data,
      messageFrom: 'chat-server'
    };
    notification.topic = process.env.APN_BUNDLE_ID;
    notification.pushType = 'alert';
    notification.priority = 10;

    try {
      const result = await this.provider.send(notification, token);
      
      if (result.sent.length > 0) {
        logger.debug('APN notification sent', { 
          deviceToken: token.substring(0, 10) + '...',
          messageId: result.sent[0].id 
        });
        return { success: true, messageId: result.sent[0].id };
      }
      
      if (result.failed.length > 0) {
        const error = result.failed[0];
        logger.error('APN notification failed', { 
          error: error.response,
          device: error.device.substring(0, 10) + '...'
        });
        
        throw new Error(error.response.reason || 'Unknown APN error');
      }
      
      return { success: false, reason: 'No devices processed' };
    } catch (error) {
      logger.error('APN send error', { 
        error: error.message,
        device: token.substring(0, 10) + '...' 
      });
      throw error;
    }
  }

  async sendBatchNotifications(tokens, title, body, data = {}) {
    if (!this.initialized) {
      throw new Error('APN service not initialized');
    }

    const notification = new apn.Notification();
    
    notification.expiry = Math.floor(Date.now() / 1000) + 3600;
    notification.badge = data.badge || 1;
    notification.sound = data.sound || 'default';
    notification.alert = {
      title,
      body
    };
    notification.payload = {
      ...data,
      messageFrom: 'chat-server'
    };
    notification.topic = process.env.APN_BUNDLE_ID;
    notification.pushType = 'alert';
    notification.priority = 10;

    try {
      const result = await this.provider.send(notification, tokens);
      
      const results = {
        success: result.sent.length,
        failure: result.failed.length,
        sent: result.sent,
        failed: result.failed
      };

      logger.info('APN batch notification results', {
        success: results.success,
        failure: results.failure
      });

      return results;
    } catch (error) {
      logger.error('APN batch send error', { error: error.message });
      throw error;
    }
  }

  async shutdown() {
    if (this.provider) {
      await this.provider.shutdown();
      this.provider = null;
      this.initialized = false;
      logger.info('APN service shut down');
    }
  }
}

module.exports = new ApnNotificationService();