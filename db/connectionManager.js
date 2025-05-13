// db/connectionManager.js
const { Sequelize } = require('sequelize');
const config = require('../config/config').database;
const logger = require('../utils/logger');

let sequelizeInstance = null;
let isConnected = false;
let connectionTimestamp = null;
let retryCounter = 0;

/**
 * Initialize Sequelize connection safely.
 * Will not create new connection if already initialized.
 */
async function initialize() {
  if (sequelizeInstance && isConnected) {
    logger.info('Database connection already initialized and healthy');
    return sequelizeInstance;
  }

  logger.info('🔌 Initializing database connection using centralized config');

  try {
    sequelizeInstance = new Sequelize(config.name, config.user, config.password, {
      host: config.host,
      port: config.port,
      dialect: config.dialect,
      logging: config.logging ? (msg) => logger.debug('SQL Query', { query: msg }) : false,
      pool: {
        max: config.pool.max,
        min: config.pool.min,
        acquire: config.pool.acquire,
        idle: config.pool.idle,
        evict: 1000,
        validate: (client) => {
          try {
            return client.validate ? client.validate() : true;
          } catch (err) {
            logger.warn('Sequelize client validation failed', { error: err.message });
            return false;
          }
        }
      },
      dialectOptions: {
        statement_timeout: config.statementTimeout || 5000,
      },
    });

    // Attach event listeners
    sequelizeInstance.connectionManager.on('error', (err) => {
      logger.error('Sequelize connectionManager error event triggered', { error: err.message });
    });

    sequelizeInstance.addHook('afterConnect', (connection) => {
      logger.info('✅ Sequelize connection established and afterConnect hook triggered');
    });

    // Test initial connection
    await sequelizeInstance.authenticate();
    isConnected = true;
    connectionTimestamp = new Date();
    logger.info('✅ Database connection established successfully');

    return sequelizeInstance;
  } catch (error) {
    logger.error('❌ Failed to initialize database connection', { error: error.message });
    sequelizeInstance = null;
    isConnected = false;
    retryCounter++;
    throw error;
  }
}

/**
 * Check if connection is currently healthy.
 */
function checkConnection() {
  return isConnected && sequelizeInstance instanceof Sequelize;
}

/**
 * Return connection pool stats.
 */
async function getConnectionStats() {
  if (!sequelizeInstance) {
    logger.warn('No Sequelize instance available for pool stats');
    return null;
  }

  const pool = sequelizeInstance.connectionManager.pool;
  return {
    total: pool.size,
    available: pool.available,
    waiting: pool.pending,
    acquired: pool.borrowed,
    idle: pool.idle,
    evicting: pool._evictor ? pool._evictor._evicting : undefined,
  };
}

/**
 * Get active Sequelize instance.
 */
function getConnection() {
  if (!sequelizeInstance || !isConnected) {
    logger.error('Database connection not initialized. Call initialize() first.');
    throw new Error('Database connection not initialized');
  }
  return sequelizeInstance;
}

/**
 * Ping the database by running a trivial query.
 */
async function ping() {
  if (!sequelizeInstance) {
    throw new Error('Database connection not initialized');
  }

  try {
    await sequelizeInstance.query('SELECT 1');
    logger.info('✅ Database ping successful');
    return true;
  } catch (error) {
    logger.error('❌ Database ping failed', { error: error.message });
    return false;
  }
}

/**
 * Close the connection gracefully.
 */
async function close() {
  if (sequelizeInstance) {
    try {
      await sequelizeInstance.close();
      logger.info('✅ Database connection closed gracefully');
    } catch (error) {
      logger.error('❌ Error closing database connection', { error: error.message });
    } finally {
      sequelizeInstance = null;
      isConnected = false;
    }
  } else {
    logger.warn('⚠️ No active database connection to close');
  }
}

module.exports = {
  initialize,
  getConnection,
  checkConnection,
  getConnectionStats,
  ping,
  close,
};
