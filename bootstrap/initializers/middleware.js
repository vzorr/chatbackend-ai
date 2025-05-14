// bootstrap/initializers/middleware.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../../utils/logger');
const config = require('../../config/config');
const requestLogger = require('../../middleware/request-logger');

async function setupMiddleware(app) {
  const startTime = Date.now();
  logger.info('🔧 [Middleware] Setting up middleware stack...');

  try {
    // Setup middleware in the correct order
    setupCorrelationId(app);
    setupSecurityMiddleware(app);
    setupCompressionMiddleware(app);
    setupCorsMiddleware(app);
    setupBodyParsers(app);
    setupRequestLogging(app);
    setupRateLimiting(app);
    setupStaticFiles(app);
    
    const duration = Date.now() - startTime;
    logger.info('✅ [Middleware] Middleware stack setup completed', {
      duration: `${duration}ms`,
      middlewareCount: 8
    });
    
  } catch (error) {
    logger.error('❌ [Middleware] Middleware setup failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

function setupCorrelationId(app) {
  logger.info('🔧 [Middleware] Setting up correlation ID...');
  
  app.use((req, res, next) => {
    req.id = uuidv4();
    req.correlationId = req.id;
    res.setHeader('X-Correlation-ID', req.correlationId);
    logger.setContext({ requestId: req.id });
    next();
  });
  
  logger.info('✅ [Middleware] Correlation ID middleware configured');
}

function setupSecurityMiddleware(app) {
  if (!config.security.enableHelmet) {
    logger.info('⏭️ [Middleware] Helmet disabled, skipping');
    return;
  }
  
  logger.info('🔧 [Middleware] Setting up security middleware...');
  
  app.use(helmet({
    contentSecurityPolicy: config.server.nodeEnv === 'production' ? {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "https:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      }
    } : false,
    crossOriginEmbedderPolicy: config.server.nodeEnv === 'production',
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  }));
  
  logger.info('✅ [Middleware] Security middleware configured', {
    environment: config.server.nodeEnv
  });
}

function setupCompressionMiddleware(app) {
  logger.info('🔧 [Middleware] Setting up compression middleware...');
  
  app.use(compression({
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false;
      }
      return compression.filter(req, res);
    },
    level: 6,
    threshold: 1024
  }));
  
  logger.info('✅ [Middleware] Compression middleware configured', {
    level: 6,
    threshold: 1024
  });
}

function setupCorsMiddleware(app) {
  logger.info('🔧 [Middleware] Setting up CORS middleware...');
  
  const corsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, server-to-server)
      if (!origin) return callback(null, true);
      
      const allowedOrigins = config.server.corsOrigin.split(',').map(o => o.trim());
      
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn('⚠️ [Middleware] CORS blocked origin', { origin });
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
    exposedHeaders: ['X-Correlation-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: 86400 // 24 hours
  };
  
  app.use(cors(corsOptions));
  
  logger.info('✅ [Middleware] CORS middleware configured', {
    origin: config.server.corsOrigin,
    maxAge: corsOptions.maxAge
  });
}

function setupBodyParsers(app) {
  logger.info('🔧 [Middleware] Setting up body parsers...');
  
  const limit = '5mb'; // You can make this configurable
  
  app.use(express.json({ 
    limit,
    strict: true,
    type: ['application/json', 'text/json']
  }));
  
  app.use(express.urlencoded({ 
    extended: true, 
    limit,
    parameterLimit: 1000
  }));
  
  // Raw body parser for webhooks (if needed)
  app.use('/webhooks', express.raw({ 
    type: 'application/json',
    limit 
  }));
  
  logger.info('✅ [Middleware] Body parsers configured', {
    jsonLimit: limit,
    urlencodedLimit: limit,
    rawBodyEnabled: true
  });
}

function setupRequestLogging(app) {
  logger.info('🔧 [Middleware] Setting up request logging...');
  
  app.use(requestLogger);
  
  logger.info('✅ [Middleware] Request logging configured');
}

function setupRateLimiting(app) {
  logger.info('🔧 [Middleware] Setting up rate limiting...');
  
  // General API rate limiter
  const apiLimiter = rateLimit({
    windowMs: config.rateLimiting.windowMs,
    max: config.rateLimiting.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: config.rateLimiting.skipSuccessfulRequests || false,
    skip: (req) => {
      const skipPaths = ['/health', '/metrics', '/api-docs'];
      return skipPaths.includes(req.path);
    },
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise use IP
      return req.user?.id || req.ip;
    },
    handler: (req, res) => {
      logger.warn('⚠️ [RateLimit] Rate limit exceeded', { 
        ip: req.ip,
        userId: req.user?.id,
        path: req.path,
        correlationId: req.correlationId
      });
      
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
          retryAfter: res.getHeader('Retry-After')
        }
      });
    }
  });
  
  // Apply to all API routes
  app.use('/api', apiLimiter);
  
  logger.info('✅ [Middleware] Rate limiting configured', {
    windowMs: config.rateLimiting.windowMs,
    max: config.rateLimiting.max,
    skipPaths: ['/health', '/metrics', '/api-docs']
  });
}

function setupStaticFiles(app) {
  logger.info('🔧 [Middleware] Setting up static file serving...');
  
  const path = require('path');
  const uploadsPath = path.join(process.cwd(), 'uploads');
  
  // Serve uploaded files
  app.use('/uploads', express.static(uploadsPath, {
    maxAge: '1d',
    etag: true,
    lastModified: true,
    index: false,
    dotfiles: 'deny'
  }));
  
  logger.info('✅ [Middleware] Static file serving configured', {
    uploads: '/uploads',
    path: uploadsPath
  });
}

module.exports = { setupMiddleware };