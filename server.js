// server.js
require('dotenv').config();

// Wrap everything in a try-catch to capture startup errors
try {
  console.log('🔧 Loading dependencies...');
  
  const { logger } = require('./utils/logger');
  const config = require('./config/config');
  const bootstrap = require('./bootstrap');

  console.log('✅ Dependencies loaded successfully');

  // Process-level event handlers (these run for both primary and worker processes)
  process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    if (logger) {
      logger.error(`💥 Uncaught Exception`, { 
        error: err.message,
        stack: err.stack,
        code: err.code
      });
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('💥 Unhandled Rejection:', reason);
    if (logger) {
      logger.error(`💥 Unhandled Rejection`, { 
        reason: reason.message || reason,
        stack: reason.stack || 'No stack trace available'
      });
    }
    process.exit(1);
  });

  async function main() {
    try {
      console.log('🚀 Starting main function...');
      
      // Log initial configuration
      console.log('📋 Configuration loaded:', {
        port: config.server.port,
        host: config.server.host,
        env: config.server.nodeEnv
      });

      // Start the bootstrap process
      console.log('🎯 Initiating bootstrap process...');
      const result = await bootstrap.start();

      // If this is the primary process in cluster mode, we're done here
      if (result.isPrimary) {
        logger.info('✅ Primary process initialized successfully', {
          pid: process.pid,
          workers: config.cluster.workerCount
        });
        return;
      }

      // Worker process or single-process mode continues here
      const { app, server, io } = result;

      logger.info('✅ Application started successfully', {
        url: `http://${config.server.host}:${config.server.port}`,
        pid: process.pid,
        workerId: result.workerId || 'single-process',
        environment: config.server.nodeEnv
      });

      // HTTPS warning
      if (process.env.NODE_ENV === 'production' && !process.env.SERVER_URL?.startsWith('https')) {
        logger.warn('🚨 WARNING: Server is running over HTTP in production mode. Use HTTPS (wss) for WebSocket security!');
      }

      // Export for testing or external use
      module.exports = { app, server, io };

    } catch (error) {
      console.error('❌ Failed to start application:', error);
      if (logger) {
        logger.error('❌ Failed to start application', {
          error: error.message,
          stack: error.stack
        });
      }
      process.exit(1);
    }
  }

  // Start the application
  if (require.main === module) {
    console.log('📍 Running as main module');
    main().catch((error) => {
      console.error('❌ Fatal error in main:', error);
      if (logger) {
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