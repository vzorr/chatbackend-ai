// server.js
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
const os = require('os');
require('dotenv').config();

const sequelize = require('./db');
const logger = require('./utils/logger');
const redisService = require('./services/redis');
const socketHandlers = require('./socketHandlers');
const apiRoutes = require('./routes');
const errorHandler = require('./middleware/error-middleware');
const requestLogger = require('./middleware/request-logger');
const { createUploadMiddleware } = require('./services/file-upload');

// Cluster mode for production (disable for development/debugging)
const CLUSTER_MODE = process.env.NODE_ENV === 'production' && process.env.DISABLE_CLUSTER !== 'true';
const WORKER_COUNT = process.env.WORKER_COUNT || os.cpus().length;

// If primary process in cluster mode, fork workers
if (CLUSTER_MODE && cluster.isPrimary) {
  logger.info(`Primary ${process.pid} is running`);
  logger.info(`Starting ${WORKER_COUNT} workers...`);

  // Fork workers
  for (let i = 0; i < WORKER_COUNT; i++) {
    cluster.fork();
  }

  // Handle worker crashes
  cluster.on('exit', (worker, code, signal) => {
    logger.error(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
    logger.info('Starting a new worker...');
    cluster.fork();
  });
} else {
  // Worker process or single-process mode
  startServer();
}

function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      credentials: true
    },
    pingTimeout: 30000, // Faster disconnection detection
    pingInterval: 10000,
    transports: ['websocket', 'polling']
  });

  // Assign request ID to each request for tracing
  app.use((req, res, next) => {
    req.id = uuidv4();
    next();
  });

  // Basic security
  app.use(helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false
  }));
  
  // Compression
  app.use(compression());
  
  // CORS
//  (updating CORS configuration)
  app.use(cors({
    origin: function(origin, callback) {
      // Allow requests with no origin (mobile apps, curl, etc)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',');
      
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
  }));
  
  // Body parsers
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  
  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false
  });
  
  // Static files
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
  
  // Request logging
  app.use(requestLogger);
  
  // Apply rate limiter to API routes
  app.use('/api', apiLimiter);
  
  // Health check endpoint
  app.get('/health', async (req, res) => {
    // Check database connection
    let dbStatus = 'OK';
    try {
      await sequelize.authenticate();
    } catch (error) {
      dbStatus = 'ERROR';
      logger.error(`Database health check failed: ${error}`);
    }
    
    // Check Redis connection
    let redisStatus = 'OK';
    try {
      await redisService.ping();
    } catch (error) {
      redisStatus = 'ERROR';
      logger.error(`Redis health check failed: ${error}`);
    }
    
    const healthy = dbStatus === 'OK' && redisStatus === 'OK';
    
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'OK' : 'ERROR',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus
      },
      version: process.env.npm_package_version || '1.0.0',
      nodeId: process.pid
    });
  });
  
  // API routes
  app.use('/api', apiRoutes);
  
  // File upload route with middleware
  const upload = createUploadMiddleware();
  app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Return file URL
    const fileUrl = req.file.location || `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    
    res.json({ 
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileType: req.file.mimetype
    });
  });
  
  // Root route
  app.get('/', (req, res) => {
    res.json({
      name: 'VortexHive Chat API',
      status: 'online',
      version: process.env.npm_package_version || '1.0.0'
    });
  });
  
  // Error handler (must be last)
  app.use(errorHandler);
  
  // Initialize socket handlers
  socketHandlers(io);
  
  // Start the server
  const PORT = process.env.PORT || 5000;
  
  // Initialize database and start server
  (async () => {
    try {
      // Connect to database
      await sequelize.authenticate();
      logger.info('Database connection established');
      
      // Sync models (disable in production)
      if (process.env.NODE_ENV !== 'production') {
        await sequelize.sync({ alter: process.env.DB_ALTER === 'true' });
        logger.info('Database models synchronized');
      }
      
      // Start HTTP server
      server.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server running on http://0.0.0.0:${PORT} (PID: ${process.pid})`);
      });
      
      // Graceful shutdown
      process.on('SIGTERM', gracefulShutdown);
      process.on('SIGINT', gracefulShutdown);
      
    } catch (error) {
      logger.error(`Failed to start server: ${error}`);
      process.exit(1);
    }
  })();
  
  // Graceful shutdown function
  async function gracefulShutdown() {
    logger.info('Received shutdown signal, closing connections...');
    
    // Close HTTP server (stop accepting new connections)
    server.close(() => {
      logger.info('HTTP server closed');
    });
    
    // Close database connection
    try {
      await sequelize.close();
      logger.info('Database connection closed');
    } catch (error) {
      logger.error(`Error closing database connection: ${error}`);
    }
    
    // Close Redis client
    try {
      await redisService.redisClient.quit();
      logger.info('Redis connection closed');
    } catch (error) {
      logger.error(`Error closing Redis connection: ${error}`);
    }
    
    // Exit with success code
    logger.info('Shutdown complete, exiting');
    process.exit(0);
  }
}