// db/index.js
const connectionManager = require('./connectionManager');
const logger = require('../utils/logger');

// Initialize models when this file is required
const models = require('./models');

// Export the configured Sequelize instance
module.exports = connectionManager.getConnection();

// Export connection manager for direct access
module.exports.connectionManager = connectionManager;

// Initialize connection on module load
connectionManager.initialize()
  .then(() => {
    logger.info('Database module initialized successfully');
  })
  .catch(err => {
    logger.error('Failed to initialize database module', {
      error: err.message,
      stack: err.stack
    });
    process.exit(1);
  });