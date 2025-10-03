// utils/logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const config = require('../config/config');

// Helper to safely serialize any value
function safeSerialize(value, maxDepth = 3, currentDepth = 0) {
  if (currentDepth > maxDepth) {
    return '[Max Depth Reached]';
  }

  if (value === null) return null;
  if (value === undefined) return undefined;
  
  // Handle primitives
  if (typeof value !== 'object') {
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (value.length > 100) {
      return `[Array with ${value.length} items]`;
    }
    try {
      return value.map(item => safeSerialize(item, maxDepth, currentDepth + 1));
    } catch (err) {
      return '[Array serialization failed]';
    }
  }

  // Handle Error objects
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  // Handle Date objects
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Handle regular objects
  try {
    const serialized = {};
    const keys = Object.keys(value);
    
    if (keys.length > 50) {
      return `[Object with ${keys.length} keys]`;
    }
    
    for (const key of keys) {
      try {
        serialized[key] = safeSerialize(value[key], maxDepth, currentDepth + 1);
      } catch (err) {
        serialized[key] = '[Unserializable]';
      }
    }
    
    return serialized;
  } catch (error) {
    return '[Unserializable Object]';
  }
}

class EnterpriseLogger {
  constructor() {
    this.contextMap = new Map();
    this.defaultContext = {};
    this.logger = this.createLogger();
    this.isLogging = false; // Prevent recursive logging
  }

  createLogger() {
    const logsDir = path.join(process.cwd(), 'logs');
    
    // Create logs directory
    try {
      require('fs').mkdirSync(logsDir, { recursive: true });
    } catch (err) {
      console.warn('Could not create logs directory:', err.message);
    }

    const transports = [];

    // Console transport for non-production
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      transports.push(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: 'HH:mm:ss' }),
          winston.format.printf(({ timestamp, level, message, ...meta }) => {
            // Remove internal Winston fields
            const { splat, ...cleanMeta } = meta;
            const metaStr = Object.keys(cleanMeta).length 
              ? `\n${JSON.stringify(cleanMeta, null, 2)}` 
              : '';
            return `${timestamp} ${level}: ${message}${metaStr}`;
          })
        ),
        handleExceptions: false,
        handleRejections: false
      }));
    }

    // File format
    const fileFormat = winston.format.combine(
      winston.format.timestamp({ format: () => new Date().toISOString() }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    );

    // Application log file
    transports.push(new DailyRotateFile({
      filename: path.join(logsDir, 'application-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: `${config.logging?.retention?.days || 30}d`,
      level: config.logging?.level || 'info',
      format: fileFormat,
      handleExceptions: false,
      handleRejections: false
    }));

    // Error log file
    transports.push(new DailyRotateFile({
      filename: path.join(logsDir, 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: `${config.logging?.retention?.days || 30}d`,
      level: 'error',
      format: fileFormat,
      handleExceptions: false,
      handleRejections: false
    }));

    const logger = winston.createLogger({
      level: config.logging?.level || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports,
      exceptionHandlers: [
        new DailyRotateFile({
          filename: path.join(logsDir, 'exceptions-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '30d'
        })
      ],
      rejectionHandlers: [
        new DailyRotateFile({
          filename: path.join(logsDir, 'rejections-%DATE%.log'),
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '30d'
        })
      ],
      exitOnError: false
    });

    // Test that logger is working
    console.log('Logger initialized successfully');

    return logger;
  }

  // Context management
  setContext(context) {
    try {
      const contextKey = this.getContextKey();
      const existingContext = this.contextMap.get(contextKey) || {};
      this.contextMap.set(contextKey, {
        ...existingContext,
        ...safeSerialize(context)
      });
    } catch (err) {
      console.error('Error setting context:', err.message);
    }
    return this;
  }

  clearContext() {
    try {
      const contextKey = this.getContextKey();
      this.contextMap.delete(contextKey);
    } catch (err) {
      console.error('Error clearing context:', err.message);
    }
    return this;
  }

  getCurrentContext() {
    try {
      const contextKey = this.getContextKey();
      return this.contextMap.get(contextKey) || this.defaultContext;
    } catch (err) {
      return this.defaultContext;
    }
  }

  getContextKey() {
    try {
      if (global.asyncLocalStorage && global.asyncLocalStorage.getStore) {
        const store = global.asyncLocalStorage.getStore();
        if (store && store.contextId) return store.contextId;
      }
    } catch (error) {
      // Fallback
    }
    return process.pid.toString();
  }

  // Prepare log data - with recursion protection
  prepareLogData(message, meta = {}) {
    try {
      // Convert message to string if it's an object
      let logMessage = message;
      let logMeta = {};

      // Safely copy meta
      try {
        logMeta = { ...meta };
      } catch (err) {
        logMeta = { metaError: 'Could not copy meta' };
      }

      if (message === null) {
        logMessage = 'null';
      } else if (message === undefined) {
        logMessage = 'undefined';
      } else if (typeof message === 'object') {
        if (message instanceof Error) {
          logMessage = message.message;
          logMeta = {
            ...logMeta,
            error: message.message,
            stack: message.stack,
            name: message.name,
            ...(message.code && { code: message.code })
          };
        } else {
          // For objects, make them part of meta
          logMessage = 'Object log';
          try {
            logMeta = {
              ...logMeta,
              data: safeSerialize(message)
            };
          } catch (err) {
            logMeta.data = '[Serialization failed]';
          }
        }
      } else {
        logMessage = String(message);
      }

      // Add context - wrapped in try-catch
      let context = {};
      try {
        context = this.getCurrentContext();
      } catch (err) {
        // Ignore context errors
      }
      
      // Sanitize meta - wrapped in try-catch
      let sanitizedMeta = logMeta;
      try {
        sanitizedMeta = this.sanitizeMeta(safeSerialize(logMeta));
      } catch (err) {
        // If sanitization fails, use raw meta
      }

      return {
        message: logMessage,
        meta: {
          ...context,
          ...sanitizedMeta,
          environment: process.env.NODE_ENV || 'development',
          service: 'vortexhive-chat',
          pid: process.pid
        }
      };
    } catch (err) {
      // If prepareLogData fails completely, return safe defaults
      return {
        message: String(message || 'Log preparation failed'),
        meta: {
          error: 'Log preparation error',
          originalError: err.message
        }
      };
    }
  }

  info(message, meta = {}) {
    if (this.isLogging) return; // Prevent recursion
    
    try {
      this.isLogging = true;
      const { message: logMessage, meta: logMeta } = this.prepareLogData(message, meta);
      this.logger.info(logMessage, logMeta);
    } catch (err) {
      console.error('Logger.info error:', err.message);
    } finally {
      this.isLogging = false;
    }
  }

  error(message, meta = {}) {
    if (this.isLogging) {
      // If already logging, fall back to console to prevent recursion
      console.error('Logger error (recursive call prevented):', message, meta);
      return;
    }
    
    try {
      this.isLogging = true;
      const { message: logMessage, meta: logMeta } = this.prepareLogData(message, meta);
      
      // Handle error objects in meta
      if (meta instanceof Error) {
        logMeta.error = meta.message;
        logMeta.stack = meta.stack;
        logMeta.name = meta.name;
        if (meta.code) logMeta.code = meta.code;
      } else if (meta && meta.error instanceof Error) {
        logMeta.errorMessage = meta.error.message;
        logMeta.errorStack = meta.error.stack;
        logMeta.errorName = meta.error.name;
        if (meta.error.code) logMeta.errorCode = meta.error.code;
      }
      
      this.logger.error(logMessage, logMeta);
    } catch (err) {
      console.error('Logger.error error:', err.message, 'Original:', message);
    } finally {
      this.isLogging = false;
    }
  }

  warn(message, meta = {}) {
    if (this.isLogging) return; // Prevent recursion
    
    try {
      this.isLogging = true;
      const { message: logMessage, meta: logMeta } = this.prepareLogData(message, meta);
      this.logger.warn(logMessage, logMeta);
    } catch (err) {
      console.error('Logger.warn error:', err.message);
    } finally {
      this.isLogging = false;
    }
  }

  debug(message, meta = {}) {
    if (this.isLogging) return; // Prevent recursion
    
    try {
      this.isLogging = true;
      const { message: logMessage, meta: logMeta } = this.prepareLogData(message, meta);
      this.logger.debug(logMessage, logMeta);
    } catch (err) {
      console.error('Logger.debug error:', err.message);
    } finally {
      this.isLogging = false;
    }
  }

  audit(action, meta = {}) {
    if (this.isLogging) return;
    
    try {
      this.isLogging = true;
      const { meta: logMeta } = this.prepareLogData(action, meta);
      this.logger.info('AUDIT', {
        ...logMeta,
        action,
        audit: true
      });
    } catch (err) {
      console.error('Logger.audit error:', err.message);
    } finally {
      this.isLogging = false;
    }
    return this;
  }

  performance(operation, duration, meta = {}) {
    if (this.isLogging) return;
    
    try {
      this.isLogging = true;
      const { meta: logMeta } = this.prepareLogData(operation, meta);
      this.logger.info('PERFORMANCE', {
        ...logMeta,
        operation,
        duration: typeof duration === 'number' ? `${duration}ms` : String(duration),
        performanceMetric: true
      });
    } catch (err) {
      console.error('Logger.performance error:', err.message);
    } finally {
      this.isLogging = false;
    }
    return this;
  }

  security(event, meta = {}) {
    if (this.isLogging) return;
    
    try {
      this.isLogging = true;
      const { meta: logMeta } = this.prepareLogData(event, meta);
      this.logger.warn('SECURITY', {
        ...logMeta,
        securityEvent: event,
        severity: meta.severity || 'medium',
        securityAlert: true
      });
    } catch (err) {
      console.error('Logger.security error:', err.message);
    } finally {
      this.isLogging = false;
    }
    return this;
  }

  sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object') return meta;

    let sanitized;
    try {
      sanitized = JSON.parse(JSON.stringify(meta));
    } catch (error) {
      sanitized = { ...meta };
    }

    const sensitiveFields = [
      'password', 'token', 'secret', 'key', 'authorization', 'credit_card',
      'ssn', 'pin', 'apikey', 'api_key', 'auth', 'authentication', 'credential',
      'accesstoken', 'refreshtoken', 'access_token', 'refresh_token', 'jwt'
    ];

    const sanitizeObject = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      
      try {
        Object.keys(obj).forEach(key => {
          const lowerKey = key.toLowerCase();
          const isSensitive = sensitiveFields.some(field => lowerKey.includes(field));
          
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeObject(obj[key]);
          } else if (isSensitive && typeof obj[key] === 'string') {
            obj[key] = '[REDACTED]';
          }
        });
      } catch (err) {
        // Ignore sanitization errors
      }
    };

    sanitizeObject(sanitized);
    return sanitized;
  }

  child(defaultMeta) {
    const childLogger = Object.create(this);
    childLogger.logger = this.logger.child(safeSerialize(defaultMeta));
    childLogger.defaultContext = { 
      ...this.defaultContext, 
      ...safeSerialize(defaultMeta) 
    };
    return childLogger;
  }

  startTimer() {
    const start = Date.now();
    return {
      done: (operation, meta = {}) => {
        const duration = Date.now() - start;
        this.performance(operation, duration, meta);
        return duration;
      }
    };
  }
}

// Create and export singleton instance
const logger = new EnterpriseLogger();

module.exports = logger;
module.exports.EnterpriseLogger = EnterpriseLogger;
module.exports.logger = logger;