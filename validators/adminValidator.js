// validators/adminValidator.js - Input Validation Schemas

const { body, param, query, validationResult } = require('express-validator');
const { ADMIN_ACCESS_CONFIG, AVAILABLE_MODELS, VALIDATION_RULES } = require('../utils/constants');

/**
 * Comprehensive validation schemas for admin endpoints using express-validator
 */

// Custom validation functions
const isValidModelName = (value) => {
  if (!VALIDATION_RULES.MODEL_NAME_REGEX.test(value)) {
    throw new Error('Model name must be a valid identifier');
  }
  if (!AVAILABLE_MODELS.includes(value)) {
    throw new Error(`Model '${value}' is not available. Available models: ${AVAILABLE_MODELS.join(', ')}`);
  }
  return true;
};

const isValidUUIDOrId = (value) => {
  // Allow UUID, integer, or string ID
  if (typeof value === 'string') {
    // Check if it's a valid UUID
    if (VALIDATION_RULES.UUID_REGEX.test(value)) {
      return true;
    }
    // Check if it's a valid string ID (not too long)
    if (value.length > 0 && value.length <= VALIDATION_RULES.MAX_RECORD_ID_LENGTH) {
      return true;
    }
  }
  // Check if it's a valid integer
  if (Number.isInteger(Number(value)) && Number(value) > 0) {
    return true;
  }
  throw new Error('Record ID must be a valid UUID, positive integer, or string identifier');
};

const isValidJSON = (value) => {
  if (!value) return true; // Optional field
  try {
    JSON.parse(value);
    return true;
  } catch (error) {
    throw new Error('Must be valid JSON format');
  }
};

// Common model name validation
const modelNameValidation = param('modelName')
  .trim()
  .isLength({ min: 1, max: VALIDATION_RULES.MAX_MODEL_NAME_LENGTH })
  .custom(isValidModelName)
  .withMessage('Invalid model name');

// Common record ID validation
const recordIdValidation = param('recordId')
  .trim()
  .isLength({ min: 1, max: VALIDATION_RULES.MAX_RECORD_ID_LENGTH })
  .custom(isValidUUIDOrId)
  .withMessage('Invalid record ID');

// Common pagination validation
const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('size')
    .optional()
    .isInt({ min: ADMIN_ACCESS_CONFIG.MIN_PAGE_SIZE, max: ADMIN_ACCESS_CONFIG.MAX_PAGE_SIZE })
    .withMessage(`Page size must be between ${ADMIN_ACCESS_CONFIG.MIN_PAGE_SIZE} and ${ADMIN_ACCESS_CONFIG.MAX_PAGE_SIZE}`),
  
  query('limit')
    .optional()
    .isInt({ min: ADMIN_ACCESS_CONFIG.MIN_PAGE_SIZE, max: ADMIN_ACCESS_CONFIG.MAX_PAGE_SIZE })
    .withMessage(`Limit must be between ${ADMIN_ACCESS_CONFIG.MIN_PAGE_SIZE} and ${ADMIN_ACCESS_CONFIG.MAX_PAGE_SIZE}`)
];

// Common sorting validation
const sortingValidation = [
  query('sortBy')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .matches(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    .withMessage('Sort field must be a valid field name'),
  
  query('sortOrder')
    .optional()
    .trim()
    .isIn(ADMIN_ACCESS_CONFIG.ALLOWED_SORT_ORDERS)
    .withMessage(`Sort order must be one of: ${ADMIN_ACCESS_CONFIG.ALLOWED_SORT_ORDERS.join(', ')}`)
];

// Common search validation
const searchValidation = query('search')
  .optional()
  .trim()
  .isLength({ max: ADMIN_ACCESS_CONFIG.MAX_SEARCH_LENGTH })
  .withMessage(`Search term cannot exceed ${ADMIN_ACCESS_CONFIG.MAX_SEARCH_LENGTH} characters`);

// Common filter validation
const filterValidation = query('filters')
  .optional()
  .isLength({ max: VALIDATION_RULES.MAX_FILTER_JSON_LENGTH })
  .custom(isValidJSON)
  .withMessage('Filters must be valid JSON');

// Common include validation
const includeValidation = query('include')
  .optional()
  .trim()
  .isLength({ max: 200 })
  .matches(/^[a-zA-Z_][a-zA-Z0-9_,\s]*$/)
  .withMessage('Include must be comma-separated association names');

/**
 * Validation schema for GET /admin/models
 */
const getModelsValidation = [
  // No specific validation needed for listing models
];

/**
 * Validation schema for GET /admin/models/:modelName
 */
const getModelDataValidation = [
  modelNameValidation,
  ...paginationValidation,
  ...sortingValidation,
  searchValidation,
  filterValidation,
  includeValidation
];

/**
 * Validation schema for GET /admin/models/:modelName/schema
 */
const getModelSchemaValidation = [
  modelNameValidation
];

/**
 * Validation schema for GET /admin/models/:modelName/records/:recordId
 */
const getModelRecordValidation = [
  modelNameValidation,
  recordIdValidation,
  includeValidation
];

/**
 * Validation schema for POST /admin/models/:modelName
 */
const createModelRecordValidation = [
  modelNameValidation,
  body()
    .isObject()
    .withMessage('Request body must be a valid object')
    .custom((value) => {
      if (Object.keys(value).length === 0) {
        throw new Error('Request body must contain at least one field');
      }
      return true;
    })
];

/**
 * Validation schema for PUT /admin/models/:modelName/records/:recordId
 */
const updateModelRecordValidation = [
  modelNameValidation,
  recordIdValidation,
  body()
    .isObject()
    .withMessage('Request body must be a valid object')
    .custom((value) => {
      if (Object.keys(value).length === 0) {
        throw new Error('Request body must contain at least one field to update');
      }
      return true;
    })
];

/**
 * Validation schema for DELETE /admin/models/:modelName/records/:recordId
 */
const deleteModelRecordValidation = [
  modelNameValidation,
  recordIdValidation
];

/**
 * Validation schema for GET /admin/stats
 */
const getStatsValidation = [
  query('timeRange')
    .optional()
    .isIn(['1h', '24h', '7d', '30d'])
    .withMessage('Time range must be one of: 1h, 24h, 7d, 30d'),
  
  query('modelName')
    .optional()
    .custom(isValidModelName)
    .withMessage('Invalid model name for stats filtering')
];

/**
 * Middleware to handle validation errors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const { validationErrorResponse } = require('../utils/apiResponseFormatter');
    return validationErrorResponse(res, errors.array());
  }
  next();
};

/**
 * Advanced validation middleware for model-specific operations
 * @param {string} modelName - Name of the model
 * @param {string} operation - Operation type (create, update, delete)
 */
const validateModelOperation = (modelName, operation) => {
  return (req, res, next) => {
    const modelConfig = ADMIN_ACCESS_CONFIG.MODEL_CONFIGS[modelName];
    
    if (!modelConfig) {
      const { notFoundResponse } = require('../utils/apiResponseFormatter');
      return notFoundResponse(res, 'Model', modelName);
    }
    
    // Check if operation is allowed for this model
    const operationAllowed = {
      create: modelConfig.allowCreate,
      update: modelConfig.allowUpdate,
      delete: modelConfig.allowDelete
    };
    
    if (operationAllowed[operation] === false) {
      const { forbiddenResponse } = require('../utils/apiResponseFormatter');
      return forbiddenResponse(res, `${operation.toUpperCase()} operation is not allowed for ${modelName} model`);
    }
    
    next();
  };
};

/**
 * Custom validation for specific model fields
 */
const validateModelFields = (modelName) => {
  return (req, res, next) => {
    const data = req.body;
    const errors = [];
    
    // Model-specific field validation
    switch (modelName) {
      case 'User':
        if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
          errors.push({ field: 'email', message: 'Invalid email format' });
        }
        if (data.role && !['customer', 'usta', 'administrator'].includes(data.role)) {
          errors.push({ field: 'role', message: 'Invalid role value' });
        }
        if (data.phone && !/^\+?[\d\s\-\(\)]+$/.test(data.phone)) {
          errors.push({ field: 'phone', message: 'Invalid phone number format' });
        }
        break;
        
      case 'DeviceToken':
        if (data.platform && !['ios', 'android', 'web'].includes(data.platform)) {
          errors.push({ field: 'platform', message: 'Platform must be ios, android, or web' });
        }
        if (data.deviceType && !['mobile', 'web'].includes(data.deviceType)) {
          errors.push({ field: 'deviceType', message: 'Device type must be mobile or web' });
        }
        break;
        
      case 'NotificationTemplate':
        if (data.priority && !['low', 'normal', 'high'].includes(data.priority)) {
          errors.push({ field: 'priority', message: 'Priority must be low, normal, or high' });
        }
        break;
        
      case 'NotificationLog':
        if (data.status && !['queued', 'processing', 'sent', 'delivered', 'failed'].includes(data.status)) {
          errors.push({ field: 'status', message: 'Invalid status value' });
        }
        break;
        
      case 'Conversation':
        if (data.type && !['job_chat', 'direct_message'].includes(data.type)) {
          errors.push({ field: 'type', message: 'Type must be job_chat or direct_message' });
        }
        if (data.status && !['active', 'closed', 'archived'].includes(data.status)) {
          errors.push({ field: 'status', message: 'Status must be active, closed, or archived' });
        }
        break;
    }
    
    if (errors.length > 0) {
      const { validationErrorResponse } = require('../utils/apiResponseFormatter');
      return validationErrorResponse(res, errors);
    }
    
    next();
  };
};

// Export all validation schemas and middlewares
module.exports = {
  // Validation schemas
  getModelsValidation,
  getModelDataValidation,
  getModelSchemaValidation,
  getModelRecordValidation,
  createModelRecordValidation,
  updateModelRecordValidation,
  deleteModelRecordValidation,
  getStatsValidation,
  
  // Middleware functions
  handleValidationErrors,
  validateModelOperation,
  validateModelFields,
  
  // Individual validation components (for reuse)
  modelNameValidation,
  recordIdValidation,
  paginationValidation,
  sortingValidation,
  searchValidation,
  filterValidation,
  includeValidation,
  
  // Custom validators
  isValidModelName,
  isValidUUIDOrId,
  isValidJSON
};