// socket/socketInitializer-fixed.js
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Import handlers
const socketAuthMiddleware = require('./middlewares/socketAuthMiddleware');
const connectionHandler = require('./handlers/connectionHandlers');
const messageHandlers = require('./handlers/messageHandlers');
const conversationHandler = require('./handlers/conversationHandlers');
const presenceHandler = require('./handlers/presenceHandlers');

module.exports = async (io) => {
  logger.info('🔧 Initializing Socket.IO configuration...');
  
  // Setup Redis adapter if configured
  if (process.env.REDIS_HOST) {
    try {
      logger.info('🔌 Setting up Redis adapter for Socket.IO...');
      
      const redisOptions = {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.error('Redis connection retries exceeded');
            return null;
          }
          return Math.min(times * 200, 2000);
        }
      };

      // Create clients
      const pubClient = new Redis(redisOptions);
      const subClient = new Redis(redisOptions);
      
      // Wait for both clients to be ready
      await Promise.all([
        new Promise((resolve, reject) => {
          pubClient.once('ready', () => {
            logger.info('✅ Redis pub client ready');
            resolve();
          });
          pubClient.once('error', reject);
        }),
        new Promise((resolve, reject) => {
          subClient.once('ready', () => {
            logger.info('✅ Redis sub client ready');
            resolve();
          });
          subClient.once('error', reject);
        })
      ]);
      
      // Create and set the adapter
      const adapter = createAdapter(pubClient, subClient);
      io.adapter(adapter);
      
      logger.info('✅ Socket.IO Redis adapter initialized successfully', {
        host: redisOptions.host,
        port: redisOptions.port
      });
      
      // Set up error handlers for ongoing operation
      pubClient.on('error', (err) => {
        logger.error('❌ Redis pub client error', { 
          error: err.message,
          code: err.code 
        });
      });
      
      subClient.on('error', (err) => {
        logger.error('❌ Redis sub client error', { 
          error: err.message,
          code: err.code 
        });
      });
      
    } catch (error) {
      logger.error('❌ Failed to initialize Socket.IO Redis adapter', {
        error: error.message,
        stack: error.stack,
        code: error.code
      });
      logger.info('⚠️ Falling back to in-memory adapter');
    }
  } else {
    logger.info('ℹ️ No Redis host configured, using in-memory adapter');
  }

  // Attach authentication middleware
  io.use(socketAuthMiddleware);
  logger.info('✅ Socket.IO authentication middleware attached');
  
  // Socket rate limiting map
  const rateLimitMap = new Map();
  const socketMetrics = {
    connections: 0,
    authenticated: 0,
    rateLimited: 0,
    secureConnections: 0,
    proxyConnections: 0
  };

  // Global socket error handler
  io.on('error', (error) => {
    logger.error('❌ Socket.IO server error', {
      error: error.message,
      stack: error.stack
    });
  });

  // Enhanced connection event handler with SSL/proxy awareness
  io.on('connection', (socket) => {
    socketMetrics.connections++;
    
    // Enhanced connection info with SSL/proxy detection
    const isSecure = socket.handshake.secure || socket.handshake.headers['x-forwarded-proto'] === 'https';
    const viaProxy = !!(socket.handshake.headers['x-forwarded-proto'] || 
                       socket.handshake.headers['x-real-ip'] || 
                       socket.handshake.headers['x-forwarded-for']);
    
    // Update metrics
    if (isSecure) socketMetrics.secureConnections++;
    if (viaProxy) socketMetrics.proxyConnections++;
    
    const connectionInfo = {
      socketId: socket.id,
      userId: socket.user?.id,
      userName: socket.user?.name,
      transport: socket.conn.transport.name,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      // Enhanced SSL/proxy detection
      secure: isSecure,
      protocol: socket.handshake.headers['x-forwarded-proto'] || (socket.handshake.secure ? 'https' : 'http'),
      origin: socket.handshake.headers.origin,
      referer: socket.handshake.headers.referer,
      // Proxy headers (if present)
      realIp: socket.handshake.headers['x-real-ip'],
      forwardedFor: socket.handshake.headers['x-forwarded-for'],
      forwardedHost: socket.handshake.headers['x-forwarded-host'],
      viaProxy: viaProxy,
      metrics: socketMetrics
    };
    
    logger.info(`🔌 New socket connection`, connectionInfo);
    
    // Log SSL-specific info if connection is secure
    if (isSecure) {
      logger.info(`🔒 Secure WebSocket connection established`, {
        socketId: socket.id,
        userId: socket.user?.id,
        protocol: connectionInfo.protocol,
        viaProxy: viaProxy,
        transport: socket.conn.transport.name,
        secureTransport: socket.conn.transport.name === 'websocket' ? 'WSS' : 'HTTPS Polling'
      });
    }

    // Log proxy detection details
    if (viaProxy) {
      logger.debug(`🔄 Connection via proxy detected`, {
        socketId: socket.id,
        userId: socket.user?.id,
        originalIp: socket.handshake.headers['x-real-ip'],
        forwardedFor: socket.handshake.headers['x-forwarded-for'],
        forwardedProto: socket.handshake.headers['x-forwarded-proto'],
        forwardedHost: socket.handshake.headers['x-forwarded-host']
      });
    }

    // Flood control middleware for this socket
    socket.use((packet, next) => {
      const now = Date.now();
      const timestamps = rateLimitMap.get(socket.id) || [];
      const recent = timestamps.filter(ts => now - ts < 1000);
      recent.push(now);
      rateLimitMap.set(socket.id, recent);
      
      if (recent.length > 10) {
        socketMetrics.rateLimited++;
        logger.warn(`⚠️ Socket rate limit exceeded`, { 
          socketId: socket.id,
          userId: socket.user?.id,
          eventsInWindow: recent.length,
          secure: isSecure,
          viaProxy: viaProxy
        });
        return next(new Error('Rate limit exceeded'));
      }
      next();
    });

    // Global socket event logger (for debugging)
    if (process.env.LOG_SOCKET_EVENTS === 'true') {
      socket.onAny((event, ...args) => {
        logger.debug(`📨 Socket event`, { 
          socketId: socket.id,
          userId: socket.user?.id,
          event,
          argsCount: args.length,
          secure: isSecure,
          transport: socket.conn.transport.name
        });
      });
    }

    // Enhanced socket error handler
    socket.on('error', (error) => {
      logger.error(`❌ Socket error`, {
        socketId: socket.id,
        userId: socket.user?.id,
        error: error.message,
        stack: error.stack,
        secure: isSecure,
        viaProxy: viaProxy,
        transport: socket.conn.transport.name
      });
    });

    // Register all event handlers
    try {
      connectionHandler(io, socket);
      messageHandlers(io, socket);
      conversationHandler(io, socket);
      presenceHandler(io, socket);
      
      socketMetrics.authenticated++;
      logger.info(`✅ Socket handlers registered`, {
        socketId: socket.id,
        userId: socket.user?.id,
        secure: isSecure,
        viaProxy: viaProxy
      });
    } catch (error) {
      logger.error(`❌ Failed to register socket handlers`, {
        socketId: socket.id,
        userId: socket.user?.id,
        error: error.message,
        stack: error.stack,
        secure: isSecure,
        viaProxy: viaProxy
      });
      socket.disconnect(true);
    }

    // Enhanced disconnect handler
    socket.on('disconnect', (reason) => {
      socketMetrics.connections--;
      if (socket.user) {
        socketMetrics.authenticated--;
      }
      if (isSecure) socketMetrics.secureConnections--;
      if (viaProxy) socketMetrics.proxyConnections--;
      
      logger.info(`🔌 Socket disconnected`, { 
        socketId: socket.id,
        userId: socket.user?.id,
        reason,
        duration: Date.now() - socket.handshake.issued,
        secure: isSecure,
        viaProxy: viaProxy,
        transport: socket.conn.transport.name,
        metrics: socketMetrics
      });
      
      // Cleanup rate limit data
      rateLimitMap.delete(socket.id);
    });

    // Custom heartbeat for better connection monitoring
    const heartbeatInterval = setInterval(() => {
      socket.emit('ping', { 
        timestamp: Date.now(),
        secure: isSecure,
        server: process.env.NODE_ENV || 'development'
      });
    }, 30000);

    socket.on('pong', (data) => {
      const latency = Date.now() - data.timestamp;
      logger.debug(`💓 Socket heartbeat`, {
        socketId: socket.id,
        userId: socket.user?.id,
        latency: `${latency}ms`,
        secure: isSecure,
        transport: socket.conn.transport.name
      });
    });

    // Transport change detection
    socket.conn.on('upgrade', () => {
      logger.info(`⬆️ Socket transport upgraded`, {
        socketId: socket.id,
        userId: socket.user?.id,
        newTransport: socket.conn.transport.name,
        secure: isSecure,
        viaProxy: viaProxy
      });
    });

    socket.conn.on('upgradeError', (error) => {
      logger.warn(`⚠️ Socket transport upgrade failed`, {
        socketId: socket.id,
        userId: socket.user?.id,
        error: error.message,
        currentTransport: socket.conn.transport.name,
        secure: isSecure
      });
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      clearInterval(heartbeatInterval);
    });
  });

  // Socket.IO engine events with enhanced logging
  io.engine.on('connection_error', (err) => {
    logger.error(`❌ Socket.IO engine connection error`, {
      error: err.message,
      type: err.type,
      code: err.code,
      description: err.description,
      context: err.context
    });
  });

  // Enhanced periodic metrics logging
  setInterval(() => {
    const totalConnections = io.sockets.sockets.size;
    const securePercentage = totalConnections > 0 ? 
      Math.round((socketMetrics.secureConnections / totalConnections) * 100) : 0;
    const proxyPercentage = totalConnections > 0 ? 
      Math.round((socketMetrics.proxyConnections / totalConnections) * 100) : 0;

    logger.info('📊 Socket.IO metrics', {
      connected: totalConnections,
      metrics: socketMetrics,
      rooms: io.sockets.adapter.rooms.size,
      security: {
        secureConnections: socketMetrics.secureConnections,
        securePercentage: `${securePercentage}%`,
        proxyConnections: socketMetrics.proxyConnections,
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

  // Log SSL/proxy configuration summary
  logger.info('🔒 Socket.IO SSL/Proxy configuration', {
    trustProxy: process.env.TRUST_PROXY === 'true',
    environment: process.env.NODE_ENV || 'development',
    domain: process.env.DOMAIN || 'localhost',
    expectedProtocol: process.env.PROTOCOL || 'http',
    corsOrigin: process.env.CORS_ORIGIN || '*'
  });

  logger.info('✅ Socket.IO initialization complete with enhanced SSL logging');
};