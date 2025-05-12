// utils/logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { ElasticsearchTransport } = require('winston-elasticsearch');
const config = require('../config/config');

class EnterpriseLogger {
  constructor() {
    this.logger = this.createLogger();
    this.contextMap = new Map();
  }

  createLogger() {
    const format = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
      winston.format.errors({ stack: true }),
      winston.format.splat(),
      winston.format.json(),
      winston.format.printf(info => {
        const { timestamp, level, message, ...meta } = info;
        const context = this.contextMap.get(process.pid) || {};
        return JSON.stringify({
          timestamp,
          level,
          message,
          ...context,
          ...meta,
          environment: config.app.environment,
          service: config.app.name,
          version: config.app.version
        });
      })
    );

    const transports = [];

    // Console transport for non-production environments
    if (config.app.environment !== 'production') {
      transports.push(new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      }));
    }

    // Daily rotate file transports
    transports.push(new DailyRotateFile({
      filename: 'logs/application-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: `${config.logging.retention.days}d`,
      level: config.logging.level
    }));

    transports.push(new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: `${config.logging.retention.days}d`,
      level: 'error'
    }));

    // Optional Elasticsearch transport
    if (config.logging.elasticsearch.enabled && config.logging.elasticsearch.url) {
      transports.push(new ElasticsearchTransport({
        level: config.logging.level,
        clientOpts: {
          node: config.logging.elasticsearch.url,
          auth: config.logging.elasticsearch.user ? {
            username: config.logging.elasticsearch.user,
            password: config.logging.elasticsearch.password
          } : undefined,
          tls: {
            rejectUnauthorized: false // Optional: make this configurable if needed
          }
        },
        indexPrefix: config.logging.elasticsearch.indexPrefix || 'chat-server-logs',
        dataStream: true
      }));
    }

    return winston.createLogger({
      level: config.logging.level,
      format,
      transports,
      exceptionHandlers: [
        new winston.transports.File({ filename: 'logs/exceptions.log' })
      ],
      rejectionHandlers: [
        new winston.transports.File({ filename: 'logs/rejections.log' })
      ]
    });
  }

  // Context management
  setContext(context) {
    this.contextMap.set(process.pid, {
      ...this.contextMap.get(process.pid),
      ...context
    });
  }

  clearContext() {
    this.contextMap.delete(process.pid);
  }

  // Logging methods
  info(message, meta = {}) { this.logger.info(message, this.sanitizeMeta(meta)); }
  error(message, meta = {}) { this.logger.error(message, this.sanitizeMeta(this.processError(meta))); }
  warn(message, meta = {}) { this.logger.warn(message, this.sanitizeMeta(meta)); }
  debug(message, meta = {}) { this.logger.debug(message, this.sanitizeMeta(meta)); }

  audit(action, meta = {}) {
    this.logger.info('AUDIT', { ...this.sanitizeMeta(meta), action, timestamp: new Date().toISOString() });
  }

  performance(operation, duration, meta = {}) {
    this.logger.info('PERFORMANCE', { ...this.sanitizeMeta(meta), operation, duration, timestamp: new Date().toISOString() });
  }

  security(event, meta = {}) {
    this.logger.warn('SECURITY', { ...this.sanitizeMeta(meta), event, timestamp: new Date().toISOString(), severity: meta.severity || 'medium' });
  }

  processError(meta) {
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
    return meta;
  }

  sanitizeMeta(meta) {
    const sanitized = { ...meta };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization', 'credit_card', 'ssn', 'pin'];
    Object.keys(sanitized).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      }
    });
    return sanitized;
  }

  child(defaultMeta) {
    const childLogger = Object.create(this);
    childLogger.logger = this.logger.child(defaultMeta);
    return childLogger;
  }

  startTimer() {
    const start = Date.now();
    return { done: (operation, meta = {}) => this.performance(operation, Date.now() - start, meta) };
  }
}

module.exports = new EnterpriseLogger();
