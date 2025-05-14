// bootstrap/validators/environment.js
const { logger } = require('../../utils/logger');

async function validateEnvironment() {
  const startTime = Date.now();
  logger.info('🔍 [Environment] Validating environment variables...');

  const requiredEnvVars = [
    'NODE_ENV',
    'PORT',
    'DATABASE_URL',
    'REDIS_URL',
    'JWT_SECRET',
    'CORS_ORIGIN'
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
  if (!validEnvironments.includes(process.env.NODE_ENV)) {
    logger.error('❌ [Environment] Invalid NODE_ENV value', {
      value: process.env.NODE_ENV,
      valid: validEnvironments
    });
    throw new Error(`Invalid NODE_ENV: ${process.env.NODE_ENV}`);
  }

  // Validate port
  const port = parseInt(process.env.PORT, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    logger.error('❌ [Environment] Invalid PORT value', {
      value: process.env.PORT
    });
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }

  const duration = Date.now() - startTime;
  logger.info('✅ [Environment] Environment variables validated', {
    duration: `${duration}ms`,
    environment: process.env.NODE_ENV,
    port: process.env.PORT
  });
}

module.exports = { validateEnvironment };