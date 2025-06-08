// bootstrap/initializers/notifications.js - UPDATED VERSION
const { logger } = require('../../utils/logger');
const notificationService = require('../../services/notifications/notificationService');
const fcmService = require('../../services/notifications/fcm');
const config = require('../../config/config');

async function initializeNotifications() {
  const startTime = Date.now();
  logger.info('🔧 [Notifications] Starting notification service initialization...');

  try {
    // Check if notifications are enabled
    if (!config.notifications?.enabled) {
      logger.info('⏭️ [Notifications] Notifications disabled, skipping initialization');
      return;
    }

    // Validate notification configuration
    await validateNotificationConfig();
    
    // Initialize notification service
    const initSuccess = await notificationService.initialize();
    
    if (!initSuccess) {
      throw new Error('Notification service initialization failed');
    }
    
    // Test notification services (development only)
    if (config.server?.nodeEnv === 'development' && config.notifications?.testOnStartup) {
      await testNotificationServices();
    }
    
    const duration = Date.now() - startTime;
    
    // Check which providers are available
    const providers = [];
    if (notificationService.providers?.has('FCM')) providers.push('FCM');
    if (notificationService.providers?.has('APN')) providers.push('APN');
    
    logger.info('✅ [Notifications] Notification service initialized', {
      duration: `${duration}ms`,
      providers: providers,
      fcmEnabled: providers.includes('FCM'),
      apnEnabled: providers.includes('APN'),
      serviceInitialized: notificationService.initialized
    });
    
  } catch (error) {
    logger.error('❌ [Notifications] Notification initialization failed', {
      error: error.message,
      stack: error.stack
    });
    
    // Don't throw if notifications are not critical
    if (config.notifications?.critical) {
      throw error;
    } else {
      logger.warn('⚠️ [Notifications] Continuing without notifications (not marked as critical)');
    }
  }
}

async function validateNotificationConfig() {
  logger.info('🔍 [Notifications] Validating notification configuration...');
  
  const providers = config.notifications?.providers || {};
  
  // Validate FCM configuration
  if (providers.fcm?.enabled) {
    if (!providers.fcm.credentials && !config.notifications?.fcm?.credentials) {
      logger.warn('⚠️ [Notifications] FCM credentials not configured - FCM will be disabled');
    } else {
      logger.info('✅ [Notifications] FCM configuration found');
    }
  }
  
  // Validate APN configuration (for future use)
  if (providers.apn?.enabled) {
    if (!providers.apn.key || !providers.apn.keyId || !providers.apn.teamId) {
      logger.warn('⚠️ [Notifications] APN configuration incomplete - APN will be disabled');
    } else {
      logger.info('✅ [Notifications] APN configuration validated');
    }
  }
  
  logger.info('✅ [Notifications] Configuration validation completed');
}

async function testNotificationServices() {
  logger.info('🧪 [Notifications] Testing notification services...');
  
  try {
    const testResults = {};
    
    // Test FCM service
    if (fcmService.initialized) {
      testResults.fcm = await testFCMService();
    } else {
      testResults.fcm = { status: 'disabled', reason: 'FCM not initialized' };
    }
    
    // Test notification service core functionality
    testResults.notificationService = await testNotificationServiceCore();
    
    logger.info('✅ [Notifications] Service tests completed', testResults);
    return testResults;
  } catch (error) {
    logger.error('❌ [Notifications] Service test failed', {
      error: error.message
    });
    return { error: error.message };
  }
}

async function testFCMService() {
  try {
    const startTime = Date.now();
    
    // Test FCM service initialization
    if (!fcmService.initialized) {
      return { status: 'failed', reason: 'FCM service not initialized' };
    }
    
    // You could add a dry-run test here if needed
    // For now, just check if the service is ready
    const latency = Date.now() - startTime;
    
    return { 
      status: 'success', 
      latency: `${latency}ms`,
      initialized: fcmService.initialized
    };
  } catch (error) {
    return { 
      status: 'failed', 
      error: error.message 
    };
  }
}

async function testNotificationServiceCore() {
  try {
    const startTime = Date.now();
    
    // Test basic service functionality
    const testUserId = 'test-user-id';
    const testAppId = 'test-app';
    
    // Test if service can handle basic operations without crashing
    try {
      // This should gracefully handle missing templates/users
      await notificationService.getUserNotifications(testUserId, { limit: 1 });
    } catch (error) {
      // Expected to fail with missing data, but service should handle it gracefully
      if (error.message.includes('models not available') || 
          error.message.includes('not initialized')) {
        return { status: 'failed', reason: 'Database not ready' };
      }
    }
    
    const latency = Date.now() - startTime;
    
    return { 
      status: 'success', 
      latency: `${latency}ms`,
      initialized: notificationService.initialized
    };
  } catch (error) {
    return { 
      status: 'failed', 
      error: error.message 
    };
  }
}

// Additional helper functions for notification management

/**
 * Get notification service status
 */
async function getNotificationStatus() {
  return {
    serviceInitialized: notificationService.initialized,
    fcmInitialized: fcmService.initialized,
    providers: notificationService.providers ? Array.from(notificationService.providers.keys()) : [],
    configEnabled: config.notifications?.enabled || false
  };
}

/**
 * Restart notification service (for maintenance)
 */
async function restartNotificationService() {
  logger.info('🔄 [Notifications] Restarting notification service...');
  
  try {
    // Shutdown if needed
    if (notificationService.shutdown) {
      await notificationService.shutdown();
    }
    
    // Reinitialize
    await initializeNotifications();
    
    logger.info('✅ [Notifications] Notification service restarted successfully');
    return true;
  } catch (error) {
    logger.error('❌ [Notifications] Failed to restart notification service', {
      error: error.message
    });
    return false;
  }
}

/**
 * Health check for notifications
 */
async function healthCheck() {
  const status = await getNotificationStatus();
  
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      notificationService: status.serviceInitialized ? 'up' : 'down',
      fcm: status.fcmInitialized ? 'up' : 'down'
    },
    providers: status.providers
  };
  
  // Determine overall health
  if (!status.serviceInitialized) {
    health.status = 'unhealthy';
    health.issues = ['Notification service not initialized'];
  } else if (!status.fcmInitialized && config.notifications?.providers?.fcm?.enabled) {
    health.status = 'degraded';
    health.issues = ['FCM service not available'];
  }
  
  return health;
}

module.exports = { 
  initializeNotifications,
  getNotificationStatus,
  restartNotificationService,
  healthCheck
};