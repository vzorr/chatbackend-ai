// middleware/exceptionHandler.js - Enhanced with SSL support
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');

class ExceptionHandler {
  /**
   * Enhanced global error handler middleware with SSL context
   */
  errorHandler(err, req, res, next) {
    const errorId = uuidv4();
    const statusCode = err.statusCode || err.status || 500;
    
    // Auto-attach Error ID to request for downstream logging
    req.errorId = errorId;
    
    // Enhanced security context
    const securityContext = {
      secure: req.isSecure || false,
      protocol: req.protocol,
      realIp: req.get('x-real-ip') || req.ip,
      forwardedFor: req.get('x-forwarded-for'),
      forwardedProto: req.get('x-forwarded-proto'),
      viaProxy: !!(req.get('x-forwarded-proto') || req.get('x-real-ip'))
    };
    
    // Log error with enhanced context
    logger.error('Request error', {
      errorId,
      error: {
        message: err.message,
        code: err.code,
        name: err.name,
        isOperational: err.isOperational || false,
        stack: err.stack
      },
      request: {
        id: req.id || req.correlationId,
        method: req.method,
        url: req.originalUrl || req.url,
        headers: this.sanitizeHeaders(req.headers),
        ip: req.ip,
        userId: req.user?.id,
        userRole: req.user?.role,
        ...securityContext
      },
      statusCode,
      timestamp: new Date().toISOString()
    });

    // Security logging for SSL-related errors
    if (err.code === 'HTTPS_REQUIRED' || err.message?.includes('HTTPS')) {
      logger.security('ssl_security_violation', {
        errorId,
        ...securityContext,
        path: req.originalUrl,
        userAgent: req.get('user-agent')
      });
    }

    // Determine error response with enhanced context
    const response = this.buildErrorResponse(err, errorId, statusCode, securityContext);
    
    // Send response
    res.status(statusCode).json(response);
  }

  /**
   * Enhanced async error wrapper with better stack trace capture
   */
  asyncHandler(fn) {
    return function asyncWrap(req, res, next) {
      Promise.resolve(fn(req, res, next)).catch((err) => {
        // Enhanced stack trace with route and security information
        const securityInfo = req.isSecure ? ' [HTTPS]' : ' [HTTP]';
        err.stack += `\nTriggered by asyncHandler at ${req.method} ${req.originalUrl}${securityInfo}`;
        
        // Add security context to error
        err.securityContext = {
          secure: req.isSecure,
          protocol: req.protocol,
          ip: req.ip,
          realIp: req.get('x-real-ip')
        };
        
        next(err);
      });
    };
  }

  /**
   * Build enhanced error response with SSL context
   */
  buildErrorResponse(err, errorId, statusCode, securityContext) {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Base error response with security context
    const response = {
      success: false,
      error: {
        id: errorId,
        message: this.getErrorMessage(err, isProduction),
        code: err.code || 'INTERNAL_ERROR',
        statusCode,
        timestamp: new Date().toISOString(),
        // Include security context in non-production or for operational errors
        ...((!isProduction || err.isOperational) && {
          security: {
            secure: securityContext.secure,
            protocol: securityContext.protocol
          }
        })
      }
    };

    // Enhanced error categorization with isOperational flag
    if (!err.isOperational && isProduction) {
      response.error.message = 'An unexpected error occurred';
    }

    // Add details in non-production with enhanced context
    if (!isProduction) {
      response.error.details = {
        stack: err.stack,
        isOperational: err.isOperational || false,
        securityContext,
        originalError: err.originalError,
        ...err
      };
    }

    // Add validation errors
    if (err.name === 'ValidationError' && err.errors) {
      response.error.validationErrors = this.formatValidationErrors(err.errors);
    }

    // Add security recommendations for SSL errors
    if (err.code === 'HTTPS_REQUIRED' || statusCode === 403) {
      response.error.recommendations = [
        'Use HTTPS for secure communication',
        'Ensure your client supports SSL/TLS connections'
      ];
    }

    return response;
  }

  /**
   * Enhanced error message with SSL awareness
   */
  getErrorMessage(err, isProduction) {
    // Enhanced error messages with SSL context
    const errorMessages = {
      'SequelizeValidationError': 'Validation failed',
      'SequelizeUniqueConstraintError': 'Resource already exists',
      'SequelizeForeignKeyConstraintError': 'Invalid reference',
      'JsonWebTokenError': 'Invalid authentication token',
      'TokenExpiredError': 'Authentication token expired',
      'MulterError': 'File upload error',
      'HTTPS_REQUIRED': 'HTTPS connection required for this operation',
      'SSL_ERROR': 'SSL/TLS connection error',
      'INSECURE_CONNECTION': 'Secure connection required'
    };

    if (errorMessages[err.name] || errorMessages[err.code]) {
      return errorMessages[err.name] || errorMessages[err.code];
    }

    // Use provided message or default based on operational status
    if (!isProduction && err.message) {
      return err.message;
    }

    // For operational errors, show message even in production
    if (err.isOperational && err.message) {
      return err.message;
    }

    return 'An error occurred processing your request';
  }

  /**
   * Enhanced validation error formatting
   */
  formatValidationErrors(errors) {
    if (Array.isArray(errors)) {
      return errors.map(error => ({
        field: error.path,
        message: error.message,
        value: error.value,
        code: error.validatorKey || error.type
      }));
    }

    // Sequelize validation errors
    return Object.keys(errors).map(field => ({
      field,
      message: errors[field].message,
      value: errors[field].value,
      code: errors[field].validatorKey || errors[field].type
    }));
  }

  /**
   * Enhanced header sanitization with SSL headers
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
    
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    // Preserve important SSL/proxy headers for debugging
    const preserveHeaders = [
      'x-forwarded-proto', 
      'x-forwarded-for', 
      'x-real-ip', 
      'x-forwarded-host',
      'host',
      'origin'
    ];
    
    const result = {};
    preserveHeaders.forEach(header => {
      if (sanitized[header]) {
        result[header] = sanitized[header];
      }
    });
    
    // Add sanitized sensitive headers
    sensitiveHeaders.forEach(header => {
      if (headers[header]) {
        result[header] = '[REDACTED]';
      }
    });
    
    return result;
  }

  /**
   * Enhanced not found handler with SSL context
   */
  notFoundHandler(req, res) {
    const errorId = uuidv4();
    
    // Auto-attach Error ID to request
    req.errorId = errorId;
    
    const securityContext = {
      secure: req.isSecure || false,
      protocol: req.protocol,
      ip: req.ip,
      realIp: req.get('x-real-ip'),
      userAgent: req.get('user-agent')
    };
    
    logger.warn('Route not found', {
      errorId,
      method: req.method,
      url: req.originalUrl || req.url,
      ...securityContext,
      timestamp: new Date().toISOString()
    });

    res.status(404).json({
      success: false,
      error: {
        id: errorId,
        message: 'Resource not found',
        code: 'NOT_FOUND',
        statusCode: 404,
        timestamp: new Date().toISOString(),
        security: {
          secure: securityContext.secure,
          protocol: securityContext.protocol
        }
      }
    });
  }

  /**
   * Enhanced unhandled rejection handler
   */
  unhandledRejectionHandler(reason, promise) {
    logger.error('Unhandled Promise Rejection', {
      reason: reason?.message || reason,
      stack: reason?.stack,
      promise: promise.toString(),
      ssl: {
        enabled: config.ssl?.enabled || false,
        behindProxy: config.security?.trustProxy || false
      },
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });

    // In production, log and continue
    // In development, crash to highlight the issue
    if (process.env.NODE_ENV !== 'production') {
      throw reason;
    }
  }

  /**
   * Enhanced uncaught exception handler
   */
  uncaughtExceptionHandler(error) {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
      ssl: {
        enabled: config.ssl?.enabled || false,
        behindProxy: config.security?.trustProxy || false
      },
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString()
    });

    // Always exit after uncaught exception
    process.exit(1);
  }

  /**
   * Enhanced initialization with SSL context
   */
  initialize(server) {
    // Modern error handler setup (no deprecated domain)
    process.on('uncaughtException', this.uncaughtExceptionHandler.bind(this));
    process.on('unhandledRejection', this.unhandledRejectionHandler.bind(this));

    // Enhanced graceful shutdown with SSL context
    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully`, {
        ssl: {
          enabled: config.ssl?.enabled || false,
          behindProxy: config.security?.trustProxy || false
        },
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
      });
      
      server.close(() => {
        logger.info('HTTP/HTTPS server closed successfully');
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    logger.info('✅ Enhanced exception handlers initialized with SSL support', {
      ssl: {
        enabled: config.ssl?.enabled || false,
        behindProxy: config.security?.trustProxy || false
      }
    });
  }

  /**
   * Enhanced helper method to create SSL-aware operational errors
   */
  static createOperationalError(message, statusCode = 400, code = null) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    err.isOperational = true;
    err.timestamp = new Date().toISOString();
    return err;
  }

  /**
   * Enhanced helper method to create system errors
   */
  static createSystemError(message, originalError = null) {
    const err = new Error(message);
    err.statusCode = 500;
    err.code = 'SYSTEM_ERROR';
    err.isOperational = false;
    err.originalError = originalError;
    err.timestamp = new Date().toISOString();
    return err;
  }

  /**
   * New helper method to create SSL-specific errors
   */
  static createSSLError(message, statusCode = 403) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = 'HTTPS_REQUIRED';
    err.isOperational = true;
    err.sslError = true;
    err.timestamp = new Date().toISOString();
    return err;
  }
}

// Export the singleton instance
const exceptionHandlerInstance = new ExceptionHandler();

// Also export the class and utilities for direct access
module.exports = exceptionHandlerInstance;
module.exports.ExceptionHandler = ExceptionHandler;
module.exports.asyncHandler = exceptionHandlerInstance.asyncHandler.bind(exceptionHandlerInstance);
module.exports.createOperationalError = ExceptionHandler.createOperationalError;
module.exports.createSystemError = ExceptionHandler.createSystemError;
module.exports.createSSLError = ExceptionHandler.createSSLError;