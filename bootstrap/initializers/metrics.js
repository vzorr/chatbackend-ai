// bootstrap/initializers/metrics.js
const promClient = require('prom-client');
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

let metrics = {};

async function initializeMetrics(app) {
  if (!config.monitoring.metrics.enabled) {
    logger.info('⏭️ [Metrics] Metrics disabled, skipping initialization');
    return;
  }

  const startTime = Date.now();
  logger.info('🔧 [Metrics] Initializing Prometheus metrics...');

  try {
    // Collect default metrics (CPU, memory, etc.)
    promClient.collectDefaultMetrics({
      prefix: 'vortexhive_',
      gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]
    });

    // Create custom metrics
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
      }),
      
      databaseQueryDuration: new promClient.Histogram({
        name: 'vortexhive_database_query_duration_seconds',
        help: 'Database query execution time',
        labelNames: ['operation', 'collection'],
        buckets: [0.001, 0.01, 0.1, 1, 5]
      }),
      
      cacheHits: new promClient.Counter({
        name: 'vortexhive_cache_hits_total',
        help: 'Total number of cache hits',
        labelNames: ['cache_type']
      }),
      
      cacheMisses: new promClient.Counter({
        name: 'vortexhive_cache_misses_total',
        help: 'Total number of cache misses',
        labelNames: ['cache_type']
      }),
      
      notificationsSent: new promClient.Counter({
        name: 'vortexhive_notifications_sent_total',
        help: 'Total number of notifications sent',
        labelNames: ['provider', 'status']
      })
    };

    // Setup middleware to track HTTP requests
    setupMetricsMiddleware(app);

    // Setup metrics endpoint
    setupMetricsEndpoint(app);

    const duration = Date.now() - startTime;
    logger.info('✅ [Metrics] Prometheus metrics initialized', {
      duration: `${duration}ms`,
      metricsCount: Object.keys(metrics).length
    });

  } catch (error) {
    logger.error('❌ [Metrics] Failed to initialize metrics', {
      error: error.message,
      stack: error.stack
    });
    
    if (config.monitoring.metrics.critical) {
      throw error;
    }
  }
}

function setupMetricsMiddleware(app) {
  app.use((req, res, next) => {
    const timer = metrics.httpRequestDuration.startTimer();
    
    res.on('finish', () => {
      const route = req.route?.path || req.path || 'unknown';
      const labels = {
        method: req.method,
        route: route,
        status_code: res.statusCode
      };
      
      timer(labels);
      
      // Track errors
      if (res.statusCode >= 400) {
        metrics.apiErrors.inc(labels);
      }
    });
    
    next();
  });
  
  logger.info('✅ [Metrics] HTTP metrics middleware configured');
}

function setupMetricsEndpoint(app) {
  app.get('/metrics', async (req, res) => {
    try {
      // Add custom metric values here if needed
      res.set('Content-Type', promClient.register.contentType);
      res.end(await promClient.register.metrics());
      
      logger.debug('📊 [Metrics] Metrics endpoint accessed', {
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
    } catch (error) {
      logger.error('❌ [Metrics] Error generating metrics', {
        error: error.message
      });
      res.status(500).json({
        error: 'Failed to generate metrics'
      });
    }
  });
  
  logger.info('✅ [Metrics] Metrics endpoint configured', {
    path: '/metrics'
  });
}

// Helper functions to update metrics
function updateWebSocketConnections(count) {
  if (metrics.activeConnections) {
    metrics.activeConnections.set(count);
  }
}

function incrementMessagesSent(type = 'unknown') {
  if (metrics.messagesSent) {
    metrics.messagesSent.inc({ type });
  }
}

function incrementMessagesReceived(type = 'unknown') {
  if (metrics.messagesReceived) {
    metrics.messagesReceived.inc({ type });
  }
}

function recordDatabaseQuery(operation, collection, duration) {
  if (metrics.databaseQueryDuration) {
    metrics.databaseQueryDuration.observe(
      { operation, collection },
      duration
    );
  }
}

function incrementCacheHit(cacheType = 'default') {
  if (metrics.cacheHits) {
    metrics.cacheHits.inc({ cache_type: cacheType });
  }
}

function incrementCacheMiss(cacheType = 'default') {
  if (metrics.cacheMisses) {
    metrics.cacheMisses.inc({ cache_type: cacheType });
  }
}

function incrementNotificationsSent(provider, status) {
  if (metrics.notificationsSent) {
    metrics.notificationsSent.inc({ provider, status });
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