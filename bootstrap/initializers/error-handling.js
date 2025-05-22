// bootstrap/initializers/error-handling.js
const { logger } = require('../../utils/logger');
const exceptionHandler = require('../../middleware/exceptionHandler');

async function setupErrorHandling(app) {
  const startTime = Date.now();
  logger.info('🔧 [ErrorHandling] Setting up error handlers...');

  try {
    // ✅ UPDATED: Use .bind() for proper context binding
    // 404 handler - must come before general error handler
    app.use('*', exceptionHandler.notFoundHandler.bind(exceptionHandler));
    logger.info('✅ [ErrorHandling] 404 handler configured with proper binding');

    // ✅ UPDATED: Use .bind() for proper context binding
    // General error handler - must be last middleware
    app.use(exceptionHandler.errorHandler.bind(exceptionHandler));
    logger.info('✅ [ErrorHandling] Error handler configured with proper binding');

    const duration = Date.now() - startTime;
    logger.info('✅ [ErrorHandling] Error handling setup completed', {
      duration: `${duration}ms`,
      handlers: 2,
      bindingEnabled: true
    });

  } catch (error) {
    logger.error('❌ [ErrorHandling] Error handling setup failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// ✅ CLEAN: Only export the setup function - no utilities
module.exports = {
  setupErrorHandling
};