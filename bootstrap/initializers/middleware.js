// bootstrap/initializers/middleware.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config/config');
const requestLogger = require('../../middleware/request-logger');
const logger = require('../../utils/logger');

async function setupMiddleware(app) {
  const startTime = Date.now();
  logger.info('🔧 [Middleware] Setting up middleware stack...');

  try {
    // Setup middleware in the correct order
    setupCorrelationId(app);
    setupSecurityMiddleware(app);
    setupSSLMiddleware(app);
    setupCompressionMiddleware(app);
    //setupCorsMiddleware(app);
    setupBodyParsers(app);
    setupRequestLogging(app);
    setupRateLimiting(app);
    setupStaticFiles(app);
    
    const duration = Date.now() - startTime;
    logger.info('✅ [Middleware] Middleware stack setup completed', {
      duration: `${duration}ms`,
      middlewareCount: 9,
      sslEnabled: config.ssl?.enabled || false,
      behindProxy: config.security?.trustProxy || false
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
    
    // Add SSL/security context to request
    req.isSecure = req.secure || req.header('x-forwarded-proto') === 'https';
    req.protocol = req.isSecure ? 'https' : 'http';
    
    logger.setContext({ 
      requestId: req.id,
      secure: req.isSecure,
      protocol: req.protocol
    });
    next();
  });
  
  logger.info('✅ [Middleware] Correlation ID middleware configured');
}

function setupSecurityMiddleware(app) {
  if (!config.security?.enableHelmet) {
    logger.info('⏭️ [Middleware] Helmet disabled, skipping');
    return;
  }
  
  logger.info('🔧 [Middleware] Setting up security middleware...');
  
  const isProduction = config.server.nodeEnv === 'production';
  const isSecure = config.ssl?.enabled || config.security?.trustProxy;
  
  const helmetConfig = {
    contentSecurityPolicy: isProduction ? {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "wss:", "https:", config.app?.domain ? `wss://${config.app.domain}` : ""],
        fontSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "https:"],
        frameSrc: ["'none'"],
      }
    } : false,
    crossOriginEmbedderPolicy: isProduction,
    // Enhanced HSTS configuration
    hsts: isSecure && config.security?.ssl?.hsts?.enabled ? {
      maxAge: config.security.ssl.hsts.maxAge || 31536000,
      includeSubDomains: config.security.ssl.hsts.includeSubDomains || true,
      preload: config.security.ssl.hsts.preload || false
    } : false,
    // Additional security headers
    noSniff: true,
    frameguard: { action: 'deny' },
    xssFilter: true,
    referrerPolicy: { policy: 'same-origin' }
  };
  
  app.use(helmet(helmetConfig));
  
  logger.info('✅ [Middleware] Security middleware configured', {
    environment: config.server.nodeEnv,
    hsts: isSecure && config.security?.ssl?.hsts?.enabled,
    csp: isProduction,
    secure: isSecure
  });
}

function setupSSLMiddleware(app) {
  logger.info('🔧 [Middleware] Setting up SSL-specific middleware...');
  
  // Force HTTPS redirect (when behind proxy)
  if (config.security?.ssl?.forceHttps && config.security?.trustProxy) {
    app.use((req, res, next) => {
      if (!req.isSecure && req.method === 'GET') {
        const httpsUrl = `https://${req.get('host')}${req.originalUrl}`;
        logger.debug('🔄 [SSL] Redirecting HTTP to HTTPS', {
          originalUrl: req.originalUrl,
          httpsUrl: httpsUrl,
          userAgent: req.get('user-agent')
        });
        return res.redirect(301, httpsUrl);
      }
      next();
    });
    logger.info('✅ [SSL] HTTPS redirect middleware enabled');
  }
  
  // Add security headers for SSL
  app.use((req, res, next) => {
    if (req.isSecure) {
      // Strict Transport Security (if not already set by Helmet)
      if (config.security?.ssl?.hsts?.enabled && !res.getHeader('Strict-Transport-Security')) {
        const maxAge = config.security.ssl.hsts.maxAge || 31536000;
        const includeSubDomains = config.security.ssl.hsts.includeSubDomains ? '; includeSubDomains' : '';
        const preload = config.security.ssl.hsts.preload ? '; preload' : '';
        res.setHeader('Strict-Transport-Security', `max-age=${maxAge}${includeSubDomains}${preload}`);
      }
      
      // Secure cookie settings
      res.setHeader('Set-Cookie', res.getHeader('Set-Cookie') || []);
    }
    next();
  });
  
  logger.info('✅ [SSL] SSL middleware configured', {
    forceHttps: config.security?.ssl?.forceHttps || false,
    hsts: config.security?.ssl?.hsts?.enabled || false,
    behindProxy: config.security?.trustProxy || false
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
    level: config.performance?.compressionLevel || 6,
    threshold: config.performance?.compressionThreshold || 1024
  }));
  
  logger.info('✅ [Middleware] Compression middleware configured', {
    level: config.performance?.compressionLevel || 6,
    threshold: config.performance?.compressionThreshold || 1024
  });
}


function setupCorsMiddleware(app) {
  logger.info('🔧 [Middleware] Setting up CORS middleware...');
  
  // Check if we're behind a proxy (Nginx)
  // You can use an environment variable to control this
  const isBehindProxy = true;
  
  if (isBehindProxy) {
    // When behind Nginx, don't add CORS headers - let Nginx handle it
    logger.info('✅ [Middleware] Running behind proxy (Nginx) - CORS handled by proxy');
    
    // Still need to handle OPTIONS requests, but without adding headers
    app.options('*', (req, res) => {
      // Nginx will add the CORS headers
      res.sendStatus(200);
    });
    
    return;
  }
  
  // Only add CORS middleware for local development or when not behind proxy
  logger.info('🔧 [Middleware] Adding CORS middleware for direct access...');
  
  const corsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, server-to-server)
      if (!origin) return callback(null, origin);
      
      // Use enhanced CORS configuration
      const allowedOrigins = config.cors?.origin ? 
        (Array.isArray(config.cors.origin) ? config.cors.origin : config.cors.origin.split(',').map(o => o.trim())) :
        config.server.corsOrigin.split(',').map(o => o.trim());
      
      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn('⚠️ [Middleware] CORS blocked origin', { 
          origin,
          allowedOrigins: allowedOrigins,
          secure: origin?.startsWith('https')
        });
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: config.cors?.credentials ?? true,
    methods: config.cors?.methods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: config.cors?.allowedHeaders || [
      'Content-Type', 
      'Authorization', 
      'X-Requested-With', 
      'X-API-Key', 
      'X-Environment',
      'X-App-Version',
      'X-Platform'
    ],
    exposedHeaders: config.cors?.exposedHeaders || ['X-Correlation-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    maxAge: config.cors?.maxAge || 86400,
    // Enhanced options for secure connections
    optionsSuccessStatus: 200,
    preflightContinue: false
  };
  
  app.use(cors(corsOptions));
  
  logger.info('✅ [Middleware] CORS middleware configured', {
    origin: config.cors?.origin || config.server.corsOrigin,
    credentials: corsOptions.credentials,
    maxAge: corsOptions.maxAge,
    secure: config.ssl?.enabled || config.security?.trustProxy,
    isBehindProxy: false
  });
}

function setupBodyParsers(app) {
  logger.info('🔧 [Middleware] Setting up body parsers...');
  
  const limit = config.server?.bodyLimit || '5mb';
  
  app.use(express.json({ 
    limit,
    strict: true,
    type: ['application/json', 'text/json'],
    verify: (req, res, buf) => {
      // Store raw body for webhook verification if needed
      if (req.originalUrl.startsWith('/webhooks')) {
        req.rawBody = buf;
      }
    }
  }));
  
  app.use(express.urlencoded({ 
    extended: true, 
    limit,
    parameterLimit: config.server?.parameterLimit || 1000
  }));
  
  // Raw body parser for webhooks (if needed)
  app.use('/webhooks', express.raw({ 
    type: 'application/json',
    limit 
  }));
  
  logger.info('✅ [Middleware] Body parsers configured', {
    jsonLimit: limit,
    urlencodedLimit: limit,
    rawBodyEnabled: true,
    parameterLimit: config.server?.parameterLimit || 1000
  });
}

function setupRequestLogging(app) {
  logger.info('🔧 [Middleware] Setting up request logging...');
  
  // Enhanced request logging with SSL context
  app.use((req, res, next) => {
    const startTime = Date.now();
    
    // Enhanced logging context
    const logContext = {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      secure: req.isSecure,
      protocol: req.protocol,
      correlationId: req.correlationId,
      // Proxy headers if present
      forwardedFor: req.get('x-forwarded-for'),
      forwardedProto: req.get('x-forwarded-proto'),
      realIp: req.get('x-real-ip')
    };
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const level = res.statusCode >= 400 ? 'warn' : 'info';
      
      logger[level]('📡 [Request]', {
        ...logContext,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('content-length') || 0
      });
    });
    
    next();
  });
  
  // Use existing request logger if available
  if (requestLogger) {
    app.use(requestLogger);
  }
  
  logger.info('✅ [Middleware] Request logging configured');
}

function setupRateLimiting(app) {
  logger.info('🔧 [Middleware] Setting up rate limiting...');
  
  // General API rate limiter
  const apiLimiter = rateLimit({
    windowMs: config.rateLimiting?.windowMs || 60000,
    max: config.rateLimiting?.max || 100,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: config.rateLimiting?.skipSuccessfulRequests || false,
    skip: (req) => {
      const skipPaths = ['/health', '/metrics', '/api-docs', '/favicon.ico'];
      return skipPaths.includes(req.path);
    },
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise use real IP (considering proxy)
      const userId = req.user?.id;
      const realIp = req.get('x-real-ip') || req.get('x-forwarded-for')?.split(',')[0] || req.ip;
      return userId || realIp;
    },
    handler: (req, res) => {
      logger.warn('⚠️ [RateLimit] Rate limit exceeded', { 
        ip: req.ip,
        realIp: req.get('x-real-ip'),
        userId: req.user?.id,
        path: req.path,
        secure: req.isSecure,
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
    windowMs: config.rateLimiting?.windowMs || 60000,
    max: config.rateLimiting?.max || 100,
    skipPaths: ['/health', '/metrics', '/api-docs'],
    proxyAware: config.security?.trustProxy || false
  });
}

function setupStaticFiles(app) {
  logger.info('🔧 [Middleware] Setting up static file serving...');
  
  const path = require('path');
  const uploadsPath = path.join(process.cwd(), 'uploads');
  
  // Serve uploaded files with security headers
  app.use('/uploads', (req, res, next) => {
    // Add security headers for static files
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Force HTTPS for sensitive uploads in production
    if (config.server.nodeEnv === 'production' && !req.isSecure) {
      return res.status(403).json({
        error: 'HTTPS required for file access'
      });
    }
    
    next();
  }, express.static(uploadsPath, {
    maxAge: config.staticFiles?.uploadsMaxAge || '1d',
    etag: true,
    lastModified: true,
    index: false,
    dotfiles: 'deny'
  }));
  
  logger.info('✅ [Middleware] Static file serving configured', {
    uploads: '/uploads',
    path: uploadsPath,
    maxAge: config.staticFiles?.uploadsMaxAge || '1d',
    httpsRequired: config.server.nodeEnv === 'production'
  });
}

module.exports = { setupMiddleware };