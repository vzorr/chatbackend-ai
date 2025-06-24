// bootstrap/initializers/environment-info.js - DEBUG VERSION
console.log('🔍 DEBUG - Loading environment-info.js file');

async function logEnvironmentInfo() {
  console.log('🔍 DEBUG - logEnvironmentInfo function called');
  const startTime = Date.now();
  
  try {
    console.log('🔍 DEBUG - Step 1: Starting try block');
    
    // Safe config loading with fallback
    let config;
    console.log('🔍 DEBUG - Step 2: About to load config');
    try {
      config = require('../../config/config');
      console.log('🔍 DEBUG - Step 2a: Config loaded successfully');
    } catch (configError) {
      console.log('🔍 DEBUG - Step 2b: Config loading failed:', configError.message);
      config = {};
    }

    console.log('🔍 DEBUG - Step 3: About to load logger');
    let logger;
    try {
      const loggerModule = require('../../utils/logger');
      logger = loggerModule.logger;
      console.log('🔍 DEBUG - Step 3a: Logger loaded successfully');
    } catch (loggerError) {
      console.log('🔍 DEBUG - Step 3b: Logger loading failed:', loggerError.message);
      logger = null;
    }

    console.log('🔍 DEBUG - Step 4: About to collect basic info');
    
    // Basic system info that always works
    const basicInfo = {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid
    };
    console.log('🔍 DEBUG - Step 4a: Basic info collected:', basicInfo);

    console.log('🔍 DEBUG - Step 5: About to get memory usage');
    try {
      basicInfo.memoryUsage = process.memoryUsage();
      console.log('🔍 DEBUG - Step 5a: Memory usage added');
    } catch (memError) {
      console.log('🔍 DEBUG - Step 5b: Memory usage failed:', memError.message);
    }

    console.log('🔍 DEBUG - Step 6: About to get process info');
    try {
      basicInfo.ppid = process.ppid;
      basicInfo.execPath = process.execPath;
      basicInfo.cwd = process.cwd();
      basicInfo.uptime = process.uptime();
      console.log('🔍 DEBUG - Step 6a: Process info added');
    } catch (processError) {
      console.log('🔍 DEBUG - Step 6b: Process info failed:', processError.message);
    }

    console.log('🔍 DEBUG - Step 7: About to create config info');
    const safeConfig = {
      server: {
        port: config?.server?.port || process.env.PORT || 'not set',
        host: config?.server?.host || process.env.HOST || 'not set',
        nodeEnv: config?.server?.nodeEnv || process.env.NODE_ENV || 'development'
      }
    };
    console.log('🔍 DEBUG - Step 7a: Config info created');

    console.log('🔍 DEBUG - Step 8: About to load OS module');
    try {
      const os = require('os');
      console.log('🔍 DEBUG - Step 8a: OS module loaded');
      
      console.log('🔍 DEBUG - Step 8b: About to get hostname');
      const hostname = os.hostname();
      console.log('🔍 DEBUG - Step 8c: Hostname got:', hostname);
      
      console.log('🔍 DEBUG - Step 8d: About to get system type');
      const type = os.type();
      console.log('🔍 DEBUG - Step 8e: System type got:', type);
      
      console.log('🔍 DEBUG - Step 8f: About to get loadavg');
      const loadavg = os.loadavg();
      console.log('🔍 DEBUG - Step 8g: Loadavg got:', loadavg);
      
      console.log('🔍 DEBUG - Step 8h: About to get memory info');
      const totalmem = os.totalmem();
      const freemem = os.freemem();
      console.log('🔍 DEBUG - Step 8i: Memory info got');
      
      console.log('🔍 DEBUG - Step 8j: About to get CPU info');
      const cpus = os.cpus();
      console.log('🔍 DEBUG - Step 8k: CPU info got, count:', cpus.length);
      
    } catch (osError) {
      console.log('🔍 DEBUG - Step 8z: OS operations failed:', osError.message);
    }

    console.log('🔍 DEBUG - Step 9: About to log via logger');
    if (logger && logger.info) {
      try {
        logger.info('🚀 Environment info logged via logger');
        console.log('🔍 DEBUG - Step 9a: Logger.info completed');
      } catch (loggerInfoError) {
        console.log('🔍 DEBUG - Step 9b: Logger.info failed:', loggerInfoError.message);
      }
    } else {
      console.log('🔍 DEBUG - Step 9c: No logger available');
    }

    const duration = Date.now() - startTime;
    console.log(`🔍 DEBUG - Step 10: Function completed in ${duration}ms`);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`🔍 DEBUG - ERROR after ${duration}ms:`, error.message);
    console.error('🔍 DEBUG - ERROR stack:', error.stack);
  }
  
  console.log('🔍 DEBUG - logEnvironmentInfo function ending');
}

console.log('🔍 DEBUG - About to export logEnvironmentInfo');
module.exports = { logEnvironmentInfo };
console.log('🔍 DEBUG - logEnvironmentInfo exported');