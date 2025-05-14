// bootstrap/validators/environment.js
const { logger } = require('../../utils/logger');

async function validateEnvironment() {
  const startTime = Date.now();
  logger.info('🔍 [Environment] Validating environment variables...');

  // Map the required variables to what they're actually called in your .env
  const requiredEnvVars = [
    'DB_HOST',
    'DB_PORT',
    'DB_NAME', 
    'DB_USER',
    'REDIS_HOST',
    'REDIS_PORT',
    'JWT_SECRET'
  ];

  const missingVars = [];
  
  for (const varName of requiredEnvVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    logger.error('❌ [Environment] Missing required environment variables', {
      missing: missingVars
    });
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }

  // Validate environment values
  const validEnvironments = ['development', 'staging', 'production', 'test'];
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  if (!validEnvironments.includes(nodeEnv)) {
    logger.error('❌ [Environment] Invalid NODE_ENV value', {
      value: nodeEnv,
      valid: validEnvironments
    });
    throw new Error(`Invalid NODE_ENV: ${nodeEnv}`);
  }

  // Validate port if provided
  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      logger.error('❌ [Environment] Invalid PORT value', {
        value: process.env.PORT
      });
      throw new Error(`Invalid PORT: ${process.env.PORT}`);
    }
  }

  const duration = Date.now() - startTime;
  logger.info('✅ [Environment] Environment variables validated', {
    duration: `${duration}ms`,
    environment: nodeEnv,
    port: process.env.PORT || 3001,
    database: {
      host: process.env.DB_HOST,
      name: process.env.DB_NAME
    },
    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT
    }
  });
}

module.exports = { validateEnvironment };