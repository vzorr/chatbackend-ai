// bootstrap/validators/config-schema.js
const Joi = require('joi');
const { logger } = require('../../utils/logger');

const configSchema = Joi.object({
  app: Joi.object({
    environment: Joi.string().default('development')
  }).required(),
  
  server: Joi.object({
    port: Joi.number().port().default(3001),
    host: Joi.string().hostname().default('0.0.0.0'),
    nodeEnv: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
    corsOrigin: Joi.string().default('*'),
    socketPath: Joi.string().default('/socket.io')
  }).required(),
  
  database: Joi.object({
    host: Joi.string().default('localhost'),
    port: Joi.number().default(5432),
    name: Joi.string().default('chatserver'),
    user: Joi.string().default('postgres'),
    password: Joi.string().allow('').default(''),
    dialect: Joi.string().valid('postgres', 'mysql', 'sqlite').default('postgres'),
    logging: Joi.boolean().optional(),
    pool: Joi.object({
      max: Joi.number().default(10),
      min: Joi.number().default(2),
      acquire: Joi.number().default(30000),
      idle: Joi.number().default(10000)
    }).optional()
  }).required(),
  
  redis: Joi.object({
    host: Joi.string().default('localhost'),
    port: Joi.number().port().default(6379),
    password: Joi.string().optional(),
    db: Joi.number().default(0),
    retryStrategy: Joi.function().optional()
  }).required(),
  
  auth: Joi.object({
    jwtSecret: Joi.string().optional(),
    jwtRefreshSecret: Joi.string().optional(),
    jwtExpiry: Joi.string().default('30d'),
    jwtRefreshExpiry: Joi.string().default('90d'),
    validApiKeys: Joi.array().items(Joi.string()).default([]),
    syncSecretKey: Joi.string().optional()
  }).required(),
  
  notifications: Joi.object({
    fcm: Joi.object({
      enabled: Joi.boolean().default(false),
      credentials: Joi.string().optional()
    }).optional(),
    apn: Joi.object({
      enabled: Joi.boolean().default(false),
      keyPath: Joi.string().optional(),
      keyId: Joi.string().optional(),
      teamId: Joi.string().optional(),
      bundleId: Joi.string().optional(),
      production: Joi.boolean().default(false)
    }).optional()
  }).optional(),
  
  fileUpload: Joi.object({
    provider: Joi.string().valid('local', 's3').default('local'),
    maxSize: Joi.number().default(10485760),
    allowedTypes: Joi.array().items(Joi.string()).default([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'audio/mpeg',
      'audio/wav',
      'application/pdf'
    ]),
    s3: Joi.object({
      bucket: Joi.string().optional(),
      region: Joi.string().optional(),
      accessKeyId: Joi.string().optional(),
      secretAccessKey: Joi.string().optional()
    }).optional()
  }).optional(),
  
  logging: Joi.object({
    level: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
    elasticsearch: Joi.object({
      enabled: Joi.boolean().default(false),
      url: Joi.string().optional(),
      user: Joi.string().optional(),
      password: Joi.string().optional()
    }).optional(),
    retention: Joi.object({
      days: Joi.number().default(30)
    }).optional()
  }).optional(),
  
  rateLimiting: Joi.object({
    windowMs: Joi.number().default(900000),
    max: Joi.number().default(1000),
    skipSuccessfulRequests: Joi.boolean().default(false)
  }).required(),
  
  sync: Joi.object({
    userSyncInterval: Joi.number().default(3600000),
    batchSize: Joi.number().default(100),
    retryAttempts: Joi.number().default(3)
  }).optional(),
  
  queue: Joi.object({
    messageProcessInterval: Joi.number().default(500),
    presenceProcessInterval: Joi.number().default(1000),
    notificationProcessInterval: Joi.number().default(2000),
    offlineMessageTTL: Joi.number().default(604800)
  }).optional(),
  
  security: Joi.object({
    enableHelmet: Joi.boolean().default(true),
    trustProxy: Joi.boolean().default(false),
    sessionSecret: Joi.string().default('default-secret-change-this'),
    encryptionKey: Joi.string().optional(),
    hashRounds: Joi.number().default(10)
  }).required(),
  
  monitoring: Joi.object({
    healthCheckInterval: Joi.number().default(30000),
    metrics: Joi.object({
      enabled: Joi.boolean().default(false),
      port: Joi.number().default(9090)
    }).optional(),
    apm: Joi.object({
      enabled: Joi.boolean().default(false),
      serverUrl: Joi.string().optional(),
      serviceName: Joi.string().default('chat-server')
    }).optional()
  }).optional(),
  
  features: Joi.object({
    typing: Joi.boolean().default(true),
    readReceipts: Joi.boolean().default(true),
    deliveryReceipts: Joi.boolean().default(true),
    groupChats: Joi.boolean().default(true),
    mediaMessages: Joi.boolean().default(true),
    offlineMessaging: Joi.boolean().default(true),
    pushNotifications: Joi.boolean().default(true),
    userSync: Joi.boolean().default(true)
  }).optional(),
  
  cluster: Joi.object({
    enabled: Joi.boolean().default(false),
    workerCount: Joi.number().min(1).default(1)
  }).optional(),
  
  bullBoard: Joi.object({
    enabled: Joi.boolean().default(false),
    port: Joi.number().default(3002),
    basePath: Joi.string().default('/admin/queues'),
    publicUrl: Joi.string().optional()
  }).optional(),
  
  dlqQueueName: Joi.string().default('dlq-queue'),
  
  worker: Joi.object({
    retries: Joi.number().default(5),
    backoffDelay: Joi.number().default(1000),
    breakerTimeout: Joi.number().default(5000),
    breakerThreshold: Joi.number().default(50),
    breakerReset: Joi.number().default(30000)
  }).optional()
});

async function validateConfig(config) {
  const startTime = Date.now();
  logger.info('🔍 [Config] Validating configuration schema...');
  
  try {
    const { error, value } = configSchema.validate(config, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: true
    });
    
    if (error) {
      const errors = error.details.map(detail => ({
        path: detail.path.join('.'),
        message: detail.message
      }));
      
      logger.error('❌ [Config] Configuration validation failed', {
        errors,
        count: errors.length
      });
      
      throw new Error(`Configuration validation failed: ${errors.map(e => `${e.path}: ${e.message}`).join(', ')}`);
    }
    
    const duration = Date.now() - startTime;
    logger.info('✅ [Config] Configuration validated successfully', {
      duration: `${duration}ms`
    });
    
    return value;
  } catch (error) {
    logger.error('❌ [Config] Configuration validation error', {
      error: error.message
    });
    throw error;
  }
}

module.exports = { validateConfig };