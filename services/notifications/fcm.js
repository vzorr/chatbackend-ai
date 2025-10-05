const admin = require('firebase-admin');
const logger = require('../../utils/logger');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');

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
        logger.error('Failed to read or parse Firebase credentials file', { 
          error: readError.message, 
          path: credentialsPath 
        });
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
      logger.debug('FCM notification sent', { 
        response, 
        token: token.substring(0, 10) + '...' 
      });
      return { 
        success: true, 
        messageId: response,
        tokenValid: true 
      };
    } catch (error) {
      // CRITICAL FIX: Handle invalid tokens without recursive logging
      if (error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/invalid-registration-token') {
        
        // Use console.error to avoid logger recursion
        console.error('Invalid FCM token detected (will be removed):', {
          code: error.code,
          token: token.substring(0, 10) + '...'
        });
        
        return {
          success: false,
          tokenValid: false,
          invalidToken: token,
          error: error.code
        };
      }

      // For other errors, log normally but don't throw
      logger.error('FCM notification failed', { 
        error: error.message, 
        code: error.code,
        token: token.substring(0, 10) + '...' 
      });
      
      return {
        success: false,
        tokenValid: true, // Token might be valid, just delivery failed
        error: error.message
      };
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
      
      // Collect invalid tokens
      const invalidTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          const errorCode = resp.error?.code;
          if (errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/invalid-registration-token') {
            invalidTokens.push(tokens[idx]);
          }
        }
      });

      const results = {
        success: response.successCount,
        failure: response.failureCount,
        invalidTokens: invalidTokens,
        responses: response.responses
      };

      logger.info('FCM batch notification results', {
        success: results.success,
        failure: results.failure,
        invalidTokenCount: invalidTokens.length
      });
      
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