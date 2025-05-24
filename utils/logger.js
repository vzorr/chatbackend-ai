// utils/logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { ElasticsearchTransport } = require('winston-elasticsearch');
const path = require('path');
const config = require('../config/config');


function flattenObject(obj, prefix = '', res = {}) {
  for (const key in obj) {
    if (!Object.hasOwn(obj, key)) continue;
    const value = obj[key];
    const prefixedKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      flattenObject(value, prefixedKey, res);
    } else {
      res[prefixedKey] = value;
    }
  }
  return res;
}

class EnterpriseLogger {
  constructor() {
    this.logger = this.createLogger();
    this.contextMap = new Map();
    this.defaultContext = {};
  }

  createLogger() {
    const format = winston.format.combine(
      winston.format.timestamp({ format: () => new Date().toISOString() }), // This already returns ISO format with T and Z
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json(),
      winston.format.printf(info => {
        const { timestamp, level, message, ...meta } = info;
        // Get context for current request/process
        const currentContext = this.getCurrentContext();
        return JSON.stringify({
          timestamp,
          level,
          message,
          ...currentContext,
          ...meta,
          environment: process.env.NODE_ENV || 'development',
          service: 'vortexhive-chat',
          version: process.env.npm_package_version || '1.0.0'
        });
      })
    );

    const transports = [];

    // Console transport for non-production environments
    if ((process.env.NODE_ENV || 'development') !== 'production') {
      transports.push(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }));
    }

    // Create logs directory if it doesn't exist
    const logsDir = path.join(process.cwd(), 'logs');
    try {
      require('fs').mkdirSync(logsDir, { recursive: true });
    } catch (err) {
      console.warn('Could not create logs directory:', err.message);
    }

    // Daily rotate file transports
    transports.push(new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: `${config.logging?.retention?.days || 30}d`,
      level: config.logging?.level || 'info'
    }));

    transports.push(new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: `${config.logging?.retention?.days || 30}d`,
      level: 'error'
    }));

    // Optional Elasticsearch transport
    if (config.logging?.elasticsearch?.enabled && config.logging?.elasticsearch?.url) {
      try {
        transports.push(new ElasticsearchTransport({
          level: config.logging?.level || 'info',
          clientOpts: {
            node: config.logging.elasticsearch.url,
            auth: config.logging.elasticsearch.user ? {
              username: config.logging.elasticsearch.user,
              password: config.logging.elasticsearch.password
            } : undefined,
            tls: {
              rejectUnauthorized: false
            }
          },
          indexPrefix: config.logging?.elasticsearch?.indexPrefix || 'chat-server-logs',
          dataStream: true,
          // ✅ Updated transformer using flatten
          transformer: (logData) => {
            const flattened = flattenObject(logData); // ✅ Uses your custom flatten function
            return {
              '@timestamp': new Date(logData.timestamp).toISOString(),
              message: logData.message,
              severity: logData.level,
              fields: flattened
            };
          }
        }));
      } catch (error) {
        console.warn('Failed to initialize Elasticsearch transport:', error.message);
      }
    }

    return winston.createLogger({
      level: config.logging?.level || 'info',
      format,
      transports,
      exceptionHandlers: [
        new DailyRotateFile({
          filename: 'logs/exceptions-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '30d'
        })
      ],
      rejectionHandlers: [
        new DailyRotateFile({
          filename: 'logs/rejections-%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxSize: '20m',
          maxFiles: '30d'
        })
      ],
      exitOnError: false
    });
  }

  // Format message properly
  formatMessage(message) {
    if (message === undefined) return 'undefined';
    if (message === null) return 'null';
    
    if (typeof message === 'object') {
      try {
        if (message instanceof Error) {
          return message.stack || message.message;
        }
        return JSON.stringify(message);
      } catch (error) {
        return '[Object could not be stringified]';
      }
    }
    
    return message;
  }

  // Context management
  setContext(context) {
    const contextKey = this.getContextKey();
    const existingContext = this.contextMap.get(contextKey) || {};
    this.contextMap.set(contextKey, {
      ...existingContext,
      ...context
    });
    return this; // For method chaining
  }

  clearContext() {
    const contextKey = this.getContextKey();
    this.contextMap.delete(contextKey);
    return this; // For method chaining
  }

  // Get the current context
  getCurrentContext() {
    const contextKey = this.getContextKey();
    return this.contextMap.get(contextKey) || this.defaultContext;
  }

  // Get context key - could be request ID, process ID, or async context
  getContextKey() {
    try {
      // If we have AsyncLocalStorage available (Node.js 12.17.0+), use it
      if (global.asyncLocalStorage && global.asyncLocalStorage.getStore) {
        const store = global.asyncLocalStorage.getStore();
        if (store && store.contextId) return store.contextId;
      }
    } catch (error) {
      // Fallback to process ID if AsyncLocalStorage is not available or errors
    }
    return process.pid.toString();
  }

  // Logging methods with improved object handling
  info(message, meta = {}) { 
    this.logger.info(this.formatMessage(message), this.sanitizeMeta(meta)); 
  }
  
  error(message, meta = {}) { 
    this.logger.error(this.formatMessage(message), this.sanitizeMeta(this.processError(meta))); 
  }
  
  warn(message, meta = {}) { 
    this.logger.warn(this.formatMessage(message), this.sanitizeMeta(meta)); 
  }
  
  debug(message, meta = {}) { 
    this.logger.debug(this.formatMessage(message), this.sanitizeMeta(meta)); 
  }

  audit(action, meta = {}) {
    this.logger.info('AUDIT', { 
      ...this.sanitizeMeta(meta), 
      action, 
      timestamp: new Date().toISOString(),
      audit: true
    });
    return this; // For method chaining
  }

  performance(operation, duration, meta = {}) {
    this.logger.info('PERFORMANCE', { 
      ...this.sanitizeMeta(meta), 
      operation, 
      duration: typeof duration === 'number' ? `${duration}ms` : duration, 
      timestamp: new Date().toISOString(),
      performanceMetric: true
    });
    return this; // For method chaining
  }

  security(event, meta = {}) {
    this.logger.warn('SECURITY', { 
      ...this.sanitizeMeta(meta), 
      event, 
      timestamp: new Date().toISOString(), 
      severity: meta.severity || 'medium',
      securityEvent: true
    });
    return this; // For method chaining
  }

  processError(meta) {
    if (!meta) return {};
    
    if (meta instanceof Error) {
      return {
        error: {
          message: meta.message,
          stack: meta.stack,
          code: meta.code,
          name: meta.name
        }
      };
    }
    
    if (meta.error instanceof Error) {
      return {
        ...meta,
        error: {
          message: meta.error.message,
          stack: meta.error.stack,
          code: meta.error.code,
          name: meta.error.name
        }
      };
    }
    
    // Handle error as string
    if (meta.error && typeof meta.error === 'string') {
      return {
        ...meta,
        error: {
          message: meta.error
        }
      };
    }
    
    return meta;
  }

  sanitizeMeta(meta) {
    if (!meta || typeof meta !== 'object') return meta;
    
    // Create a deep copy to avoid modifying the original
    let sanitized;
    try {
      sanitized = JSON.parse(JSON.stringify(meta));
    } catch (error) {
      // If circular structure or other JSON error, create shallow copy
      sanitized = { ...meta };
    }

    const sensitiveFields = [
      'password', 'token', 'secret', 'key', 'authorization', 'credit_card', 
      'ssn', 'pin', 'apiKey', 'api_key', 'auth', 'authentication', 'credential',
      'accessToken', 'refreshToken', 'access_token', 'refresh_token', 'jwt'
    ];
    
    // Recursive function to sanitize objects
    const sanitizeObject = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      
      Object.keys(obj).forEach(key => {
        // Check if this key contains a sensitive field name
        const isPasswordField = sensitiveFields.some(field => 
          key.toLowerCase().includes(field.toLowerCase())
        );
        
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          sanitizeObject(obj[key]); // Recurse into nested objects
        } else if (isPasswordField && typeof obj[key] === 'string') {
          // Redact sensitive data
          obj[key] = '[REDACTED]';
        }
      });
    };
    
    sanitizeObject(sanitized);
    return sanitized;
  }

  // Create a child logger with default metadata
  child(defaultMeta) {
    const childLogger = Object.create(this);
    childLogger.logger = this.logger.child(defaultMeta);
    childLogger.defaultContext = { ...this.defaultContext, ...defaultMeta };
    return childLogger;
  }

  // Timer utility for performance logging
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

// Create and export a singleton instance
const logger = new EnterpriseLogger();
module.exports = logger;
