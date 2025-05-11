// scripts/initialize.js
require('dotenv').config();
const { execSync } = require('child_process');
const logger = require('../utils/logger');

// Run all initialization tasks
const initialize = async () => {
  try {
    logger.info('Starting initialization process');
    
    // Run database migrations
    logger.info('Running database migrations...');
    execSync('npx sequelize-cli db:migrate', { stdio: 'inherit' });
    
    // Set up bot and knowledge base
    logger.info('Setting up bot and knowledge base...');
    execSync('node scripts/setup-bot.js', { stdio: 'inherit' });
    
    logger.info('Initialization completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error(`Initialization error: ${error}`);
    process.exit(1);
  }
};

// Run initialization
initialize();