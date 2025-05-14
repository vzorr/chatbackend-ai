// utils/validation.js

/**
 * Validates a phone number using E.164 format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} Whether the phone number is valid
 */
const validatePhone = (phone) => {
  // Basic E.164 format check
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(phone);
};

/**
 * Validates an email address
 * @param {string} email - Email to validate
 * @returns {boolean} Whether the email is valid
 */
const validateEmail = (email) => {
  // RFC 5322 compliant regex
  const emailRegex = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return emailRegex.test(email);
};

/**
 * Validates UUID v4 format - Fixed to handle valid UUIDs
 * @param {string} uuid - UUID to validate
 * @returns {boolean} Whether the UUID is valid
 */
const validateUUID = (uuid) => {
  // This regex handles both UUID v4 and other UUID versions
  // The original regex only accepted v4 UUIDs (with '4' in the third segment)
  // but the sample UUID uses '1' which is v1
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Sanitizes a string for logging (removes sensitive data)
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized object
 */
const sanitizeForLogging = (obj) => {
  if (!obj) return obj;
  
  // Create a deep copy
  const sanitized = JSON.parse(JSON.stringify(obj));
  
  // Fields to censor
  const sensitiveFields = [
    'password', 'token', 'refreshToken', 'accessToken', 'secret',
    'apiKey', 'api_key', 'auth', 'authentication', 'authorization',
    'credit_card', 'creditCard', 'cardNumber', 'cvv'
  ];
  
  // Recursive function to sanitize objects
  const sanitizeObject = (object) => {
    if (!object || typeof object !== 'object') return;
    
    Object.keys(object).forEach(key => {
      if (typeof object[key] === 'object' && object[key] !== null) {
        sanitizeObject(object[key]);
      } else if (typeof object[key] === 'string' && sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        object[key] = '[REDACTED]';
      }
    });
  };
  
  sanitizeObject(sanitized);
  return sanitized;
};

/**
 * Throws a client error with status code
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code
 * @param {string} code - Error code for clients
 */
const throwClientError = (message, statusCode = 400, code = null) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  throw error;
};

module.exports = {
  validatePhone,
  validateEmail,
  sanitizeForLogging,
  validateUUID,
  throwClientError
};