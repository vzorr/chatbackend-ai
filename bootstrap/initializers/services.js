// bootstrap/initializers/services.js
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

// Import your actual services
const redisService = require('../../services/redis');
const queueService = require('../../services/queue/queueService');
//const notificationManager = require('../../services/notifications/notificationManager');

const notificationService = require('../../services/notifications/notificationService');

async function initializeServices() {
  const startTime = Date.now();
  logger.info('🔧 [Services] Starting services initialization...');

  try {
    // Initialize services in dependency order
    await initializeRedisService();
    await initializeQueueService();

    // Initialize notification service
    await initializeNotificationService();

    //await initializeNotificationManager();
    
    const duration = Date.now() - startTime;
    logger.info('✅ [Services] All services initialized', {
      duration: `${duration}ms`,
      count: 3
    });
    
  } catch (error) {
    logger.error('❌ [Services] Services initialization failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function initializeNotificationService() {
  logger.info('🔧 [Services] Initializing notification service...');
  
  try {
    await notificationService.initialize();
    
    logger.info('✅ [Services] Notification service initialized');
  } catch (error) {
    logger.error('❌ [Services] Notification service initialization failed', {
      error: error.message
    });
    if (config.notifications.critical) {
      throw error;
    }
  }
}

async function initializeRedisService() {
  logger.info('🔧 [Services] Initializing Redis service...');
  
  try {
    if (redisService.initialize) {
      await redisService.initialize();
    } else {
      logger.warn('⚠️ [Services] Redis service initialize method not found');
    }
    
    // Test Redis connection
    await redisService.ping();
    
    logger.info('✅ [Services] Redis service initialized', {
      host: config.redis.host,
      port: config.redis.port
    });
  } catch (error) {
    logger.error('❌ [Services] Redis service initialization failed', {
      error: error.message
    });
    throw error; // Redis is critical for most operations
  }
}

async function initializeQueueService() {
  logger.info('🔧 [Services] Initializing queue service...');
  
  try {
    if (queueService.initialize) {
      await queueService.initialize();
    } else {
      logger.warn('⚠️ [Services] Queue service initialize method not found');
    }
    
    // Test queue service
    const pingResult = await queueService.ping();
    
    logger.info('✅ [Services] Queue service initialized', {
      status: pingResult.status
    });
  } catch (error) {
    logger.error('❌ [Services] Queue service initialization failed', {
      error: error.message
    });
    // Queue might not be critical for all operations
    if (config.queue.critical) {
      throw error;
    }
  }
}

async function initializeNotificationManager() {
  logger.info('🔧 [Services] Initializing notification manager...');
  
  try {
    await notificationManager.initialize();
    
    logger.info('✅ [Services] Notification manager initialized', {
      providers: notificationManager.providers ? 
        Array.from(notificationManager.providers.keys()) : []
    });
  } catch (error) {
    logger.error('❌ [Services] Notification manager initialization failed', {
      error: error.message
    });
    if (config.notifications.critical) {
      throw error;
    }
  }
}

module.exports = { initializeServices, initializeNotificationService };