// bootstrap/initializers/cluster.js
const cluster = require('cluster');
const os = require('os');
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

async function initializeCluster() {
  if (!config.cluster.enabled) {
    logger.info('⏭️ [Cluster] Cluster mode disabled, running in single process');
    return { isMaster: false, isWorker: false };
  }

  if (cluster.isPrimary) {
    return await initializePrimary();
  } else {
    return await initializeWorker();
  }
}

async function initializePrimary() {
  logger.info(`🔧 [Cluster] Primary ${process.pid} is running in cluster mode`);
  
  const workerCount = config.cluster.workerCount || os.cpus().length;
  logger.info(`📊 [Cluster] Starting ${workerCount} workers...`);

  // Fork workers
  for (let i = 0; i < workerCount; i++) {
    const worker = cluster.fork();
    logger.info(`👷 [Cluster] Worker ${i + 1} started`, { 
      pid: worker.process.pid,
      workerId: worker.id
    });
  }

  // Setup worker event handlers
  setupWorkerHandlers();
  
  // Monitor cluster health
  setupHealthMonitoring();

  return { isMaster: true, isWorker: false };
}

async function initializeWorker() {
  const workerId = cluster.worker?.id || 'single-process';
  logger.info(`🏃 [Cluster] Starting server (Worker ${workerId})...`);
  
  return { isMaster: false, isWorker: true, workerId };
}

function setupWorkerHandlers() {
  cluster.on('exit', (worker, code, signal) => {
    logger.error(`❌ [Cluster] Worker ${worker.process.pid} died`, { 
      code, 
      signal,
      workerId: worker.id 
    });
    
    // Restart worker after a delay
    setTimeout(() => {
      logger.info('♻️ [Cluster] Starting replacement worker...');
      const newWorker = cluster.fork();
      logger.info(`✅ [Cluster] Replacement worker started`, { 
        pid: newWorker.process.pid,
        workerId: newWorker.id
      });
    }, 1000);
  });

  cluster.on('online', (worker) => {
    logger.info(`✅ [Cluster] Worker ${worker.process.pid} is online`, {
      workerId: worker.id
    });
  });

  cluster.on('disconnect', (worker) => {
    logger.warn(`⚠️ [Cluster] Worker ${worker.process.pid} disconnected`, {
      workerId: worker.id
    });
  });
}

function setupHealthMonitoring() {
  setInterval(() => {
    const workers = Object.values(cluster.workers);
    const aliveWorkers = workers.filter(w => w.state === 'online').length;
    
    logger.info('📊 [Cluster] Health check', {
      totalWorkers: workers.length,
      aliveWorkers,
      deadWorkers: workers.length - aliveWorkers,
      workerDetails: workers.map(w => ({
        id: w.id,
        pid: w.process.pid,
        state: w.state
      }))
    });
  }, config.monitoring.healthCheckInterval || 60000);
}

module.exports = { initializeCluster };