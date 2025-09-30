// utils/apiResponseFormatter.js - Updated to match utils/response.js structure

const { RESPONSE_CODES, RESPONSE_MESSAGES } = require('./constants');

/**
 * Standardized API response formatter matching utils/response.js structure
 * Updated to use 'code' and 'result' properties for consistency
 */

/**
 * Format successful response - matches utils/response.js
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {*} data - Response data
 * @param {number} statusCode - HTTP status code (default: 200)
 * @param {Object} meta - Optional metadata
 */
const successResponse = (res, message, data = {}, statusCode = 200, meta = {}) => {
  const response = {
    success: true,
    code: statusCode,        // Changed from 'status' to 'code'
    message: message || RESPONSE_MESSAGES?.SUCCESS || 'Operation successful',
    result: data,            // Changed from 'data' to 'result'
    ...meta
  };

  // Add request tracking if available (optional enhancement)
  if (res.req && res.req.id) {
    response.requestId = res.req.id;
  }

  return res.status(statusCode).json(response);
};

/**
 * Format error response - matches utils/response.js
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {Array} errors - Array of detailed error messages
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {string} errorCode - Error code for client handling (optional)
 */
const errorResponse = (res, message, errors = [], statusCode = 500, errorCode = null) => {
  const response = {
    success: false,
    code: statusCode,        // Changed from 'status' to 'code'
    message: message || RESPONSE_MESSAGES?.ERROR || 'An error occurred',
    errors: Array.isArray(errors) ? errors : [errors]
  };

  // Add optional errorCode if provided (enhancement over utils/response)
  if (errorCode) {
    response.errorCode = errorCode;
  }

  // Add request tracking if available (optional enhancement)
  if (res.req && res.req.id) {
    response.requestId = res.req.id;
  }

  // Add stack trace in development mode
  if (process.env.NODE_ENV === 'development' && errors.length > 0) {
    const error = errors[0];
    if (error instanceof Error && error.stack) {
      response.stack = error.stack;
    }
  }

  return res.status(statusCode).json(response);
};

/**
 * Format paginated response - enhanced version for admin endpoints
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {Array} data - Array of records
 * @param {Object} pagination - Pagination metadata
 * @param {Object} meta - Additional metadata
 */
const paginatedResponse = (res, message, data, pagination, meta = {}) => {
  const response = {
    success: true,
    code: 200,               // Changed from 'status' to 'code'
    message: message || 'Data retrieved successfully',
    result: {                // Changed from 'data' to 'result'
      records: data,
      pagination: {
        totalItems: pagination.totalItems || 0,
        totalPages: pagination.totalPages || 0,
        currentPage: pagination.currentPage || 1,
        pageSize: pagination.pageSize || 20,
        hasNextPage: pagination.hasNextPage || false,
        hasPrevPage: pagination.hasPrevPage || false,
        ...pagination
      },
      ...meta
    }
  };

  // Add request tracking if available
  if (res.req && res.req.id) {
    response.requestId = res.req.id;
  }

  return res.status(200).json(response);
};

/**
 * Format validation error response
 * @param {Object} res - Express response object
 * @param {Array} validationErrors - Array of validation errors from express-validator
 */
const validationErrorResponse = (res, validationErrors) => {
  const errors = validationErrors.map(error => ({
    field: error.param || error.path,
    message: error.msg || error.message,
    value: error.value,
    location: error.location
  }));

  return errorResponse(
    res,
    RESPONSE_MESSAGES?.VALIDATION_ERROR || 'Validation failed',
    errors,
    400,
    RESPONSE_CODES?.VALIDATION_ERROR || 'VALIDATION_ERROR'
  );
};

/**
 * Format not found response
 * @param {Object} res - Express response object
 * @param {string} resourceType - Type of resource not found
 * @param {string} identifier - Resource identifier
 */
const notFoundResponse = (res, resourceType = 'Resource', identifier = '') => {
  const message = identifier 
    ? `${resourceType} with identifier '${identifier}' not found`
    : `${resourceType} not found`;

  return errorResponse(
    res,
    message,
    [],
    404,
    RESPONSE_CODES?.NOT_FOUND || 'NOT_FOUND'
  );
};

/**
 * Format forbidden response
 * @param {Object} res - Express response object
 * @param {string} message - Custom forbidden message
 */
const forbiddenResponse = (res, message = 'Access denied') => {
  return errorResponse(
    res,
    message,
    [],
    403,
    RESPONSE_CODES?.FORBIDDEN || 'FORBIDDEN'
  );
};

/**
 * Format unauthorized response
 * @param {Object} res - Express response object
 * @param {string} message - Custom unauthorized message
 */
const unauthorizedResponse = (res, message = 'Authentication required') => {
  return errorResponse(
    res,
    message,
    [],
    401,
    RESPONSE_CODES?.UNAUTHORIZED || 'UNAUTHORIZED'
  );
};

/**
 * Format rate limit response
 * @param {Object} res - Express response object
 * @param {string} message - Custom rate limit message
 */
const rateLimitResponse = (res, message = 'Too many requests, please try again later') => {
  return errorResponse(
    res,
    message,
    [],
    429,
    RESPONSE_CODES?.RATE_LIMITED || 'RATE_LIMITED'
  );
};

/**
 * Format internal server error response
 * @param {Object} res - Express response object
 * @param {Error} error - Error object
 * @param {string} message - Custom error message
 */
const internalErrorResponse = (res, error = null, message = 'Internal server error occurred') => {
  const errors = error ? [error.message] : [];
  
  return errorResponse(
    res,
    message,
    errors,
    500,
    RESPONSE_CODES?.INTERNAL_ERROR || 'INTERNAL_ERROR'
  );
};

/**
 * Format created response (for POST requests)
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {*} data - Created resource data
 * @param {Object} meta - Optional metadata
 */
const createdResponse = (res, message, data, meta = {}) => {
  return successResponse(res, message, data, 201, meta);
};

/**
 * Format no content response (for successful DELETE requests)
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 */
const noContentResponse = (res, message = 'Resource deleted successfully') => {
  const response = {
    success: true,
    code: 204,               // Changed from 'status' to 'code'
    message
  };

  // Add request tracking if available
  if (res.req && res.req.id) {
    response.requestId = res.req.id;
  }

  return res.status(204).json(response);
};

/**
 * Format schema response for model introspection
 * @param {Object} res - Express response object
 * @param {string} modelName - Name of the model
 * @param {Object} schema - Model schema data
 */
const schemaResponse = (res, modelName, schema) => {
  return successResponse(
    res,
    `${modelName} schema retrieved successfully`,
    schema,
    200,
    {
      model: modelName,
      schemaVersion: '1.0'
    }
  );
};

/**
 * Format statistics response
 * @param {Object} res - Express response object
 * @param {Object} stats - Statistics data
 * @param {string} message - Custom message
 */
const statisticsResponse = (res, stats, message = 'Statistics retrieved successfully') => {
  return successResponse(
    res,
    message,
    stats,
    200,
    {
      type: 'statistics'
    }
  );
};

/**
 * Helper function to determine appropriate error response based on error type
 * @param {Object} res - Express response object
 * @param {Error} error - Error object
 * @param {string} operation - Operation being performed
 */
const handleError = (res, error, operation = 'operation') => {
  // Log error for debugging
  console.error(`Error during ${operation}:`, error);

  // Determine error type and respond accordingly
  if (error.name === 'ValidationError') {
    return validationErrorResponse(res, error.errors || [error.message]);
  }
  
  if (error.name === 'SequelizeValidationError') {
    const errors = error.errors.map(err => ({
      field: err.path,
      message: err.message,
      value: err.value
    }));
    return validationErrorResponse(res, errors);
  }
  
  if (error.name === 'SequelizeUniqueConstraintError') {
    return errorResponse(
      res,
      'Resource already exists with the provided unique field(s)',
      [error.message],
      409,
      'DUPLICATE_RESOURCE'
    );
  }
  
  if (error.name === 'SequelizeForeignKeyConstraintError') {
    return errorResponse(
      res,
      'Referenced resource does not exist',
      [error.message],
      400,
      'INVALID_REFERENCE'
    );
  }
  
  if (error.message && error.message.includes('not found')) {
    return notFoundResponse(res, 'Resource');
  }
  
  // Default to internal server error
  return internalErrorResponse(res, error);
};

module.exports = {
  successResponse,
  errorResponse,
  paginatedResponse,
  validationErrorResponse,
  notFoundResponse,
  forbiddenResponse,
  unauthorizedResponse,
  rateLimitResponse,
  internalErrorResponse,
  createdResponse,
  noContentResponse,
  schemaResponse,
  statisticsResponse,
  handleError
};