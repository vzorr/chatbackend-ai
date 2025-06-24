// bootstrap/initializers/http-server.js
const { logger } = require('../../utils/logger');
const config = require('../../config/config');
const cluster = require('cluster');

async function startHTTPServer(server, io) {
  const startTime = Date.now();
  logger.info('🔧 [Server] Starting HTTP/HTTPS server...');

  try {
    // Configure server timeout with SSL considerations
    configureServerTimeouts(server);
    
    // Setup SSL-specific server events
    setupSSLServerEvents(server);

    const PORT = config.server.port;
    const HOST = config.server.host || '0.0.0.0';

    await new Promise((resolve, reject) => {
      server.listen(PORT, HOST, (error) => {
        if (error) {
          logger.error('❌ [Server] Failed to start server', {
            error: error.message,
            port: PORT,
            host: HOST,
            ssl: config.ssl?.enabled || false
          });
          reject(error);
          return;
        }

        const duration = Date.now() - startTime;
        
        // Enhanced startup information with SSL context
        logServerStartup(HOST, PORT, duration);
        
        // Log service endpoints with SSL awareness
        logServiceEndpoints(HOST, PORT);
        
        // Log enabled features
        logEnabledFeatures();
        
        // Log service status with SSL context
        logServiceStatus();
        
        resolve();
      });
    });

    // Setup enhanced connection monitoring with SSL awareness
    setupEnhancedConnectionMonitoring(server, io);
    
  } catch (error) {
    logger.error('❌ [Server] Server startup failed', {
      error: error.message,
      stack: error.stack,
      ssl: config.ssl?.enabled || false
    });
    throw error;
  }
}

function configureServerTimeouts(server) {
  // Enhanced timeout configuration for SSL connections
  const timeouts = {
    timeout: config.server?.timeout || 120000, // 2 minutes
    keepAliveTimeout: config.server?.keepAliveTimeout || 65000,
    headersTimeout: config.server?.headersTimeout || 66000,
    requestTimeout: config.server?.requestTimeout || 30000
  };
  
  // Apply timeouts
  server.timeout = timeouts.timeout;
  server.keepAliveTimeout = timeouts.keepAliveTimeout;
  server.headersTimeout = timeouts.headersTimeout;
  
  // Set request timeout if available (Node.js 14.11+)
  if (server.requestTimeout !== undefined) {
    server.requestTimeout = timeouts.requestTimeout;
  }
  
  logger.info('✅ [Server] Server timeouts configured', timeouts);
}

function setupSSLServerEvents(server) {
  // Standard error handlers
  server.on('error', (error) => {
    logger.error('❌ [Server] Server error', {
      error: error.message,
      code: error.code,
      stack: error.stack
    });
  });
  
  // SSL-specific event handlers (for HTTPS servers)
  if (server.listening && server.cert) {
    server.on('tlsClientError', (err, tlsSocket) => {
      logger.error('❌ [SSL] TLS client error', {
        error: err.message,
        code: err.code,
        remoteAddress: tlsSocket?.remoteAddress,
        remotePort: tlsSocket?.remotePort
      });
    });
    
    server.on('secureConnect', (cleartextStream) => {
      logger.debug('🔒 [SSL] Secure connection established', {
        remoteAddress: cleartextStream.remoteAddress,
        cipher: cleartextStream.getCipher?.(),
        protocol: cleartextStream.getProtocol?.(),
        authorized: cleartextStream.authorized
      });
    });
    
    server.on('newSession', (sessionId, sessionData, callback) => {
      logger.debug('🔑 [SSL] New TLS session created', {
        sessionId: sessionId.toString('hex'),
        sessionSize: sessionData.length
      });
      callback();
    });
  }
  
  logger.info('✅ [Server] SSL event handlers configured');
}

function logServerStartup(host, port, duration) {
  const publicUrl = getPublicUrl(host, port);
  const localUrl = getLocalUrl(host, port);
  const isSecure = config.ssl?.enabled || config.security?.trustProxy;
  
  logger.info('🚀 [Server] Server is running!', {
    publicUrl: publicUrl,
    localUrl: localUrl,
    protocol: isSecure ? 'https' : 'http',
    ssl: {
      enabled: config.ssl?.enabled || false,
      direct: config.ssl?.enabled && config.ssl?.certificatePath,
      behindProxy: config.security?.trustProxy || false
    },
    environment: config.server.nodeEnv,
    pid: process.pid,
    workerId: cluster.worker?.id,
    duration: `${duration}ms`,
    nodeVersion: process.version,
    domain: config.app?.domain
  });
  
  // Enhanced production warnings
  if (config.server.nodeEnv === 'production') {
    if (!publicUrl.startsWith('https')) {
      logger.error('🚨 [Server] CRITICAL: Public URL is not HTTPS in production!', {
        publicUrl: publicUrl,
        recommendation: 'Configure SSL certificates or update proxy configuration'
      });
    } else {
      logger.info('🔒 [Server] Production server secured with HTTPS', {
        method: config.security?.trustProxy ? 'proxy_termination' : 'direct_ssl',
        domain: config.app?.domain
      });
    }
  }
}

function getPublicUrl(host, port) {
  // Check if we have a configured public URL
  if (config.app?.url) {
    return config.app.url;
  }
  
  // Check if we're behind a proxy
  if (config.security?.trustProxy && config.server?.proxy?.publicUrl) {
    return config.server.proxy.publicUrl;
  }
  
  // Determine protocol
  const protocol = config.ssl?.enabled ? 'https' : 'http';
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  const defaultPort = protocol === 'https' ? 443 : 80;
  const portSuffix = port === defaultPort ? '' : `:${port}`;
  
  return `${protocol}://${displayHost}${portSuffix}`;
}

function getLocalUrl(host, port) {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  return `http://${displayHost}:${port}`;
}

function logServiceEndpoints(host, port) {
  const baseUrl = getPublicUrl(host, port);
  
  const endpoints = {
    api: baseUrl,
    health: `${baseUrl}/health`,
    socketio: `${baseUrl}${config.server.socketPath || '/socket.io'}`
  };

  // Add optional endpoints if they're enabled
  if (config.bullBoard?.enabled) {
    endpoints.admin = `${baseUrl}${config.bullBoard.basePath || '/admin/queues'}`;
  }
  
  if (config.development?.testMode || config.server.nodeEnv !== 'production') {
    endpoints.docs = `${baseUrl}/api-docs`;
  }
  
  if (config.monitoring?.metrics?.enabled) {
    endpoints.metrics = `${baseUrl}/metrics`;
  }

  logger.info('📚 [Server] Service endpoints available:', {
    endpoints,
    secure: baseUrl.startsWith('https'),
    websocket: endpoints.socketio.replace('http', 'ws')
  });
}

function logEnabledFeatures() {
  const enabledFeatures = Object.entries(config.features || {})
    .filter(([_, enabled]) => enabled)
    .map(([feature]) => feature);
  
  if (enabledFeatures.length > 0) {
    logger.info('🎯 [Server] Enabled features', { 
      features: enabledFeatures,
      count: enabledFeatures.length,
      ssl: config.ssl?.enabled || config.security?.trustProxy
    });
  }
}

function logServiceStatus() {
  try {
    // Safely import notification service
    let notificationService;
    try {
      notificationService = require('../../services/notifications/notificationService');
    } catch (err) {
      logger.warn('⚠️ [Server] Notification service not available', { error: err.message });
    }
    
    const serviceStatus = {
      database: 'connected',
      redis: config.redis?.host ? 'configured' : 'not_configured',
      cache: config.redis?.host ? 'enabled' : 'disabled',
      notifications: notificationService?.initialized ? 'initialized' : 'disabled',
      fcm: notificationService?.providers?.has('FCM') ? 'enabled' : 'disabled',
      apn: notificationService?.providers?.has('APN') ? 'enabled' : 'disabled',
      email: config.notifications?.email?.enabled ? 'enabled' : 'disabled',
      search: config.features?.search ? 'enabled' : 'disabled',
      ssl: {
        direct: config.ssl?.enabled || false,
        proxy: config.security?.trustProxy || false,
        hsts: config.security?.ssl?.hsts?.enabled || false
      }
    };

    logger.info('📊 [Server] Service status', serviceStatus);
  } catch (error) {
    logger.warn('⚠️ [Server] Failed to gather service status', {
      error: error.message
    });
  }
}

function setupEnhancedConnectionMonitoring(server, io) {
  let connectionCount = 0;
  const connectionStats = {
    http: 0,
    https: 0,
    websocket: 0,
    total: 0
  };
  
  server.on('connection', (socket) => {
    connectionCount++;
    connectionStats.total++;
    
    const isSecure = socket.encrypted || false;
    if (isSecure) {
      connectionStats.https++;
    } else {
      connectionStats.http++;
    }
    
    socket.on('close', () => {
      connectionCount--;
    });
  });
  
  // Monitor Socket.IO connections separately
  if (io) {
    io.on('connection', (socket) => {
      connectionStats.websocket++;
      
      socket.on('disconnect', () => {
        connectionStats.websocket--;
      });
    });
  }
  
  // Enhanced periodic logging with SSL context
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    logger.info('📊 [Server] Enhanced connection statistics', {
      connections: {
        active: connectionCount,
        ...connectionStats,
        socketio: io ? io.sockets.sockets.size : 0
      },
      performance: {
        uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: {
          rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
          heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
          heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
        }
      },
      security: {
        httpsConnections: connectionStats.https,
        httpsPercentage: connectionStats.total > 0 ? 
          `${Math.round((connectionStats.https / connectionStats.total) * 100)}%` : '0%',
        wsConnections: connectionStats.websocket
      }
    });
  }, config.monitoring?.statsInterval || 300000); // 5 minutes
  
  logger.info('✅ [Server] Enhanced connection monitoring configured');
}

module.exports = { startHTTPServer };