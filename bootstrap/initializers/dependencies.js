// bootstrap/validators/dependencies.js
const { logger } = require('../../utils/logger');
const fs = require('fs').promises;
const path = require('path');

async function validateDependencies() {
  const startTime = Date.now();
  logger.info('🔍 [Dependencies] Validating system dependencies...');

  try {
    // Check for required directories
    await validateDirectories();
    
    // Check for required files
    await validateFiles();
    
    // Check node version
    validateNodeVersion();
    
    // Check critical npm packages
    await validateNpmPackages();

    const duration = Date.now() - startTime;
    logger.info('✅ [Dependencies] All dependencies validated', {
      duration: `${duration}ms`
    });
  } catch (error) {
    logger.error('❌ [Dependencies] Dependency validation failed', {
      error: error.message
    });
    throw error;
  }
}

async function validateDirectories() {
  logger.info('📁 [Dependencies] Checking required directories...');
  
  const requiredDirs = [
    'uploads',
    'logs',
    'temp',
    'public'
  ];

  for (const dir of requiredDirs) {
    const dirPath = path.join(process.cwd(), dir);
    try {
      await fs.access(dirPath);
      logger.info(`✅ [Dependencies] Directory exists: ${dir}`);
    } catch (error) {
      logger.info(`📁 [Dependencies] Creating directory: ${dir}`);
      await fs.mkdir(dirPath, { recursive: true });
    }
  }
}

async function validateFiles() {
  logger.info('📄 [Dependencies] Checking required files...');
  
  const requiredFiles = [
    'config/index.js',
    'utils/logger.js'
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(process.cwd(), file);
    try {
      await fs.access(filePath);
      logger.info(`✅ [Dependencies] File exists: ${file}`);
    } catch (error) {
      logger.error(`❌ [Dependencies] Missing required file: ${file}`);
      throw new Error(`Required file not found: ${file}`);
    }
  }
}

function validateNodeVersion() {
  logger.info('🔍 [Dependencies] Checking Node.js version...');
  
  const requiredVersion = '14.0.0';
  const currentVersion = process.version;
  const versionNumber = currentVersion.slice(1); // Remove 'v' prefix
  
  if (compareVersions(versionNumber, requiredVersion) < 0) {
    logger.error('❌ [Dependencies] Node.js version too old', {
      required: requiredVersion,
      current: currentVersion
    });
    throw new Error(`Node.js version ${requiredVersion} or higher required. Current: ${currentVersion}`);
  }
  
  logger.info('✅ [Dependencies] Node.js version OK', {
    version: currentVersion
  });
}

async function validateNpmPackages() {
  logger.info('📦 [Dependencies] Checking required npm packages...');
  
  const criticalPackages = [
    'express',
    'socket.io',
    'mongoose',
    'redis',
    'jsonwebtoken'
  ];

  for (const pkg of criticalPackages) {
    try {
      require.resolve(pkg);
      logger.info(`✅ [Dependencies] Package found: ${pkg}`);
    } catch (error) {
      logger.error(`❌ [Dependencies] Missing package: ${pkg}`);
      throw new Error(`Required package not found: ${pkg}. Run 'npm install'`);
    }
  }
}

function compareVersions(current, required) {
  const currentParts = current.split('.').map(Number);
  const requiredParts = required.split('.').map(Number);
  
  for (let i = 0; i < requiredParts.length; i++) {
    if (currentParts[i] > requiredParts[i]) return 1;
    if (currentParts[i] < requiredParts[i]) return -1;
  }
  
  return 0;
}

module.exports = { validateDependencies };