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

// Import socket handlers
//const socketHandlers = require('./socketHandlers');
const socketInitializer = require('./socket/socketInitializer');
socketInitializer(io);

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
  logger.info(`Primary ${process.pid} is running`);
  logger.info(`Starting ${config.cluster.workerCount} workers...`);

  // Fork workers
  for (let i = 0; i < config.cluster.workerCount; i++) {
    cluster.fork();
  }

  // Handle worker crashes
  cluster.on('exit', (worker, code, signal) => {
    logger.error(`Worker ${worker.process.pid} died`, { code, signal });
    
    // Restart worker after a delay
    setTimeout(() => {
      logger.info('Starting a new worker...');
      cluster.fork();
    }, 1000);
  });

  // Monitor cluster health
  setInterval(() => {
    const workers = Object.values(cluster.workers);
    const aliveWorkers = workers.filter(w => w.state === 'online').length;
    
    logger.info('Cluster health check', {
      totalWorkers: workers.length,
      aliveWorkers,
      deadWorkers: workers.length - aliveWorkers
    });
  }, config.monitoring.healthCheckInterval);

} else {
  // Worker process or single-process mode
  startServer();
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  // Initialize Socket.IO
  const io = new Server(server, {
    cors: {
      origin: config.server.corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingTimeout: 30000,
    pingInterval: 10000,
    path: config.server.socketPath
  });

  // Initialize services
  await initializeServices();

  // Trust proxy if configured
  if (config.security.trustProxy) {
    app.set('trust proxy', true);
  }

  // Request ID middleware
  app.use((req, res, next) => {
    req.id = uuidv4();
    logger.setContext({ requestId: req.id });
    next();
  });

  // Security middleware
  if (config.security.enableHelmet) {
    app.use(helmet({
      contentSecurityPolicy: config.server.nodeEnv === 'production'
    }));
  }

  // Compression middleware
  app.use(compression());

  // CORS middleware
  app.use(cors({
    origin: config.server.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  }));

  // Body parsers
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // Request logging
  app.use(requestLogger);

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: config.rateLimiting.windowMs,
    max: config.rateLimiting.max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
      
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

  // Static files
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // Health check endpoint
  app.get('/health', async (req, res) => {
    const health = await getHealthStatus();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  });

  // Metrics endpoint (if enabled)
  if (config.monitoring.metrics.enabled) {
    const prometheus = require('prom-client');
    prometheus.collectDefaultMetrics();
    
    app.get('/metrics', async (req, res) => {
      res.set('Content-Type', prometheus.register.contentType);
      res.end(await prometheus.register.metrics());
    });
  }

  // Client SDK configuration endpoint (from existing)
  app.get('/api/config', (req, res) => {
    const { generateClientConfig } = require('./utils/client-sdk');
    res.json(generateClientConfig(req));
  });

  // Swagger documentation
  const swaggerDocs = swaggerJsDoc(swaggerOptions);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

  // API Routes - Versioned
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/conversations', conversationRoutes);
  app.use('/api/v1/messages', messageRoutes);
  app.use('/api/v1/admin', adminRoutes);

  // API Routes - Legacy support (from existing)
  app.use('/api', apiRoutes);

  // File upload endpoint
  const upload = createUploadMiddleware();
  app.post('/upload', 
    authMiddleware.authenticate.bind(authMiddleware),
    upload.single('file'), 
    (req, res) => {
      if (!req.file) {
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

      res.json({
        success: true,
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: req.file.mimetype
      });
    }
  );

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

  // 404 handler
  app.use(exceptionHandler.notFoundHandler);

  // Error handler
  app.use(exceptionHandler.errorHandler);

  // Initialize exception handlers
  exceptionHandler.initialize(server);

  // Initialize socket handlers
  socketHandlers(io);

  // Start server
  const PORT = config.server.port;
  const HOST = config.server.host;

  try {
    // Connect to database
    await sequelize.authenticate();
    logger.info('Database connection established');

    // Sync models in development
    if (config.server.nodeEnv !== 'production' && process.env.DB_ALTER === 'true') {
      await sequelize.sync({ alter: true });
      logger.info('Database models synchronized');
    }

    // Start HTTP server
    server.listen(PORT, HOST, () => {
      logger.info(`Server running on http://${HOST}:${PORT}`, {
        pid: process.pid,
        environment: config.server.nodeEnv,
        workerId: cluster.worker?.id
      });
      logger.info(`API Documentation: http://${HOST}:${PORT}/api-docs`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown(server, io));
    process.on('SIGINT', () => gracefulShutdown(server, io));

  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

async function initializeServices() {
  try {
    // Initialize queue service
    await queueService.initialize?.();
    
    // Initialize notification manager
    await notificationManager.initialize();
    
    // Initialize Redis service
    await redisService.initialize?.();
    
    logger.info('All services initialized successfully');
  } catch (error) {
    logger.error('Service initialization failed', { error: error.message });
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
    await sequelize.authenticate();
    status.services.database = 'healthy';
  } catch (error) {
    status.services.database = 'unhealthy';
    status.status = 'unhealthy';
  }

  // Check Redis
  try {
    await redisService.ping();
    status.services.redis = 'healthy';
  } catch (error) {
    status.services.redis = 'unhealthy';
    status.status = 'unhealthy';
  }

  // Check Queue service
  try {
    await queueService.ping();
    status.services.queue = 'healthy';
  } catch (error) {
    status.services.queue = 'unhealthy';
    status.status = 'warning';
  }

  // Check notification services
  status.services.notifications = notificationManager.initialized ? 'healthy' : 'unhealthy';

  return status;
}

async function gracefulShutdown(server, io) {
  logger.info('Received shutdown signal, closing connections...');

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });

  // Close Socket.IO connections
  io.close(() => {
    logger.info('Socket.IO connections closed');
  });

  // Close database connection
  try {
    await sequelize.close();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection', { error: error.message });
  }

  // Close Redis connection
  try {
    await redisService.redisClient.quit();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error('Error closing Redis connection', { error: error.message });
  }

  // Close Queue service
  try {
    await queueService.redisClient.quit();
    logger.info('Queue service connection closed');
  } catch (error) {
    logger.error('Error closing queue service connection', { error: error.message });
  }

  // Shutdown notification services
  try {
    const apnService = require('./services/notifications/apn');
    await apnService.shutdown();
    logger.info('APN service shut down');
  } catch (error) {
    logger.error('Error shutting down APN service', { error: error.message });
  }

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);

  // Exit
  process.exit(0);
}


// === PHASE 1A: Lifecycle Management, Health Check, and Metrics ===


// Secure headers and CORS
app.use(helmet());
app.use(cors());

// Correlation ID Middleware
app.use((req, res, next) => {
  req.correlationId = uuidv4();
  res.setHeader('X-Correlation-ID', req.correlationId);
  logger.info(`Incoming request: ${req.method} ${req.url}`, { correlationId: req.correlationId });
  next();
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Prometheus Metrics
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics();
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});

// Graceful Shutdown
const shutdown = () => {
  logger.info('Received shutdown signal, closing gracefully...');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
  shutdown();
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled Rejection: ${reason}`);
  shutdown();
});

// === PHASE 1B: Socket Error Handling, Flood Control, HTTPS Warning ===
const rateLimitMap = new Map();

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  // Flood control
  socket.use((packet, next) => {
    const now = Date.now();
    const timestamps = rateLimitMap.get(socket.id) || [];
    const recent = timestamps.filter(ts => now - ts < 1000);
    recent.push(now);
    rateLimitMap.set(socket.id, recent);
    if (recent.length > 10) {
      logger.warn(`Rate limit exceeded for socket ${socket.id}`);
      return next(new Error('Rate limit exceeded'));
    }
    next();
  });

  // Global socket event error wrapper
  socket.onAny((event, ...args) => {
    try {
      logger.info(`Socket event received: ${event}`);
    } catch (err) {
      logger.error(`Error processing event ${event}: ${err.message}`, { stack: err.stack });
      socket.emit('error', 'Internal server error');
    }
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
    rateLimitMap.delete(socket.id);
  });
});

if (process.env.NODE_ENV === 'production' && !process.env.SERVER_URL?.startsWith('https')) {
  logger.warn('🚨 WARNING: Server is running over HTTP in production mode. Use HTTPS (wss) for security!');
}
