// utils/errors.js

class AppError extends Error {
    constructor(message, statusCode, code) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.isOperational = true;
      
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  class ValidationError extends AppError {
    constructor(message, details = null) {
      super(message, 400, 'VALIDATION_ERROR');
      this.details = details;
    }
  }
  
  class AuthenticationError extends AppError {
    constructor(message = 'Authentication failed') {
      super(message, 401, 'AUTHENTICATION_ERROR');
    }
  }
  
  class AuthorizationError extends AppError {
    constructor(message = 'Access denied') {
      super(message, 403, 'AUTHORIZATION_ERROR');
    }
  }
  
  class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
      super(message, 404, 'NOT_FOUND');
    }
  }
  
  class ConflictError extends AppError {
    constructor(message = 'Resource conflict') {
      super(message, 409, 'CONFLICT');
    }
  }
  
  class RateLimitError extends AppError {
    constructor(message = 'Too many requests') {
      super(message, 429, 'RATE_LIMIT_EXCEEDED');
    }
  }
  
  class BadRequestError extends AppError {
    constructor(message = 'Bad request') {
      super(message, 400, 'BAD_REQUEST');
    }
  }
  
  class InternalServerError extends AppError {
    constructor(message = 'Internal server error') {
      super(message, 500, 'INTERNAL_ERROR');
    }
  }
  
  // Database-specific errors
  class DatabaseError extends AppError {
    constructor(message = 'Database error', originalError = null) {
      super(message, 500, 'DATABASE_ERROR');
      this.originalError = originalError;
    }
  }
  
  class DuplicateEntryError extends ConflictError {
    constructor(field, value) {
      super(`${field} '${value}' already exists`);
      this.field = field;
      this.value = value;
    }
  }
  
  // Service-specific errors
  class ExternalServiceError extends AppError {
    constructor(service, message) {
      super(`${service} error: ${message}`, 503, 'EXTERNAL_SERVICE_ERROR');
      this.service = service;
    }
  }
  
  module.exports = {
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    ConflictError,
    RateLimitError,
    BadRequestError,
    InternalServerError,
    DatabaseError,
    DuplicateEntryError,
    ExternalServiceError
  };