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

  // Continue with the rest of your socket initialization...
  
  // Attach authentication middleware
  io.use(socketAuthMiddleware);
  logger.info('✅ Socket.IO authentication middleware attached');
  
  // Socket rate limiting map
  const rateLimitMap = new Map();
  const socketMetrics = {
    connections: 0,
    authenticated: 0,
    rateLimited: 0
  };

  // Global socket error handler
  io.on('error', (error) => {
    logger.error('❌ Socket.IO server error', {
      error: error.message,
      stack: error.stack
    });
  });

  // Connection event handler
  io.on('connection', (socket) => {
    socketMetrics.connections++;
    
    logger.info(`🔌 New socket connection`, {
      socketId: socket.id,
      userId: socket.user?.id,
      userName: socket.user?.name,
      transport: socket.conn.transport.name,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      metrics: socketMetrics
    });

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
          eventsInWindow: recent.length
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
          argsCount: args.length
        });
      });
    }

    // Socket error handler
    socket.on('error', (error) => {
      logger.error(`❌ Socket error`, {
        socketId: socket.id,
        userId: socket.user?.id,
        error: error.message,
        stack: error.stack
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
        userId: socket.user?.id
      });
    } catch (error) {
      logger.error(`❌ Failed to register socket handlers`, {
        socketId: socket.id,
        userId: socket.user?.id,
        error: error.message,
        stack: error.stack
      });
      socket.disconnect(true);
    }

    // Disconnect handler
    socket.on('disconnect', (reason) => {
      socketMetrics.connections--;
      if (socket.user) {
        socketMetrics.authenticated--;
      }
      
      logger.info(`🔌 Socket disconnected`, { 
        socketId: socket.id,
        userId: socket.user?.id,
        reason,
        duration: Date.now() - socket.handshake.issued,
        metrics: socketMetrics
      });
      
      // Cleanup rate limit data
      rateLimitMap.delete(socket.id);
    });

    // Custom heartbeat for better connection monitoring
    const heartbeatInterval = setInterval(() => {
      socket.emit('ping', { timestamp: Date.now() });
    }, 30000);

    socket.on('pong', (data) => {
      const latency = Date.now() - data.timestamp;
      logger.debug(`💓 Socket heartbeat`, {
        socketId: socket.id,
        userId: socket.user?.id,
        latency: `${latency}ms`
      });
    });

    socket.on('disconnect', () => {
      clearInterval(heartbeatInterval);
    });
  });

  // Socket.IO engine events
  io.engine.on('connection_error', (err) => {
    logger.error(`❌ Socket.IO engine connection error`, {
      error: err.message,
      type: err.type,
      code: err.code
    });
  });

  // Periodic metrics logging
  setInterval(() => {
    logger.info('📊 Socket.IO metrics', {
      connected: io.sockets.sockets.size,
      metrics: socketMetrics,
      rooms: io.sockets.adapter.rooms.size
    });
  }, 60000); // Every minute

  logger.info('✅ Socket.IO initialization complete');
};