// bootstrap/index.js - Updated with File Upload
const { logger } = require('../utils/logger');
const config = require('../config/config');
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
const { initializeFileUpload, setupFileRoutes } = require('./initializers/file-upload');

class Bootstrap {
  constructor() {
    console.log('🔧 Bootstrap constructor called');
    this.app = null;
    this.server = null;
    this.io = null;
    this.isInitialized = false;
    this.clusterInfo = null;
    console.log('✅ Bootstrap constructor completed');
  }

  async start() {
    const startTime = Date.now();
    console.log('🚀 Bootstrap starting...');
    
    try {
      // Step 0: Handle cluster mode
      console.log('📋 [Step 0/8] Initializing cluster mode...');
      this.clusterInfo = await initializeCluster();
      console.log('✅ [Step 0/8] Cluster mode initialized');
      
      if (this.clusterInfo.isMaster) {
        console.log('✅ Primary process initialized, workers will start servers');
        return { isPrimary: true };
      }

      // Step 1: Log environment information
      console.log('📋 [Step 1/8] Logging environment information...');
      await logEnvironmentInfo();
      console.log('✅ [Step 1/8] Environment information logged');

      // Step 2: Validate environment and dependencies
      console.log('📋 [Step 2/8] Validating prerequisites...');
      await this.validatePrerequisites();
      console.log('✅ [Step 2/8] Prerequisites validated');

      // Step 3: Initialize core components
      console.log('📋 [Step 3/8] Initializing core components...');
      await this.initializeCoreComponents();
      console.log('✅ [Step 3/8] Core components initialized');

      // Step 4: Configure Express app
      console.log('📋 [Step 4/8] Configuring Express application...');
      await this.configureExpressApp();
      console.log('✅ [Step 4/8] Express application configured');

      // Step 5: Initialize file upload system
      console.log('📋 [Step 5/8] Initializing file upload system...');
      await initializeFileUpload();
      console.log('✅ [Step 5/8] File upload system initialized');

      // Step 6: Initialize metrics
      console.log('📋 [Step 6/8] Initializing metrics system...');
      await initializeMetrics(this.app);
      console.log('✅ [Step 6/8] Metrics system initialized');

      // Step 7: Start the server
      console.log('📋 [Step 7/8] Starting HTTP server...');
      await this.startServer();
      console.log('✅ [Step 7/8] HTTP server started');

      // Step 8: Setup shutdown handlers
      console.log('📋 [Step 8/8] Setting up shutdown handlers...');
      this.setupShutdownHandlers();
      console.log('✅ [Step 8/8] Shutdown handlers configured');

      const duration = Date.now() - startTime;
      console.log(`🎉 Bootstrap completed successfully in ${duration}ms!`);
      
      logger?.info?.('🎉 Bootstrap process completed successfully!', {
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
        workerId: this.clusterInfo.workerId,
        isPrimary: false
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Bootstrap failed after ${duration}ms:`, error.message);
      
      logger?.error?.('❌ Bootstrap process failed', {
        error: error.message,
        stack: error.stack,
        failedAfter: `${duration}ms`,
        pid: process.pid,
        workerId: this.clusterInfo?.workerId
      });
      
      console.log('🧹 Initiating cleanup after bootstrap failure...');
      await this.cleanup();
      throw error;
    }
  }

  async validatePrerequisites() {
    console.log('🔍 Starting prerequisites validation...');
    
    try {
      console.log('🔍 Validating configuration schema...');
      await validateConfig(config);
      console.log('✅ Configuration schema validated');
      
      console.log('🌐 Validating environment variables...');
      await validateEnvironment();
      console.log('✅ Environment variables validated');
      
      console.log('🔧 Validating system dependencies...');
      await validateDependencies();
      console.log('✅ System dependencies validated');
      
    } catch (error) {
      console.error('❌ Prerequisites validation failed:', error.message);
      throw error;
    }
  }

  async initializeCoreComponents() {
    console.log('🔧 Starting core components initialization...');
    
    try {
      console.log('🗄️ Initializing database...');
      await initializeDatabase();
      console.log('✅ Database initialized');
      
      console.log('📊 Initializing database models...');
      await initializeModels();
      console.log('✅ Database models initialized');

      console.log('🛠️ Initializing services...');
      await initializeServices();
      console.log('✅ Services initialized');
      
    } catch (error) {
      console.error('❌ Core components initialization failed:', error.message);
      throw error;
    }
  }

  async configureExpressApp() {
    console.log('🔧 Starting Express application configuration...');
    
    try {
      console.log('🌐 Setting up Express server...');
      const { app, server } = await setupExpress();
      this.app = app;
      this.server = server;
      console.log('✅ Express server setup complete');
      
      console.log('🔌 Initializing Socket.IO...');
      this.io = await initializeSocketIO(this.server);
      console.log('✅ Socket.IO initialized');
      
      console.log('📚 Setting up middleware stack...');
      await setupMiddleware(this.app);
      console.log('✅ Middleware stack configured');
      
      // CRITICAL: Setup file upload routes BEFORE main routes
      // This ensures they're registered before the 404 catch-all handler
      console.log('📁 Setting up file upload routes...');
      await setupFileRoutes(this.app);
      console.log('✅ File upload routes configured');
      
      console.log('🛣️ Setting up application routes...');
      await setupRoutes(this.app);
      console.log('✅ Routes configured');
      
      console.log('🚨 Setting up error handling...');
      await setupErrorHandling(this.app);
      console.log('✅ Error handling configured');
      
    } catch (error) {
      console.error('❌ Express application configuration failed:', error.message);
      throw error;
    }
  }

  async startServer() {
    console.log('🚀 Starting HTTP server...');
    
    try {
      await startHTTPServer(this.server, this.io);
      console.log('✅ HTTP server started successfully');
    } catch (error) {
      console.error('❌ HTTP server startup failed:', error.message);
      throw error;
    }
  }

  setupShutdownHandlers() {
    console.log('🛑 Setting up graceful shutdown handlers...');
    setupGracefulShutdown(this.server, this.io);
    console.log('✅ Graceful shutdown handlers configured');
  }

  async cleanup() {
    console.log('🧹 Starting cleanup process...');
    
    try {
      if (this.server) {
        console.log('🔒 Closing HTTP server...');
        await new Promise(resolve => this.server.close(resolve));
        console.log('✅ HTTP server closed');
      }
      
      if (this.io) {
        console.log('🔌 Closing Socket.IO connections...');
        await new Promise(resolve => this.io.close(resolve));
        console.log('✅ Socket.IO connections closed');
      }
      
      console.log('🛠️ Cleaning up services...');
      await this.cleanupServices();
      console.log('✅ Services cleanup completed');
      
    } catch (error) {
      console.error('❌ Error during cleanup:', error.message);
    }
  }

  async cleanupServices() {
    console.log('🔧 Starting services cleanup...');
    
    const cleanupTasks = [
      {
        name: 'Database',
        cleanup: async () => {
          const connectionManager = require('../db/connectionManager');
          if (connectionManager && connectionManager.close) {
            await connectionManager.close();
          }
        }
      },
      {
        name: 'Notifications',
        cleanup: async () => {
          const notificationService = require('../services/notifications/notificationService');
          if (notificationService && notificationService.initialized && notificationService.shutdown) {
            await notificationService.shutdown();
          }
        }
      },
      {
        name: 'Redis',
        cleanup: async () => {
          const redisService = require('../services/redis');
          if (redisService && redisService.redisClient && redisService.redisClient.quit) {
            await redisService.redisClient.quit();
          }
        }
      },
      {
        name: 'Queue',
        cleanup: async () => {
          const queueService = require('../services/queue/queueService');
          if (queueService && queueService.redisClient && queueService.redisClient.quit) {
            await queueService.redisClient.quit();
          }
        }
      }
    ];

    for (const task of cleanupTasks) {
      try {
        console.log(`🔧 Cleaning up ${task.name}...`);
        await task.cleanup();
        console.log(`✅ ${task.name} cleanup completed`);
      } catch (error) {
        console.error(`⚠️ ${task.name} cleanup failed:`, error.message);
      }
    }
    
    console.log('✅ Services cleanup completed');
  }
}

module.exports = new Bootstrap();