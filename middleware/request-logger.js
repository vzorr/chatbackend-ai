// middleware/request-logger.js - Enhanced with SSL support
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Enhanced middleware to log incoming requests with SSL context
 */
module.exports = (req, res, next) => {
  // Skip logging for certain paths to avoid noise
  const skipPaths = ['/health', '/favicon.ico', '/robots.txt'];
  if (skipPaths.includes(req.path)) {
    return next();
  }
  
  // Start time for measuring duration
  const startTime = Date.now();
  
  // Enhanced security context
  const securityContext = {
    secure: req.isSecure || false,
    protocol: req.protocol,
    realIp: req.get('x-real-ip') || req.ip,
    forwardedFor: req.get('x-forwarded-for'),
    forwardedProto: req.get('x-forwarded-proto'),
    forwardedHost: req.get('x-forwarded-host'),
    viaProxy: !!(req.get('x-forwarded-proto') || req.get('x-real-ip') || req.get('x-forwarded-for'))
  };
  
  // Enhanced request logging with SSL context
  const requestLog = {
    requestId: req.id || req.correlationId,
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    origin: req.get('origin'),
    referer: req.get('referer'),
    contentType: req.get('content-type'),
    contentLength: req.get('content-length'),
    ...securityContext,
    timestamp: new Date().toISOString()
  };
  
  // Add user context if authenticated
  if (req.user) {
    requestLog.user = {
      id: req.user.id,
      role: req.user.role,
      externalId: req.user.externalId
    };
  }
  
  // Log security warnings for production HTTP requests
  if (config.server.nodeEnv === 'production' && !req.isSecure) {
    logger.warn('⚠️ Insecure request in production', requestLog);
  } else {
    logger.info('📡 HTTP Request', requestLog);
  }
  
  // Enhanced response logging setup
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Capture response body for debugging (limit size)
  res.send = function (body) {
    if (typeof body === 'string' && body.length < 1000) {
      res.responseBody = body;
    }
    return originalSend.call(this, body);
  };
  
  res.json = function (obj) {
    res.responseData = obj;
    return originalJson.call(this, obj);
  };
  
  // Enhanced response logging when request finishes
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const isError = res.statusCode >= 400;
    const logLevel = isError ? 'warn' : 'info';
    
    // Enhanced response log
    const responseLog = {
      requestId: req.id || req.correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      duration: `${duration}ms`,
      contentLength: res.get('content-length') || 0,
      contentType: res.get('content-type'),
      ...securityContext,
      timestamp: new Date().toISOString()
    };
    
    // Add user context if available
    if (req.user) {
      responseLog.userId = req.user.id;
    }
    
    // Add error context for failed requests
    if (isError) {
      responseLog.error = {
        errorId: req.errorId,
        code: res.responseData?.error?.code,
        message: res.responseData?.error?.message
      };
    }
    
    // Performance warnings
    if (duration > 5000) {
      responseLog.performance = 'SLOW';
      logger.warn('🐌 Slow request detected', responseLog);
    }
    
    // Security logging for authentication failures
    if (res.statusCode === 401 || res.statusCode === 403) {
      logger.security('🔒 Authentication/Authorization failure', {
        ...responseLog,
        authFailure: true,
        securityRisk: !req.isSecure && config.server.nodeEnv === 'production'
      });
    }
    
    // Main response log
    const emoji = isError ? '❌' : '✅';
    logger[logLevel](`${emoji} HTTP Response`, responseLog);
  });
  
  // Log when request is aborted/closed unexpectedly
  req.on('close', () => {
    if (!res.headersSent) {
      logger.warn('⚠️ Request closed unexpectedly', {
        requestId: req.id || req.correlationId,
        method: req.method,
        path: req.path,
        duration: `${Date.now() - startTime}ms`,
        ...securityContext
      });
    }
  });
  
  // Log request timeout
  req.on('timeout', () => {
    logger.error('⏰ Request timeout', {
      requestId: req.id || req.correlationId,
      method: req.method,
      path: req.path,
      duration: `${Date.now() - startTime}ms`,
      ...securityContext
    });
  });
  
  next();
};