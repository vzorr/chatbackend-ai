'use strict';

const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const connectionManager = require('../connectionManager');
const logger = require('../../utils/logger');

const basename = path.basename(__filename);
const db = {};

// Get sequelize instance from connection manager
let sequelize;
try {
  sequelize = connectionManager.getConnection();
} catch (error) {
  logger.error('Failed to get database connection', { error: error.message });
  // Create a new instance if connection manager hasn't been initialized yet
  const config = require('../../config/config').database;
  sequelize = new Sequelize(config.name, config.user, config.password, {
    host: config.host,
    port: config.port,
    dialect: config.dialect,
    logging: config.logging ? (msg) => logger.debug('SQL Query', { query: msg }) : false,
    pool: config.pool
  });
}

// Load all models
fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    try {
      const model = require(path.join(__dirname, file))(sequelize, DataTypes);
      db[model.name] = model;
      logger.debug(`Model loaded: ${model.name}`);
    } catch (error) {
      logger.error(`Failed to load model from file: ${file}`, {
        error: error.message,
        stack: error.stack
      });
    }
  });

// Setup associations
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    try {
      db[modelName].associate(db);
      logger.debug(`Associations set up for model: ${modelName}`);
    } catch (error) {
      logger.error(`Failed to set up associations for model: ${modelName}`, {
        error: error.message
      });
    }
  }
});

// Setup global hooks
sequelize.addHook('beforeBulkCreate', (instances, options) => {
  logger.debug('Bulk create operation starting', {
    model: options.model?.name,
    count: instances?.length
  });
});

sequelize.addHook('afterBulkCreate', (instances, options) => {
  logger.debug('Bulk create operation completed', {
    model: options.model?.name,
    count: instances?.length
  });
});

sequelize.addHook('beforeBulkUpdate', (options) => {
  logger.debug('Bulk update operation starting', {
    model: options.model?.name,
    where: options.where
  });
});

sequelize.addHook('afterBulkUpdate', (options) => {
  logger.debug('Bulk update operation completed', {
    model: options.model?.name,
    where: options.where
  });
});

// Model validation utilities
db.validateAssociations = async () => {
  const errors = [];
  
  for (const modelName of Object.keys(db)) {
    const model = db[modelName];
    
    if (model.associations) {
      for (const [assocName, association] of Object.entries(model.associations)) {
        try {
          // Check if target model exists
          if (!association.target) {
            errors.push(`${modelName}: Association '${assocName}' has no target model`);
          }
        } catch (error) {
          errors.push(`${modelName}: Error in association '${assocName}': ${error.message}`);
        }
      }
    }
  }
  
  if (errors.length > 0) {
    logger.error('Model association validation failed', { errors });
    return false;
  }
  
  logger.info('Model association validation passed');
  return true;
};

// Export database objects
db.sequelize = sequelize;
db.Sequelize = Sequelize;
db.connectionManager = connectionManager;

// Export utility functions
db.Op = Sequelize.Op;
db.DataTypes = DataTypes;

// Model helper functions
db.transaction = async (callback) => {
  const t = await sequelize.transaction();
  try {
    const result = await callback(t);
    await t.commit();
    return result;
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

// Sync database function
db.sync = async (options = {}) => {
  try {
    logger.info('Starting database synchronization...');
    await sequelize.sync(options);
    logger.info('Database synchronized successfully');
  } catch (error) {
    logger.error('Database synchronization failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

module.exports = db;