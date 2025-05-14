// bootstrap/initializers/error-handling.js
const { logger } = require('../../utils/logger');
const exceptionHandler = require('../../middleware/exceptionHandler');  // Correct path

async function setupErrorHandling(app) {
  const startTime = Date.now();
  logger.info('🔧 [ErrorHandling] Setting up error handlers...');

  try {
    // 404 handler - must come before general error handler
    app.use(exceptionHandler.notFoundHandler.bind(exceptionHandler));
    logger.info('✅ [ErrorHandling] 404 handler configured');

    // General error handler - must be last middleware
    app.use(exceptionHandler.errorHandler.bind(exceptionHandler));
    logger.info('✅ [ErrorHandling] Error handler configured');

    const duration = Date.now() - startTime;
    logger.info('✅ [ErrorHandling] Error handling setup completed', {
      duration: `${duration}ms`,
      handlers: 2
    });

  } catch (error) {
    logger.error('❌ [ErrorHandling] Error handling setup failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Export any error-related utilities for use in routes
const asyncHandler = (fn) => exceptionHandler.asyncHandler(fn);

module.exports = {
  setupErrorHandling,
  asyncHandler
};