// db/models/index.js
const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const logger = require('../../utils/logger');
const connectionManager = require('../connectionManager');

const db = {};
let sequelizeInstance = null;
let initialized = false;

/**
 * Initializes all models and associations using the enterprise pattern.
 * Lazy initialization with ConnectionManager.
 */
async function initializeModels() {
  if (initialized) {
    logger.info('Models already initialized, returning db instance.');
    return db;
  }

  try {
    // Ensure ConnectionManager is initialized
    if (!connectionManager.checkConnection()) {
      logger.info('Initializing database connection from models...');
      await connectionManager.initialize();
      logger.info('Database connection initialized successfully from models');
    }

    sequelizeInstance = connectionManager.getConnection();

    logger.info('Loading models...');
    fs
      .readdirSync(__dirname)
      .filter((file) => {
        return (
          file.indexOf('.') !== 0 &&
          file !== basename &&
          (file.slice(-3) === '.js' || file.slice(-3) === '.ts')
        );
      })
      .forEach((file) => {
        const model = require(path.join(__dirname, file))(sequelizeInstance, Sequelize.DataTypes);
        db[model.name] = model;
        logger.info(`Model loaded: ${model.name}`);
      });

    // Run model associations
    Object.keys(db).forEach((modelName) => {
      if (db[modelName].associate) {
        db[modelName].associate(db);
        logger.info(`Associations setup for model: ${modelName}`);
      }
    });

    // Add hooks if defined in models
    Object.keys(db).forEach((modelName) => {
      if (db[modelName].addHooks) {
        db[modelName].addHooks();
        logger.info(`Hooks registered for model: ${modelName}`);
      }
    });

    db.sequelize = sequelizeInstance;
    db.Sequelize = Sequelize;

    initialized = true;
    logger.info('✅ All models initialized and associations set up successfully.');

    return db;
  } catch (error) {
    logger.error('❌ Error initializing models', { error: error.message });
    throw error;
  }
}

/**
 * Getter to ensure connection and models are safely retrieved.
 */
function getDbInstance() {
  if (!initialized) {
    logger.error('❌ Models not initialized. Call initializeModels() first.');
    return db; // Still return the db object, even if empty
  }
  return db;
}

/**
 * Synchronize all models with database (force or alter based on env).
 */
async function syncModels(options = {}) {
  if (!sequelizeInstance) {
    logger.error('❌ No Sequelize instance found. Call initializeModels() first.');
    throw new Error('Sequelize not initialized');
  }
  logger.info('🔄 Synchronizing all models with database...');
  await sequelizeInstance.sync(options);
  logger.info('✅ Database models synchronized successfully.');
}

// Initialize models on first require
(async () => {
  try {
    await initializeModels();
  } catch (error) {
    logger.error('Failed to initialize models on require', { error: error.message });
  }
})();

module.exports = db;
module.exports.initialize = initializeModels;
module.exports.getDbInstance = getDbInstance;
module.exports.sync = syncModels;