// bootstrap/initializers/http-server.js
const { logger } = require('../../utils/logger');
const config = require('../../config/config');
const cluster = require('cluster');

async function startHTTPServer(server, io) {
  const startTime = Date.now();
  logger.info('🔧 [Server] Starting HTTP server...');

  try {
    // Configure server timeout
    server.timeout = config.server.timeout || 120000; // 2 minutes
    server.keepAliveTimeout = config.server.keepAliveTimeout || 65000;
    server.headersTimeout = config.server.headersTimeout || 66000;
    
    logger.info('✅ [Server] Server timeouts configured', {
      timeout: server.timeout,
      keepAliveTimeout: server.keepAliveTimeout,
      headersTimeout: server.headersTimeout
    });

    const PORT = config.server.port;
    const HOST = config.server.host || '0.0.0.0';

    await new Promise((resolve, reject) => {
      server.listen(PORT, HOST, (error) => {
        if (error) {
          logger.error('❌ [Server] Failed to start HTTP server', {
            error: error.message,
            port: PORT,
            host: HOST
          });
          reject(error);
          return;
        }

        const duration = Date.now() - startTime;
        
        // Log startup information
        logger.info('🚀 [Server] HTTP server is running!', {
          url: `http://${HOST}:${PORT}`,
          environment: config.server.nodeEnv,
          pid: process.pid,
          workerId: cluster.worker?.id,
          duration: `${duration}ms`,
          nodeVersion: process.version
        });

        // HTTPS warning for production
        if (config.server.nodeEnv === 'production' && 
            !process.env.SERVER_URL?.startsWith('https')) {
          logger.warn('🚨 [Server] WARNING: Server is running over HTTP in production mode. Use HTTPS (wss) for WebSocket security!');
        }

        // Log service endpoints
        logServiceEndpoints(HOST, PORT);
        
        // Log enabled features
        logEnabledFeatures();
        
        // Log service status
        logServiceStatus();
        
        resolve();
      });
    });

    // Setup connection monitoring
    setupConnectionMonitoring(server);
    
  } catch (error) {
    logger.error('❌ [Server] HTTP server startup failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

function logServiceEndpoints(host, port) {
  const endpoints = {
    api: `http://${host}:${port}`,
    health: `http://${host}:${port}/health`
  };

  // Only add optional endpoints if they're enabled
  if (config.documentation?.enabled) {
    endpoints.docs = `http://${host}:${port}/api-docs`;
  }
  
  if (config.monitoring?.metrics?.enabled) {
    endpoints.metrics = `http://${host}:${port}/metrics`;
  }

  logger.info('📚 [Server] Service endpoints available:', endpoints);
}

function logEnabledFeatures() {
  const enabledFeatures = Object.entries(config.features || {})
    .filter(([_, enabled]) => enabled)
    .map(([feature]) => feature);
  
  if (enabledFeatures.length > 0) {
    logger.info('🎯 [Server] Enabled features', { 
      features: enabledFeatures,
      count: enabledFeatures.length
    });
  }
}

function logServiceStatus() {
  const { notificationManager } = require('../../services/notificationManager');
  
  const serviceStatus = {
    database: 'connected',
    cache: config.cache.enabled ? 'connected' : 'disabled',
    notifications: notificationManager.initialized ? 'initialized' : 'disabled',
    fcm: notificationManager.providers?.has('FCM') ? 'enabled' : 'disabled',
    apn: notificationManager.providers?.has('APN') ? 'enabled' : 'disabled',
    email: config.email.enabled ? 'enabled' : 'disabled',
    search: config.search.enabled ? 'enabled' : 'disabled'
  };

  logger.info('📊 [Server] Service status', serviceStatus);
}

function setupConnectionMonitoring(server) {
  let connectionCount = 0;
  
  server.on('connection', (socket) => {
    connectionCount++;
    
    socket.on('close', () => {
      connectionCount--;
    });
  });
  
  // Log connection stats periodically
  setInterval(() => {
    logger.info('📊 [Server] Connection statistics', {
      activeConnections: connectionCount,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    });
  }, config.monitoring?.statsInterval || 300000); // 5 minutes
}

module.exports = { startHTTPServer };