// server.js - Hybrid version combining best features
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const cluster = require('cluster');
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();

const config = require('./config/config');
const sequelize = require('./db');
const logger = require('./utils/logger');
const redisService = require('./services/redis');
const queueService = require('./services/queue/queueService');
const notificationManager = require('./services/notifications/notificationManager');
const exceptionHandler = require('./middleware/exceptionHandler');
const authMiddleware = require('./middleware/authentication');
const requestLogger = require('./middleware/request-logger');
const { createUploadMiddleware } = require('./services/file-upload');
const promClient = require('prom-client');

// Import routes
const apiRoutes = require('./routes');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const conversationRoutes = require('./routes/conversation');
const messageRoutes = require('./routes/message');
const adminRoutes = require('./routes/admin');

// Import socket initializer
const socketInitializer = require('./socket/socketInitializer');

// Log initial startup
logger.info('🚀 Chat Server Starting...', {
  nodeVersion: process.version,
  platform: process.platform,
  pid: process.pid,
  env: process.env.NODE_ENV || 'development'
});

// Log configuration
logger.info('📋 Server Configuration', {
  server: {
    port: config.server.port,
    host: config.server.host,
    corsOrigin: config.server.corsOrigin,
    socketPath: config.server.socketPath
  },
  database: {
    host: config.database.host,
    port: config.database.port,
    name: config.database.name,
    dialect: config.database.dialect
  },
  redis: {
    host: config.redis.host,
    port: config.redis.port,
    hasPassword: !!config.redis.password
  },
  features: config.features,
  cluster: {
    enabled: config.cluster.enabled,
    workerCount: config.cluster.workerCount
  }
});

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'VortexHive Chat API',
      version: '1.0.0',
      description: 'API documentation for VortexHive Chat Backend',
    },
    servers: [
      {
        url: config.server.apiUrl || `http://localhost:${config.server.port}`,
        description: config.server.nodeEnv === 'production' ? 'Production Server' : 'Development Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [{ bearerAuth: [] }]
  },
  apis: ['./routes/*.js']
};

// Cluster mode for production
if (config.cluster.enabled && cluster.isPrimary) {
  logger.info(`🔧 Primary ${process.pid} is running in cluster mode`);
  logger.info(`📊 Starting ${config.cluster.workerCount} workers...`);

  // Fork workers
  for (let i = 0; i < config.cluster.workerCount; i++) {
    const worker = cluster.fork();
    logger.info(`👷 Worker ${i + 1} started`, { pid: worker.process.pid });
  }

  // Handle worker crashes
  cluster.on('exit', (worker, code, signal) => {
    logger.error(`❌ Worker ${worker.process.pid} died`, { 
      code, 
      signal,
      workerId: worker.id 
    });
    
    // Restart worker after a delay
    setTimeout(() => {
      logger.info('♻️  Starting replacement worker...');
      const newWorker = cluster.fork();
      logger.info(`✅ Replacement worker started`, { pid: newWorker.process.pid });
    }, 1000);
  });

  // Monitor cluster health
  setInterval(() => {
    const workers = Object.values(cluster.workers);
    const aliveWorkers = workers.filter(w => w.state === 'online').length;
    
    logger.info('📊 Cluster health check', {
      totalWorkers: workers.length,
      aliveWorkers,
      deadWorkers: workers.length - aliveWorkers,
      workerDetails: workers.map(w => ({
        id: w.id,
        pid: w.process.pid,
        state: w.state
      }))
    });
  }, config.monitoring.healthCheckInterval);

} else {
  // Worker process or single-process mode
  const workerId = cluster.worker?.id || 'single-process';
  logger.info(`🏃 Starting server (${workerId})...`);
  startServer();
}

async function startServer() {
  const startTime = Date.now();
  logger.info('🔧 Initializing server components...');

  const app = express();
  const server = http.createServer(app);
  
  logger.info('✅ Express app created');

  // Initialize Socket.IO server
  const io = new Server(server, {
    cors: {
      origin: config.server.corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 30000,
    pingInterval: 10000,
    path: config.server.socketPath,
    transports: ['websocket', 'polling'],
    allowEIO3: true
  });

  logger.info('✅ Socket.IO server instance created', {
    cors: config.server.corsOrigin,
    path: config.server.socketPath,
    transports: ['websocket', 'polling']
  });

  // Pass io to socket initializer - let it handle all socket logic
  await socketInitializer(io);
  logger.info('✅ Socket.IO fully initialized with handlers');

  // Initialize services
  logger.info('🔧 Initializing services...');
  await initializeServices();

  // Trust proxy if configured
  if (config.security.trustProxy) {
    app.set('trust proxy', true);
    logger.info('✅ Trust proxy enabled');
  }

  // Correlation ID Middleware
  app.use((req, res, next) => {
    req.id = uuidv4();
    req.correlationId = req.id;
    res.setHeader('X-Correlation-ID', req.correlationId);
    logger.setContext({ requestId: req.id });
    next();
  });
  logger.info('✅ Correlation ID middleware added');

  // Security middleware
  if (config.security.enableHelmet) {
    app.use(helmet({
      contentSecurityPolicy: config.server.nodeEnv === 'production'
    }));
    logger.info('✅ Helmet security middleware enabled');
  }

  // Compression middleware
  app.use(compression());
  logger.info('✅ Compression middleware enabled');

  // CORS middleware
  app.use(cors({
    origin: config.server.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }));
  logger.info('✅ CORS middleware configured', { origin: config.server.corsOrigin });

  // Body parsers
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  logger.info('✅ Body parsers configured', { limit: '5mb' });

  // Request logging
  app.use(requestLogger);
  logger.info('✅ Request logging middleware enabled');

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: config.rateLimiting.windowMs,
    max: config.rateLimiting.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('⚠️ Rate limit exceeded', { 
        ip: req.ip, 
        path: req.path,
        correlationId: req.correlationId
      });
      
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          retryAfter: res.getHeader('Retry-After')
        }
      });
    }
  });

  app.use('/api', apiLimiter);
  logger.info('✅ Rate limiting configured', {
    windowMs: config.rateLimiting.windowMs,
    max: config.rateLimiting.max
  });

  // Static files
  const uploadsPath = path.join(__dirname, 'uploads');
  app.use('/uploads', express.static(uploadsPath));
  logger.info('✅ Static file serving configured', { path: '/uploads' });

  // Health check endpoint
  app.get('/health', async (req, res) => {
    const startTime = Date.now();
    const health = await getHealthStatus();
    const duration = Date.now() - startTime;
    
    logger.info('🏥 Health check performed', {
      status: health.status,
      duration: `${duration}ms`,
      services: health.services
    });
    
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  });
  logger.info('✅ Health check endpoint configured', { path: '/health' });

  // Metrics endpoint (if enabled)
  if (config.monitoring.metrics.enabled) {
    promClient.collectDefaultMetrics();
    
    app.get('/metrics', async (req, res) => {
      res.set('Content-Type', promClient.register.contentType);
      res.end(await promClient.register.metrics());
    });
    logger.info('✅ Prometheus metrics endpoint configured', { path: '/metrics' });
  }

  // Client SDK configuration endpoint
  app.get('/api/config', (req, res) => {
    const { generateClientConfig } = require('./utils/client-sdk');
    res.json(generateClientConfig(req));
  });
  logger.info('✅ Client SDK config endpoint configured', { path: '/api/config' });

  // Swagger documentation
  const swaggerDocs = swaggerJsDoc(swaggerOptions);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
  logger.info('✅ Swagger documentation configured', { path: '/api-docs' });

  // API Routes - Versioned
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/conversations', conversationRoutes);
  app.use('/api/v1/messages', messageRoutes);
  app.use('/api/v1/admin', adminRoutes);
  logger.info('✅ Versioned API routes configured', { 
    routes: ['/api/v1/auth', '/api/v1/users', '/api/v1/conversations', '/api/v1/messages', '/api/v1/admin']
  });

  // API Routes - Legacy support
  app.use('/api', apiRoutes);
  logger.info('✅ Legacy API routes configured', { path: '/api' });

  // File upload endpoint
  const upload = createUploadMiddleware();
  app.post('/upload', 
    authMiddleware.authenticate.bind(authMiddleware),
    upload.single('file'), 
    (req, res) => {
      if (!req.file) {
        logger.warn('⚠️ File upload attempted without file', { 
          correlationId: req.correlationId 
        });
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_REQUIRED',
            message: 'No file uploaded'
          }
        });
      }

      const fileUrl = req.file.location || 
        `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

      logger.info('✅ File uploaded successfully', {
        correlationId: req.correlationId,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: req.file.mimetype
      });

      res.json({
        success: true,
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: req.file.mimetype
      });
    }
  );
  logger.info('✅ File upload endpoint configured', { path: '/upload' });

  // Root route
  app.get('/', (req, res) => {
    res.json({
      name: 'VortexHive Chat API',
      status: 'online',
      version: process.env.npm_package_version || '1.0.0',
      environment: config.server.nodeEnv,
      features: config.features,
      docs: `${req.protocol}://${req.get('host')}/api-docs`
    });
  });
  logger.info('✅ Root route configured', { path: '/' });

  // 404 handler
  app.use(exceptionHandler.notFoundHandler);
  logger.info('✅ 404 handler configured');

  // Error handler
  app.use(exceptionHandler.errorHandler);
  logger.info('✅ Error handler configured');

  // Initialize exception handlers
  exceptionHandler.initialize(server);
  logger.info('✅ Exception handlers initialized');

  // Start server
  const PORT = config.server.port;
  const HOST = config.server.host;

  try {
    logger.info('🔌 Connecting to database...');
    // Connect to database
    await sequelize.authenticate();
    logger.info('✅ Database connection established', {
      host: config.database.host,
      database: config.database.name,
      dialect: config.database.dialect
    });

    // Sync models in development
    if (config.server.nodeEnv !== 'production' && process.env.DB_ALTER === 'true') {
      logger.info('🔄 Synchronizing database models...');
      await sequelize.sync({ alter: true });
      logger.info('✅ Database models synchronized');
    }

    // Start HTTP server
    await new Promise((resolve) => {
      server.listen(PORT, HOST, () => {
        const setupDuration = Date.now() - startTime;
        logger.info(`🚀 Server is running!`, {
          url: `http://${HOST}:${PORT}`,
          environment: config.server.nodeEnv,
          pid: process.pid,
          workerId: cluster.worker?.id,
          setupDuration: `${setupDuration}ms`
        });
        logger.info(`📚 API Documentation available at: http://${HOST}:${PORT}/api-docs`);
        logger.info(`🏥 Health check available at: http://${HOST}:${PORT}/health`);
        
        // Log enabled features
        const enabledFeatures = Object.entries(config.features)
          .filter(([_, enabled]) => enabled)
          .map(([feature]) => feature);
        
        logger.info('🎯 Enabled features', { features: enabledFeatures });
        
        resolve();
      });
    });

    // Log successful startup summary
    logger.info('✅ Server startup completed successfully', {
      services: {
        database: '✓',
        redis: '✓',
        socketIO: '✓',
        notifications: notificationManager.initialized ? '✓' : '✗'
      }
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      logger.warn('⚠️ SIGTERM received, initiating graceful shutdown...');
      gracefulShutdown(server, io);
    });
    
    process.on('SIGINT', () => {
      logger.warn('⚠️ SIGINT received, initiating graceful shutdown...');
      gracefulShutdown(server, io);
    });

  } catch (error) {
    logger.error('❌ Failed to start server', { 
      error: error.message,
      stack: error.stack,
      code: error.code
    });
    process.exit(1);
  }
}

async function initializeServices() {
  const startTime = Date.now();
  
  try {
    // Initialize queue service
    logger.info('🔧 Initializing queue service...');
    if (queueService.initialize) {
      await queueService.initialize();
      logger.info('✅ Queue service initialized');
    } else {
      logger.warn('⚠️ Queue service initialize method not found');
    }
    
    // Initialize notification manager
    logger.info('🔧 Initializing notification manager...');
    await notificationManager.initialize();
    logger.info('✅ Notification manager initialized', {
      providers: notificationManager.providers ? 
        Array.from(notificationManager.providers.keys()) : []
    });
    
    // Initialize Redis service
    logger.info('🔧 Initializing Redis service...');
    if (redisService.initialize) {
      await redisService.initialize();
      logger.info('✅ Redis service initialized');
    } else {
      logger.warn('⚠️ Redis service initialize method not found');
    }
    
    const duration = Date.now() - startTime;
    logger.info('✅ All services initialized successfully', { 
      duration: `${duration}ms` 
    });
  } catch (error) {
    logger.error('❌ Service initialization failed', { 
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function getHealthStatus() {
  const status = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    pid: process.pid,
    memory: process.memoryUsage(),
    services: {}
  };

  // Check database
  try {
    const startTime = Date.now();
    await sequelize.authenticate();
    const duration = Date.now() - startTime;
    status.services.database = {
      status: 'healthy',
      responseTime: `${duration}ms`
    };
    logger.debug('✅ Database health check passed', { duration: `${duration}ms` });
  } catch (error) {
    status.services.database = {
      status: 'unhealthy',
      error: error.message
    };
    status.status = 'unhealthy';
    logger.error('❌ Database health check failed', { error: error.message });
  }

  // Check Redis
  try {
    const startTime = Date.now();
    await redisService.ping();
    const duration = Date.now() - startTime;
    status.services.redis = {
      status: 'healthy',
      responseTime: `${duration}ms`
    };
    logger.debug('✅ Redis health check passed', { duration: `${duration}ms` });
  } catch (error) {
    status.services.redis = {
      status: 'unhealthy',
      error: error.message
    };
    status.status = 'unhealthy';
    logger.error('❌ Redis health check failed', { error: error.message });
  }

  // Check Queue service
  try {
    const startTime = Date.now();
    const queueStatus = await queueService.ping();
    const duration = Date.now() - startTime;
    status.services.queue = {
      status: queueStatus.status === 'ok' ? 'healthy' : 'unhealthy',
      responseTime: `${duration}ms`
    };
    logger.debug('✅ Queue health check passed', { duration: `${duration}ms` });
  } catch (error) {
    status.services.queue = {
      status: 'unhealthy',
      error: error.message
    };
    status.status = 'warning';
    logger.error('❌ Queue health check failed', { error: error.message });
  }

  // Check notification services
  status.services.notifications = {
    status: notificationManager.initialized ? 'healthy' : 'unhealthy',
    providers: notificationManager.providers ? 
      Array.from(notificationManager.providers.keys()) : []
  };

  return status;
}

async function gracefulShutdown(server, io) {
  const shutdownStartTime = Date.now();
  logger.warn('🛑 Initiating graceful shutdown...');

  const shutdownTimeout = setTimeout(() => {
    logger.error('❌ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);

  try {
    // Stop accepting new connections
    logger.info('🔒 Closing HTTP server to new connections...');
    await new Promise((resolve) => {
      server.close(resolve);
    });
    logger.info('✅ HTTP server closed');

    // Close Socket.IO connections
    logger.info('🔌 Closing Socket.IO connections...');
    await new Promise((resolve) => {
      io.close(resolve);
    });
    logger.info('✅ Socket.IO connections closed');

    // Close database connection
    logger.info('💾 Closing database connection...');
    await sequelize.close();
    logger.info('✅ Database connection closed');

    // Close Redis connection
    logger.info('📦 Closing Redis connection...');
    await redisService.redisClient.quit();
    logger.info('✅ Redis connection closed');

    // Close Queue service
    logger.info('📋 Closing Queue service connection...');
    await queueService.redisClient.quit();
    logger.info('✅ Queue service connection closed');

    // Shutdown notification services
    logger.info('🔔 Shutting down notification services...');
    const apnService = require('./services/notifications/apn');
    await apnService.shutdown();
    logger.info('✅ APN service shut down');

    clearTimeout(shutdownTimeout);
    
    const shutdownDuration = Date.now() - shutdownStartTime;
    logger.info(`✅ Graceful shutdown completed`, { 
      duration: `${shutdownDuration}ms` 
    });
    
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error during graceful shutdown', { 
      error: error.message,
      stack: error.stack
    });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Process-level event handlers
process.on('uncaughtException', (err) => {
  logger.error(`💥 Uncaught Exception`, { 
    error: err.message,
    stack: err.stack,
    code: err.code
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`💥 Unhandled Rejection`, { 
    reason: reason.message || reason,
    stack: reason.stack || 'No stack trace available'
  });
  process.exit(1);
});

// HTTPS warning
if (process.env.NODE_ENV === 'production' && !process.env.SERVER_URL?.startsWith('https')) {
  logger.warn('🚨 WARNING: Server is running over HTTP in production mode. Use HTTPS (wss) for security!');
}

// Log environment information on startup
logger.info('🌍 Environment Information', {
  nodeVersion: process.version,
  npmVersion: process.env.npm_package_version,
  platform: process.platform,
  arch: process.arch,
  pid: process.pid,
  ppid: process.ppid,
  execPath: process.execPath,
  cwd: process.cwd(),
  memoryUsage: process.memoryUsage(),
  cpuUsage: process.cpuUsage(),
  env: {
    NODE_ENV: process.env.NODE_ENV,
    PORT: process.env.PORT || config.server.port,
    HOST: process.env.HOST || config.server.host
  }
});