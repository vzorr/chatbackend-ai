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
  
  // Standard response structure
  const errorResponse = {
    success: false,
    error: {
      message: errorMessage,
      code: err.code || 'INTERNAL_ERROR',
      status: err.statusCode || err.status || 500,
      requestId: req.id
    }
  };
  
  // Handle Sequelize errors
  if (err.name === 'SequelizeValidationError') {
    errorResponse.error.code = 'VALIDATION_ERROR';
    errorResponse.error.status = 400;
    errorResponse.error.details = err.errors.map(e => ({
      field: e.path,
      message: e.message
    }));
    
    return res.status(400).json(errorResponse);
  }
  
  if (err.name === 'SequelizeUniqueConstraintError') {
    errorResponse.error.code = 'RESOURCE_EXISTS';
    errorResponse.error.status = 409;
    errorResponse.error.details = err.errors.map(e => ({
      field: e.path,
      message: e.message
    }));
    
    return res.status(409).json(errorResponse);
  }
  
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    errorResponse.error.code = 'INVALID_REFERENCE';
    errorResponse.error.status = 400;
    errorResponse.error.message = 'Referenced entity does not exist';
    
    return res.status(400).json(errorResponse);
  }
  
  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    errorResponse.error.code = 'INVALID_TOKEN';
    errorResponse.error.status = 401;
    errorResponse.error.message = 'Invalid token';
    
    return res.status(401).json(errorResponse);
  }
  
  if (err.name === 'TokenExpiredError') {
    errorResponse.error.code = 'TOKEN_EXPIRED';
    errorResponse.error.status = 401;
    errorResponse.error.message = 'Token expired';
    
    return res.status(401).json(errorResponse);
  }
  
  // Handle multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    errorResponse.error.code = 'FILE_TOO_LARGE';
    errorResponse.error.status = 400;
    errorResponse.error.message = 'The uploaded file exceeds the size limit';
    
    return res.status(400).json(errorResponse);
  }
  
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    errorResponse.error.code = 'UNEXPECTED_FILE';
    errorResponse.error.status = 400;
    errorResponse.error.message = 'Field name does not match the expected name';
    
    return res.status(400).json(errorResponse);
  }
  
  // Handle client-defined errors
  if (err.statusCode) {
    errorResponse.error.code = err.code || 'ERROR';
    errorResponse.error.status = err.statusCode;
    errorResponse.error.message = err.message;
    
    return res.status(err.statusCode).json(errorResponse);
  }
  
  // Handle other errors
  const statusCode = err.status || 500;
  errorResponse.error.status = statusCode;
  
  // Send final response
  res.status(statusCode).json(errorResponse);
};