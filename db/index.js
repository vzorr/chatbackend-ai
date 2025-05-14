// db/index.js - Enterprise-grade fixed initialization preserving existing code pattern
const connectionManager = require('./connectionManager');
const modelsLoader = require('./models');
const logger = require('../utils/logger');

let modelsInitialized = false;
let initializationPromise = null;

/**
 * Initialize connection and models together.
 * Ensures connection is healthy first, then initializes models.
 * Uses existing connectionManager and modelsLoader hybrid export pattern.
 */
async function initialize() {
  // If already initializing, return the same promise
  if (initializationPromise) {
    logger.info('Database initialization already in progress, waiting...');
    return initializationPromise;
  }

  if (modelsInitialized) {
    logger.info('Database and models already initialized, skipping...');
    return;
  }

  // Create a new promise for this initialization
  initializationPromise = (async () => {
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
  })();

  return initializationPromise;
}

/**
 * Get Sequelize models after ensuring initialized.
 */
function getModels() {
  try {
    const models = modelsLoader.getDbInstance();
    if (!models || Object.keys(models).length === 0) {
      logger.error('Models not initialized or empty', {
        modelsInitialized,
        modelKeys: models ? Object.keys(models) : []
      });
      throw new Error('Models not initialized or empty. Ensure initialize() is called first.');
    }
    return models;
  } catch (error) {
    logger.error('❌ Failed to get models', {
      error: error.message,
      stack: error.stack,
      modelsInitialized
    });
    throw error;
  }
}

/**
 * Get current database connection safely.
 * Will auto-initialize connection if not ready.
 */
async function getConnection() {
  if (!connectionManager.checkConnection()) {
    logger.info('🔄 Connection not found, initializing...');
    await connectionManager.initialize();
  } else {
    logger.info('✅ Reusing existing database connection');
  }
  return connectionManager.getConnection();
}

/**
 * Check if models are initialized
 */
function isInitialized() {
  return modelsInitialized;
}

/**
 * Wait for initialization to complete
 */
async function waitForInitialization() {
  if (initializationPromise) {
    await initializationPromise;
  } else if (!modelsInitialized) {
    await initialize();
  }
}

module.exports = {
  initialize,
  getConnection,
  getModels,
  isInitialized,
  waitForInitialization
};