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
   * Async error wrapper
   */
  asyncHandler(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }

  /**
   * Build error response
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

    // Add details in non-production
    if (!isProduction) {
      response.error.details = {
        stack: err.stack,
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

    // Use provided message or default
    if (!isProduction && err.message) {
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
   * Domain error handler
   */
  domainErrorHandler(err, req, res) {
    const errorId = uuidv4();
    
    logger.error('Domain error', {
      errorId,
      error: err,
      domain: process.domain
    });

    try {
      // Close server after 30 seconds
      const killtimer = setTimeout(() => {
        process.exit(1);
      }, 30000);
      killtimer.unref();

      // Stop taking new requests
      server.close();

      // Try to send error response
      res.status(500).json({
        success: false,
        error: {
          id: errorId,
          message: 'Critical server error',
          code: 'DOMAIN_ERROR',
          statusCode: 500
        }
      });
    } catch (err2) {
      logger.error('Error sending 500 response', { error: err2 });
    }
  }

  /**
   * Unhandled rejection handler
   */
  unhandledRejectionHandler(reason, promise) {
    logger.error('Unhandled Promise Rejection', {
      reason,
      promise,
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
   * Initialize exception handlers
   */
  initialize(server) {
    // Domain error handling (deprecated but still useful)
    process.on('uncaughtException', this.uncaughtExceptionHandler);
    process.on('unhandledRejection', this.unhandledRejectionHandler);

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
  }
}

module.exports = new ExceptionHandler();