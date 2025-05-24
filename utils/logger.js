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
      winston.format.timestamp({ format: () => new Date().toISOString() }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json()
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

    // Daily rotate file transports with custom format
    const fileFormat = winston.format.combine(
      winston.format.timestamp({ format: () => new Date().toISOString() }),
      winston.format.errors({ stack: true }),
      winston.format.json(),
      winston.format.printf(info => {
        const { timestamp, level, message, ...meta } = info;
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

    transports.push(new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: `${config.logging?.retention?.days || 30}d`,
      level: config.logging?.level || 'info',
      format: fileFormat
    }));

    transports.push(new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: `${config.logging?.retention?.days || 30}d`,
      level: 'error',
      format: fileFormat
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
          transformer: (logData) => {
            const { timestamp, level, message, ...meta } = logData;
            
            // Get context from the logger instance
            const currentContext = this.getCurrentContext();
            
            // Merge all metadata
            const allMeta = {
              ...currentContext,
              ...meta,
              environment: process.env.NODE_ENV || 'development',
              service: 'vortexhive-chat',
              version: process.env.npm_package_version || '1.0.0'
            };
            
            // Remove duplicate fields that would conflict
            delete allMeta.timestamp;
            delete allMeta.level;
            delete allMeta.message;
            
            // Flatten the metadata to avoid nested object conflicts
            const flattenedMeta = flattenObject(allMeta);
            
            return {
              '@timestamp': new Date(timestamp || new Date()).toISOString(),
              message: message || '',
              severity: level || 'info',
              // Don't nest under 'fields' - put flattened fields at root
              ...flattenedMeta
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

    return String(message);
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

  // Get the current context
  getCurrentContext() {
    const contextKey = this.getContextKey();
    return this.contextMap.get(contextKey) || this.defaultContext;
  }

  // Get context key - could be request ID, process ID, or async context
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
      audit: true
    });
    return this;
  }

  performance(operation, duration, meta = {}) {
    this.logger.info('PERFORMANCE', {
      ...this.sanitizeMeta(meta),
      operation,
      duration: typeof duration === 'number' ? `${duration}ms` : String(duration),
      performanceMetric: true
    });
    return this;
  }

  security(event, meta = {}) {
    this.logger.warn('SECURITY', {
      ...this.sanitizeMeta(meta),
      securityEvent: event,
      severity: meta.severity || 'medium',
      securityAlert: true
    });
    return this;
  }

  processError(meta) {
    if (!meta) return {};

    if (meta instanceof Error) {
      return {
        errorMessage: meta.message,
        errorStack: meta.stack,
        errorCode: meta.code,
        errorName: meta.name
      };
    }

    if (meta.error instanceof Error) {
      return {
        ...meta,
        errorMessage: meta.error.message,
        errorStack: meta.error.stack,
        errorCode: meta.error.code,
        errorName: meta.error.name
      };
    }

    if (meta.error && typeof meta.error === 'string') {
      return {
        ...meta,
        errorMessage: meta.error
      };
    }

    return meta;
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
      'ssn', 'pin', 'apiKey', 'api_key', 'auth', 'authentication', 'credential',
      'accessToken', 'refreshToken', 'access_token', 'refresh_token', 'jwt'
    ];

    const sanitizeObject = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(key => {
        const isSensitive = sensitiveFields.some(field =>
          key.toLowerCase().includes(field.toLowerCase())
        );
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
    childLogger.logger = this.logger.child(defaultMeta);
    childLogger.defaultContext = { ...this.defaultContext, ...defaultMeta };
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

const logger = new EnterpriseLogger();
module.exports = logger;