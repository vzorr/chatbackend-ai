// bootstrap/initializers/express.js
const express = require('express');
const http = require('http');
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

async function setupExpress() {
  const startTime = Date.now();
  logger.info('🔧 [Express] Setting up Express application...');

  try {
    // Create Express app
    const app = express();
    
    // Configure Express settings
    configureExpressSettings(app);
    
    // Create HTTP server
    const server = http.createServer(app);
    
    const duration = Date.now() - startTime;
    logger.info('✅ [Express] Express application setup completed', {
      duration: `${duration}ms`
    });
    
    return { app, server };
  } catch (error) {
    logger.error('❌ [Express] Express setup failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

function configureExpressSettings(app) {
  logger.info('🔧 [Express] Configuring Express settings...');
  
  // Trust proxy configuration
  if (config.security.trustProxy) {
    app.set('trust proxy', true);
    logger.info('✅ [Express] Trust proxy enabled');
  }
  
  // View engine setup (if needed)
  if (config.server.viewEngine) {
    app.set('view engine', config.server.viewEngine);
    app.set('views', './views');
    logger.info('✅ [Express] View engine configured', {
      engine: config.server.viewEngine
    });
  }
  
  // Disable X-Powered-By header for security
  app.disable('x-powered-by');
  logger.info('✅ [Express] X-Powered-By header disabled');
  
  // Enable case sensitive routing if configured
  if (config.server.caseSensitiveRouting) {
    app.set('case sensitive routing', true);
    logger.info('✅ [Express] Case sensitive routing enabled');
  }
  
  // Enable strict routing if configured
  if (config.server.strictRouting) {
    app.set('strict routing', true);
    logger.info('✅ [Express] Strict routing enabled');
  }
  
  logger.info('✅ [Express] Settings configured', {
    trustProxy: config.security.trustProxy,
    viewEngine: config.server.viewEngine || 'none',
    caseSensitive: config.server.caseSensitiveRouting || false,
    strictRouting: config.server.strictRouting || false
  });
}

module.exports = { setupExpress };