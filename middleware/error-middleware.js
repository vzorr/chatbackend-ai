// middleware/errorHandler.js
const logger = require('../utils/logger');

/**
 * Global error handler middleware
 * Catches errors and formats response
 */
module.exports = (err, req, res, next) => {
  // Log the error
  logger.error(`Error in request ${req.id}: ${err.stack || err}`);
  
  // Default error message (don't expose details in production)
  let errorMessage = process.env.NODE_ENV === 'production' 
    ? 'Internal server error'
    : err.message || 'Unknown error';
  
  // Handle Sequelize errors
  if (err.name === 'SequelizeValidationError') {
    return res.status(400).json({
      error: 'Validation error',
      details: err.errors.map(e => ({
        field: e.path,
        message: e.message
      }))
    });
  }
  
  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      error: 'Resource already exists',
      details: err.errors.map(e => ({
        field: e.path,
        message: e.message
      }))
    });
  }
  
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(400).json({
      error: 'Invalid reference',
      details: 'Referenced entity does not exist'
    });
  }
  
  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid token',
      code: 'INVALID_TOKEN'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expired',
      code: 'TOKEN_EXPIRED'
    });
  }
  
  // Handle multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'File too large',
      details: 'The uploaded file exceeds the size limit'
    });
  }
  
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      error: 'Unexpected file',
      details: 'Field name does not match the expected name'
    });
  }
  
  // Handle client-defined errors
  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code || 'ERROR'
    });
  }
  
  // Handle other errors
  const statusCode = err.status || 500;
  
  res.status(statusCode).json({
    error: errorMessage,
    requestId: req.id // Include request ID for tracing
  });
};
