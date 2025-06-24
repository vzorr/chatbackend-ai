// bootstrap/initializers/metrics.js - DEBUG VERSION
console.log('🔍 DEBUG - Loading metrics.js file');

let promClient;
let metrics = {};

async function initializeMetrics(app) {
  console.log('🔍 DEBUG - initializeMetrics function called');
  const startTime = Date.now();
  
  try {
    console.log('🔍 DEBUG - Step 1: Starting metrics initialization');
    
    console.log('🔍 DEBUG - Step 2: About to load config');
    let config;
    try {
      config = require('../../config/config');
      console.log('🔍 DEBUG - Step 2a: Config loaded successfully');
    } catch (configError) {
      console.log('🔍 DEBUG - Step 2b: Config loading failed:', configError.message);
      config = { monitoring: { metrics: { enabled: false } } };
    }

    console.log('🔍 DEBUG - Step 3: About to load logger');
    let logger;
    try {
      const loggerModule = require('../../utils/logger');
      logger = loggerModule.logger;
      console.log('🔍 DEBUG - Step 3a: Logger loaded successfully');
    } catch (loggerError) {
      console.log('🔍 DEBUG - Step 3b: Logger loading failed:', loggerError.message);
      logger = { info: console.log, error: console.error };
    }

    console.log('🔍 DEBUG - Step 4: About to check if metrics enabled');
    const metricsEnabled = config?.monitoring?.metrics?.enabled === true || 
                          process.env.ENABLE_METRICS === 'true';
    console.log('🔍 DEBUG - Step 4a: Metrics enabled:', metricsEnabled);
    
    if (!metricsEnabled) {
      console.log('🔍 DEBUG - Step 4b: Metrics disabled, returning early');
      return;
    }

    console.log('🔍 DEBUG - Step 5: About to load prom-client');
    try {
      promClient = require('prom-client');
      console.log('🔍 DEBUG - Step 5a: prom-client loaded successfully');
    } catch (promError) {
      console.log('🔍 DEBUG - Step 5b: prom-client loading failed:', promError.message);
      return;
    }

    console.log('🔍 DEBUG - Step 6: About to setup default metrics');
    try {
      promClient.collectDefaultMetrics({
        prefix: 'vortexhive_',
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5]
      });
      console.log('🔍 DEBUG - Step 6a: Default metrics setup completed');
    } catch (defaultMetricsError) {
      console.log('🔍 DEBUG - Step 6b: Default metrics setup failed:', defaultMetricsError.message);
    }

    console.log('🔍 DEBUG - Step 7: About to create custom metrics');
    try {
      console.log('🔍 DEBUG - Step 7a: Creating httpRequestDuration');
      const httpRequestDuration = new promClient.Histogram({
        name: 'vortexhive_http_request_duration_seconds',
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status_code'],
        buckets: [0.1, 0.5, 1, 2, 5]
      });
      console.log('🔍 DEBUG - Step 7b: httpRequestDuration created');
      
      console.log('🔍 DEBUG - Step 7c: Creating activeConnections');
      const activeConnections = new promClient.Gauge({
        name: 'vortexhive_websocket_active_connections',
        help: 'Number of active WebSocket connections'
      });
      console.log('🔍 DEBUG - Step 7d: activeConnections created');
      
      metrics = { httpRequestDuration, activeConnections };
      console.log('🔍 DEBUG - Step 7e: Custom metrics object created');
      
    } catch (customMetricsError) {
      console.log('🔍 DEBUG - Step 7f: Custom metrics creation failed:', customMetricsError.message);
      metrics = {};
    }

    console.log('🔍 DEBUG - Step 8: About to setup middleware');
    if (app && typeof app.use === 'function') {
      try {
        console.log('🔍 DEBUG - Step 8a: App is valid, setting up middleware');
        // Simple middleware setup
        app.use((req, res, next) => {
          console.log('🔍 DEBUG - Metrics middleware called');
          next();
        });
        console.log('🔍 DEBUG - Step 8b: Middleware setup completed');
      } catch (middlewareError) {
        console.log('🔍 DEBUG - Step 8c: Middleware setup failed:', middlewareError.message);
      }
    } else {
      console.log('🔍 DEBUG - Step 8d: No valid app provided');
    }

    const duration = Date.now() - startTime;
    console.log(`🔍 DEBUG - Step 9: Metrics initialization completed in ${duration}ms`);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`🔍 DEBUG - ERROR after ${duration}ms:`, error.message);
    console.error('🔍 DEBUG - ERROR stack:', error.stack);
  }
  
  console.log('🔍 DEBUG - initializeMetrics function ending');
}

console.log('🔍 DEBUG - About to export initializeMetrics');
module.exports = { initializeMetrics };
console.log('🔍 DEBUG - initializeMetrics exported');