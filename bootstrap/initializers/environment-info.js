// bootstrap/initializers/environment-info.js
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

async function logEnvironmentInfo() {
  const startTime = Date.now();
  logger.info('🌍 [Environment] Logging environment information...');

  // Log initial startup
  logger.info('🚀 [Environment] Chat Server Starting...', {
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
    env: config.server.nodeEnv
  });

  // Log configuration
  logger.info('📋 [Environment] Server Configuration', {
    server: {
      port: config.server.port,
      host: config.server.host,
      corsOrigin: config.server.corsOrigin,
      socketPath: config.server.socketPath
    },
    database: {
      host: config.database.host || 'localhost',
      port: config.database.port || 27017,
      name: config.database.name,
      dialect: config.database.dialect || 'mongodb'
    },
    redis: {
      host: config.redis.host,
      port: config.redis.port,
      hasPassword: !!config.redis.password
    },
    features: config.features,
    cluster: {
      enabled: config.cluster.enabled,
      workerCount: config.cluster.workerCount
    },
    notifications: {
      fcmEnabled: !!config.notifications?.providers?.fcm?.enabled,
      apnEnabled: !!config.notifications?.providers?.apn?.enabled
    }
  });

  // Log detailed environment information
  logger.info('🌍 [Environment] Detailed Environment Information', {
    nodeVersion: process.version,
    npmVersion: process.env.npm_package_version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    ppid: process.ppid,
    execPath: process.execPath,
    cwd: process.cwd(),
    memoryUsage: process.memoryUsage(),
    cpuUsage: process.cpuUsage(),
    env: {
      NODE_ENV: config.server.nodeEnv,
      PORT: config.server.port,
      HOST: config.server.host
    }
  });

  const duration = Date.now() - startTime;
  logger.info('✅ [Environment] Environment information logged', {
    duration: `${duration}ms`
  });
}

module.exports = { logEnvironmentInfo };