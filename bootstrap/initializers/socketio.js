// bootstrap/initializers/socketio.js
const { logger } = require('../../utils/logger');
const { Server } = require('socket.io');
const config = require('../../config/config');
const socketInitializer = require('../../socket/socketInitializer'); // Your existing file

async function initializeSocketIO(server) {
  const startTime = Date.now();
  logger.info('🔧 [SocketIO] Starting Socket.IO initialization...');

  try {
    // Create Socket.IO instance with configuration
    const io = new Server(server, {
      cors: {
        origin: config.server.corsOrigin,
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Authorization', 'Content-Type']
      },
      pingTimeout: config.socket?.pingTimeout || 30000,
      pingInterval: config.socket?.pingInterval || 10000,
      maxHttpBufferSize: config.socket?.maxHttpBufferSize || 1e6,
      path: config.server.socketPath,
      transports: config.socket?.transports || ['websocket', 'polling'],
      allowEIO3: true,
      perMessageDeflate: {
        threshold: 1024
      },
      httpCompression: {
        threshold: 1024
      }
    });
    
    logger.info('✅ [SocketIO] Socket.IO instance created', {
      corsOrigin: config.server.corsOrigin,
      path: config.server.socketPath,
      transports: config.socket?.transports || ['websocket', 'polling']
    });

    // Use your existing socketInitializer
    await socketInitializer(io);
    
    const duration = Date.now() - startTime;
    logger.info('✅ [SocketIO] Socket.IO initialization completed', {
      duration: `${duration}ms`
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

module.exports = { initializeSocketIO };