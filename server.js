require('dotenv').config();

try {
  console.log('🔧 Loading dependencies...');

  const { logger } = require('./utils/logger');
  const config = require('./config/config');
  const bootstrap = require('./bootstrap');
  const exceptionHandler = require('./middleware/exceptionHandler');

  console.log('✅ Dependencies loaded successfully');

  process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    if (logger && logger.error) {
      logger.error(`💥 Uncaught Exception`, {
        error: err.message,
        stack: err.stack,
        code: err.code
      });
    }
    exceptionHandler.uncaughtExceptionHandler(err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
    const isFatal = reason?.name === 'ConnectionError' || reason?.isFatal || false;
    if (logger && logger.error) {
      logger.error(`💥 Unhandled Rejection`, {
        reason: reason?.message || reason,
        stack: reason?.stack || 'No stack trace available',
        promise: promise?.toString()
      });
    }
    exceptionHandler.unhandledRejectionHandler(reason, promise);
    if (isFatal) {
      console.error('❌ Fatal unhandled rejection – exiting process.');
      process.exit(1);
    }
  });

  async function main() {
    try {
      console.log('🚀 Starting main function...');

      console.log('📋 Configuration loaded:', {
        port: config.server.port,
        host: config.server.host,
        env: config.server.nodeEnv
      });

      console.log('🎯 Initiating bootstrap process...');
      const result = await bootstrap.start();

      if (result.isPrimary) {
        if (logger && logger.info) {
          logger.info('✅ Primary process initialized successfully', {
            pid: process.pid,
            workers: config.cluster.workerCount
          });
        }
        return;
      }

      const { app, server, io } = result;

      exceptionHandler.initialize(server);
      if (logger && logger.info) {
        logger.info('✅ Exception handler initialized with server instance');
      }

      server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          logger?.error?.(`❌ Port ${config.server.port} is already in use`);
          process.exit(1);
        } else if (error.code === 'EACCES') {
          logger?.error?.(`❌ Permission denied to bind to port ${config.server.port}`);
          process.exit(1);
        } else {
          logger?.error?.('❌ Server error', {
            error: error.message,
            code: error.code,
            stack: error.stack
          });
        }
      });

      server.on('connection', (socket) => {
        logger?.debug?.('🔌 New connection established', {
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort
        });

        socket.on('error', (err) => {
          logger?.warn?.('⚠️ Socket error', {
            error: err.message,
            remoteAddress: socket.remoteAddress
          });
        });
      });

      logger?.info?.('✅ Application started successfully', {
        url: `http://${config.server.host}:${config.server.port}`,
        pid: process.pid,
        workerId: result.workerId || 'single-process',
        environment: config.server.nodeEnv
      });

      if (process.env.NODE_ENV === 'production' && !process.env.SERVER_URL?.startsWith('https')) {
        logger?.warn?.('🚨 WARNING: Server is running over HTTP in production mode. Use HTTPS (wss) for WebSocket security!');
      }

      if (config.monitoring?.healthCheckInterval) {
        setInterval(() => {
          const memUsage = process.memoryUsage();
          logger?.debug?.('📊 Application health check', {
            uptime: process.uptime(),
            memory: {
              rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
              heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
              heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
            },
            connections: server.listening ? 'active' : 'inactive'
          });
        }, config.monitoring.healthCheckInterval);
      }

      module.exports = { app, server, io };

    } catch (error) {
      console.error('❌ Failed to start application:', error);
      if (logger && logger.error) {
        logger.error('❌ Failed to start application', {
          error: error.message,
          stack: error.stack
        });

        if (error.isOperational) {
          logger.error('💥 Operational error during startup - exiting gracefully');
        } else {
          logger.error('💥 System error during startup - immediate exit required');
        }
      }
      process.exit(1);
    }
  }

  const gracefulShutdown = async (signal) => {
    logger?.info?.(`🛑 Received ${signal}, initiating graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
      logger?.error?.('❌ Graceful shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 30000);

    try {
      if (bootstrap && typeof bootstrap.cleanup === 'function') {
        await bootstrap.cleanup();
      }
      clearTimeout(shutdownTimeout);
      logger?.info?.('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger?.error?.('❌ Error during graceful shutdown', {
        error: error.message,
        stack: error.stack
      });
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  if (require.main === module) {
    console.log('📍 Running as main module');
    main().catch((error) => {
      console.error('❌ Fatal error in main:', error);
      if (logger && logger.error) {
        logger.error('❌ Fatal error in main', {
          error: error.message,
          stack: error.stack
        });
      }
      process.exit(1);
    });
  }

  module.exports = main;

} catch (startupError) {
  console.error('❌ Startup error:', startupError);
  console.error('Stack trace:', startupError.stack);
  process.exit(1);
}
