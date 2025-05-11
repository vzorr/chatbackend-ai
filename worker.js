// worker.js
require('dotenv').config();
const logger = require('./utils/logger');
const queueService = require('./services/queue');
const sequelize = require('./db');

// Connect to database
const initServices = async () => {
  try {
    // Test database connection
    await sequelize.authenticate();
    logger.info('Database connection established for worker');
    
    // Start worker processes
    startWorkers();
  } catch (error) {
    logger.error(`Worker initialization error: ${error}`);
    process.exit(1);
  }
};

// Start worker processes
const startWorkers = () => {
  logger.info('Starting queue workers');
  
  // Process message queue
  setInterval(async () => {
    try {
      const processedId = await queueService.processMessageQueue();
      if (processedId) {
        logger.debug(`Processed message ${processedId}`);
      }
    } catch (error) {
      logger.error(`Error processing message queue: ${error}`);
    }
  }, 500); // Every 500ms
  
  // Process presence queue
  setInterval(async () => {
    try {
      const processedId = await queueService.processPresenceQueue();
      if (processedId) {
        logger.debug(`Processed presence update for user ${processedId}`);
      }
    } catch (error) {
      logger.error(`Error processing presence queue: ${error}`);
    }
  }, 1000); // Every second
};

// Handle graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Worker shutting down');
  
  // Close database connection
  try {
    await sequelize.close();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error(`Error closing database connection: ${error}`);
  }
  
  // Close Redis client
  try {
    await queueService.redisClient.quit();
    logger.info('Redis connection closed');
  } catch (error) {
    logger.error(`Error closing Redis connection: ${error}`);
  }
  
  process.exit(0);
};

// Attach shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the worker
initServices();