// bootstrap/initializers/express.js
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
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
    
    // Create server (HTTP or HTTPS based on config)
    const server = await createServer(app);
    
    const duration = Date.now() - startTime;
    logger.info('✅ [Express] Express application setup completed', {
      duration: `${duration}ms`,
      serverType: config.ssl?.enabled ? 'HTTPS' : 'HTTP',
      behindProxy: config.security?.trustProxy || false
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

async function createServer(app) {
  // Check if direct SSL is enabled (not common with nginx proxy)
  if (config.ssl?.enabled && config.ssl?.certificatePath && config.ssl?.privateKeyPath) {
    logger.info('🔒 [Express] Creating HTTPS server with SSL certificates...');
    
    try {
      const sslOptions = {
        key: fs.readFileSync(config.ssl.privateKeyPath),
        cert: fs.readFileSync(config.ssl.certificatePath)
      };
      
      // Add CA certificate if provided
      if (config.ssl.caPath) {
        sslOptions.ca = fs.readFileSync(config.ssl.caPath);
      }
      
      // Add passphrase if provided
      if (config.ssl.passphrase) {
        sslOptions.passphrase = config.ssl.passphrase;
      }
      
      // SSL/TLS options
      if (config.ssl.secureProtocol) {
        sslOptions.secureProtocol = config.ssl.secureProtocol;
      }
      
      if (config.ssl.ciphers) {
        sslOptions.ciphers = config.ssl.ciphers;
      }
      
      if (config.ssl.honorCipherOrder) {
        sslOptions.honorCipherOrder = config.ssl.honorCipherOrder;
      }
      
      // Client certificate options
      if (config.ssl.requestCert) {
        sslOptions.requestCert = config.ssl.requestCert;
        sslOptions.rejectUnauthorized = config.ssl.rejectUnauthorized;
      }
      
      const server = https.createServer(sslOptions, app);
      
      logger.info('✅ [Express] HTTPS server created with SSL certificates', {
        cert: config.ssl.certificatePath,
        key: config.ssl.privateKeyPath,
        ca: config.ssl.caPath || 'none',
        clientCerts: config.ssl.requestCert || false
      });
      
      return server;
    } catch (error) {
      logger.error('❌ [Express] Failed to create HTTPS server', {
        error: error.message,
        cert: config.ssl.certificatePath,
        key: config.ssl.privateKeyPath
      });
      throw error;
    }
  } else {
    // Create HTTP server (most common with nginx proxy)
    logger.info('🔧 [Express] Creating HTTP server...');
    const server = http.createServer(app);
    
    if (config.security?.trustProxy) {
      logger.info('🔄 [Express] HTTP server configured for proxy (SSL termination handled by proxy)');
    }
    
    return server;
  }
}

function configureExpressSettings(app) {
  logger.info('🔧 [Express] Configuring Express settings...');
  
  // Trust proxy configuration (CRITICAL for nginx proxy)
  if (config.security?.trustProxy) {
    app.set('trust proxy', true);
    logger.info('✅ [Express] Trust proxy enabled - will trust X-Forwarded-* headers');
  } else {
    logger.warn('⚠️ [Express] Trust proxy disabled - X-Forwarded-* headers will be ignored');
  }
  
  // View engine setup (if needed)
  if (config.server?.viewEngine) {
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
  if (config.server?.caseSensitiveRouting) {
    app.set('case sensitive routing', true);
    logger.info('✅ [Express] Case sensitive routing enabled');
  }
  
  // Enable strict routing if configured
  if (config.server?.strictRouting) {
    app.set('strict routing', true);
    logger.info('✅ [Express] Strict routing enabled');
  }
  
  // SSL/Security related Express settings
  if (config.security?.ssl?.forceHttps && config.security?.trustProxy) {
    // This middleware redirects HTTP to HTTPS when behind a proxy
    app.use((req, res, next) => {
      if (req.header('x-forwarded-proto') !== 'https') {
        const httpsUrl = `https://${req.header('host')}${req.url}`;
        logger.debug('🔄 [Express] Redirecting HTTP to HTTPS', {
          originalUrl: req.url,
          httpsUrl: httpsUrl
        });
        return res.redirect(301, httpsUrl);
      }
      next();
    });
    logger.info('✅ [Express] HTTPS redirect middleware enabled');
  }
  
  logger.info('✅ [Express] Settings configured', {
    trustProxy: config.security?.trustProxy || false,
    viewEngine: config.server?.viewEngine || 'none',
    caseSensitive: config.server?.caseSensitiveRouting || false,
    strictRouting: config.server?.strictRouting || false,
    httpsRedirect: config.security?.ssl?.forceHttps || false,
    ssl: {
      enabled: config.ssl?.enabled || false,
      directSSL: !!(config.ssl?.enabled && config.ssl?.certificatePath),
      behindProxy: config.security?.trustProxy || false
    }
  });
}

module.exports = { setupExpress };