// config/config.js - Fixed Elasticsearch configuration
module.exports = {

  app: {
    environment: process.env.APP_ENVIRONMENT || 'development',
    url: process.env.APP_URL || 'http://localhost:3001',
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
    // Add SSL/domain support
    domain: process.env.DOMAIN || 'localhost',
    ssl: {
      enabled: process.env.SSL_ENABLED === 'true',
      forceHttps: process.env.FORCE_HTTPS === 'true',
      behindProxy: process.env.TRUST_PROXY === 'true'
    }
  },
  
  // Server Configuration
  server: {
    port: parseInt(process.env.SERVER_PORT || process.env.PORT || '3001'),
    host: process.env.HOST || '0.0.0.0',
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigin: process.env.CORS_ORIGIN || '*',
    socketPath: process.env.SOCKET_PATH || '/socket.io',
    socketUrl: process.env.SOCKET_URL || 'http://localhost:5000',
    // Add proxy configuration
    proxy: {
      enabled: process.env.TRUST_PROXY === 'true',
      protocol: process.env.PROTOCOL || 'http',
      publicUrl: process.env.APP_URL || process.env.SERVER_URL
    }
  },

  // Database Configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'chatserver',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || '',
    dialect: process.env.DB_DIALECT || 'postgres',
    logging: process.env.DB_LOGGING === 'true',
    alter: process.env.DB_ALTER === 'true',
    queryTimeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000'),
    pool: {
      max: parseInt(process.env.DB_POOL_MAX || '10'),
      min: parseInt(process.env.DB_POOL_MIN || '2'),
      acquire: parseInt(process.env.DB_POOL_ACQUIRE || '30000'),
      idle: parseInt(process.env.DB_POOL_IDLE || '10000')
    }
  },

  // Redis Configuration
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0'),
    url: process.env.REDIS_URL || undefined,
    retryStrategy: (times) => {
      if (times > 10) return null;
      return Math.min(times * 100, 3000);
    }
  },

  // Authentication
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    jwtExpiry: process.env.JWT_EXPIRY || '30d',
    jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '90d',
    validApiKeys: (process.env.VALID_API_KEYS || '').split(',').filter(k => k),
    syncSecretKey: process.env.SYNC_SECRET_KEY
  },

  // External OAuth
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    }
  },

  // Push Notifications
  notifications: {
    enabled: process.env.NOTIFICATIONS_ENABLED === 'true',
    fcm: {
      enabled: !!process.env.FIREBASE_CREDENTIALS,
      credentials: process.env.FIREBASE_CREDENTIALS
    },
    apn: {
      enabled: !!process.env.APN_KEY_PATH,
      keyPath: process.env.APN_KEY_PATH,
      keyId: process.env.APN_KEY_ID,
      teamId: process.env.APN_TEAM_ID,
      bundleId: process.env.APN_BUNDLE_ID,
      production: process.env.NODE_ENV === 'production'
    }
  },

  // File Upload
  fileUpload: {
    provider: process.env.FILE_UPLOAD_PROVIDER || 'local',
    maxSize: parseInt(process.env.MAX_FILE_SIZE || '10485760'), // 10MB
    allowedTypes: [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'audio/mpeg',
      'audio/wav',
      'application/pdf'
    ],
    s3: {
      bucket: process.env.S3_BUCKET_NAME,
      region: process.env.AWS_REGION,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  },

  // FIXED: Logging Configuration with optional Elasticsearch
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    elasticsearch: {
      enabled: !!process.env.ELASTICSEARCH_URL,
      url: process.env.ELASTICSEARCH_URL || null,
      user: process.env.ELASTICSEARCH_USER || null,
      password: process.env.ELASTICSEARCH_PASSWORD || null
    },
    retention: {
      days: parseInt(process.env.LOG_RETENTION_DAYS || '30')
    }
  },

  // Rate Limiting
  rateLimiting: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'), // 1 minute
    max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    skipSuccessfulRequests: false,
    api: {
      max: parseInt(process.env.API_RATE_LIMIT_MAX || '1000')
    },
    auth: {
      max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5')
    },
    upload: {
      max: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || '10')
    }
  },

  // Sync Configuration
  sync: {
    userSyncInterval: parseInt(process.env.USER_SYNC_INTERVAL || '3600000'), // 1 hour
    batchSize: parseInt(process.env.SYNC_BATCH_SIZE || '100'),
    retryAttempts: parseInt(process.env.SYNC_RETRY_ATTEMPTS || '3')
  },

  // Queue Configuration
  queue: {
    messageProcessInterval: parseInt(process.env.QUEUE_MESSAGE_INTERVAL || '500'),
    presenceProcessInterval: parseInt(process.env.QUEUE_PRESENCE_INTERVAL || '1000'),
    notificationProcessInterval: parseInt(process.env.QUEUE_NOTIFICATION_INTERVAL || '2000'),
    offlineMessageTTL: parseInt(process.env.OFFLINE_MESSAGE_TTL || '604800') // 7 days
  },

  // Security
  security: {
    enableHelmet: process.env.ENABLE_HELMET !== 'false',
    trustProxy: process.env.TRUST_PROXY === 'true',
    sessionSecret: process.env.SESSION_SECRET || 'default-secret-change-this',
    encryptionKey: process.env.ENCRYPTION_KEY,
    hashRounds: parseInt(process.env.HASH_ROUNDS || '10'),
    // SSL/HTTPS security settings
    ssl: {
      behindProxy: process.env.TRUST_PROXY === 'true',
      hsts: {
        enabled: process.env.HSTS_ENABLED === 'true',
        maxAge: parseInt(process.env.HSTS_MAX_AGE || '31536000'), // 1 year
        includeSubDomains: process.env.HSTS_INCLUDE_SUBDOMAINS === 'true',
        preload: process.env.HSTS_PRELOAD === 'true'
      },
      forceHttps: process.env.FORCE_HTTPS === 'true'
    }
  },

  // SSL Configuration (for direct SSL if needed)
  ssl: {
    enabled: process.env.SSL_ENABLED === 'true',
    certificatePath: process.env.SSL_CERT_PATH,
    privateKeyPath: process.env.SSL_KEY_PATH,
    caPath: process.env.SSL_CA_PATH,
    passphrase: process.env.SSL_PASSPHRASE,
    // TLS options
    secureProtocol: process.env.SSL_SECURE_PROTOCOL || 'TLSv1_2_method',
    ciphers: process.env.SSL_CIPHERS,
    honorCipherOrder: process.env.SSL_HONOR_CIPHER_ORDER === 'true',
    // Client certificate settings (if needed)
    requestCert: process.env.SSL_REQUEST_CERT === 'true',
    rejectUnauthorized: process.env.SSL_REJECT_UNAUTHORIZED !== 'false',
    // Development settings
    allowSelfSigned: process.env.SSL_ALLOW_SELF_SIGNED === 'true'
  },

  // Monitoring
  monitoring: {
    healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000'),
    metrics: {
      enabled: process.env.ENABLE_METRICS === 'true',
      port: parseInt(process.env.METRICS_PORT || '9090')
    },
    apm: {
      enabled: !!process.env.APM_SERVER_URL,
      serverUrl: process.env.APM_SERVER_URL,
      serviceName: process.env.APM_SERVICE_NAME || 'chat-server'
    },
    sentry: {
      enabled: !!process.env.SENTRY_DSN,
      dsn: process.env.SENTRY_DSN
    }
  },

  // Feature Flags
  features: {
    typing: process.env.FEATURE_TYPING !== 'false',
    readReceipts: process.env.FEATURE_READ_RECEIPTS !== 'false',
    deliveryReceipts: process.env.FEATURE_DELIVERY_RECEIPTS !== 'false',
    groupChats: process.env.FEATURE_GROUP_CHATS !== 'false',
    mediaMessages: process.env.FEATURE_MEDIA_MESSAGES !== 'false',
    offlineMessaging: process.env.FEATURE_OFFLINE_MESSAGING !== 'false',
    pushNotifications: process.env.FEATURE_PUSH_NOTIFICATIONS !== 'false',
    userSync: process.env.FEATURE_USER_SYNC !== 'false'
  },

  // Cluster Configuration
  cluster: {
    enabled: process.env.DISABLE_CLUSTER !== 'true' && process.env.NODE_ENV === 'production',
    workerCount: parseInt(process.env.WORKER_COUNT || require('os').cpus().length.toString())
  },

  // Bull Board UI Config
  bullBoard: {
    enabled: process.env.BULL_BOARD_ENABLED === 'true',
    port: parseInt(process.env.BULL_BOARD_PORT || '3002'),
    basePath: process.env.BULL_BOARD_BASE_PATH || '/admin/queues',
    publicUrl: process.env.BULL_BOARD_PUBLIC_URL || `http://localhost:${process.env.BULL_BOARD_PORT || '3002'}`
  },

  // DLQ Configuration
  dlqQueueName: process.env.DLQ_QUEUE_NAME || 'dlq-queue',

  // Worker Processing Config
  worker: {
    retries: parseInt(process.env.WORKER_RETRIES || '5'),
    backoffDelay: parseInt(process.env.WORKER_BACKOFF || '1000'),
    breakerTimeout: parseInt(process.env.WORKER_BREAKER_TIMEOUT || '5000'),
    breakerThreshold: parseInt(process.env.WORKER_BREAKER_THRESHOLD || '50'),
    breakerReset: parseInt(process.env.WORKER_BREAKER_RESET || '30000'),
  },

  // External Services
  externalServices: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    virusScanApiKey: process.env.VIRUS_SCAN_API_KEY,
    smsFallbackApiKey: process.env.SMS_FALLBACK_API_KEY,
    analyticsApiKey: process.env.ANALYTICS_API_KEY
  },

  // Performance
  performance: {
    socketConnectionLimit: parseInt(process.env.SOCKET_CONNECTION_LIMIT || '10000'),
    messageBatchSize: parseInt(process.env.MESSAGE_BATCH_SIZE || '100'),
    notificationBatchSize: parseInt(process.env.NOTIFICATION_BATCH_SIZE || '500'),
    cacheTTL: parseInt(process.env.CACHE_TTL || '3600')
  },

  // Webhooks
  webhooks: {
    enabled: process.env.WEBHOOKS_ENABLED === 'true',
    secret: process.env.WEBHOOK_SECRET,
    timeout: parseInt(process.env.WEBHOOK_TIMEOUT || '30000')
  },

  // CORS Configuration (detailed)
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: (process.env.CORS_METHODS || 'GET,POST,PUT,DELETE,OPTIONS,PATCH').split(','),
    allowedHeaders: (process.env.CORS_ALLOWED_HEADERS || 'Content-Type,Authorization,X-Requested-With,X-API-Key').split(','),
    exposedHeaders: (process.env.CORS_EXPOSED_HEADERS || 'X-Correlation-ID,X-RateLimit-Limit,X-RateLimit-Remaining').split(','),
    maxAge: parseInt(process.env.CORS_MAX_AGE || '86400'),
    credentials: process.env.CORS_CREDENTIALS === 'true'
  },

  // Socket.IO Configuration
  socketio: {
    transports: (process.env.SOCKET_TRANSPORTS || 'websocket,polling').split(','),
    pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT || '30000'),
    pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL || '10000'),
    maxBuffer: parseInt(process.env.SOCKET_MAX_BUFFER || '1000000'),
    path: process.env.SOCKET_PATH || '/socket.io'
  },

  // Development/Testing
  development: {
    testMode: process.env.TEST_MODE === 'true',
    mockExternalServices: process.env.MOCK_EXTERNAL_SERVICES === 'true',
    debugMode: process.env.DEBUG_MODE === 'true',
    verboseLogging: process.env.VERBOSE_LOGGING === 'true'
  }
};