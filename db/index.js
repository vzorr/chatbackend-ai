const { Sequelize } = require("sequelize");
const config = require('../config/config');
const logger = require('../utils/logger');

// Create Sequelize instance with configuration
const sequelize = new Sequelize(
  config.database.name,
  config.database.user,
  config.database.password,
  {
    host: config.database.host,
    port: config.database.port,
    dialect: config.database.dialect,
    logging: config.database.logging ? 
      (msg) => logger.debug('SQL Query', { query: msg }) : false,
    pool: {
      max: config.database.pool.max,
      min: config.database.pool.min,
      acquire: config.database.pool.acquire,
      idle: config.database.pool.idle
    },
    // Retry logic for connection
    retry: {
      match: [
        Sequelize.ConnectionError,
        Sequelize.ConnectionTimedOutError,
        Sequelize.TimeoutError,
        /Deadlock/i,
        /SQLITE_BUSY/
      ],
      max: 3
    }
  }
);

// Test connection on initialization
sequelize.authenticate()
  .then(() => {
    logger.info('Database connection established successfully', {
      host: config.database.host,
      database: config.database.name
    });
  })
  .catch(err => {
    logger.error('Unable to connect to the database', { 
      error: err.message,
      host: config.database.host,
      database: config.database.name
    });
  });

module.exports = sequelize;