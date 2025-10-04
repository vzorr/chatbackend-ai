// bootstrap/initializers/socketio.js
const { logger } = require('../../utils/logger');
const { Server } = require('socket.io');
const config = require('../../config/config');
const socketInitializer = require('../../socket/socketInitializer');

async function initializeSocketIO(server) {
  const startTime = Date.now();
  logger.info('[SocketIO] Starting Socket.IO initialization...');

  try {
    const corsOrigin = getCorsOrigin();
    const originsMultiple = corsOrigin.split(',').map(origin => origin.trim());
    
    const io = new Server(server, {
      cors: {
        origin: originsMultiple,
        methods: ['GET', 'POST'],
        credentials: config.cors?.credentials ?? true,
        allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With']
      },
      pingTimeout: config.socketio?.pingTimeout || 30000,
      pingInterval: config.socketio?.pingInterval || 10000,
      maxHttpBufferSize: config.socketio?.maxBuffer || 1e6,
      path: config.server.socketPath || '/socket.io',
      transports: config.socketio?.transports || ['websocket', 'polling'],
      allowEIO3: true,
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
      upgradeTimeout: 10000,
      allowUpgrades: true,
      cookie: config.ssl?.enabled || config.security?.trustProxy ? {
        name: 'io',
        httpOnly: true,
        secure: true,
        sameSite: 'strict'
      } : false,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true
      }
    });
    
    logger.info('[SocketIO] Socket.IO instance created', {
      corsOrigin: corsOrigin,
      path: config.server.socketPath || '/socket.io',
      transports: config.socketio?.transports || ['websocket', 'polling'],
      ssl: {
        enabled: config.ssl?.enabled || false,
        behindProxy: config.security?.trustProxy || false,
        secureCookies: !!(config.ssl?.enabled || config.security?.trustProxy)
      }
    });

    // Setup debugging and monitoring
    setupEnhancedDebugging(io);
    setupSSLEventListeners(io);
    setupRateLimiting(io);
    setupMetrics(io);
    
    // Initialize handlers
    await socketInitializer(io);
    
    const duration = Date.now() - startTime;
    logger.info('[SocketIO] Socket.IO initialization completed', {
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
    logger.error('[SocketIO] Socket.IO initialization failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

function setupEnhancedDebugging(io) {
  if (process.env.LOG_SOCKET_EVENTS !== 'true') {
    logger.info('[SocketIO] Enhanced debugging disabled (set LOG_SOCKET_EVENTS=true to enable)');
    return;
  }

  logger.info('[SocketIO DEBUG] Setting up enhanced debugging...');
  
  const connectionMap = new Map();
  
  io.on('connection', (socket) => {
    const connectionId = `${socket.id}-${Date.now()}`;
    connectionMap.set(socket.id, {
      connectionId,
      connectedAt: new Date(),
      userId: socket.user?.id,
      handshake: {
        headers: socket.handshake.headers,
        query: socket.handshake.query,
        auth: socket.handshake.auth
      }
    });
    
    logger.info('[SOCKET CONNECTION] New socket connected', {
      socketId: socket.id,
      userId: socket.user?.id,
      transport: socket.conn.transport.name,
      headers: {
        origin: socket.handshake.headers.origin,
        userAgent: socket.handshake.headers['user-agent']
      }
    });

    // Monitor all events on this socket
    const originalEmit = socket.emit;
    socket.emit = function(eventName, ...args) {
      logger.debug('[SOCKET EMIT] Server -> Client', {
        socketId: socket.id,
        userId: socket.user?.id,
        eventName,
        dataPreview: JSON.stringify(args[0]).substring(0, 200),
        timestamp: new Date().toISOString()
      });
      return originalEmit.apply(socket, [eventName, ...args]);
    };

    // Monitor disconnection
    socket.on('disconnect', (reason) => {
      const connInfo = connectionMap.get(socket.id);
      logger.info('[SOCKET DISCONNECT] Socket disconnected', {
        socketId: socket.id,
        userId: socket.user?.id,
        reason,
        duration: connInfo ? Date.now() - connInfo.connectedAt.getTime() : 'unknown'
      });
      connectionMap.delete(socket.id);
    });

    // Log socket errors
    socket.on('error', (error) => {
      logger.error('[SOCKET ERROR] Socket error occurred', {
        socketId: socket.id,
        userId: socket.user?.id,
        error: error.message,
        stack: error.stack
      });
    });
  });

  // Log server-level events
  io.engine.on('initial_headers', (headers, req) => {
    logger.debug('[ENGINE] Initial headers', {
      url: req.url,
      method: req.method,
      headers: req.headers
    });
  });

  io.engine.on('headers', (headers, req) => {
    logger.debug('[ENGINE] Headers event', {
      url: req.url,
      socketId: req._query?.EIO
    });
  });

  // Periodic status report
  setInterval(() => {
    const socketsCount = io.sockets.sockets.size;
    const socketsList = Array.from(io.sockets.sockets.values()).map(s => ({
      id: s.id,
      userId: s.user?.id,
      connected: s.connected,
      rooms: Array.from(s.rooms)
    }));

    logger.info('[SOCKET STATUS] Server status report', {
      totalSockets: socketsCount,
      sockets: socketsList,
      timestamp: new Date().toISOString()
    });
  }, 60000); // Every minute

  logger.info('[SocketIO DEBUG] Enhanced debugging configured');
}

function setupSSLEventListeners(io) {
  logger.info('[SocketIO] Setting up SSL-specific event listeners...');
  
  const sslStats = {
    totalConnections: 0,
    secureConnections: 0,
    upgradeSuccesses: 0,
    upgradeFailures: 0
  };
  
  io.engine.on('connection', (socket) => {
    sslStats.totalConnections++;
    
    const isSecure = socket.request.connection.encrypted || 
                    socket.request.headers['x-forwarded-proto'] === 'https';
    
    if (isSecure) {
      sslStats.secureConnections++;
    }
    
    socket.on('upgrade', () => {
      sslStats.upgradeSuccesses++;
      logger.debug('[SocketIO] Transport upgraded to WebSocket', {
        socketId: socket.id,
        secure: isSecure,
        transport: 'websocket'
      });
    });
    
    socket.on('upgradeError', (error) => {
      sslStats.upgradeFailures++;
      logger.warn('[SocketIO] Transport upgrade failed', {
        socketId: socket.id,
        error: error.message,
        secure: isSecure
      });
    });
  });
  
  io.engine.on('connection_error', (err) => {
    logger.error('[SocketIO] Enhanced connection error', {
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
  
  setInterval(() => {
    const securePercentage = sslStats.totalConnections > 0 ? 
      Math.round((sslStats.secureConnections / sslStats.totalConnections) * 100) : 0;
    
    logger.info('[SocketIO] SSL connection statistics', {
      ...sslStats,
      securePercentage: `${securePercentage}%`
    });
  }, 5 * 60 * 1000);
  
  logger.info('[SocketIO] SSL event listeners configured');
}

function setupRateLimiting(io) {
  logger.info('[SocketIO] Setting up rate limiting...');
  
  const rateLimitMap = new Map();
  
  io.on('connection', (socket) => {
    // Flood control middleware
    socket.use((packet, next) => {
      const now = Date.now();
      const timestamps = rateLimitMap.get(socket.id) || [];
      const recent = timestamps.filter(ts => now - ts < 1000);
      recent.push(now);
      rateLimitMap.set(socket.id, recent);
      
      if (recent.length > 10) {
        logger.warn('[SocketIO] Socket rate limit exceeded', { 
          socketId: socket.id,
          userId: socket.user?.id,
          eventsInWindow: recent.length
        });
        return next(new Error('Rate limit exceeded'));
      }
      next();
    });
    
    // Cleanup on disconnect
    socket.on('disconnect', () => {
      rateLimitMap.delete(socket.id);
    });
  });
  
  logger.info('[SocketIO] Rate limiting configured');
}

function setupMetrics(io) {
  logger.info('[SocketIO] Setting up metrics tracking...');
  
  const metrics = {
    connections: 0,
    authenticated: 0,
    rateLimited: 0,
    secureConnections: 0,
    proxyConnections: 0
  };
  
  io.on('connection', (socket) => {
    metrics.connections++;
    
    const isSecure = socket.handshake.secure || 
                    socket.handshake.headers['x-forwarded-proto'] === 'https';
    const viaProxy = !!(socket.handshake.headers['x-forwarded-proto'] || 
                       socket.handshake.headers['x-real-ip'] || 
                       socket.handshake.headers['x-forwarded-for']);
    
    if (isSecure) metrics.secureConnections++;
    if (viaProxy) metrics.proxyConnections++;
    if (socket.user) metrics.authenticated++;
    
    // Log connection info
    logger.info('[SocketIO] New connection', {
      socketId: socket.id,
      userId: socket.user?.id,
      transport: socket.conn.transport.name,
      secure: isSecure,
      viaProxy: viaProxy,
      ip: socket.handshake.address
    });
    
    // Track disconnect
    socket.on('disconnect', () => {
      metrics.connections--;
      if (socket.user) metrics.authenticated--;
      if (isSecure) metrics.secureConnections--;
      if (viaProxy) metrics.proxyConnections--;
    });
  });
  
  // Periodic metrics logging
  setInterval(() => {
    const totalConnections = io.sockets.sockets.size;
    const securePercentage = totalConnections > 0 ? 
      Math.round((metrics.secureConnections / totalConnections) * 100) : 0;
    const proxyPercentage = totalConnections > 0 ? 
      Math.round((metrics.proxyConnections / totalConnections) * 100) : 0;

    logger.info('[SocketIO] Metrics report', {
      connected: totalConnections,
      metrics: metrics,
      rooms: io.sockets.adapter.rooms.size,
      security: {
        secureConnections: metrics.secureConnections,
        securePercentage: `${securePercentage}%`,
        proxyConnections: metrics.proxyConnections,
        proxyPercentage: `${proxyPercentage}%`
      },
      transports: {
        websocket: Array.from(io.sockets.sockets.values())
          .filter(s => s.conn.transport.name === 'websocket').length,
        polling: Array.from(io.sockets.sockets.values())
          .filter(s => s.conn.transport.name === 'polling').length
      }
    });
  }, 60000); // Every minute
  
  logger.info('[SocketIO] Metrics tracking configured');
}

function getCorsOrigin() {
  if (config.cors?.origin) {
    return config.cors.origin;
  }
  
  const serverOrigin = config.server.corsOrigin;
  
  if (serverOrigin === '*' && config.server.nodeEnv !== 'production') {
    logger.warn('[SocketIO] Using wildcard CORS origin in development');
    return '*';
  }
  
  if (config.server.nodeEnv === 'production' && serverOrigin === '*') {
    logger.error('[SocketIO] Wildcard CORS origin not allowed in production');
    throw new Error('Wildcard CORS origin not allowed in production');
  }
  
  const origins = serverOrigin.split(',').map(origin => origin.trim());
  
  if (config.server.nodeEnv === 'production') {
    const httpOrigins = origins.filter(origin => origin.startsWith('http://'));
    if (httpOrigins.length > 0) {
      logger.warn('[SocketIO] HTTP origins detected in production', {
        httpOrigins: httpOrigins
      });
    }
  }
  
  logger.info('[SocketIO] CORS origins configured', {
    origins: origins,
    count: origins.length,
    production: config.server.nodeEnv === 'production'
  });
  
  return origins.length === 1 ? origins[0] : origins;
}

module.exports = { initializeSocketIO };