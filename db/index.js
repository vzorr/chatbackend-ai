// db/index.js - Enterprise-grade fixed initialization preserving existing code pattern
const connectionManager = require('./connectionManager');
const modelsLoader = require('./models');
const logger = require('../utils/logger');

let modelsInitialized = false;

/**
 * Initialize connection and models together.
 * Ensures connection is healthy first, then initializes models.
 * Uses existing connectionManager and modelsLoader hybrid export pattern.
 */
async function initialize() {
  if (modelsInitialized) {
    logger.info('Database and models already initialized, skipping...');
    return;
  }

  try {
    logger.info('🔧 Initializing database connection...');
    await connectionManager.initialize();
    logger.info('✅ Database connection initialized successfully');

    logger.info('📦 Initializing Sequelize models...');
    // Always call modelsLoader.initialize() (do not call initializeModels directly)
    await modelsLoader.initialize();
    logger.info('✅ Sequelize models initialized successfully');

    modelsInitialized = true;
    logger.info('🚀 Database and models fully initialized and verified');
  } catch (error) {
    logger.error('❌ Failed to initialize database and models', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Get Sequelize models after ensuring initialized.
 */
function getModels() {
  try {
    const models = modelsLoader.getDbInstance();
    if (!models || Object.keys(models).length === 0) {
      throw new Error('Models not initialized or empty. Ensure initialize() is called first.');
    }
    return models;
  } catch (error) {
    logger.error('❌ Failed to get models', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

/**
 * Get current database connection safely.
 * Will auto-initialize connection if not ready.
 */
async function getConnection() {
  if (!connectionManager.sequelize) {
    logger.info('🔄 Connection not found, initializing...');
    await connectionManager.initialize();
  } else {
    logger.info('✅ Reusing existing database connection');
  }
  return connectionManager.getConnection();
}

module.exports = {
  initialize,
  getConnection,
  getModels,
};
