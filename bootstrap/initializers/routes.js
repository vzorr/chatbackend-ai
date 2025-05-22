// bootstrap/initializers/routes.js
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

// Import route modules - matching your actual file names
const authRoutes = require('../../routes/auth');
const userRoutes = require('../../routes/user');  // Changed from 'users' to 'user'
const conversationRoutes = require('../../routes/conversation');  // Changed from 'conversations'
const messageRoutes = require('../../routes/message');  // Changed from 'messages'
const adminRoutes = require('../../routes/admin');
const notificationsRoutes = require('../../routes/notification');


async function setupRoutes(app) {
  const startTime = Date.now();
  logger.info('🔧 [Routes] Setting up application routes...');

  try {
    // Setup health and monitoring routes
    setupHealthRoutes(app);
    
    // Setup API routes
    setupAPIRoutes(app);
    
    // Setup file upload routes
    setupFileUploadRoutes(app);
    
    // Setup notification routes
    setupNotificationRoutes(app);
    
    // Setup metrics endpoint
    if (config.monitoring.metrics.enabled) {
      setupMetricsEndpoint(app);
    }
    
    // Setup webhook routes
    if (config.webhooks.enabled) {
      setupWebhookRoutes(app);
    }
    
    // Setup client SDK config endpoint
    setupClientConfigEndpoint(app);
    
    // Setup root route
    setupRootRoute(app);
    
    // Setup 404 handler (should be last)
    setup404Handler(app);
    
    const duration = Date.now() - startTime;
    logger.info('✅ [Routes] All routes setup completed', {
      duration: `${duration}ms`,
      routeGroups: 9,
      featuresEnabled: {
        metrics: config.monitoring.metrics.enabled,
        webhooks: config.webhooks.enabled
      }
    });
    
  } catch (error) {
    logger.error('❌ [Routes] Route setup failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

function setupHealthRoutes(app) {
  logger.info('🔧 [Routes] Setting up health check routes...');
  
  // Basic health check
  app.get('/health', async (req, res) => {
    const checkStartTime = Date.now();
    const health = await getHealthStatus();
    const checkDuration = Date.now() - checkStartTime;
    
    logger.info('🏥 [Routes] Health check performed', {
      status: health.status,
      duration: `${checkDuration}ms`,
      services: health.services
    });
    
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  });
  
  logger.info('✅ [Routes] Health check routes configured', {
    endpoints: ['/health']
  });
}

function setupAPIRoutes(app) {
  logger.info('🔧 [Routes] Setting up API routes...');
  
  // API v1 routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/conversations', conversationRoutes);
  app.use('/api/v1/messages', messageRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  
  logger.info('✅ [Routes] API routes configured', {
    version: 'v1',
    routes: ['auth', 'users', 'conversations', 'messages', 'admin', 'notifications' ]
  });
}

function setupFileUploadRoutes(app) {
  logger.info('🔧 [Routes] Setting up file upload routes...');
  
  const authMiddleware = require('../../middleware/authentication');
  const { createUploadMiddleware } = require('../../services/file-upload');
  const upload = createUploadMiddleware();
  
  app.post('/upload', 
    authMiddleware.authenticate.bind(authMiddleware),
    upload.single('file'), 
    (req, res, next) => {
      if (!req.file) {
        logger.warn('⚠️ [Routes] File upload attempted without file', { 
          correlationId: req.correlationId 
        });
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_REQUIRED',
            message: 'No file uploaded'
          }
        });
      }

      const fileUrl = req.file.location || 
        `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;

      logger.info('✅ [Routes] File uploaded successfully', {
        correlationId: req.correlationId,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: req.file.mimetype,
        fileUrl: fileUrl
      });

      res.json({
        success: true,
        fileUrl,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileType: req.file.mimetype
      });
    }
  );
  
  logger.info('✅ [Routes] File upload routes configured', {
    endpoints: ['/upload']
  });
}

function setupNotificationRoutes(app) {
  logger.info('🔧 [Routes] Setting up notification routes...');
  
  const authMiddleware = require('../../middleware/authentication');
  const notificationManager = require('../../services/notifications/notificationManager');
  
  app.post('/api/v1/notifications/send',
    authMiddleware.authenticate.bind(authMiddleware),
    authMiddleware.authorize('admin'),
    async (req, res, next) => {
      try {
        const { userId, title, body, data } = req.body;
        
        if (!userId || !title) {
          logger.warn('⚠️ [Routes] Invalid notification request', {
            missingFields: !userId ? 'userId' : 'title',
            correlationId: req.correlationId
          });
          
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'userId and title are required'
            }
          });
        }

        const result = await notificationManager.sendNotification(userId, {
          type: 'admin_notification',
          title,
          body,
          data
        });

        logger.info('✅ [Routes] Notification sent successfully', {
          userId,
          title,
          correlationId: req.correlationId
        });

        res.json({
          success: true,
          result
        });
      } catch (error) {
        logger.error('❌ [Routes] Failed to send notification', {
          error: error.message,
          correlationId: req.correlationId
        });
        next(error);
      }
    }
  );

  app.post('/api/v1/notifications/batch',
    authMiddleware.authenticate.bind(authMiddleware),
    authMiddleware.authorize('admin'),
    async (req, res, next) => {
      try {
        const { notifications } = req.body;
        
        if (!Array.isArray(notifications) || notifications.length === 0) {
          logger.warn('⚠️ [Routes] Invalid batch notification request', {
            correlationId: req.correlationId
          });
          
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_REQUEST',
              message: 'notifications array is required'
            }
          });
        }

        const results = await notificationManager.batchSendNotifications(notifications);

        logger.info('✅ [Routes] Batch notifications sent', {
          count: notifications.length,
          correlationId: req.correlationId
        });

        res.json({
          success: true,
          results
        });
      } catch (error) {
        logger.error('❌ [Routes] Failed to send batch notifications', {
          error: error.message,
          correlationId: req.correlationId
        });
        next(error);
      }
    }
  );
  
  logger.info('✅ [Routes] Notification routes configured', {
    endpoints: ['/api/v1/notifications/send', '/api/v1/notifications/batch']
  });
}

function setupRootRoute(app) {
  logger.info('🔧 [Routes] Setting up root route...');
  
  app.get('/', (req, res) => {
    res.json({
      name: 'VortexHive Chat API',
      status: 'online',
      version: process.env.npm_package_version || '1.0.0',
      environment: config.server.nodeEnv,
      features: config.features,
      health: `${req.protocol}://${req.get('host')}/health`
    });
  });
  
  logger.info('✅ [Routes] Root route configured');
}

function setup404Handler(app) {
  logger.info('🔧 [Routes] Setting up 404 handler...');
  
  app.use((req, res, next) => {
    logger.warn('⚠️ [Routes] 404 Not Found', {
      method: req.method,
      url: req.originalUrl,
      correlationId: req.correlationId,
      ip: req.ip
    });

    res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'The requested resource was not found',
        path: req.originalUrl
      }
    });
  });
  
  logger.info('✅ [Routes] 404 handler configured');
}

function setupMetricsEndpoint(app) {
  logger.info('🔧 [Routes] Setting up metrics endpoint...');
  
  const promClient = require('prom-client');
  
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', promClient.register.contentType);
      res.end(await promClient.register.metrics());
      
      logger.debug('📊 [Routes] Metrics endpoint accessed', {
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
    } catch (error) {
      logger.error('❌ [Routes] Error generating metrics', {
        error: error.message
      });
      res.status(500).json({
        error: 'Failed to generate metrics'
      });
    }
  });
  
  logger.info('✅ [Routes] Metrics endpoint configured', {
    path: '/metrics'
  });
}

function setupWebhookRoutes(app) {
  logger.info('🔧 [Routes] Setting up webhook routes...');
  
  app.post('/webhooks/:provider', async (req, res, next) => {
    try {
      const provider = req.params.provider;
      
      logger.info('🪝 [Routes] Webhook received', {
        provider,
        correlationId: req.correlationId,
        contentType: req.get('content-type')
      });
      
      // You can implement webhook handler service here
      // const webhookHandler = require('../../services/webhooks');
      // const result = await webhookHandler.process(provider, req);
      
      // For now, just acknowledge the webhook
      res.json({ 
        success: true,
        message: `Webhook received for provider: ${provider}`
      });
      
    } catch (error) {
      logger.error('❌ [Routes] Webhook processing failed', {
        error: error.message,
        provider: req.params.provider,
        correlationId: req.correlationId
      });
      next(error);
    }
  });
  
  logger.info('✅ [Routes] Webhook routes configured', {
    endpoint: '/webhooks/:provider'
  });
}

function setupClientConfigEndpoint(app) {
  logger.info('🔧 [Routes] Setting up client SDK config endpoint...');
  
  app.get('/api/config', (req, res) => {
    try {
      // Check if the utility exists before using it
      const utilPath = '../../utils/client-sdk';
      try {
        const { generateClientConfig } = require(utilPath);
        const config = generateClientConfig(req);
        
        logger.info('📱 [Routes] Client config requested', {
          correlationId: req.correlationId,
          userAgent: req.get('user-agent')
        });
        
        res.json(config);
      } catch (requireError) {
        // If client-sdk utility doesn't exist, return a basic config
        logger.warn('⚠️ [Routes] Client SDK utility not found, returning basic config');
        
        res.json({
          serverUrl: `${req.protocol}://${req.get('host')}`,
          socketPath: config.server.socketPath || '/socket.io',
          apiVersion: 'v1',
          features: config.features || {}
        });
      }
    } catch (error) {
      logger.error('❌ [Routes] Error generating client config', {
        error: error.message,
        correlationId: req.correlationId
      });
      res.status(500).json({
        error: 'Failed to generate client configuration'
      });
    }
  });
  
  logger.info('✅ [Routes] Client SDK config endpoint configured', {
    path: '/api/config'
  });
}

// Helper functions
async function getHealthStatus() {
  const status = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    pid: process.pid,
    memory: process.memoryUsage(),
    services: {}
  };

  // Check database
  try {
    const connectionManager = require('../../db/connectionManager');
    const dbHealth = await connectionManager.healthCheck();
    status.services.database = dbHealth;
  } catch (error) {
    status.services.database = {
      status: 'unhealthy',
      error: error.message
    };
    status.status = 'unhealthy';
  }

  // Check Redis
  try {
    const redisService = require('../../services/redis');
    const startTime = Date.now();
    await redisService.ping();
    const duration = Date.now() - startTime;
    status.services.redis = {
      status: 'healthy',
      responseTime: `${duration}ms`
    };
  } catch (error) {
    status.services.redis = {
      status: 'unhealthy',
      error: error.message
    };
    status.status = 'unhealthy';
  }

  // Check Queue service
  try {
    const queueService = require('../../services/queue/queueService');
    const startTime = Date.now();
    const queueStatus = await queueService.ping();
    const duration = Date.now() - startTime;
    status.services.queue = {
      status: queueStatus.status === 'ok' ? 'healthy' : 'unhealthy',
      responseTime: `${duration}ms`
    };
  } catch (error) {
    status.services.queue = {
      status: 'unhealthy',
      error: error.message
    };
    status.status = 'warning';
  }

  // Check notification services
  const notificationManager = require('../../services/notifications/notificationManager');
  status.services.notifications = {
    status: notificationManager.initialized ? 'healthy' : 'unhealthy',
    providers: notificationManager.providers ? 
      Array.from(notificationManager.providers.keys()) : [],
    fcm: notificationManager.providers?.has('FCM') || false,
    apn: notificationManager.providers?.has('APN') || false
  };

  return status;
}

module.exports = { setupRoutes };