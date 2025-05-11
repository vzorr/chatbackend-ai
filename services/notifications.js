// services/notifications.js (new file)
const admin = require('firebase-admin');
const apn = require('apn');
const { DeviceToken } = require('../db/models');
const logger = require('../utils/logger');

// Initialize Firebase Admin for Android
if (process.env.FIREBASE_CREDENTIALS) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    logger.info('Firebase Admin initialized for Android notifications');
  } catch (error) {
    logger.error(`Firebase Admin initialization failed: ${error}`);
  }
}

// Initialize APN for iOS
let apnProvider = null;
if (process.env.APN_KEY_PATH && process.env.APN_KEY_ID && process.env.APN_TEAM_ID) {
  try {
    apnProvider = new apn.Provider({
      token: {
        key: process.env.APN_KEY_PATH,
        keyId: process.env.APN_KEY_ID,
        teamId: process.env.APN_TEAM_ID
      },
      production: process.env.NODE_ENV === 'production'
    });
    logger.info('APN Provider initialized for iOS notifications');
  } catch (error) {
    logger.error(`APN Provider initialization failed: ${error}`);
  }
}

// Send push notification to a user
const sendPushNotification = async (userId, title, body, data = {}) => {
  try {
    // Get user's device tokens
    const deviceTokens = await DeviceToken.findAll({
      where: { userId }
    });
    
    if (deviceTokens.length === 0) {
      return { success: false, reason: 'No device tokens found' };
    }
    
    const results = {
      android: { success: 0, failure: 0 },
      ios: { success: 0, failure: 0 },
      web: { success: 0, failure: 0 }
    };
    
    // Group tokens by platform
    const androidTokens = [];
    const iosTokens = [];
    const webTokens = [];
    
    deviceTokens.forEach(device => {
      if (device.platform === 'android') {
        androidTokens.push(device.token);
      } else if (device.platform === 'ios') {
        iosTokens.push(device.token);
      } else if (device.platform === 'web') {
        webTokens.push(device.token);
      }
    });
    
    // Send to Android devices
    if (androidTokens.length > 0 && admin.messaging) {
      try {
        const message = {
          notification: {
            title,
            body
          },
          data: {
            ...data,
            click_action: 'FLUTTER_NOTIFICATION_CLICK'
          },
          tokens: androidTokens
        };
        
        const response = await admin.messaging().sendMulticast(message);
        results.android.success = response.successCount;
        results.android.failure = response.failureCount;
      } catch (error) {
        logger.error(`Error sending Android notifications: ${error}`);
        results.android.failure = androidTokens.length;
      }
    }
    
    // Send to iOS devices
    if (iosTokens.length > 0 && apnProvider) {
      try {
        const notification = new apn.Notification();
        notification.expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
        notification.badge = 1;
        notification.sound = 'ping.aiff';
        notification.alert = {
          title,
          body
        };
        notification.payload = data;
        notification.topic = process.env.APN_BUNDLE_ID;
        
        for (const token of iosTokens) {
          const result = await apnProvider.send(notification, token);
          if (result.sent.length > 0) {
            results.ios.success++;
          } else {
            results.ios.failure++;
          }
        }
      } catch (error) {
        logger.error(`Error sending iOS notifications: ${error}`);
        results.ios.failure = iosTokens.length;
      }
    }
    
    // Web push notifications would go here
    
    return {
      success: true,
      results
    };
  } catch (error) {
    logger.error(`Error sending push notification: ${error}`);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendPushNotification
};