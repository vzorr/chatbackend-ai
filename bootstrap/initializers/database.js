// bootstrap/initializers/database.js
const { logger } = require('../../utils/logger');
const connectionManager = require('../../db/connectionManager');
const config = require('../../config/config');

async function initializeDatabase() {
  const startTime = Date.now();
  logger.info('🔧 [Database] Starting database initialization...');

  try {
    // Pre-initialization checks
    await validateDatabaseConfig();
    
    // Initialize connection using the connection manager
    logger.info('🔌 [Database] Connecting to PostgreSQL database...');
    await connectionManager.initialize();
    
    // Verify connection
    await verifyDatabaseConnection();
    
    const duration = Date.now() - startTime;
    logger.info('✅ [Database] Database initialization completed', {
      duration: `${duration}ms`,
      database: config.database.name,
      host: config.database.host,
      dialect: config.database.dialect,
      status: 'connected'
    });
    
  } catch (error) {
    logger.error('❌ [Database] Database initialization failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function validateDatabaseConfig() {
  logger.info('🔍 [Database] Validating database configuration...');
  
  // For PostgreSQL, we need individual connection parameters, not a URL
  if (!config.database.host) {
    throw new Error('Database host not configured');
  }
  
  if (!config.database.name) {
    throw new Error('Database name not configured');
  }
  
  if (!config.database.user) {
    throw new Error('Database user not configured');
  }
  
  logger.info('✅ [Database] Configuration validated', {
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    dialect: config.database.dialect
  });
}

async function verifyDatabaseConnection() {
  logger.info('🔍 [Database] Verifying database connection...');
  
  try {
    // Check if the connection manager has specific methods
    if (connectionManager.checkConnection) {
      const isConnected = await connectionManager.checkConnection();
      logger.info('✅ [Database] Connection verified', {
        connected: isConnected
      });
    } else if (connectionManager.sequelize) {
      // Try using Sequelize's authenticate method
      await connectionManager.sequelize.authenticate();
      logger.info('✅ [Database] Connection verified via Sequelize authenticate');
    } else {
      // If no specific health check, just verify it's initialized
      logger.info('✅ [Database] Connection manager initialized');
    }
  } catch (error) {
    logger.error('❌ [Database] Connection verification failed', {
      error: error.message
    });
    throw error;
  }
}

module.exports = { initializeDatabase };