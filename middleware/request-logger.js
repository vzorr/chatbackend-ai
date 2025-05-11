// middleware/requestLogger.js
const logger = require('../utils/logger');

/**
 * Middleware to log incoming requests
 */
module.exports = (req, res, next) => {
  // Don't log health check endpoints to avoid noise
  if (req.path === '/health') {
    return next();
  }
  
  // Start time for measuring duration
  const startTime = Date.now();
  
  // Log request details
  logger.info({
    requestId: req.id,
    method: req.method,
    path: req.path,
    query: req.query,
    ip: req.ip,
    userAgent: req.get('user-agent')
  });
  
  // Capture response data
  const originalSend = res.send;
  res.send = function (body) {
    res.responseBody = body;
    return originalSend.call(this, body);
  };
  
  // Log when response is finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel]({
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      contentLength: res.get('content-length') || 0
    });
  });
  
  next();
};
