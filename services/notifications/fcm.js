const admin = require('firebase-admin');
const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');  // Corrected path to config.js at root level

class FcmNotificationService {
  constructor() {
    this.initialized = false;
    this.firebaseApp = null;
  }

  async initialize() {
    try {
      if (this.initialized) {
        return true;
      }

      const credentialsPath = config.notifications.fcm.credentials;
      if (!credentialsPath) {
        logger.warn('Firebase credentials path not configured (FIREBASE_CREDENTIALS)');
        return false;
      }

      let serviceAccount;
      try {
        const resolvedPath = path.resolve(credentialsPath);
        const rawData = fs.readFileSync(resolvedPath, 'utf8');
        serviceAccount = JSON.parse(rawData);
      } catch (readError) {
        logger.error('Failed to read or parse Firebase credentials file', { error: readError.message, path: credentialsPath });
        return false;
      }

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });

      this.initialized = true;
      logger.info('FCM notification service initialized successfully');
      return true;
    } catch (error) {
      logger.error('Failed to initialize FCM service', { error: error.message });
      return false;
    }
  }

  async sendNotification(token, title, body, data = {}) {
    if (!this.initialized) {
      throw new Error('FCM service not initialized');
    }

    const message = {
      notification: {
        title,
        body
      },
      data: {
        ...data,
        timestamp: Date.now().toString(),
        priority: 'high'
      },
      token
    };

    try {
      const response = await admin.messaging().send(message);
      logger.debug('FCM notification sent', { response, token: token.substring(0, 10) + '...' });
      return { success: true, messageId: response };
    } catch (error) {
      logger.error('FCM notification failed', { 
        error: error.message, 
        code: error.code,
        token: token.substring(0, 10) + '...' 
      });
      throw error;
    }
  }

  async sendBatchNotifications(tokens, title, body, data = {}) {
    if (!this.initialized) {
      throw new Error('FCM service not initialized');
    }

    const messages = tokens.map(token => ({
      notification: { title, body },
      data: {
        ...data,
        timestamp: Date.now().toString(),
        priority: 'high'
      },
      token
    }));

    try {
      const response = await admin.messaging().sendEach(messages);
      
      const results = {
        success: response.successCount,
        failure: response.failureCount,
        responses: response.responses
      };

      logger.info('FCM batch notification results', results);
      return results;
    } catch (error) {
      logger.error('FCM batch notification failed', { error: error.message });
      throw error;
    }
  }

  async validateToken(token) {
    if (!this.initialized) {
      throw new Error('FCM service not initialized');
    }

    try {
      // Send a dry-run message to validate the token
      await admin.messaging().send({
        token,
        notification: { title: 'Test', body: 'Test' }
      }, true);
      
      return { valid: true };
    } catch (error) {
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        return { valid: false, reason: error.code };
      }
      throw error;
    }
  }
}

module.exports = new FcmNotificationService();
