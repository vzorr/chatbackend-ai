require('dotenv').config();

try {
  console.log('🔧 Loading dependencies...');

  const { logger } = require('./utils/logger');
  const config = require('./config/config');
  const bootstrap = require('./bootstrap');
  const exceptionHandler = require('./middleware/exceptionHandler');

  console.log('✅ Dependencies loaded successfully');

  process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err);
    if (logger && logger.error) {
      logger.error(`💥 Uncaught Exception`, {
        error: err.message,
        stack: err.stack,
        code: err.code
      });
    }
    exceptionHandler.uncaughtExceptionHandler(err);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection:', reason);
    const isFatal = reason?.name === 'ConnectionError' || reason?.isFatal || false;
    if (logger && logger.error) {
      logger.error(`💥 Unhandled Rejection`, {
        reason: reason?.message || reason,
        stack: reason?.stack || 'No stack trace available',
        promise: promise?.toString()
      });
    }
    exceptionHandler.unhandledRejectionHandler(reason, promise);
    if (isFatal) {
      console.error('❌ Fatal unhandled rejection – exiting process.');
      process.exit(1);
    }
  });

  // Helper function to determine public URL
  const getPublicUrl = () => {
    // Check if we're behind a proxy
    if (config.security?.trustProxy && config.server?.proxy?.enabled) {
      return config.server.proxy.publicUrl || config.app?.url;
    }
    
    // Fallback to direct server URL
    const protocol = config.ssl?.enabled ? 'https' : 'http';
    return `${protocol}://${config.server.host}:${config.server.port}`;
  };

  // Helper function to get local URL
  const getLocalUrl = () => {
    return `http://${config.server.host}:${config.server.port}`;
  };

  async function main() {
    try {
      console.log('🚀 Starting main function...');

      console.log('📋 Configuration loaded:', {
        port: config.server.port,
        host: config.server.host,
        env: config.server.nodeEnv,
        domain: config.app?.domain,
        behindProxy: config.security?.trustProxy,
        sslEnabled: config.ssl?.enabled
      });

      console.log('🎯 Initiating bootstrap process...');
      const result = await bootstrap.start();
      
      console.log('🔍 DEBUG - Bootstrap completed successfully!');
      console.log('🔍 DEBUG - Bootstrap result:', {
        isPrimary: result?.isPrimary,
        hasApp: !!result?.app,
        hasServer: !!result?.server,
        hasIO: !!result?.io,
        workerId: result?.workerId
      });

      if (result?.isPrimary) {
        console.log('🔍 DEBUG - Primary process detected, returning early');
        if (logger && logger.info) {
          logger.info('✅ Primary process initialized successfully', {
            pid: process.pid,
            workers: config.cluster?.workerCount
          });
        }
        return;
      }

      console.log('🔍 DEBUG - Extracting components from bootstrap result...');
      const { app, server, io } = result || {};
      
      if (!app || !server) {
        console.error('🔍 DEBUG - Missing critical components!');
        console.error('🔍 DEBUG - App exists:', !!app);
        console.error('🔍 DEBUG - Server exists:', !!server);
        throw new Error('Bootstrap did not return required app and server instances');
      }

      console.log('🔍 DEBUG - Components extracted successfully');
      console.log('🔍 DEBUG - About to initialize exception handler...');

      try {
        exceptionHandler.initialize(server);
        console.log('🔍 DEBUG - Exception handler initialized');
      } catch (exceptionError) {
        console.error('🔍 DEBUG - Exception handler init failed:', exceptionError.message);
      }

      if (logger && logger.info) {
        logger.info('✅ Exception handler initialized with server instance');
      }

      console.log('🔍 DEBUG - Setting up server error handlers...');
      // Enhanced server error handling
      server.on('error', (error) => {
        console.log('🔍 DEBUG - Server error occurred:', error.code);
        if (error.code === 'EADDRINUSE') {
          logger?.error?.(`❌ Port ${config.server.port} is already in use`);
          process.exit(1);
        } else if (error.code === 'EACCES') {
          logger?.error?.(`❌ Permission denied to bind to port ${config.server.port}`);
          process.exit(1);
        } else {
          logger?.error?.('❌ Server error', {
            error: error.message,
            code: error.code,
            stack: error.stack
          });
        }
      });

      console.log('🔍 DEBUG - Setting up connection handlers...');
      // Enhanced connection logging for SSL/proxy setup
      server.on('connection', (socket) => {
        const connectionInfo = {
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort,
          // Note: socket.encrypted will be false since nginx terminates SSL
          viaProxy: config.security?.trustProxy || false,
          encrypted: socket.encrypted || false
        };
        
        logger?.debug?.('🔌 New connection established', connectionInfo);

        // Log SSL-specific details if available
        if (socket.encrypted) {
          logger?.debug?.('🔒 Secure connection details', {
            cipher: socket.getCipher?.()?.name,
            protocol: socket.getProtocol?.(),
            authorized: socket.authorized
          });
        }

        socket.on('error', (err) => {
          logger?.warn?.('⚠️ Socket error', {
            error: err.message,
            remoteAddress: socket.remoteAddress,
            viaProxy: config.security?.trustProxy || false
          });
        });
      });

      console.log('🔍 DEBUG - Setting up TLS handlers (if needed)...');
      // Add TLS-specific error handlers if SSL is enabled
      if (config.ssl?.enabled) {
        server.on('tlsClientError', (err, tlsSocket) => {
          logger?.error?.('❌ TLS Client Error', {
            error: err.message,
            code: err.code,
            remoteAddress: tlsSocket?.remoteAddress
          });
        });

        server.on('secureConnection', (tlsSocket) => {
          logger?.debug?.('🔒 Secure TLS connection established', {
            remoteAddress: tlsSocket.remoteAddress,
            authorized: tlsSocket.authorized,
            cipher: tlsSocket.getCipher?.()?.name
          });
        });
      }

      console.log('🔍 DEBUG - Generating URLs...');
      // Enhanced startup logging with SSL/proxy awareness
      const publicUrl = getPublicUrl();
      const localUrl = getLocalUrl();
      
      console.log('🔍 DEBUG - URLs generated successfully');
      console.log('🔍 DEBUG - Public URL:', publicUrl);
      console.log('🔍 DEBUG - Local URL:', localUrl);

      console.log('🔍 DEBUG - Logging application started message...');
      logger?.info?.('✅ Application started successfully', {
        publicUrl: publicUrl,
        localUrl: localUrl,
        domain: config.app?.domain,
        protocol: config.server?.proxy?.protocol || (config.ssl?.enabled ? 'https' : 'http'),
        behindProxy: config.security?.trustProxy || false,
        pid: process.pid,
        workerId: result.workerId || 'single-process',
        environment: config.server.nodeEnv
      });

      console.log('🔍 DEBUG - Application started message logged');
      
      // Enhanced proxy detection logging
      if (config.security?.trustProxy) {
        console.log('🔍 DEBUG - Logging proxy information...');
        logger?.info?.('🔄 Running behind reverse proxy', {
          publicProtocol: config.server?.proxy?.protocol || 'https',
          localProtocol: 'http',
          proxyHeaders: 'X-Forwarded-* headers trusted',
          domain: config.app?.domain
        });
      } else {
        logger?.warn?.('⚠️ Proxy trust disabled - check TRUST_PROXY setting if using nginx/proxy');
      }

      console.log('🔍 DEBUG - Checking production security settings...');
      // Enhanced production security checks
      if (process.env.NODE_ENV === 'production') {
        const isPublicHttps = publicUrl.startsWith('https');
        const hasServerUrl = process.env.SERVER_URL || process.env.APP_URL;
        
        if (!isPublicHttps) {
          logger?.error?.('🚨 CRITICAL: Public URL is not HTTPS in production!', {
            publicUrl: publicUrl,
            serverUrl: hasServerUrl,
            recommendation: 'Configure nginx SSL and update APP_URL/SERVER_URL environment variables'
          });
        } else {
          logger?.info?.('🔒 Production server secured with HTTPS', {
            method: config.security?.trustProxy ? 'via_proxy' : 'direct_ssl',
            domain: config.app?.domain
          });
        }

        // Additional production security warnings
        if (config.security?.trustProxy && !hasServerUrl?.startsWith('https')) {
          logger?.warn?.('⚠️ TRUST_PROXY enabled but SERVER_URL/APP_URL not HTTPS - check configuration');
        }

        // SSL certificate warnings (if using direct SSL)
        if (config.ssl?.enabled) {
          if (config.ssl.certificatePath && config.ssl.privateKeyPath) {
            logger?.info?.('✅ SSL certificates configured for direct HTTPS');
          } else {
            logger?.warn?.('⚠️ SSL enabled but certificate paths not configured');
          }
        }
      } else {
        // Development mode warnings
        if (!publicUrl.startsWith('https') && config.server.nodeEnv !== 'development') {
          logger?.warn?.('🚨 Non-production environment running over HTTP');
        }
      }

      console.log('🔍 DEBUG - Checking HSTS configuration...');
      // HSTS and security headers info
      if (config.security?.ssl?.hsts?.enabled) {
        logger?.info?.('🛡️ HSTS security headers enabled', {
          maxAge: config.security.ssl.hsts.maxAge,
          includeSubDomains: config.security.ssl.hsts.includeSubDomains,
          preload: config.security.ssl.hsts.preload
        });
      }

      console.log('🔍 DEBUG - Setting up health check monitoring...');
      // Health check monitoring with enhanced metrics
      if (config.monitoring?.healthCheckInterval) {
        setInterval(() => {
          const memUsage = process.memoryUsage();
          const connectionCount = server.listening ? 'active' : 'inactive';
          
          logger?.debug?.('📊 Application health check', {
            uptime: process.uptime(),
            memory: {
              rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
              heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
              heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`
            },
            connections: connectionCount,
            ssl: {
              enabled: config.ssl?.enabled || false,
              behindProxy: config.security?.trustProxy || false
            },
            socketConnections: io ? io.sockets?.sockets?.size : 0
          });
        }, config.monitoring.healthCheckInterval);
        console.log('🔍 DEBUG - Health check monitoring enabled');
      }

      console.log('🔍 DEBUG - Exporting module...');
      module.exports = { app, server, io };

      // Final success messages
      console.log('');
      console.log('🎉 ===== SERVER STARTUP COMPLETE =====');
      console.log('✅ Server is running and ready to accept connections!');
      console.log('');
      console.log('📊 Server Information:');
      console.log(`   🌐 Public URL: ${publicUrl}`);
      console.log(`   🏠 Local URL:  ${localUrl}`);
      console.log(`   🎯 Health:     ${localUrl}/health`);
      console.log(`   🔧 Process:    PID ${process.pid}`);
      console.log(`   🏷️  Worker:     ${result.workerId || 'single-process'}`);
      console.log(`   🌍 Environment: ${config.server.nodeEnv}`);
      console.log('');
      console.log('💡 Test the server:');
      console.log(`   curl ${localUrl}/health`);
      console.log('');
      console.log('🛑 Stop the server: Ctrl+C');
      console.log('🔍 DEBUG - All startup tasks completed successfully!');

    } catch (error) {
      console.error('🔍 DEBUG - Error in main function:', error);
      console.error('❌ Failed to start application:', error);
      if (logger && logger.error) {
        logger.error('❌ Failed to start application', {
          error: error.message,
          stack: error.stack,
          ssl: {
            enabled: config.ssl?.enabled || false,
            behindProxy: config.security?.trustProxy || false
          }
        });

        if (error.isOperational) {
          logger.error('💥 Operational error during startup - exiting gracefully');
        } else {
          logger.error('💥 System error during startup - immediate exit required');
        }
      }
      process.exit(1);
    }
  }

  const gracefulShutdown = async (signal) => {
    console.log(`🛑 Received ${signal}, initiating graceful shutdown...`);
    logger?.info?.(`🛑 Received ${signal}, initiating graceful shutdown...`);

    const shutdownTimeout = setTimeout(() => {
      console.error('❌ Graceful shutdown timeout exceeded, forcing exit');
      logger?.error?.('❌ Graceful shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 30000);

    try {
      if (bootstrap && typeof bootstrap.cleanup === 'function') {
        console.log('🧹 Running bootstrap cleanup...');
        await bootstrap.cleanup();
        console.log('✅ Bootstrap cleanup completed');
      }
      clearTimeout(shutdownTimeout);
      console.log('✅ Graceful shutdown completed');
      logger?.info?.('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
      logger?.error?.('❌ Error during graceful shutdown', {
        error: error.message,
        stack: error.stack
      });
      clearTimeout(shutdownTimeout);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  if (require.main === module) {
    console.log('📍 Running as main module');
    main().catch((error) => {
      console.error('❌ Fatal error in main:', error);
      if (logger && logger.error) {
        logger.error('❌ Fatal error in main', {
          error: error.message,
          stack: error.stack
        });
      }
      process.exit(1);
    });
  }

  module.exports = main;

} catch (startupError) {
  console.error('❌ Startup error:', startupError);
  console.error('Stack trace:', startupError.stack);
  process.exit(1);
}