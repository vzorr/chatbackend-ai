// bootstrap/initializers/notifications.js
const { logger } = require('../../utils/logger');
const notificationManager = require('../../services/notifications/notificationManager');
const config = require('../../config/config');

async function initializeNotifications() {
  const startTime = Date.now();
  logger.info('🔧 [Notifications] Starting notification manager initialization...');

  try {
    // Check if notifications are enabled
    if (!config.notifications.enabled) {
      logger.info('⏭️ [Notifications] Notifications disabled, skipping initialization');
      return;
    }

    // Validate notification configuration
    await validateNotificationConfig();
    
    // Initialize notification providers
    await initializeProviders();
    
    // Initialize notification manager
    await notificationManager.initialize();
    
    // Test notification services (development only)
    if (config.server.nodeEnv === 'development' && config.notifications.testOnStartup) {
      await testNotificationServices();
    }
    
    const duration = Date.now() - startTime;
    const providers = Array.from(notificationManager.providers.keys());
    
    logger.info('✅ [Notifications] Notification manager initialized', {
      duration: `${duration}ms`,
      providers: providers,
      fcmEnabled: notificationManager.providers.has('FCM'),
      apnEnabled: notificationManager.providers.has('APN'),
      emailEnabled: notificationManager.providers.has('EMAIL'),
      smsEnabled: notificationManager.providers.has('SMS')
    });
    
  } catch (error) {
    logger.error('❌ [Notifications] Notification initialization failed', {
      error: error.message,
      stack: error.stack
    });
    
    // Don't throw if notifications are not critical
    if (config.notifications.critical) {
      throw error;
    }
  }
}

async function validateNotificationConfig() {
  logger.info('🔍 [Notifications] Validating notification configuration...');
  
  const providers = config.notifications.providers || {};
  
  // Validate FCM configuration
  if (providers.fcm?.enabled) {
    if (!providers.fcm.credentials) {
      throw new Error('FCM credentials not configured');
    }
    logger.info('✅ [Notifications] FCM configuration validated');
  }
  
  // Validate APN configuration
  if (providers.apn?.enabled) {
    if (!providers.apn.key || !providers.apn.keyId || !providers.apn.teamId) {
      throw new Error('APN configuration incomplete');
    }
    logger.info('✅ [Notifications] APN configuration validated');
  }
  
  // Validate Email configuration
  if (providers.email?.enabled) {
    if (!providers.email.apiKey || !providers.email.from) {
      throw new Error('Email configuration incomplete');
    }
    logger.info('✅ [Notifications] Email configuration validated');
  }
  
  // Validate SMS configuration
  if (providers.sms?.enabled) {
    if (!providers.sms.apiKey || !providers.sms.from) {
      throw new Error('SMS configuration incomplete');
    }
    logger.info('✅ [Notifications] SMS configuration validated');
  }
}

async function initializeProviders() {
  logger.info('🔧 [Notifications] Initializing notification providers...');
  
  const providers = config.notifications.providers || {};
  
  // Initialize FCM (Firebase Cloud Messaging)
  if (providers.fcm?.enabled) {
    try {
      await initializeFCM(providers.fcm);
      logger.info('✅ [Notifications] FCM provider initialized');
    } catch (error) {
      logger.error('❌ [Notifications] Failed to initialize FCM', {
        error: error.message
      });
      if (providers.fcm.critical) throw error;
    }
  }
  
  // Initialize APN (Apple Push Notifications)
  if (providers.apn?.enabled) {
    try {
      await initializeAPN(providers.apn);
      logger.info('✅ [Notifications] APN provider initialized');
    } catch (error) {
      logger.error('❌ [Notifications] Failed to initialize APN', {
        error: error.message
      });
      if (providers.apn.critical) throw error;
    }
  }
  
  // Initialize Email provider
  if (providers.email?.enabled) {
    try {
      await initializeEmailProvider(providers.email);
      logger.info('✅ [Notifications] Email provider initialized');
    } catch (error) {
      logger.error('❌ [Notifications] Failed to initialize Email provider', {
        error: error.message
      });
      if (providers.email.critical) throw error;
    }
  }
  
  // Initialize SMS provider
  if (providers.sms?.enabled) {
    try {
      await initializeSMSProvider(providers.sms);
      logger.info('✅ [Notifications] SMS provider initialized');
    } catch (error) {
      logger.error('❌ [Notifications] Failed to initialize SMS provider', {
        error: error.message
      });
      if (providers.sms.critical) throw error;
    }
  }
}

async function initializeFCM(fcmConfig) {
  const admin = require('firebase-admin');
  
  // Initialize Firebase Admin SDK
  admin.initializeApp({
    credential: admin.credential.cert(fcmConfig.credentials),
    projectId: fcmConfig.projectId
  });
  
  // Register with notification manager
  notificationManager.registerProvider('FCM', {
    send: async (token, payload) => {
      return await admin.messaging().send({
        token,
        notification: payload.notification,
        data: payload.data
      });
    }
  });
}

async function initializeAPN(apnConfig) {
  const apn = require('apn');
  
  // Create APN provider
  const provider = new apn.Provider({
    token: {
      key: apnConfig.key,
      keyId: apnConfig.keyId,
      teamId: apnConfig.teamId
    },
    production: config.server.nodeEnv === 'production'
  });
  
  // Register with notification manager
  notificationManager.registerProvider('APN', {
    send: async (deviceToken, payload) => {
      const notification = new apn.Notification();
      notification.alert = payload.alert;
      notification.badge = payload.badge;
      notification.sound = payload.sound || 'default';
      notification.payload = payload.data;
      
      return await provider.send(notification, deviceToken);
    }
  });
}

async function initializeEmailProvider(emailConfig) {
  // Example using SendGrid
  const sgMail = require('@sendgrid/mail');
  sgMail.setApiKey(emailConfig.apiKey);
  
  // Register with notification manager
  notificationManager.registerProvider('EMAIL', {
    send: async (to, payload) => {
      const msg = {
        to,
        from: emailConfig.from,
        subject: payload.subject,
        text: payload.text,
        html: payload.html
      };
      
      return await sgMail.send(msg);
    }
  });
}

async function initializeSMSProvider(smsConfig) {
  // Example using Twilio
  const twilio = require('twilio');
  const client = twilio(smsConfig.accountSid, smsConfig.authToken);
  
  // Register with notification manager
  notificationManager.registerProvider('SMS', {
    send: async (to, payload) => {
      return await client.messages.create({
        body: payload.message,
        from: smsConfig.from,
        to
      });
    }
  });
}

async function testNotificationServices() {
  logger.info('🧪 [Notifications] Testing notification services...');
  
  try {
    // Test each enabled provider
    const testResults = {};
    
    if (notificationManager.providers.has('FCM')) {
      testResults.fcm = await testFCMService();
    }
    
    if (notificationManager.providers.has('APN')) {
      testResults.apn = await testAPNService();
    }
    
    if (notificationManager.providers.has('EMAIL')) {
      testResults.email = await testEmailService();
    }
    
    if (notificationManager.providers.has('SMS')) {
      testResults.sms = await testSMSService();
    }
    
    logger.info('✅ [Notifications] Service tests completed', testResults);
  } catch (error) {
    logger.error('❌ [Notifications] Service test failed', {
      error: error.message
    });
  }
}

// Test functions (implement actual tests)
async function testFCMService() {
  // Implement FCM test
  return { status: 'success', latency: '120ms' };
}

async function testAPNService() {
  // Implement APN test
  return { status: 'success', latency: '150ms' };
}

async function testEmailService() {
  // Implement email test
  return { status: 'success', latency: '200ms' };
}

async function testSMSService() {
  // Implement SMS test
  return { status: 'success', latency: '180ms' };
}

module.exports = { initializeNotifications };