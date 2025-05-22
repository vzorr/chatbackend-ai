// middleware/exceptionHandler.js
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

class ExceptionHandler {
  /**
   * Global error handler middleware
   */
  errorHandler(err, req, res, next) {
    const errorId = uuidv4();
    const statusCode = err.statusCode || err.status || 500;
    
    // Auto-attach Error ID to request for downstream logging
    req.errorId = errorId;
    
    // Log error with context
    logger.error('Request error', {
      errorId,
      error: err,
      request: {
        id: req.id,
        method: req.method,
        url: req.url,
        headers: this.sanitizeHeaders(req.headers),
        ip: req.ip,
        userId: req.user?.id
      },
      statusCode
    });

    // Determine error response
    const response = this.buildErrorResponse(err, errorId, statusCode);
    
    // Send response
    res.status(statusCode).json(response);
  }

  /**
   * Enhanced async error wrapper with better stack trace capture
   */
  asyncHandler(fn) {
    return function asyncWrap(req, res, next) {
      Promise.resolve(fn(req, res, next)).catch((err) => {
        // Enhanced stack trace with route information
        err.stack += `\nTriggered by asyncHandler at ${req.method} ${req.originalUrl}`;
        next(err);
      });
    };
  }

  /**
   * Build error response with isOperational flag support
   */
  buildErrorResponse(err, errorId, statusCode) {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Base error response
    const response = {
      success: false,
      error: {
        id: errorId,
        message: this.getErrorMessage(err, isProduction),
        code: err.code || 'INTERNAL_ERROR',
        statusCode,
        timestamp: new Date().toISOString()
      }
    };

    // Enhanced error categorization with isOperational flag
    if (!err.isOperational && isProduction) {
      response.error.message = 'An unexpected error occurred';
    }

    // Add details in non-production
    if (!isProduction) {
      response.error.details = {
        stack: err.stack,
        isOperational: err.isOperational || false,
        ...err
      };
    }

    // Add validation errors
    if (err.name === 'ValidationError' && err.errors) {
      response.error.validationErrors = this.formatValidationErrors(err.errors);
    }

    return response;
  }

  /**
   * Get user-friendly error message
   */
  getErrorMessage(err, isProduction) {
    // Custom error messages
    const errorMessages = {
      'SequelizeValidationError': 'Validation failed',
      'SequelizeUniqueConstraintError': 'Resource already exists',
      'SequelizeForeignKeyConstraintError': 'Invalid reference',
      'JsonWebTokenError': 'Invalid authentication token',
      'TokenExpiredError': 'Authentication token expired',
      'MulterError': 'File upload error'
    };

    if (errorMessages[err.name]) {
      return errorMessages[err.name];
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
   * Format validation errors
   */
  formatValidationErrors(errors) {
    if (Array.isArray(errors)) {
      return errors.map(error => ({
        field: error.path,
        message: error.message,
        value: error.value
      }));
    }

    // Sequelize validation errors
    return Object.keys(errors).map(field => ({
      field,
      message: errors[field].message,
      value: errors[field].value
    }));
  }

  /**
   * Sanitize headers for logging
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
    
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  /**
   * Not found handler
   */
  notFoundHandler(req, res) {
    const errorId = uuidv4();
    
    // Auto-attach Error ID to request
    req.errorId = errorId;
    
    logger.warn('Route not found', {
      errorId,
      method: req.method,
      url: req.url,
      ip: req.ip
    });

    res.status(404).json({
      success: false,
      error: {
        id: errorId,
        message: 'Resource not found',
        code: 'NOT_FOUND',
        statusCode: 404,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Unhandled rejection handler (replaces deprecated domain handler)
   */
  unhandledRejectionHandler(reason, promise) {
    logger.error('Unhandled Promise Rejection', {
      reason,
      promise: promise.toString(),
      stack: reason?.stack
    });

    // In production, log and continue
    // In development, crash to highlight the issue
    if (process.env.NODE_ENV !== 'production') {
      throw reason;
    }
  }

  /**
   * Uncaught exception handler
   */
  uncaughtExceptionHandler(error) {
    logger.error('Uncaught Exception', {
      error,
      stack: error.stack
    });

    // Always exit after uncaught exception
    process.exit(1);
  }

  /**
   * Initialize exception handlers (enhanced, no deprecated domain usage)
   */
  initialize(server) {
    // Modern error handler setup (no deprecated domain)
    process.on('uncaughtException', this.uncaughtExceptionHandler.bind(this));
    process.on('unhandledRejection', this.unhandledRejectionHandler.bind(this));

    // Graceful shutdown
    const gracefulShutdown = (signal) => {
      logger.info(`Received ${signal}, shutting down gracefully`);
      
      server.close(() => {
        logger.info('HTTP server closed');
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

    logger.info('✅ Enhanced exception handlers initialized');
  }

  /**
   * Helper method to create operational errors
   */
  static createOperationalError(message, statusCode = 400, code = null) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.code = code;
    err.isOperational = true;
    return err;
  }

  /**
   * Helper method to create system errors
   */
  static createSystemError(message, originalError = null) {
    const err = new Error(message);
    err.statusCode = 500;
    err.code = 'SYSTEM_ERROR';
    err.isOperational = false;
    err.originalError = originalError;
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