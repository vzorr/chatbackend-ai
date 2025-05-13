// db/index.js - Fixed initialization
const connectionManager = require('./connectionManager');
const logger = require('../utils/logger');

// Export the connection manager and methods
module.exports = {
  // Get connection - initializes if needed
  async getConnection() {
    if (!connectionManager.sequelize) {
      await connectionManager.initialize();
    }
    return connectionManager.getConnection();
  },
  
  // Connection manager
  connectionManager,
  
  // Initialize connection
  async initialize() {
    return connectionManager.initialize();
  }
};

// Initialize models only after connection is ready
let modelsInitialized = false;

async function initializeModels() {
  if (modelsInitialized) return;
  
  try {
    await connectionManager.initialize();
    const models = require('./models');
    modelsInitialized = true;
    logger.info('Database module and models initialized successfully');
  } catch (err) {
    logger.error('Failed to initialize database module', {
      error: err.message,
      stack: err.stack
    });
    throw err;
  }
}

// Auto-initialize on first require (but don't block)
initializeModels().catch(err => {
  logger.error('Background model initialization failed', { error: err.message });
});