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
    return value.map(item => safeSerialize(item, maxDepth, currentDepth + 1));
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

    // File format without context binding issues
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
    logger.info('Logger initialized successfully', {
      environment: process.env.NODE_ENV || 'development',
      logLevel: config.logging?.level || 'info',
      logsDirectory: logsDir
    });

    return logger;
  }

  // Context management
  setContext(context) {
    const contextKey = this.getContextKey();
    const existingContext = this.contextMap.get(contextKey) || {};
    this.contextMap.set(contextKey, {
      ...existingContext,
      ...context
    });
    return this;
  }

  clearContext() {
    const contextKey = this.getContextKey();
    this.contextMap.delete(contextKey);
    return this;
  }

  getCurrentContext() {
    const contextKey = this.getContextKey();
    return this.contextMap.get(contextKey) || this.defaultContext;
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

  // Prepare log data
  prepareLogData(message, meta = {}) {
    // Convert message to string if it's an object
    let logMessage = message;
    let logMeta = { ...meta };

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
        logMeta = {
          ...logMeta,
          data: safeSerialize(message)
        };
      }
    } else {
      logMessage = String(message);
    }

    // Add context
    const context = this.getCurrentContext();
    
    // Sanitize and serialize meta
    const sanitizedMeta = this.sanitizeMeta(safeSerialize(logMeta));

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
  }

  info(message, meta = {}) {
    const { message: logMessage, meta: logMeta } = this.prepareLogData(message, meta);
    this.logger.info(logMessage, logMeta);
  }

  error(message, meta = {}) {
    const { message: logMessage, meta: logMeta } = this.prepareLogData(message, meta);
    
    // Handle error objects in meta
    if (meta instanceof Error) {
      logMeta.error = meta.message;
      logMeta.stack = meta.stack;
      logMeta.name = meta.name;
      if (meta.code) logMeta.code = meta.code;
    } else if (meta.error instanceof Error) {
      logMeta.errorMessage = meta.error.message;
      logMeta.errorStack = meta.error.stack;
      logMeta.errorName = meta.error.name;
      if (meta.error.code) logMeta.errorCode = meta.error.code;
    }
    
    this.logger.error(logMessage, logMeta);
  }

  warn(message, meta = {}) {
    const { message: logMessage, meta: logMeta } = this.prepareLogData(message, meta);
    this.logger.warn(logMessage, logMeta);
  }

  debug(message, meta = {}) {
    const { message: logMessage, meta: logMeta } = this.prepareLogData(message, meta);
    this.logger.debug(logMessage, logMeta);
  }

  audit(action, meta = {}) {
    const { meta: logMeta } = this.prepareLogData(action, meta);
    this.logger.info('AUDIT', {
      ...logMeta,
      action,
      audit: true
    });
    return this;
  }

  performance(operation, duration, meta = {}) {
    const { meta: logMeta } = this.prepareLogData(operation, meta);
    this.logger.info('PERFORMANCE', {
      ...logMeta,
      operation,
      duration: typeof duration === 'number' ? `${duration}ms` : String(duration),
      performanceMetric: true
    });
    return this;
  }

  security(event, meta = {}) {
    const { meta: logMeta } = this.prepareLogData(event, meta);
    this.logger.warn('SECURITY', {
      ...logMeta,
      securityEvent: event,
      severity: meta.severity || 'medium',
      securityAlert: true
    });
    return this;
  }

  sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object') return meta;

    let sanitized;
    try {
      // Create a deep copy
      sanitized = JSON.parse(JSON.stringify(meta));
    } catch (error) {
      // If JSON fails, do shallow copy
      sanitized = { ...meta };
    }

    const sensitiveFields = [
      'password', 'token', 'secret', 'key', 'authorization', 'credit_card',
      'ssn', 'pin', 'apikey', 'api_key', 'auth', 'authentication', 'credential',
      'accesstoken', 'refreshtoken', 'access_token', 'refresh_token', 'jwt'
    ];

    const sanitizeObject = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      
      Object.keys(obj).forEach(key => {
        const lowerKey = key.toLowerCase();
        const isSensitive = sensitiveFields.some(field => lowerKey.includes(field));
        
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]);
        } else if (isSensitive && typeof obj[key] === 'string') {
          obj[key] = '[REDACTED]';
        }
      });
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

// Export both the instance and the class
module.exports = logger;
module.exports.EnterpriseLogger = EnterpriseLogger;
module.exports.logger = logger;