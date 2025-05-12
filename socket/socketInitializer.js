// /socket/socketInitializer.js
const { createAdapter } = require('socket.io-redis');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const socketAuthMiddleware = require('./middlewares/socketAuthMiddleware');
const connectionHandler = require('./handlers/connectionHandler');
const messageHandlers = require('./handlers/messageHandlers');

module.exports = (io) => {
  // Setup Redis adapter if configured
  if (process.env.REDIS_HOST) {
    const redisConfig = {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined
    };

    try {
      io.adapter(createAdapter({
        pubClient: new Redis(redisConfig),
        subClient: new Redis(redisConfig)
      }));

      logger.info('Socket.IO connected to Redis adapter');
    } catch (error) {
      logger.error(`Failed to connect Socket.IO to Redis: ${error}`);
      logger.info('Socket.IO will use in-memory adapter');
    }
  }

  // Attach authentication middleware
  io.use(socketAuthMiddleware);

  // Register connection handler
  io.on('connection', (socket) => {
    connectionHandler(io, socket);
    messageHandlers(io, socket);
    // Other handlers can be registered here like typingHandler(io, socket);
  });

  io.engine.on('connection_error', (err) => {
    logger.error(`Socket.IO connection error: ${err.message}`);
  });
};
