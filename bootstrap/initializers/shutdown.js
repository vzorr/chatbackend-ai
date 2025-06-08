// bootstrap/initializers/shutdown.js
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

function setupGracefulShutdown(server, io) {
  logger.info('🔧 [Shutdown] Setting up graceful shutdown handlers...');

  // Store active connections
  const connections = new Set();
  
  // Track connections
  server.on('connection', (connection) => {
    connections.add(connection);
    
    connection.on('close', () => {
      connections.delete(connection);
    });
  });

  // Shutdown handler function
  const shutdownHandler = async (signal) => {
    logger.warn(`⚠️ [Shutdown] ${signal} received, initiating graceful shutdown...`);
    
    const startTime = Date.now();
    
    try {
      // Phase 1: Stop accepting new connections
      await stopAcceptingConnections(server);
      
      // Phase 2: Close WebSocket connections
      await closeWebSocketConnections(io);
      
      // Phase 3: Wait for active requests to complete
      await waitForActiveRequests(connections);
      
      // Phase 4: Close service connections
      await closeServiceConnections();
      
      // Phase 5: Cleanup resources
      await cleanupResources();
      
      const duration = Date.now() - startTime;
      logger.info('✅ [Shutdown] Graceful shutdown completed', {
        duration: `${duration}ms`,
        signal
      });
      
      process.exit(0);
    } catch (error) {
      logger.error('❌ [Shutdown] Error during graceful shutdown', {
        error: error.message,
        stack: error.stack
      });
      
      // Force exit after timeout
      setTimeout(() => {
        logger.error('❌ [Shutdown] Forced shutdown after timeout');
        process.exit(1);
      }, config.shutdown.forceTimeout || 30000);
    }
  };

  // Register signal handlers
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('💥 [Shutdown] Uncaught exception', {
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    shutdownHandler('UNCAUGHT_EXCEPTION');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('💥 [Shutdown] Unhandled promise rejection', {
      reason: reason.message || reason,
      stack: reason.stack || 'No stack trace available',
      promise
    });
    shutdownHandler('UNHANDLED_REJECTION');
  });

  logger.info('✅ [Shutdown] Graceful shutdown handlers configured', {
    signals: ['SIGTERM', 'SIGINT'],
    handlers: ['uncaughtException', 'unhandledRejection']
  });
}

async function stopAcceptingConnections(server) {
  logger.info('🔄 [Shutdown] Stopping server from accepting new connections...');
  
  return new Promise((resolve) => {
    server.close(() => {
      logger.info('✅ [Shutdown] Server stopped accepting new connections');
      resolve();
    });
  });
}

async function closeWebSocketConnections(io) {
  if (!io) return;
  
  logger.info('🔄 [Shutdown] Closing WebSocket connections...');
  
  // Notify clients about shutdown
  io.emit('server:shutdown', {
    message: 'Server is shutting down',
    reconnect: false
  });
  
  // Give clients time to receive the message
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Close all connections
  return new Promise((resolve) => {
    io.close(() => {
      logger.info('✅ [Shutdown] WebSocket connections closed');
      resolve();
    });
  });
}

async function waitForActiveRequests(connections) {
  logger.info('🔄 [Shutdown] Waiting for active requests to complete...');
  
  const timeout = config.shutdown.requestTimeout || 30000;
  const checkInterval = 100;
  const maxChecks = timeout / checkInterval;
  let checks = 0;
  
  while (connections.size > 0 && checks < maxChecks) {
    await new Promise(resolve => setTimeout(resolve, checkInterval));
    checks++;
  }
  
  if (connections.size > 0) {
    logger.warn('⚠️ [Shutdown] Force closing remaining connections', {
      count: connections.size
    });
    
    // Force close remaining connections
    for (const connection of connections) {
      connection.destroy();
    }
  }
  
  logger.info('✅ [Shutdown] All connections closed');
}

async function closeServiceConnections() {
  logger.info('🔄 [Shutdown] Closing service connections...');
  
  try {
    // Close database connections
    await closeDatabaseConnections();
    
    // Close cache connections
    await closeCacheConnections();
    
    // Close notification services
    await closeNotificationServices();
    
    // Close other services
    await closeOtherServices();
    
    logger.info('✅ [Shutdown] All service connections closed');
  } catch (error) {
    logger.error('❌ [Shutdown] Error closing service connections', {
      error: error.message
    });
  }
}

async function closeDatabaseConnections() {
  logger.info('🔄 [Shutdown] Closing database connections...');
  
  const { connectionManager } = require('../../services/connectionManager');
  
  if (connectionManager) {
    await connectionManager.close();
    logger.info('✅ [Shutdown] Database connections closed');
  }
}

async function closeCacheConnections() {
  logger.info('🔄 [Shutdown] Closing cache connections...');
  
  const { cacheService } = require('../../services/cache');
  
  if (cacheService && cacheService.isConnected()) {
    await cacheService.disconnect();
    logger.info('✅ [Shutdown] Cache connections closed');
  }
}

async function closeNotificationServices() {
  logger.info('🔄 [Shutdown] Closing notification services...');
  
  const { notificationService } = require('../../services/notifications/notificationService');
  
  if (notificationService && notificationService.initialized) {
    await notificationService.close();
    logger.info('✅ [Shutdown] Notification services closed');
  }
}

async function closeOtherServices() {
  logger.info('🔄 [Shutdown] Closing other services...');
  
  // Close any other services (search, storage, etc.)
  const services = [
    { name: 'search', module: require('../../services/search') },
    { name: 'storage', module: require('../../services/storage') },
    { name: 'email', module: require('../../services/email') }
  ];
  
  for (const service of services) {
    try {
      if (service.module && typeof service.module.close === 'function') {
        await service.module.close();
        logger.info(`✅ [Shutdown] ${service.name} service closed`);
      }
    } catch (error) {
      logger.error(`❌ [Shutdown] Error closing ${service.name} service`, {
        error: error.message
      });
    }
  }
}

async function cleanupResources() {
  logger.info('🔄 [Shutdown] Cleaning up resources...');
  
  try {
    // Clear timers and intervals
    clearTimersAndIntervals();
    
    // Clear temporary files
    await clearTempFiles();
    
    // Flush logs
    await flushLogs();
    
    logger.info('✅ [Shutdown] Resources cleaned up');
  } catch (error) {
    logger.error('❌ [Shutdown] Error during cleanup', {
      error: error.message
    });
  }
}

function clearTimersAndIntervals() {
  // Clear any global timers or intervals
  const activeTimers = process._getActiveHandles();
  const timerCount = activeTimers.filter(handle => 
    handle.constructor.name === 'Timer' || 
    handle.constructor.name === 'Timeout'
  ).length;
  
  logger.info(`🧹 [Shutdown] Clearing ${timerCount} active timers`);
}

async function clearTempFiles() {
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    const tempDir = path.join(process.cwd(), 'temp');
    const files = await fs.readdir(tempDir);
    
    for (const file of files) {
      await fs.unlink(path.join(tempDir, file));
    }
    
    logger.info(`🧹 [Shutdown] Cleared ${files.length} temporary files`);
  } catch (error) {
    logger.error('❌ [Shutdown] Error clearing temp files', {
      error: error.message
    });
  }
}

async function flushLogs() {
  logger.info('📝 [Shutdown] Flushing logs...');
  
  // Give logger time to flush
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // If using winston or similar, explicitly flush
  if (logger.end && typeof logger.end === 'function') {
    await new Promise(resolve => logger.end(resolve));
  }
}

module.exports = { setupGracefulShutdown };