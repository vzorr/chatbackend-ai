// bootstrap/index.js
const { logger } = require('../utils/logger');
const config = require('../config/config'); // Updated path to your existing config
const { validateEnvironment } = require('./validators/environment');
const { validateDependencies } = require('./validators/dependencies');
const { validateConfig } = require('./validators/config-schema');
const { initializeDatabase } = require('./initializers/database');
const { initializeSocketIO } = require('./initializers/socketio');
const { initializeServices } = require('./initializers/services');
const { setupExpress } = require('./initializers/express');
const { setupMiddleware } = require('./initializers/middleware');
const { setupRoutes } = require('./initializers/routes');
const { setupErrorHandling } = require('./initializers/error-handling');
const { startHTTPServer } = require('./initializers/http-server');
const { setupGracefulShutdown } = require('./initializers/shutdown');
const { initializeCluster } = require('./initializers/cluster');
const { initializeMetrics } = require('./initializers/metrics');
const { logEnvironmentInfo } = require('./initializers/environment-info');
const { initializeModels } = require('./initializers/models');
const { initializeNotifications } = require('./initializers/notifications');
class Bootstrap {
  constructor() {
    this.app = null;
    this.server = null;
    this.io = null;
    this.isInitialized = false;
    this.clusterInfo = null;
  }

  async start() {
    const startTime = Date.now();
    logger.info('🚀 Starting bootstrap process...', {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform
    });

    try {
      // Step 0: Handle cluster mode
      logger.info('📋 [Step 0/7] Initializing cluster mode...');
      this.clusterInfo = await initializeCluster();
      logger.info('✅ [Step 0/7] Cluster mode initialized', {
        isMaster: this.clusterInfo.isMaster,
        isWorker: this.clusterInfo.isWorker,
        workerId: this.clusterInfo.workerId
      });
      
      // If this is the primary process in cluster mode, we shouldn't start the server
      if (this.clusterInfo.isMaster) {
        logger.info('✅ Primary process initialized, workers will start servers');
        return { isPrimary: true };
      }

      // Step 1: Log environment information
      logger.info('📋 [Step 1/7] Logging environment information...');
      await logEnvironmentInfo();
      logger.info('✅ [Step 1/7] Environment information logged');

      // Step 2: Validate environment and dependencies
      logger.info('📋 [Step 2/7] Validating prerequisites...');
      await this.validatePrerequisites();
      logger.info('✅ [Step 2/7] Prerequisites validated');

      // Step 3: Initialize core components
      logger.info('📋 [Step 3/7] Initializing core components...');
      await this.initializeCoreComponents();
      logger.info('✅ [Step 3/7] Core components initialized');

      // Step 4: Configure Express app
      logger.info('📋 [Step 4/7] Configuring Express application...');
      await this.configureExpressApp();
      logger.info('✅ [Step 4/7] Express application configured');

      // Step 5: Initialize metrics
      logger.info('📋 [Step 5/7] Initializing metrics system...');
      await initializeMetrics(this.app);
      logger.info('✅ [Step 5/7] Metrics system initialized');

      // Step 6: Start the server
      logger.info('📋 [Step 6/7] Starting HTTP server...');
      await this.startServer();
      logger.info('✅ [Step 6/7] HTTP server started');

      // Step 7: Setup shutdown handlers
      logger.info('📋 [Step 7/7] Setting up shutdown handlers...');
      this.setupShutdownHandlers();
      logger.info('✅ [Step 7/7] Shutdown handlers configured');

      // Step 8: Initialize notifications
    

      const duration = Date.now() - startTime;
      logger.info('🎉 Bootstrap process completed successfully!', {
        duration: `${duration}ms`,
        environment: config.server.nodeEnv,
        pid: process.pid,
        workerId: this.clusterInfo.workerId,
        port: config.server.port,
        host: config.server.host
      });

      this.isInitialized = true;
      return { 
        app: this.app, 
        server: this.server, 
        io: this.io,
        workerId: this.clusterInfo.workerId 
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('❌ Bootstrap process failed', {
        error: error.message,
        stack: error.stack,
        failedAfter: `${duration}ms`,
        pid: process.pid,
        workerId: this.clusterInfo?.workerId
      });
      
      logger.info('🧹 Initiating cleanup after bootstrap failure...');
      await this.cleanup();
      process.exit(1);
    }
  }

  async validatePrerequisites() {
    const startTime = Date.now();
    logger.info('🔍 Starting prerequisites validation...', {
      pid: process.pid
    });
    
    try {
      // Validate configuration schema
      logger.info('📝 Validating configuration schema...');
      const validatedConfig = await validateConfig(config);
      logger.info('✅ Configuration schema validated');
      
      // Validate environment variables
      logger.info('🌍 Validating environment variables...');
      await validateEnvironment();
      logger.info('✅ Environment variables validated');
      
      // Validate system dependencies
      logger.info('📦 Validating system dependencies...');
      await validateDependencies();
      logger.info('✅ System dependencies validated');
      
      const duration = Date.now() - startTime;
      logger.info('✅ Prerequisites validation completed', {
        duration: `${duration}ms`
      });
      
      return validatedConfig;
    } catch (error) {
      logger.error('❌ Prerequisites validation failed', {
        error: error.message,
        phase: 'validatePrerequisites'
      });
      throw error;
    }
  }

  async initializeCoreComponents() {
    const startTime = Date.now();
    logger.info('🔧 Starting core components initialization...', {
      components: ['database', 'services']
    });
    
    try {
      // Initialize in dependency order
      logger.info('💾 Initializing database...');
      await initializeDatabase();
      logger.info('✅ Database initialized');
      
      logger.info('💾 Initializing database models...');
      await initializeModels(); // Initialize database + models

      logger.info('✅ Database models initialized');

    

      logger.info('🛠️ Initializing services...');
      await initializeServices();
      logger.info('✅ Services initialized');
      
      const duration = Date.now() - startTime;
      logger.info('✅ Core components initialization completed', {
        duration: `${duration}ms`,
        componentsInitialized: ['database', 'services']
      });
    } catch (error) {
      logger.error('❌ Core components initialization failed', {
        error: error.message,
        phase: 'initializeCoreComponents'
      });
      throw error;
    }
  }

  async configureExpressApp() {
    const startTime = Date.now();
    logger.info('🔧 Starting Express application configuration...', {
      steps: ['express setup', 'socket.io', 'middleware', 'routes', 'error handling']
    });
    
    try {
      // Setup Express app
      logger.info('🌐 Setting up Express server...');
      const { app, server } = await setupExpress();
      this.app = app;
      this.server = server;
      logger.info('✅ Express server setup complete');
      
      // Initialize Socket.IO
      logger.info('🔌 Initializing Socket.IO...');
      this.io = await initializeSocketIO(this.server);
      logger.info('✅ Socket.IO initialized');
      
      // Setup middleware stack
      logger.info('📚 Setting up middleware stack...');
      await setupMiddleware(this.app);
      logger.info('✅ Middleware stack configured');
      
      // Setup routes
      logger.info('🛣️ Setting up application routes...');
      await setupRoutes(this.app);
      logger.info('✅ Routes configured');
      
      // Setup error handling
      logger.info('🚨 Setting up error handling...');
      await setupErrorHandling(this.app);
      logger.info('✅ Error handling configured');
      
      const duration = Date.now() - startTime;
      logger.info('✅ Express application configuration completed', {
        duration: `${duration}ms`,
        componentsConfigured: ['express', 'socketio', 'middleware', 'routes', 'errorHandling']
      });
    } catch (error) {
      logger.error('❌ Express application configuration failed', {
        error: error.message,
        phase: 'configureExpressApp'
      });
      throw error;
    }
  }

  async startServer() {
    const startTime = Date.now();
    logger.info('🚀 Starting HTTP server...', {
      port: config.server.port,
      host: config.server.host
    });
    
    try {
      await startHTTPServer(this.server, this.io);
      
      const duration = Date.now() - startTime;
      logger.info('✅ HTTP server started successfully', {
        duration: `${duration}ms`,
        url: `http://${config.server.host}:${config.server.port}`
      });
    } catch (error) {
      logger.error('❌ HTTP server startup failed', {
        error: error.message,
        phase: 'startServer'
      });
      throw error;
    }
  }

  setupShutdownHandlers() {
    logger.info('🛑 Setting up graceful shutdown handlers...');
    setupGracefulShutdown(this.server, this.io);
    logger.info('✅ Graceful shutdown handlers configured', {
      signals: ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection']
    });
  }

  async cleanup() {
    const startTime = Date.now();
    logger.info('🧹 Starting cleanup process...', {
      hasServer: !!this.server,
      hasSocketIO: !!this.io,
      isInitialized: this.isInitialized
    });
    
    try {
      if (this.server) {
        logger.info('🔒 Closing HTTP server...');
        await new Promise(resolve => this.server.close(resolve));
        logger.info('✅ HTTP server closed');
      }
      
      if (this.io) {
        logger.info('🔌 Closing Socket.IO connections...');
        await new Promise(resolve => this.io.close(resolve));
        logger.info('✅ Socket.IO connections closed');
      }
      
      // Cleanup other resources
      logger.info('🛠️ Cleaning up services...');
      await this.cleanupServices();
      logger.info('✅ Services cleanup completed');
      
      const duration = Date.now() - startTime;
      logger.info('✅ Cleanup process completed', {
        duration: `${duration}ms`
      });
    } catch (error) {
      logger.error('❌ Error during cleanup', {
        error: error.message,
        phase: 'cleanup'
      });
    }
  }

  async cleanupServices() {
    logger.info('🔧 Starting services cleanup...');
    
    // Updated import paths for your project structure
    const connectionManager = require('../db/connectionManager');
    const notificationManager = require('../services/notifications/notificationManager');
    const redisService = require('../services/redis');
    const queueService = require('../services/queue/queueService');
    
    // Close database connection
    if (connectionManager) {
      logger.info('💾 Closing database connections...');
      await connectionManager.close();
      logger.info('✅ Database connections closed');
    }
    
    // Close notification services
    if (notificationManager && notificationManager.initialized) {
      logger.info('🔔 Shutting down notification services...');
      await notificationManager.shutdown();
      logger.info('✅ Notification services shut down');
    }
    
    // Close Redis connection
    if (redisService && redisService.redisClient) {
      logger.info('📦 Closing Redis connection...');
      await redisService.redisClient.quit();
      logger.info('✅ Redis connection closed');
    }
    
    // Close Queue service connection
    if (queueService && queueService.redisClient && queueService.redisClient.quit) {
      logger.info('📋 Closing Queue service connection...');
      await queueService.redisClient.quit();
      logger.info('✅ Queue service connection closed');
    }
    
    logger.info('✅ Services cleanup completed');
  }
}

module.exports = new Bootstrap();