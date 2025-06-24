// bootstrap/initializers/metrics.js
let promClient;
let metrics = {};

async function initializeMetrics(app) {
  const startTime = Date.now();
  
  try {
    console.log('🔧 [Metrics] Starting metrics initialization...');
    
    // Safe config and logger loading
    let config, logger;
    try {
      config = require('../../config/config');
      const loggerModule = require('../../utils/logger');
      logger = loggerModule.logger;
    } catch (loadError) {
      console.log('⚠️ [Metrics] Config/Logger loading failed, using defaults');
      config = { monitoring: { metrics: { enabled: false } } };
      logger = { info: console.log, error: console.error, debug: console.log };
    }

    // Check if metrics are enabled
    const metricsEnabled = config?.monitoring?.metrics?.enabled === true || 
                          process.env.ENABLE_METRICS === 'true';
    
    if (!metricsEnabled) {
      console.log('⏭️ [Metrics] Metrics disabled, skipping initialization');
      if (logger && logger.info) {
        logger.info('⏭️ [Metrics] Metrics disabled, skipping initialization');
      }
      return;
    }

    // Try to load prom-client
    try {
      promClient = require('prom-client');
      console.log('✅ [Metrics] prom-client loaded successfully');
    } catch (promError) {
      console.error('❌ [Metrics] prom-client not found:', promError.message);
      console.log('💡 [Metrics] Install with: npm install prom-client');
      return; // Exit gracefully if prom-client is not available
    }

    if (logger && logger.info) {
      logger.info('🔧 [Metrics] Initializing Prometheus metrics...');
    }

    // Collect default metrics (CPU, memory, etc.)
    try {
      promClient.collectDefaultMetrics({
        prefix: 'vortexhive_',
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]
      });
      console.log('✅ [Metrics] Default metrics collection started');
    } catch (defaultMetricsError) {
      console.error('⚠️ [Metrics] Default metrics setup failed:', defaultMetricsError.message);
    }

    // Create custom metrics
    try {
      metrics = {
        httpRequestDuration: new promClient.Histogram({
          name: 'vortexhive_http_request_duration_seconds',
          help: 'Duration of HTTP requests in seconds',
          labelNames: ['method', 'route', 'status_code'],
          buckets: [0.1, 0.5, 1, 2, 5]
        }),
        
        activeConnections: new promClient.Gauge({
          name: 'vortexhive_websocket_active_connections',
          help: 'Number of active WebSocket connections'
        }),
        
        messagesSent: new promClient.Counter({
          name: 'vortexhive_messages_sent_total',
          help: 'Total number of messages sent',
          labelNames: ['type']
        }),
        
        messagesReceived: new promClient.Counter({
          name: 'vortexhive_messages_received_total',
          help: 'Total number of messages received',
          labelNames: ['type']
        }),
        
        apiErrors: new promClient.Counter({
          name: 'vortexhive_api_errors_total',
          help: 'Total number of API errors',
          labelNames: ['method', 'route', 'status_code']
        })
      };
      console.log('✅ [Metrics] Custom metrics created');
    } catch (customMetricsError) {
      console.error('⚠️ [Metrics] Custom metrics setup failed:', customMetricsError.message);
      metrics = {}; // Use empty metrics object
    }

    // Setup middleware and endpoint if app is provided
    if (app && typeof app.use === 'function') {
      try {
        setupMetricsMiddleware(app, logger);
        setupMetricsEndpoint(app, logger);
        console.log('✅ [Metrics] Middleware and endpoint configured');
      } catch (middlewareError) {
        console.error('⚠️ [Metrics] Middleware setup failed:', middlewareError.message);
      }
    } else {
      console.log('⚠️ [Metrics] No valid Express app provided, skipping middleware setup');
    }

    const duration = Date.now() - startTime;
    console.log(`✅ [Metrics] Metrics initialized in ${duration}ms`);
    
    if (logger && logger.info) {
      logger.info('✅ [Metrics] Prometheus metrics initialized', {
        duration: `${duration}ms`,
        metricsCount: Object.keys(metrics).length
      });
    }

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ [Metrics] Error after ${duration}ms:`, error.message);
    
    // Try to log via logger if available
    try {
      const { logger } = require('../../utils/logger');
      if (logger && logger.error) {
        logger.error('❌ [Metrics] Failed to initialize metrics', {
          error: error.message,
          stack: error.stack,
          duration: `${duration}ms`
        });
      }
    } catch (loggerError) {
      // Ignore logger errors
    }
    
    // Don't throw unless explicitly critical
    const config = require('../../config/config').catch(() => ({}));
    if (config?.monitoring?.metrics?.critical) {
      throw error;
    }
    
    console.log('⚠️ [Metrics] Proceeding despite error...');
  }
}

function setupMetricsMiddleware(app, logger) {
  if (!metrics.httpRequestDuration) {
    console.log('⚠️ [Metrics] HTTP metrics not available, skipping middleware');
    return;
  }

  app.use((req, res, next) => {
    const timer = metrics.httpRequestDuration.startTimer();
    
    res.on('finish', () => {
      try {
        const route = req.route?.path || req.path || 'unknown';
        const labels = {
          method: req.method,
          route: route,
          status_code: res.statusCode
        };
        
        timer(labels);
        
        // Track errors
        if (res.statusCode >= 400 && metrics.apiErrors) {
          metrics.apiErrors.inc(labels);
        }
      } catch (metricsError) {
        // Silently ignore metrics errors
      }
    });
    
    next();
  });
  
  console.log('✅ [Metrics] HTTP metrics middleware configured');
  if (logger && logger.info) {
    logger.info('✅ [Metrics] HTTP metrics middleware configured');
  }
}

function setupMetricsEndpoint(app, logger) {
  if (!promClient) {
    console.log('⚠️ [Metrics] promClient not available, skipping endpoint');
    return;
  }

  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', promClient.register.contentType);
      const metrics = await promClient.register.metrics();
      res.end(metrics);
      
      if (logger && logger.debug) {
        logger.debug('📊 [Metrics] Metrics endpoint accessed', {
          ip: req.ip,
          userAgent: req.get('user-agent')
        });
      }
    } catch (error) {
      console.error('❌ [Metrics] Error generating metrics:', error.message);
      if (logger && logger.error) {
        logger.error('❌ [Metrics] Error generating metrics', {
          error: error.message
        });
      }
      res.status(500).json({
        error: 'Failed to generate metrics'
      });
    }
  });
  
  console.log('✅ [Metrics] Metrics endpoint configured at /metrics');
  if (logger && logger.info) {
    logger.info('✅ [Metrics] Metrics endpoint configured', {
      path: '/metrics'
    });
  }
}

// Helper functions to update metrics (with safe checks)
function updateWebSocketConnections(count) {
  if (metrics.activeConnections && typeof metrics.activeConnections.set === 'function') {
    try {
      metrics.activeConnections.set(count);
    } catch (error) {
      // Silently ignore
    }
  }
}

function incrementMessagesSent(type = 'unknown') {
  if (metrics.messagesSent && typeof metrics.messagesSent.inc === 'function') {
    try {
      metrics.messagesSent.inc({ type });
    } catch (error) {
      // Silently ignore
    }
  }
}

function incrementMessagesReceived(type = 'unknown') {
  if (metrics.messagesReceived && typeof metrics.messagesReceived.inc === 'function') {
    try {
      metrics.messagesReceived.inc({ type });
    } catch (error) {
      // Silently ignore
    }
  }
}

function recordDatabaseQuery(operation, collection, duration) {
  if (metrics.databaseQueryDuration && typeof metrics.databaseQueryDuration.observe === 'function') {
    try {
      metrics.databaseQueryDuration.observe(
        { operation, collection },
        duration
      );
    } catch (error) {
      // Silently ignore
    }
  }
}

function incrementCacheHit(cacheType = 'default') {
  if (metrics.cacheHits && typeof metrics.cacheHits.inc === 'function') {
    try {
      metrics.cacheHits.inc({ cache_type: cacheType });
    } catch (error) {
      // Silently ignore
    }
  }
}

function incrementCacheMiss(cacheType = 'default') {
  if (metrics.cacheMisses && typeof metrics.cacheMisses.inc === 'function') {
    try {
      metrics.cacheMisses.inc({ cache_type: cacheType });
    } catch (error) {
      // Silently ignore
    }
  }
}

function incrementNotificationsSent(provider, status) {
  if (metrics.notificationsSent && typeof metrics.notificationsSent.inc === 'function') {
    try {
      metrics.notificationsSent.inc({ provider, status });
    } catch (error) {
      // Silently ignore
    }
  }
}

module.exports = {
  initializeMetrics,
  updateWebSocketConnections,
  incrementMessagesSent,
  incrementMessagesReceived,
  recordDatabaseQuery,
  incrementCacheHit,
  incrementCacheMiss,
  incrementNotificationsSent
};