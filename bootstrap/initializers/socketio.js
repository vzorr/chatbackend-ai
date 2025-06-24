// bootstrap/initializers/socketio.js
const { logger } = require('../../utils/logger');
const { Server } = require('socket.io');
const config = require('../../config/config');
const socketInitializer = require('../../socket/socketInitializer'); // Your existing file

async function initializeSocketIO(server) {
  const startTime = Date.now();
  logger.info('🔧 [SocketIO] Starting Socket.IO initialization...');

  try {
    // Determine CORS origin with SSL awareness
    const corsOrigin = getCorsOrigin();
    
    // Create Socket.IO instance with enhanced SSL configuration
    const io = new Server(server, {
      cors: {
        origin: corsOrigin,
        methods: ['GET', 'POST'],
        credentials: config.cors?.credentials ?? true,
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With']
      },
      // Enhanced connection settings
      pingTimeout: config.socketio?.pingTimeout || 30000,
      pingInterval: config.socketio?.pingInterval || 10000,
      maxHttpBufferSize: config.socketio?.maxBuffer || 1e6,
      path: config.server.socketPath || '/socket.io',
      transports: config.socketio?.transports || ['websocket', 'polling'],
      allowEIO3: true,
      // Enhanced compression for better performance over SSL
      perMessageDeflate: {
        threshold: 1024,
        zlibDeflateOptions: {
          level: 6,
          chunkSize: 16 * 1024
        }
      },
      httpCompression: {
        threshold: 1024
      },
      // SSL-specific settings
      upgradeTimeout: 10000,
      allowUpgrades: true,
      // Enhanced cookie settings for secure connections
      cookie: config.ssl?.enabled || config.security?.trustProxy ? {
        name: 'io',
        httpOnly: true,
        secure: true,
        sameSite: 'strict'
      } : false,
      // Connection state recovery (Socket.IO v4.6+)
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
      }
    });
    
    logger.info('✅ [SocketIO] Socket.IO instance created', {
      corsOrigin: corsOrigin,
      path: config.server.socketPath || '/socket.io',
      transports: config.socketio?.transports || ['websocket', 'polling'],
      ssl: {
        enabled: config.ssl?.enabled || false,
        behindProxy: config.security?.trustProxy || false,
        secureCookies: !!(config.ssl?.enabled || config.security?.trustProxy)
      }
    });

    // Add SSL-specific event listeners
    setupSSLEventListeners(io);
    
    // Use your existing socketInitializer with enhanced features
    await socketInitializer(io);
    
    const duration = Date.now() - startTime;
    logger.info('✅ [SocketIO] Socket.IO initialization completed', {
      duration: `${duration}ms`,
      securityFeatures: {
        cors: !!corsOrigin,
        compression: true,
        secureCookies: !!(config.ssl?.enabled || config.security?.trustProxy),
        connectionRecovery: true
      }
    });

    return io;
  } catch (error) {
    logger.error('❌ [SocketIO] Socket.IO initialization failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

function getCorsOrigin() {
  // Use enhanced CORS configuration if available
  if (config.cors?.origin) {
    return config.cors.origin;
  }
  
  // Fallback to server CORS origin
  const serverOrigin = config.server.corsOrigin;
  
  // If using wildcard in development, allow it
  if (serverOrigin === '*' && config.server.nodeEnv !== 'production') {
    logger.warn('⚠️ [SocketIO] Using wildcard CORS origin in development');
    return '*';
  }
  
  // For production, ensure we have specific origins
  if (config.server.nodeEnv === 'production' && serverOrigin === '*') {
    logger.error('❌ [SocketIO] Wildcard CORS origin not allowed in production');
    throw new Error('Wildcard CORS origin not allowed in production');
  }
  
  // Convert to array format
  const origins = serverOrigin.split(',').map(origin => origin.trim());
  
  // Ensure HTTPS origins in production
  if (config.server.nodeEnv === 'production') {
    const httpOrigins = origins.filter(origin => origin.startsWith('http://'));
    if (httpOrigins.length > 0) {
      logger.warn('⚠️ [SocketIO] HTTP origins detected in production', {
        httpOrigins: httpOrigins
      });
    }
  }
  
  logger.info('🔧 [SocketIO] CORS origins configured', {
    origins: origins,
    count: origins.length,
    production: config.server.nodeEnv === 'production'
  });
  
  return origins.length === 1 ? origins[0] : origins;
}

function setupSSLEventListeners(io) {
  logger.info('🔧 [SocketIO] Setting up SSL-specific event listeners...');
  
  // Track SSL connection statistics
  const sslStats = {
    totalConnections: 0,
    secureConnections: 0,
    upgradeSuccesses: 0,
    upgradeFailures: 0
  };
  
  // Monitor connection upgrades (HTTP polling → WebSocket)
  io.engine.on('connection', (socket) => {
    sslStats.totalConnections++;
    
    const isSecure = socket.request.connection.encrypted || 
                    socket.request.headers['x-forwarded-proto'] === 'https';
    
    if (isSecure) {
      sslStats.secureConnections++;
    }
    
    // Log transport upgrades
    socket.on('upgrade', () => {
      sslStats.upgradeSuccesses++;
      logger.debug('⬆️ [SocketIO] Transport upgraded to WebSocket', {
        socketId: socket.id,
        secure: isSecure,
        transport: 'websocket'
      });
    });
    
    socket.on('upgradeError', (error) => {
      sslStats.upgradeFailures++;
      logger.warn('⚠️ [SocketIO] Transport upgrade failed', {
        socketId: socket.id,
        error: error.message,
        secure: isSecure
      });
    });
  });
  
  // Enhanced connection error handling
  io.engine.on('connection_error', (err) => {
    logger.error('❌ [SocketIO] Enhanced connection error', {
      error: err.message,
      type: err.type,
      code: err.code,
      description: err.description,
      context: err.context,
      req: {
        method: err.req?.method,
        url: err.req?.url,
        headers: {
          origin: err.req?.headers?.origin,
          userAgent: err.req?.headers['user-agent'],
          forwardedProto: err.req?.headers['x-forwarded-proto']
        }
      }
    });
  });
  
  // Periodic SSL statistics logging
  setInterval(() => {
    const securePercentage = sslStats.totalConnections > 0 ? 
      Math.round((sslStats.secureConnections / sslStats.totalConnections) * 100) : 0;
    
    logger.info('📊 [SocketIO] SSL connection statistics', {
      ...sslStats,
      securePercentage: `${securePercentage}%`
    });
  }, 5 * 60 * 1000); // Every 5 minutes
  
  logger.info('✅ [SocketIO] SSL event listeners configured');
}

module.exports = { initializeSocketIO };