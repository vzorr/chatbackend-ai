// bootstrap/initializers/models.js
const db = require('../../db');
const logger = require('../../utils/logger');

async function initializeModels() {
  logger.info('📦 [Models] Starting database connection and Sequelize models initialization...');

  try {

      // Ensure models are loaded before proceeding
      
      await db.waitForInitialization();
      const models = db.getModels();
      logger.info('✅ Verified models are loaded:', Object.keys(models).filter(k => k !== 'sequelize' && k !== 'Sequelize'));

    // Step 1: Initialize connection + models
    await db.initialize();

    // Step 2: Validate loaded models explicitly
    // const models = db.getModels();
    const modelNames = Object.keys(models).filter(name => name !== 'sequelize' && name !== 'Sequelize');

    if (modelNames.length === 0) {
      logger.error('❌ [Models] No models were loaded. Check db/models/index.js and ensure models exist.');
      throw new Error('No models loaded');
    }

    logger.info('✅ [Models] Database models initialized and verified');
    logger.info('✅ [Models] Loaded models:', modelNames);
  } catch (error) {
    logger.error('❌ [Models] Failed to initialize models', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

module.exports = { initializeModels };
