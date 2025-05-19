// queueWorker.js
require('dotenv').config();
const { queueService } = require('./services/queue');
const logger = require('./utils/logger');
const promClient = require('prom-client');
const { v4: uuidv4 } = require('uuid');
const CircuitBreaker = require('opossum');
const os = require('os');
const config = require('./config/config');
const express = require('express');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

// Import all queue services
const messageQueueService = require('./services/queue/MessageQueueService');
const presenceQueueService = require('./services/queue/PresenceQueueService');
const notificationQueueService = require('./services/queue/notificationQueueService');

// Initialize all services at startup
async function initializeQueueServices() {
  logger.info('Initializing queue services...');
  
  try {
    // Initialize all services
    await messageQueueService.initialize();
    await presenceQueueService.initialize();
    // Notification service is likely already initialized

    // Start processing with each service
    await messageQueueService.start();
    await presenceQueueService.start();
    
    logger.info('All queue services initialized and started successfully');
  } catch (error) {
    logger.error('Failed to initialize queue services', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Call the initialization function
initializeQueueServices().catch(error => {
  logger.error('Error during queue services initialization', { 
    error: error.message,
    stack: error.stack
  });
});

// Prometheus custom metrics
const jobProcessedCounter = new promClient.Counter({
  name: 'worker_jobs_processed_total',
  help: 'Total jobs processed',
});
const jobFailedCounter = new promClient.Counter({
  name: 'worker_jobs_failed_total',
  help: 'Total jobs failed',
});
const dlqJobCounter = new promClient.Counter({
  name: 'worker_dlq_jobs_total',
  help: 'Total jobs moved to DLQ',
});
const jobProcessingTime = new promClient.Histogram({
  name: 'worker_job_processing_duration_seconds',
  help: 'Job processing time in seconds',
});

// Circuit breaker config
const breakerOptions = {
  timeout: config.worker.breakerTimeout,
  errorThresholdPercentage: config.worker.breakerThreshold,
  resetTimeout: config.worker.breakerReset,
};

const riskyExternalCall = async (data) => {
  return Promise.resolve(`Processed: ${data}`);
};
const breaker = new CircuitBreaker(riskyExternalCall, breakerOptions);

// Worker Identification
const instanceId = uuidv4();
const hostname = os.hostname();
const ipAddress = Object.values(os.networkInterfaces())
  .flat()
  .filter((item) => item.family === 'IPv4' && !item.internal)[0].address;

logger.setContext({ instanceId, hostname, ipAddress });
logger.info('Worker started');

function categorizeError(error) {
  if (error.message.includes('timeout')) return 'transient';
  if (error.message.includes('Service Unavailable')) return 'external_service_down';
  return 'permanent';
}

// Process main queue
queueService.process(async (job) => {
  const traceId = uuidv4();
  logger.setContext({ traceId });

  const startTime = Date.now();
  try {
    logger.info('Job started', { jobId: job.id, data: job.data });

    const result = await breaker.fire(job.data);

    jobProcessedCounter.inc();
    logger.info('Job completed', { jobId: job.id, result });

    return result;
  } catch (err) {
    jobFailedCounter.inc();
    logger.error('Job failed', { jobId: job.id, error: err });

    const errorType = categorizeError(err);
    logger.warn('Error categorized', { errorType });

    if (errorType === 'permanent' || job.attemptsMade >= job.opts.attempts) {
      logger.warn('Moving job to DLQ', { jobId: job.id });
      dlqJobCounter.inc();
      await queueService.getQueue(config.dlqQueueName).add(job.data);
    }

    throw err;
  } finally {
    const duration = (Date.now() - startTime) / 1000;
    jobProcessingTime.observe(duration);
    logger.clearContext();
  }
}, {
  attempts: config.worker.retries,
  backoff: { type: 'exponential', delay: config.worker.backoffDelay },
  removeOnComplete: true,
  removeOnFail: false,
});

// Process DLQ for retry manually every 5 mins
setInterval(async () => {
  logger.setContext({ traceId: uuidv4() });
  const dlq = queueService.getQueue(config.dlqQueueName);
  const jobs = await dlq.getWaiting();
  logger.info('DLQ status', { jobs: jobs.length });

  for (const job of jobs) {
    logger.info('Retrying DLQ job', { jobId: job.id });
    await queueService.add(job.data);
    await job.remove();
  }
  logger.clearContext();
}, 300000);

// Process notification queue periodically
setInterval(async () => {
  try {
    await notificationQueueService.processNotificationQueue();
  } catch (error) {
    logger.error(`Error processing notification queue: ${error.message}`, {
      error: error.stack
    });
  }
}, 5000); // Process every 5 seconds

// Process presence queue cleanup periodically
setInterval(async () => {
  try {
    await presenceQueueService.cleanupStalePresenceData();
  } catch (error) {
    logger.error(`Error cleaning up stale presence data: ${error.message}`, {
      error: error.stack
    });
  }
}, 300000); // Clean up every 5 minutes

// Bull Board UI (configurable)
if (config.bullBoard.enabled) {
  const bullBoardApp = express();
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(config.bullBoard.basePath);

  createBullBoard({
    queues: [
      new BullAdapter(queueService.getQueue()),
      new BullAdapter(queueService.getQueue(config.dlqQueueName)),
    ],
    serverAdapter,
  });

  bullBoardApp.use(config.bullBoard.basePath, serverAdapter.getRouter());

  bullBoardApp.listen(config.bullBoard.port, () => {
    logger.info('Bull Board running', { url: `${config.bullBoard.publicUrl}${config.bullBoard.basePath}` });
  });
}

// Graceful shutdown
const shutdown = async () => {
  logger.info('Worker shutdown initiated');
  try {
    // Stop all queue services
    if (messageQueueService && messageQueueService.stop) {
      await messageQueueService.stop();
      logger.info('Message queue service stopped');
    }
    
    if (presenceQueueService && presenceQueueService.stop) {
      await presenceQueueService.stop();
      logger.info('Presence queue service stopped');
    }

    // Close queue service last
    await queueService.close();
    logger.info('Queue closed gracefully');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err });
    process.exit(1);
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

logger.info('Worker ready and waiting for jobs...');