// bootstrap/initializers/services.js - UPDATED VERSION
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

// Import your actual services
const redisService = require('../../services/redis');
const queueService = require('../../services/queue/queueService');
const notificationService = require('../../services/notifications/notificationService');

async function initializeServices() {
  const startTime = Date.now();
  logger.info('🔧 [Services] Starting services initialization...');

  const serviceResults = [];

  try {
    // Initialize services in dependency order
    const redisResult = await initializeRedisService();
    serviceResults.push({ name: 'Redis', ...redisResult });

    const queueResult = await initializeQueueService();
    serviceResults.push({ name: 'Queue', ...queueResult });

    // Initialize notification service
    const notificationResult = await initializeNotificationService();
    serviceResults.push({ name: 'Notifications', ...notificationResult });
    
    const duration = Date.now() - startTime;
    const successfulServices = serviceResults.filter(s => s.success).length;
    const failedServices = serviceResults.filter(s => !s.success).length;
    
    logger.info('✅ [Services] Services initialization completed', {
      duration: `${duration}ms`,
      total: serviceResults.length,
      successful: successfulServices,
      failed: failedServices,
      services: serviceResults.map(s => ({ name: s.name, success: s.success }))
    });

    // If critical services failed, throw error
    const criticalFailures = serviceResults.filter(s => !s.success && s.critical);
    if (criticalFailures.length > 0) {
      throw new Error(`Critical services failed: ${criticalFailures.map(s => s.name).join(', ')}`);
    }
    
  } catch (error) {
    logger.error('❌ [Services] Services initialization failed', {
      error: error.message,
      stack: error.stack,
      serviceResults
    });
    throw error;
  }
}

async function initializeRedisService() {
  logger.info('🔧 [Services] Initializing Redis service...');
  
  try {
    // Initialize Redis if method exists
    if (typeof redisService.initialize === 'function') {
      await redisService.initialize();
      logger.debug('📡 [Services] Redis initialize() method called');
    } else {
      logger.debug('📡 [Services] Redis service has no initialize() method, skipping');
    }
    
    // Test Redis connection
    const startTime = Date.now();
    await redisService.ping();
    const responseTime = Date.now() - startTime;
    
    logger.info('✅ [Services] Redis service initialized', {
      host: config.redis?.host || 'localhost',
      port: config.redis?.port || 6379,
      responseTime: `${responseTime}ms`
    });

    return { success: true, critical: true, responseTime };
  } catch (error) {
    logger.error('❌ [Services] Redis service initialization failed', {
      error: error.message,
      host: config.redis?.host,
      port: config.redis?.port
    });
    
    // Redis is critical for most operations
    return { 
      success: false, 
      critical: true, 
      error: error.message 
    };
  }
}

async function initializeQueueService() {
  logger.info('🔧 [Services] Initializing queue service...');
  
  try {
    // Initialize queue service if method exists
    if (typeof queueService.initialize === 'function') {
      await queueService.initialize();
      logger.debug('📡 [Services] Queue initialize() method called');
    } else {
      logger.debug('📡 [Services] Queue service has no initialize() method, skipping');
    }
    
    // Test queue service
    const startTime = Date.now();
    const pingResult = await queueService.ping();
    const responseTime = Date.now() - startTime;
    
    logger.info('✅ [Services] Queue service initialized', {
      status: pingResult?.status || 'unknown',
      responseTime: `${responseTime}ms`
    });

    return { 
      success: true, 
      critical: config.queue?.critical || false, 
      status: pingResult?.status,
      responseTime 
    };
  } catch (error) {
    logger.error('❌ [Services] Queue service initialization failed', {
      error: error.message
    });
    
    // Queue might not be critical for all operations
    const isCritical = config.queue?.critical || false;
    
    return { 
      success: false, 
      critical: isCritical, 
      error: error.message 
    };
  }
}

async function initializeNotificationService() {
  logger.info('🔧 [Services] Initializing notification service...');
  
  try {
    const startTime = Date.now();
    const initSuccess = await notificationService.initialize();
    const responseTime = Date.now() - startTime;
    
    if (!initSuccess) {
      throw new Error('Notification service initialize() returned false');
    }
    
    // Get service status
    const providers = notificationService.providers ? 
      Array.from(notificationService.providers.keys()) : [];
    
    logger.info('✅ [Services] Notification service initialized', {
      initialized: notificationService.initialized,
      providers: providers,
      responseTime: `${responseTime}ms`,
      fcmEnabled: providers.includes('FCM'),
      apnEnabled: providers.includes('APN')
    });

    return { 
      success: true, 
      critical: config.notifications?.critical || false,
      providers,
      responseTime
    };
  } catch (error) {
    logger.error('❌ [Services] Notification service initialization failed', {
      error: error.message,
      stack: error.stack
    });
    
    const isCritical = config.notifications?.critical || false;
    
    if (isCritical) {
      logger.error('🚨 [Services] Notification service is marked as critical - initialization failure will stop startup');
    } else {
      logger.warn('⚠️ [Services] Notification service failed but is not critical - continuing startup');
    }
    
    return { 
      success: false, 
      critical: isCritical, 
      error: error.message 
    };
  }
}

/**
 * Health check for all services
 */
async function getServicesHealth() {
  const health = {
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Check Redis
  try {
    const startTime = Date.now();
    await redisService.ping();
    const responseTime = Date.now() - startTime;
    
    health.services.redis = {
      status: 'healthy',
      responseTime: `${responseTime}ms`
    };
  } catch (error) {
    health.services.redis = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Check Queue
  try {
    const startTime = Date.now();
    const pingResult = await queueService.ping();
    const responseTime = Date.now() - startTime;
    
    health.services.queue = {
      status: pingResult?.status === 'ok' ? 'healthy' : 'unhealthy',
      responseTime: `${responseTime}ms`,
      details: pingResult
    };
  } catch (error) {
    health.services.queue = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Check Notifications
  try {
    health.services.notifications = {
      status: notificationService.initialized ? 'healthy' : 'unhealthy',
      initialized: notificationService.initialized,
      providers: notificationService.providers ? 
        Array.from(notificationService.providers.keys()) : []
    };
  } catch (error) {
    health.services.notifications = {
      status: 'unhealthy',
      error: error.message
    };
  }

  // Determine overall health
  const serviceStatuses = Object.values(health.services).map(s => s.status);
  const healthyCount = serviceStatuses.filter(s => s === 'healthy').length;
  const totalCount = serviceStatuses.length;

  if (healthyCount === totalCount) {
    health.overall = 'healthy';
  } else if (healthyCount > 0) {
    health.overall = 'degraded';
  } else {
    health.overall = 'unhealthy';
  }

  health.summary = `${healthyCount}/${totalCount} services healthy`;

  return health;
}

/**
 * Graceful shutdown of all services
 */
async function shutdownServices() {
  logger.info('🔽 [Services] Starting graceful services shutdown...');
  
  const shutdownResults = [];

  // Shutdown notification service
  try {
    if (typeof notificationService.shutdown === 'function') {
      await notificationService.shutdown();
      shutdownResults.push({ service: 'notifications', success: true });
      logger.info('✅ [Services] Notification service shut down');
    }
  } catch (error) {
    shutdownResults.push({ service: 'notifications', success: false, error: error.message });
    logger.error('❌ [Services] Notification service shutdown failed', { error: error.message });
  }

  // Shutdown queue service
  try {
    if (typeof queueService.shutdown === 'function') {
      await queueService.shutdown();
      shutdownResults.push({ service: 'queue', success: true });
      logger.info('✅ [Services] Queue service shut down');
    }
  } catch (error) {
    shutdownResults.push({ service: 'queue', success: false, error: error.message });
    logger.error('❌ [Services] Queue service shutdown failed', { error: error.message });
  }

  // Shutdown Redis service
  try {
    if (typeof redisService.shutdown === 'function') {
      await redisService.shutdown();
      shutdownResults.push({ service: 'redis', success: true });
      logger.info('✅ [Services] Redis service shut down');
    }
  } catch (error) {
    shutdownResults.push({ service: 'redis', success: false, error: error.message });
    logger.error('❌ [Services] Redis service shutdown failed', { error: error.message });
  }

  const successfulShutdowns = shutdownResults.filter(r => r.success).length;
  
  logger.info('✅ [Services] Services shutdown completed', {
    total: shutdownResults.length,
    successful: successfulShutdowns,
    failed: shutdownResults.length - successfulShutdowns,
    results: shutdownResults
  });

  return shutdownResults;
}

module.exports = { 
  initializeServices, 
  initializeNotificationService,
  getServicesHealth,
  shutdownServices
};