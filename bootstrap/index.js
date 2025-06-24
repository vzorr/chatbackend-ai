// bootstrap/index.js - Enhanced with detailed logging
const { logger } = require('../utils/logger');
const config = require('../config/config');

// Enhanced logging helper
const logStep = (step, message, data = {}) => {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp,
    step,
    ...data
  };
  
  console.log(`\n🔍 [${timestamp}] ${step}: ${message}`);
  console.log(`📊 Data:`, JSON.stringify(logData, null, 2));
  
  if (logger && logger.info) {
    logger.info(`${step}: ${message}`, logData);
  }
};

const logError = (step, error, data = {}) => {
  const timestamp = new Date().toISOString();
  const errorData = {
    timestamp,
    step,
    error: error.message,
    stack: error.stack,
    pid: process.pid,
    ...data
  };
  
  console.error(`\n❌ [${timestamp}] ${step}: ERROR - ${error.message}`);
  console.error(`📊 Error Data:`, JSON.stringify(errorData, null, 2));
  
  if (logger && logger.error) {
    logger.error(`${step}: ${error.message}`, errorData);
  }
};

// Import all initializers with error handling
const loadInitializer = (name, path) => {
  try {
    logStep('INITIALIZER_LOAD', `Loading ${name} initializer`, { name, path });
    const initializer = require(path);
    logStep('INITIALIZER_LOAD', `Successfully loaded ${name} initializer`, { name });
    return initializer;
  } catch (error) {
    logError('INITIALIZER_LOAD', error, { name, path });
    throw new Error(`Failed to load ${name} initializer: ${error.message}`);
  }
};

// Load all initializers with detailed logging
let validators, initializers;

try {
  logStep('DEPENDENCIES_LOAD', 'Starting to load all dependencies');
  
  // Load validators
  logStep('VALIDATORS_LOAD', 'Loading validators');
  validators = {
    validateEnvironment: loadInitializer('environment validator', './validators/environment').validateEnvironment,
    validateDependencies: loadInitializer('dependencies validator', './validators/dependencies').validateDependencies,
    validateConfig: loadInitializer('config validator', './validators/config-schema').validateConfig
  };
  logStep('VALIDATORS_LOAD', 'All validators loaded successfully');
  
  // Load initializers
  logStep('INITIALIZERS_LOAD', 'Loading initializers');
  initializers = {
    initializeDatabase: loadInitializer('database', './initializers/database').initializeDatabase,
    initializeSocketIO: loadInitializer('socketio', './initializers/socketio').initializeSocketIO,
    initializeServices: loadInitializer('services', './initializers/services').initializeServices,
    setupExpress: loadInitializer('express', './initializers/express').setupExpress,
    setupMiddleware: loadInitializer('middleware', './initializers/middleware').setupMiddleware,
    setupRoutes: loadInitializer('routes', './initializers/routes').setupRoutes,
    setupErrorHandling: loadInitializer('error-handling', './initializers/error-handling').setupErrorHandling,
    startHTTPServer: loadInitializer('http-server', './initializers/http-server').startHTTPServer,
    setupGracefulShutdown: loadInitializer('shutdown', './initializers/shutdown').setupGracefulShutdown,
    initializeCluster: loadInitializer('cluster', './initializers/cluster').initializeCluster,
    initializeMetrics: loadInitializer('metrics', './initializers/metrics').initializeMetrics,
    logEnvironmentInfo: loadInitializer('environment-info', './initializers/environment-info').logEnvironmentInfo,
    initializeModels: loadInitializer('models', './initializers/models').initializeModels,
    initializeNotifications: loadInitializer('notifications', './initializers/notifications').initializeNotifications
  };
  logStep('INITIALIZERS_LOAD', 'All initializers loaded successfully');
  
  logStep('DEPENDENCIES_LOAD', 'All dependencies loaded successfully');
  
} catch (error) {
  logError('DEPENDENCIES_LOAD', error);
  console.error('💥 FATAL: Failed to load dependencies - exiting');
  process.exit(1);
}

class Bootstrap {
  constructor() {
    logStep('BOOTSTRAP_CONSTRUCT', 'Bootstrap constructor called');
    this.app = null;
    this.server = null;
    this.io = null;
    this.isInitialized = false;
    this.clusterInfo = null;
    logStep('BOOTSTRAP_CONSTRUCT', 'Bootstrap constructor completed');
  }

  async start() {
    const startTime = Date.now();
    logStep('BOOTSTRAP_START', 'Bootstrap start method called', {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      argv: process.argv
    });

    try {
      // Step 0: Handle cluster mode
      logStep('STEP_0_START', 'Starting cluster initialization');
      logger.info('📋 [Step 0/7] Initializing cluster mode...');
      
      logStep('STEP_0_BEFORE_CLUSTER', 'About to call initializeCluster()');
      this.clusterInfo = await initializers.initializeCluster();
      logStep('STEP_0_CLUSTER_RESULT', 'Cluster initialization completed', this.clusterInfo);
      
      logger.info('✅ [Step 0/7] Cluster mode initialized', {
        isMaster: this.clusterInfo.isMaster,
        isWorker: this.clusterInfo.isWorker,
        workerId: this.clusterInfo.workerId
      });
      
      // If this is the primary process in cluster mode, we shouldn't start the server
      if (this.clusterInfo.isMaster) {
        logStep('STEP_0_MASTER', 'Primary process detected, returning early');
        logger.info('✅ Primary process initialized, workers will start servers');
        return { isPrimary: true };
      }

      // Step 1: Log environment information
      logStep('STEP_1_START', 'Starting environment info logging');
      logger.info('📋 [Step 1/7] Logging environment information...');
      await initializers.logEnvironmentInfo();
      logStep('STEP_1_COMPLETE', 'Environment info logging completed');
      logger.info('✅ [Step 1/7] Environment information logged');

      // Step 2: Validate environment and dependencies
      logStep('STEP_2_START', 'Starting prerequisites validation');
      logger.info('📋 [Step 2/7] Validating prerequisites...');
      await this.validatePrerequisites();
      logStep('STEP_2_COMPLETE', 'Prerequisites validation completed');
      logger.info('✅ [Step 2/7] Prerequisites validated');

      // Step 3: Initialize core components
      logStep('STEP_3_START', 'Starting core components initialization');
      logger.info('📋 [Step 3/7] Initializing core components...');
      await this.initializeCoreComponents();
      logStep('STEP_3_COMPLETE', 'Core components initialization completed');
      logger.info('✅ [Step 3/7] Core components initialized');

      // Step 4: Configure Express app
      logStep('STEP_4_START', 'Starting Express app configuration');
      logger.info('📋 [Step 4/7] Configuring Express application...');
      await this.configureExpressApp();
      logStep('STEP_4_COMPLETE', 'Express app configuration completed');
      logger.info('✅ [Step 4/7] Express application configured');

      // Step 5: Initialize metrics
      logStep('STEP_5_START', 'Starting metrics initialization');
      logger.info('📋 [Step 5/7] Initializing metrics system...');
      await initializers.initializeMetrics(this.app);
      logStep('STEP_5_COMPLETE', 'Metrics initialization completed');
      logger.info('✅ [Step 5/7] Metrics system initialized');

      // Step 6: Start the server
      logStep('STEP_6_START', 'Starting HTTP server');
      logger.info('📋 [Step 6/7] Starting HTTP server...');
      await this.startServer();
      logStep('STEP_6_COMPLETE', 'HTTP server startup completed');
      logger.info('✅ [Step 6/7] HTTP server started');

      // Step 7: Setup shutdown handlers
      logStep('STEP_7_START', 'Setting up shutdown handlers');
      logger.info('📋 [Step 7/7] Setting up shutdown handlers...');
      this.setupShutdownHandlers();
      logStep('STEP_7_COMPLETE', 'Shutdown handlers setup completed');
      logger.info('✅ [Step 7/7] Shutdown handlers configured');

      const duration = Date.now() - startTime;
      logStep('BOOTSTRAP_SUCCESS', 'Bootstrap process completed successfully', {
        duration: `${duration}ms`,
        environment: config.server.nodeEnv,
        pid: process.pid,
        workerId: this.clusterInfo.workerId,
        port: config.server.port,
        host: config.server.host
      });

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
      logError('BOOTSTRAP_FAILED', error, {
        failedAfter: `${duration}ms`,
        pid: process.pid,
        workerId: this.clusterInfo?.workerId
      });
      
      logger.error('❌ Bootstrap process failed', {
        error: error.message,
        stack: error.stack,
        failedAfter: `${duration}ms`,
        pid: process.pid,
        workerId: this.clusterInfo?.workerId
      });
      
      logStep('CLEANUP_START', 'Initiating cleanup after bootstrap failure');
      await this.cleanup();
      process.exit(1);
    }
  }

  // Remove the timeout wrapper since it's causing issues
  // The functions work fine without timeout protection

  async validatePrerequisites() {
    const startTime = Date.now();
    logStep('PREREQUISITES_START', 'Starting prerequisites validation', { pid: process.pid });
    
    try {
      // Validate configuration schema
      logStep('CONFIG_VALIDATION_START', 'Starting configuration schema validation');
      const validatedConfig = await validators.validateConfig(config);
      logStep('CONFIG_VALIDATION_COMPLETE', 'Configuration schema validated');
      
      // Validate environment variables
      logStep('ENV_VALIDATION_START', 'Starting environment variables validation');
      await validators.validateEnvironment();
      logStep('ENV_VALIDATION_COMPLETE', 'Environment variables validated');
      
      // Validate system dependencies
      logStep('DEPS_VALIDATION_START', 'Starting system dependencies validation');
      await validators.validateDependencies();
      logStep('DEPS_VALIDATION_COMPLETE', 'System dependencies validated');
      
      const duration = Date.now() - startTime;
      logStep('PREREQUISITES_COMPLETE', 'Prerequisites validation completed', { duration: `${duration}ms` });
      
      return validatedConfig;
    } catch (error) {
      logError('PREREQUISITES_FAILED', error, { phase: 'validatePrerequisites' });
      throw error;
    }
  }

  async initializeCoreComponents() {
    const startTime = Date.now();
    logStep('CORE_COMPONENTS_START', 'Starting core components initialization', {
      components: ['database', 'models', 'services']
    });
    
    try {
      // Initialize database
      logStep('DATABASE_INIT_START', 'Starting database initialization');
      await initializers.initializeDatabase();
      logStep('DATABASE_INIT_COMPLETE', 'Database initialized');
      
      // Initialize database models
      logStep('MODELS_INIT_START', 'Starting database models initialization');
      await initializers.initializeModels();
      logStep('MODELS_INIT_COMPLETE', 'Database models initialized');

      // Initialize services
      logStep('SERVICES_INIT_START', 'Starting services initialization');
      await initializers.initializeServices();
      logStep('SERVICES_INIT_COMPLETE', 'Services initialized');
      
      const duration = Date.now() - startTime;
      logStep('CORE_COMPONENTS_COMPLETE', 'Core components initialization completed', {
        duration: `${duration}ms`,
        componentsInitialized: ['database', 'models', 'services']
      });
    } catch (error) {
      logError('CORE_COMPONENTS_FAILED', error, { phase: 'initializeCoreComponents' });
      throw error;
    }
  }

  async configureExpressApp() {
    const startTime = Date.now();
    logStep('EXPRESS_CONFIG_START', 'Starting Express application configuration', {
      steps: ['express setup', 'socket.io', 'middleware', 'routes', 'error handling']
    });
    
    try {
      // Setup Express app
      logStep('EXPRESS_SETUP_START', 'Setting up Express server');
      const { app, server } = await initializers.setupExpress();
      this.app = app;
      this.server = server;
      logStep('EXPRESS_SETUP_COMPLETE', 'Express server setup complete');
      
      // Initialize Socket.IO
      logStep('SOCKETIO_INIT_START', 'Initializing Socket.IO');
      this.io = await initializers.initializeSocketIO(this.server);
      logStep('SOCKETIO_INIT_COMPLETE', 'Socket.IO initialized');
      
      // Setup middleware stack
      logStep('MIDDLEWARE_SETUP_START', 'Setting up middleware stack');
      await initializers.setupMiddleware(this.app);
      logStep('MIDDLEWARE_SETUP_COMPLETE', 'Middleware stack configured');
      
      // Setup routes
      logStep('ROUTES_SETUP_START', 'Setting up application routes');
      await initializers.setupRoutes(this.app);
      logStep('ROUTES_SETUP_COMPLETE', 'Routes configured');
      
      // Setup error handling
      logStep('ERROR_HANDLING_SETUP_START', 'Setting up error handling');
      await initializers.setupErrorHandling(this.app);
      logStep('ERROR_HANDLING_SETUP_COMPLETE', 'Error handling configured');
      
      const duration = Date.now() - startTime;
      logStep('EXPRESS_CONFIG_COMPLETE', 'Express application configuration completed', {
        duration: `${duration}ms`,
        componentsConfigured: ['express', 'socketio', 'middleware', 'routes', 'errorHandling']
      });
    } catch (error) {
      logError('EXPRESS_CONFIG_FAILED', error, { phase: 'configureExpressApp' });
      throw error;
    }
  }

  async startServer() {
    const startTime = Date.now();
    logStep('SERVER_START', 'Starting HTTP server', {
      port: config.server.port,
      host: config.server.host
    });
    
    try {
      await initializers.startHTTPServer(this.server, this.io);
      
      const duration = Date.now() - startTime;
      logStep('SERVER_START_COMPLETE', 'HTTP server started successfully', {
        duration: `${duration}ms`,
        url: `http://${config.server.host}:${config.server.port}`
      });
    } catch (error) {
      logError('SERVER_START_FAILED', error, { phase: 'startServer' });
      throw error;
    }
  }

  setupShutdownHandlers() {
    logStep('SHUTDOWN_SETUP_START', 'Setting up graceful shutdown handlers');
    initializers.setupGracefulShutdown(this.server, this.io);
    logStep('SHUTDOWN_SETUP_COMPLETE', 'Graceful shutdown handlers configured', {
      signals: ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection']
    });
  }

  async cleanup() {
    const startTime = Date.now();
    logStep('CLEANUP_START', 'Starting cleanup process', {
      hasServer: !!this.server,
      hasSocketIO: !!this.io,
      isInitialized: this.isInitialized
    });
    
    try {
      if (this.server) {
        logStep('SERVER_CLEANUP_START', 'Closing HTTP server');
        await new Promise(resolve => this.server.close(resolve));
        logStep('SERVER_CLEANUP_COMPLETE', 'HTTP server closed');
      }
      
      if (this.io) {
        logStep('SOCKETIO_CLEANUP_START', 'Closing Socket.IO connections');
        await new Promise(resolve => this.io.close(resolve));
        logStep('SOCKETIO_CLEANUP_COMPLETE', 'Socket.IO connections closed');
      }
      
      // Cleanup other resources
      logStep('SERVICES_CLEANUP_START', 'Cleaning up services');
      await this.cleanupServices();
      logStep('SERVICES_CLEANUP_COMPLETE', 'Services cleanup completed');
      
      const duration = Date.now() - startTime;
      logStep('CLEANUP_COMPLETE', 'Cleanup process completed', { duration: `${duration}ms` });
    } catch (error) {
      logError('CLEANUP_FAILED', error, { phase: 'cleanup' });
    }
  }

  async cleanupServices() {
    logStep('SERVICES_CLEANUP_DETAILED_START', 'Starting detailed services cleanup');
    
    try {
      // Close database connection
      logStep('DB_CLEANUP_START', 'Closing database connections');
      const connectionManager = require('../db/connectionManager');
      if (connectionManager) {
        await connectionManager.close();
        logStep('DB_CLEANUP_COMPLETE', 'Database connections closed');
      }
    } catch (error) {
      logError('DB_CLEANUP_FAILED', error);
    }
    
    try {
      // Close notification services
      logStep('NOTIFICATION_CLEANUP_START', 'Shutting down notification services');
      const notificationService = require('../services/notifications/notificationService');
      if (notificationService && notificationService.initialized) {
        await notificationService.shutdown();
        logStep('NOTIFICATION_CLEANUP_COMPLETE', 'Notification services shut down');
      }
    } catch (error) {
      logError('NOTIFICATION_CLEANUP_FAILED', error);
    }
    
    try {
      // Close Redis connection
      logStep('REDIS_CLEANUP_START', 'Closing Redis connection');
      const redisService = require('../services/redis');
      if (redisService && redisService.redisClient) {
        await redisService.redisClient.quit();
        logStep('REDIS_CLEANUP_COMPLETE', 'Redis connection closed');
      }
    } catch (error) {
      logError('REDIS_CLEANUP_FAILED', error);
    }
    
    try {
      // Close Queue service connection
      logStep('QUEUE_CLEANUP_START', 'Closing Queue service connection');
      const queueService = require('../services/queue/queueService');
      if (queueService && queueService.redisClient && queueService.redisClient.quit) {
        await queueService.redisClient.quit();
        logStep('QUEUE_CLEANUP_COMPLETE', 'Queue service connection closed');
      }
    } catch (error) {
      logError('QUEUE_CLEANUP_FAILED', error);
    }
    
    logStep('SERVICES_CLEANUP_DETAILED_COMPLETE', 'Detailed services cleanup completed');
  }
}

module.exports = new Bootstrap();