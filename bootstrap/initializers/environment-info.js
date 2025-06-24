// bootstrap/initializers/environment-info.js
const { logger } = require('../../utils/logger');

async function logEnvironmentInfo() {
  const startTime = Date.now();
  
  try {
    // Safe config loading with fallback
    let config;
    try {
      config = require('../../config/config');
    } catch (configError) {
      console.log('⚠️ [Environment] Config loading failed, using defaults');
      config = {};
    }

    console.log('🌍 [Environment] Starting environment info logging...');
    
    if (logger && logger.info) {
      logger.info('🌍 [Environment] Logging environment information...');
    }

    // Basic system info that always works
    const basicInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      ppid: process.ppid,
      execPath: process.execPath,
      cwd: process.cwd(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      env: process.env.NODE_ENV || 'development'
    };

    console.log('🚀 [Environment] Basic Info:', basicInfo);

    // Safe config access
    const safeConfig = {
      server: {
        port: config?.server?.port || process.env.PORT || 'not set',
        host: config?.server?.host || process.env.HOST || 'not set',
        nodeEnv: config?.server?.nodeEnv || process.env.NODE_ENV || 'development',
        corsOrigin: config?.server?.corsOrigin || 'not set',
        socketPath: config?.server?.socketPath || 'not set'
      },
      database: {
        host: config?.database?.host || process.env.DB_HOST || 'not set',
        port: config?.database?.port || process.env.DB_PORT || 'not set',
        name: config?.database?.name || process.env.DB_NAME || 'not set',
        dialect: config?.database?.dialect || 'not set'
      },
      redis: {
        host: config?.redis?.host || process.env.REDIS_HOST || 'not set',
        port: config?.redis?.port || process.env.REDIS_PORT || 'not set',
        hasPassword: !!(config?.redis?.password || process.env.REDIS_PASSWORD)
      },
      cluster: {
        enabled: config?.cluster?.enabled || false,
        workerCount: config?.cluster?.workerCount || 1
      },
      ssl: {
        enabled: config?.ssl?.enabled || false,
        trustProxy: config?.security?.trustProxy || false
      }
    };

    console.log('📋 [Environment] Configuration:', safeConfig);

    // System information
    const os = require('os');
    const systemInfo = {
      hostname: os.hostname(),
      type: os.type(),
      release: os.release(),
      loadavg: os.loadavg(),
      totalmem: Math.round(os.totalmem() / 1024 / 1024) + 'MB',
      freemem: Math.round(os.freemem() / 1024 / 1024) + 'MB',
      cpus: os.cpus().length
    };

    console.log('💻 [Environment] System Info:', systemInfo);

    // Log via logger if available
    if (logger && logger.info) {
      logger.info('🚀 [Environment] Chat Server Starting...', basicInfo);
      logger.info('📋 [Environment] Server Configuration', safeConfig);
      logger.info('💻 [Environment] System Information', systemInfo);
    }

    const duration = Date.now() - startTime;
    console.log(`✅ [Environment] Environment info logged in ${duration}ms`);
    
    if (logger && logger.info) {
      logger.info('✅ [Environment] Environment information logged', {
        duration: `${duration}ms`
      });
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ [Environment] Error after ${duration}ms:`, error.message);
    
    if (logger && logger.error) {
      logger.error('❌ [Environment] Failed to log environment info', {
        error: error.message,
        stack: error.stack,
        duration: `${duration}ms`
      });
    }
    
    // Don't throw - just log error and proceed
    console.log('⚠️ [Environment] Proceeding despite error...');
  }
}

module.exports = { logEnvironmentInfo };