// bootstrap/validators/config-schema.js - Updated with enhanced file upload validation
const Joi = require('joi');
const { logger } = require('../../utils/logger');

const configSchema = Joi.object({
  app: Joi.object({
    environment: Joi.string().default('development'),
    url: Joi.string().uri().optional(),
    baseUrl: Joi.string().uri().optional(),
    domain: Joi.string().optional(),
    ssl: Joi.object({
      enabled: Joi.boolean().default(false),
      forceHttps: Joi.boolean().default(false),
      behindProxy: Joi.boolean().default(false)
    }).optional()
  }).required(),
  
  server: Joi.object({
    port: Joi.number().port().default(3001),
    host: Joi.string().hostname().default('0.0.0.0'),
    nodeEnv: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
    corsOrigin: Joi.string().default('*'),
    socketPath: Joi.string().default('/socket.io'),
    socketUrl: Joi.string().uri().optional(),
    proxy: Joi.object({
      enabled: Joi.boolean().default(false),
      protocol: Joi.string().valid('http', 'https').default('http'),
      publicUrl: Joi.string().uri().optional()
    }).optional()
  }).required(),
  
  database: Joi.object({
    host: Joi.string().default('localhost'),
    port: Joi.number().default(5432),
    name: Joi.string().default('chatserver'),
    user: Joi.string().default('postgres'),
    password: Joi.string().allow('').default(''),
    dialect: Joi.string().valid('postgres', 'mysql', 'sqlite').default('postgres'),
    logging: Joi.boolean().optional(),
    alter: Joi.boolean().optional(),
    queryTimeout: Joi.number().optional(),
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
    password: Joi.string().optional().allow(null),
    db: Joi.number().default(0),
    url: Joi.string().uri().optional().allow(null),
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
  
  oauth: Joi.object({
    google: Joi.object({
      clientId: Joi.string().optional(),
      clientSecret: Joi.string().optional()
    }).optional()
  }).optional(),
  
  notifications: Joi.object({
    enabled: Joi.boolean().default(false),
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
  
  // UPDATED: Enhanced file upload validation
  fileUpload: Joi.object({
    enabled: Joi.boolean().default(true),
    provider: Joi.string().valid('local', 's3').default('local'),
    uploadDir: Joi.string().default('./uploads'),
    maxFileSize: Joi.number().default(10485760), // 10MB
    maxBatchFiles: Joi.number().min(1).max(20).default(5),
    
    // Support both simple array and categorized object
    allowedTypes: Joi.alternatives().try(
      // Simple array of MIME types
      Joi.array().items(Joi.string()),
      // Categorized object
      Joi.object({
        images: Joi.array().items(Joi.string()).default(['jpeg', 'jpg', 'png', 'gif', 'webp']),
        audio: Joi.array().items(Joi.string()).default(['mp3', 'wav', 'ogg', 'm4a', 'aac']),
        documents: Joi.array().items(Joi.string()).default(['pdf', 'doc', 'docx', 'txt', 'zip', 'rar'])
      })
    ).default([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'audio/mpeg',
      'audio/wav',
      'application/pdf'
    ]),
    
    allowedMimeTypes: Joi.array().items(Joi.string()).optional(),
    
    s3: Joi.object({
      bucket: Joi.string().optional(),
      region: Joi.string().default('us-east-1'),
      accessKeyId: Joi.string().optional(),
      secretAccessKey: Joi.string().optional(),
      endpoint: Joi.string().uri().optional(),
      forcePathStyle: Joi.boolean().default(false)
    }).optional()
  }).optional(),
  
  logging: Joi.object({
    level: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
    elasticsearch: Joi.object({
      enabled: Joi.boolean().default(false),
      url: Joi.string().uri().optional().allow(null),
      user: Joi.string().optional().allow(null),
      password: Joi.string().optional().allow(null)
    }).optional(),
    retention: Joi.object({
      days: Joi.number().default(30)
    }).optional()
  }).optional(),
  
  rateLimiting: Joi.object({
    windowMs: Joi.number().default(900000),
    max: Joi.number().default(1000),
    skipSuccessfulRequests: Joi.boolean().default(false),
    api: Joi.object({
      max: Joi.number().default(1000)
    }).optional(),
    auth: Joi.object({
      max: Joi.number().default(5)
    }).optional(),
    upload: Joi.object({
      max: Joi.number().default(10)
    }).optional()
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
    hashRounds: Joi.number().default(10),
    ssl: Joi.object({
      behindProxy: Joi.boolean().default(false),
      hsts: Joi.object({
        enabled: Joi.boolean().default(false),
        maxAge: Joi.number().default(31536000),
        includeSubDomains: Joi.boolean().default(false),
        preload: Joi.boolean().default(false)
      }).optional(),
      forceHttps: Joi.boolean().default(false)
    }).optional()
  }).required(),
  
  ssl: Joi.object({
    enabled: Joi.boolean().default(false),
    certificatePath: Joi.string().optional(),
    privateKeyPath: Joi.string().optional(),
    caPath: Joi.string().optional(),
    passphrase: Joi.string().optional(),
    secureProtocol: Joi.string().optional(),
    ciphers: Joi.string().optional(),
    honorCipherOrder: Joi.boolean().optional(),
    requestCert: Joi.boolean().optional(),
    rejectUnauthorized: Joi.boolean().optional(),
    allowSelfSigned: Joi.boolean().optional()
  }).optional(),
  
  monitoring: Joi.object({
    healthCheckInterval: Joi.number().default(30000),
    metrics: Joi.object({
      enabled: Joi.boolean().default(false),
      port: Joi.number().default(9090)
    }).optional(),
    apm: Joi.object({
      enabled: Joi.boolean().default(false),
      serverUrl: Joi.string().uri().optional(),
      serviceName: Joi.string().default('chat-server')
    }).optional(),
    sentry: Joi.object({
      enabled: Joi.boolean().default(false),
      dsn: Joi.string().uri().optional()
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
    userSync: Joi.boolean().default(true),
    fileUpload: Joi.boolean().default(true)
  }).optional(),
  
  cluster: Joi.object({
    enabled: Joi.boolean().default(false),
    workerCount: Joi.number().min(1).default(1)
  }).optional(),
  
  bullBoard: Joi.object({
    enabled: Joi.boolean().default(false),
    port: Joi.number().default(3002),
    basePath: Joi.string().default('/admin/queues'),
    publicUrl: Joi.string().uri().optional()
  }).optional(),
  
  dlqQueueName: Joi.string().default('dlq-queue'),
  
  worker: Joi.object({
    retries: Joi.number().default(5),
    backoffDelay: Joi.number().default(1000),
    breakerTimeout: Joi.number().default(5000),
    breakerThreshold: Joi.number().default(50),
    breakerReset: Joi.number().default(30000)
  }).optional(),
  
  externalServices: Joi.object().optional(),
  performance: Joi.object().optional(),
  webhooks: Joi.object().optional(),
  cors: Joi.object().optional(),
  socketio: Joi.object().optional(),
  development: Joi.object().optional()
});

async function validateConfig(config) {
  const startTime = Date.now();
  logger.info('🔍 [Config] Validating configuration schema...');
  
  try {
    const { error, value } = configSchema.validate(config, {
      abortEarly: false,
      allowUnknown: true,
      stripUnknown: false
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
      duration: `${duration}ms`,
      fileUploadEnabled: value.fileUpload?.enabled || false,
      fileUploadProvider: value.fileUpload?.provider || 'local'
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