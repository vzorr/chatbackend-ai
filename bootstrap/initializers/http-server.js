// bootstrap/initializers/http-server.js - Supports both HTTP and HTTPS
const { logger } = require('../../utils/logger');
const config = require('../../config/config');
const fs = require('fs');
const https = require('https');
const http = require('http');

async function startHTTPServer(server, io) {
  console.log('🚀 Starting server with SSL/HTTP support');
  
  try {
    const PORT = config.server?.port || 5000;
    const HOST = config.server?.host || 'localhost';
    
    console.log('🔍 Server configuration:', {
      port: PORT,
      host: HOST,
      sslEnabled: config.ssl?.enabled || false,
      behindProxy: config.security?.trustProxy || false,
      environment: config.server?.nodeEnv || 'development'
    });

    // Determine server mode
    const shouldUseHTTPS = config.ssl?.enabled && 
                          config.ssl?.certificatePath && 
                          config.ssl?.privateKeyPath;

    if (shouldUseHTTPS) {
      console.log('🔒 Starting in HTTPS mode (direct SSL)');
      await startHTTPSServer(server, io, HOST, PORT);
    } else {
      console.log('🌐 Starting in HTTP mode (proxy SSL or no SSL)');
      await startHTTPOnlyServer(server, io, HOST, PORT);
    }

    // Setup connection monitoring (safe)
    setupConnectionMonitoring(server, io);
    
    // Log final status
    logServerStatus(HOST, PORT, shouldUseHTTPS);
    
  } catch (error) {
    console.error('❌ Server startup failed:', error.message);
    if (logger?.error) {
      logger.error('❌ Server startup failed', {
        error: error.message,
        stack: error.stack
      });
    }
    throw error;
  }
}

async function startHTTPSServer(server, io, HOST, PORT) {
  console.log('🔒 Loading SSL certificates and starting HTTPS server');
  
  try {
    // Load SSL certificates safely
    const sslOptions = await loadSSLCertificates();
    
    // Create HTTPS server wrapper
    const httpsServer = https.createServer(sslOptions, server);
    
    // Start HTTPS server
    await new Promise((resolve, reject) => {
      httpsServer.listen(PORT, HOST, (error) => {
        if (error) {
          console.error('❌ HTTPS server failed to start:', error.message);
          reject(error);
          return;
        }

        console.log(`✅ HTTPS Server listening on https://${HOST}:${PORT}`);
        resolve();
      });
    });

    // Setup SSL-specific event handlers
    setupSSLEventHandlers(httpsServer);
    
  } catch (error) {
    console.error('❌ HTTPS server startup failed:', error.message);
    throw error;
  }
}

async function startHTTPOnlyServer(server, io, HOST, PORT) {
  console.log('🌐 Starting HTTP server');
  
  await new Promise((resolve, reject) => {
    server.listen(PORT, HOST, (error) => {
      if (error) {
        console.error('❌ HTTP server failed to start:', error.message);
        reject(error);
        return;
      }

      const proxyInfo = config.security?.trustProxy ? ' (behind proxy)' : '';
      console.log(`✅ HTTP Server listening on http://${HOST}:${PORT}${proxyInfo}`);
      resolve();
    });
  });
}

async function loadSSLCertificates() {
  console.log('📜 Loading SSL certificates');
  
  try {
    const sslOptions = {};
    
    // Load private key (required)
    if (config.ssl?.privateKeyPath) {
      if (!fs.existsSync(config.ssl.privateKeyPath)) {
        throw new Error(`Private key file not found: ${config.ssl.privateKeyPath}`);
      }
      console.log('🔑 Loading private key from:', config.ssl.privateKeyPath);
      sslOptions.key = fs.readFileSync(config.ssl.privateKeyPath, 'utf8');
    } else {
      throw new Error('SSL private key path not configured');
    }
    
    // Load certificate (required)
    if (config.ssl?.certificatePath) {
      if (!fs.existsSync(config.ssl.certificatePath)) {
        throw new Error(`Certificate file not found: ${config.ssl.certificatePath}`);
      }
      console.log('📜 Loading certificate from:', config.ssl.certificatePath);
      sslOptions.cert = fs.readFileSync(config.ssl.certificatePath, 'utf8');
    } else {
      throw new Error('SSL certificate path not configured');
    }
    
    // Load CA certificate (optional)
    if (config.ssl?.caPath) {
      if (fs.existsSync(config.ssl.caPath)) {
        console.log('🏛️ Loading CA certificate from:', config.ssl.caPath);
        sslOptions.ca = fs.readFileSync(config.ssl.caPath, 'utf8');
      } else {
        console.warn('⚠️ CA certificate file not found:', config.ssl.caPath);
      }
    }
    
    // Optional SSL settings (with safe defaults)
    if (config.ssl?.passphrase) {
      sslOptions.passphrase = config.ssl.passphrase;
    }
    
    if (config.ssl?.secureProtocol) {
      sslOptions.secureProtocol = config.ssl.secureProtocol;
    }
    
    if (config.ssl?.ciphers) {
      sslOptions.ciphers = config.ssl.ciphers;
    }
    
    if (config.ssl?.honorCipherOrder !== undefined) {
      sslOptions.honorCipherOrder = config.ssl.honorCipherOrder;
    }
    
    // Client certificate options (optional)
    if (config.ssl?.requestCert !== undefined) {
      sslOptions.requestCert = config.ssl.requestCert;
    }
    
    if (config.ssl?.rejectUnauthorized !== undefined) {
      sslOptions.rejectUnauthorized = config.ssl.rejectUnauthorized;
    }
    
    console.log('✅ SSL certificates loaded successfully');
    return sslOptions;
    
  } catch (error) {
    console.error('❌ Failed to load SSL certificates:', error.message);
    throw new Error(`SSL certificate loading failed: ${error.message}`);
  }
}

function setupSSLEventHandlers(httpsServer) {
  console.log('🔒 Setting up SSL event handlers');
  
  // TLS client errors
  httpsServer.on('tlsClientError', (err, tlsSocket) => {
    console.warn('⚠️ TLS client error:', err.message);
    if (logger?.warn) {
      logger.warn('TLS Client Error', {
        error: err.message,
        code: err.code,
        remoteAddress: tlsSocket?.remoteAddress
      });
    }
  });
  
  // Secure connections
  httpsServer.on('secureConnection', (tlsSocket) => {
    console.log('🔒 Secure connection from:', tlsSocket.remoteAddress);
    if (logger?.debug) {
      logger.debug('Secure TLS connection established', {
        remoteAddress: tlsSocket.remoteAddress,
        authorized: tlsSocket.authorized,
        cipher: tlsSocket.getCipher?.()?.name,
        protocol: tlsSocket.getProtocol?.()
      });
    }
  });
  
  // New session events (optional monitoring)
  httpsServer.on('newSession', (sessionId, sessionData, callback) => {
    if (logger?.debug) {
      logger.debug('New TLS session created', {
        sessionId: sessionId.toString('hex').substring(0, 16) + '...',
        sessionSize: sessionData.length
      });
    }
    callback();
  });
  
  console.log('✅ SSL event handlers configured');
}

function setupConnectionMonitoring(server, io) {
  let connectionCount = 0;
  
  // Monitor HTTP/HTTPS connections
  server.on('connection', (socket) => {
    connectionCount++;
    
    socket.on('close', () => {
      connectionCount--;
    });
    
    socket.on('error', (err) => {
      console.warn('⚠️ Socket error:', err.message);
      if (logger?.warn) {
        logger.warn('Socket error', {
          error: err.message,
          remoteAddress: socket.remoteAddress
        });
      }
    });
  });
  
  // Monitor Socket.IO connections (if available)
  if (io && typeof io.on === 'function') {
    io.on('connection', (socket) => {
      if (logger?.debug) {
        logger.debug('Socket.IO connection established', {
          socketId: socket.id,
          remoteAddress: socket.handshake?.address
        });
      }
      
      socket.on('disconnect', (reason) => {
        if (logger?.debug) {
          logger.debug('Socket.IO disconnection', {
            socketId: socket.id,
            reason: reason
          });
        }
      });
    });
  }
  
  console.log('✅ Connection monitoring configured');
}

function logServerStatus(HOST, PORT, isHTTPS) {
  const isBehindProxy = config.security?.trustProxy;
  
  // Determine URLs
  let publicUrl, localUrl, sslMode;
  
  if (isHTTPS) {
    publicUrl = `https://${config.app?.domain || HOST}${PORT === 443 ? '' : `:${PORT}`}`;
    localUrl = `https://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    sslMode = 'Direct SSL (Node.js)';
  } else if (isBehindProxy) {
    publicUrl = config.app?.url || `https://${config.app?.domain || HOST}`;
    localUrl = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    sslMode = 'Proxy SSL (nginx)';
  } else {
    publicUrl = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}${PORT === 80 ? '' : `:${PORT}`}`;
    localUrl = publicUrl;
    sslMode = 'No SSL';
  }
  
  console.log('');
  console.log('🎉 ===== SERVER READY =====');
  console.log(`🌐 Public URL:  ${publicUrl}`);
  console.log(`🏠 Local URL:   ${localUrl}`);
  console.log(`🎯 Health:      ${localUrl}/health`);
  console.log(`🔒 SSL Mode:    ${sslMode}`);
  console.log(`🌍 Environment: ${config.server?.nodeEnv || 'development'}`);
  console.log(`📊 Process:     PID ${process.pid}`);
  console.log('===============================');
  console.log('');
  
  // Additional info based on mode
  if (isBehindProxy && !isHTTPS) {
    console.log('💡 nginx terminates SSL → forwards HTTP to Node.js');
    console.log('');
  }
  
  if (logger?.info) {
    logger.info('🎉 Server ready and listening', {
      publicUrl,
      localUrl,
      ssl: {
        enabled: isHTTPS || isBehindProxy,
        direct: isHTTPS,
        behindProxy: isBehindProxy,
        mode: sslMode
      },
      environment: config.server?.nodeEnv || 'development',
      pid: process.pid
    });
  }
  
  // Production warnings
  if (config.server?.nodeEnv === 'production') {
    if (!publicUrl.startsWith('https')) {
      console.warn('🚨 WARNING: Production server not using HTTPS!');
      if (logger?.warn) {
        logger.warn('Production server not using HTTPS', {
          publicUrl,
          recommendation: 'Configure SSL certificates or proxy SSL termination'
        });
      }
    } else {
      console.log(`✅ Production SSL secured via ${isHTTPS ? 'direct SSL' : 'nginx proxy'}`);
    }
  }
}

module.exports = { startHTTPServer };