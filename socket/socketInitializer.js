// socket/socketInitializer.js
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Import handlers
const socketAuthMiddleware = require('./middlewares/socketAuthMiddleware');
const connectionHandler = require('./handlers/connectionHandlers');
const messageHandlers = require('./handlers/messageHandlers');
const conversationHandler = require('./handlers/conversationHandlers');

module.exports = async (io) => {
  logger.info('Initializing Socket.IO configuration...');
  
  // Setup Redis adapter if configured
  if (process.env.REDIS_HOST) {
    try {
      logger.info('Setting up Redis adapter for Socket.IO...');
      
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

      const pubClient = new Redis(redisOptions);
      const subClient = new Redis(redisOptions);
      
      await Promise.all([
        new Promise((resolve, reject) => {
          pubClient.once('ready', () => {
            logger.info('Redis pub client ready');
            resolve();
          });
          pubClient.once('error', reject);
        }),
        new Promise((resolve, reject) => {
          subClient.once('ready', () => {
            logger.info('Redis sub client ready');
            resolve();
          });
          subClient.once('error', reject);
        })
      ]);
      
      const adapter = createAdapter(pubClient, subClient);
      io.adapter(adapter);
      
      logger.info('Socket.IO Redis adapter initialized successfully', {
        host: redisOptions.host,
        port: redisOptions.port
      });
      
      pubClient.on('error', (err) => {
        logger.error('Redis pub client error', { 
          error: err.message,
          code: err.code 
        });
      });
      
      subClient.on('error', (err) => {
        logger.error('Redis sub client error', { 
          error: err.message,
          code: err.code 
        });
      });
      
    } catch (error) {
      logger.error('Failed to initialize Socket.IO Redis adapter', {
        error: error.message,
        stack: error.stack,
        code: error.code
      });
      logger.info('Falling back to in-memory adapter');
    }
  } else {
    logger.info('No Redis host configured, using in-memory adapter');
  }

  // Attach authentication middleware
  io.use(socketAuthMiddleware);
  logger.info('Socket.IO authentication middleware attached');

  // Connection event handler - register handlers only
  io.on('connection', (socket) => {
    try {
      // Register all event handlers
      connectionHandler(io, socket);
      messageHandlers(io, socket);
      conversationHandler(io, socket);
      
      logger.debug('Socket handlers registered', {
        socketId: socket.id,
        userId: socket.user?.id
      });
    } catch (error) {
      logger.error('Failed to register socket handlers', {
        socketId: socket.id,
        userId: socket.user?.id,
        error: error.message,
        stack: error.stack
      });
      socket.disconnect(true);
    }
  });

  logger.info('Socket.IO initialization complete');
};