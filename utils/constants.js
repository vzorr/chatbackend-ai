// utils/constants.js - Admin System Configuration

/**
 * Comprehensive configuration for the admin system
 * Controls access, security, pagination, and model-specific settings
 */

// Admin Access Configuration
const ADMIN_ACCESS_CONFIG = {
  // Access Control
  RESTRICT_TO_ADMIN_ONLY: false, // Set to true to restrict to admin role only
  ALLOWED_ROLES: ['administrator', 'usta'], // Roles allowed when restriction is enabled
  
  // Pagination Defaults
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE_SIZE: 1,
  
  // Sorting
  ALLOWED_SORT_ORDERS: ['ASC', 'DESC', 'asc', 'desc'],
  DEFAULT_SORT_ORDER: 'DESC',
  DEFAULT_SORT_FIELD: 'createdAt',
  
  // Security
  HIDDEN_MODELS: [
    // Models that should not be accessible via admin panel
    'TokenHistory', // Contains sensitive token audit data
    'Session' // Contains active session data
  ],
  
  HIDDEN_FIELDS: {
    // Fields to hide from responses (sensitive data)
    User: ['socketId', 'metaData'],
    DeviceToken: ['token'], // Hide actual device tokens
    TokenHistory: ['token', 'previousToken'], // Hide token values
    Session: ['authToken', 'pushToken'], // Hide authentication tokens
    NotificationTemplate: [], // No hidden fields
    NotificationLog: ['deviceToken'], // Hide device token from logs
    Message: [], // No hidden fields for messages
    Conversation: [], // No hidden fields
    ConversationParticipant: [], // No hidden fields
    MessageVersion: [], // No hidden fields
    NotificationCategory: [], // No hidden fields
    NotificationEvent: [], // No hidden fields
    NotificationPreference: [] // No hidden fields
  },
  
  // Search Configuration
  MAX_SEARCH_LENGTH: 100,
  SEARCHABLE_FIELD_TYPES: ['STRING', 'TEXT', 'CHAR'],
  
  // Rate Limiting (requests per minute)
  RATE_LIMIT: {
    WINDOW_MS: 60 * 1000, // 1 minute
    MAX_REQUESTS: 200 // per window for admin operations
  },
  
  // Model-specific configurations
  MODEL_CONFIGS: {
    User: {
      defaultSort: 'createdAt',
      searchableFields: ['name', 'firstName', 'lastName', 'email', 'phone'],
      allowCreate: true,
      allowUpdate: true,
      allowDelete: false // Prevent accidental user deletion
    },
    Message: {
      defaultSort: 'createdAt',
      searchableFields: ['content'],
      allowCreate: false, // Messages should be created via chat system
      allowUpdate: false,
      allowDelete: true
    },
    Conversation: {
      defaultSort: 'createdAt',
      searchableFields: ['jobTitle'],
      allowCreate: false,
      allowUpdate: true,
      allowDelete: false
    },
    ConversationParticipant: {
      defaultSort: 'joinedAt',
      searchableFields: [],
      allowCreate: false,
      allowUpdate: true,
      allowDelete: true
    },
    MessageVersion: {
      defaultSort: 'editedAt',
      searchableFields: [],
      allowCreate: false,
      allowUpdate: false,
      allowDelete: false // Audit trail should be preserved
    },
    DeviceToken: {
      defaultSort: 'lastUsed',
      searchableFields: ['platform', 'deviceId'],
      allowCreate: false,
      allowUpdate: true,
      allowDelete: true
    },
    NotificationCategory: {
      defaultSort: 'displayOrder',
      searchableFields: ['name', 'categoryKey', 'description'],
      allowCreate: true,
      allowUpdate: true,
      allowDelete: false
    },
    NotificationEvent: {
      defaultSort: 'eventName',
      searchableFields: ['eventName', 'eventKey', 'description'],
      allowCreate: true,
      allowUpdate: true,
      allowDelete: false
    },
    NotificationTemplate: {
      defaultSort: 'createdAt',
      searchableFields: ['title', 'body', 'description'],
      allowCreate: true,
      allowUpdate: true,
      allowDelete: true
    },
    NotificationPreference: {
      defaultSort: 'updatedAt',
      searchableFields: [],
      allowCreate: false,
      allowUpdate: true,
      allowDelete: true
    },
    NotificationLog: {
      defaultSort: 'createdAt',
      searchableFields: ['title', 'body'],
      allowCreate: false,
      allowUpdate: false,
      allowDelete: false // Delivery logs should be preserved
    }
  }
};

// Available models for admin access
const AVAILABLE_MODELS = [
  'User',
  'Message', 
  'Conversation',
  'ConversationParticipant',
  'MessageVersion',
  'DeviceToken',
  'NotificationCategory',
  'NotificationEvent', 
  'NotificationTemplate',
  'NotificationPreference',
  'NotificationLog'
];

// Model display names for better UX
const MODEL_DISPLAY_NAMES = {
  User: 'Users',
  Message: 'Messages',
  Conversation: 'Conversations',
  ConversationParticipant: 'Conversation Participants',
  MessageVersion: 'Message Edit History',
  DeviceToken: 'Device Tokens',
  TokenHistory: 'Token History',
  Session: 'User Sessions',
  NotificationCategory: 'Notification Categories',
  NotificationEvent: 'Notification Events',
  NotificationTemplate: 'Notification Templates',
  NotificationPreference: 'Notification Preferences',
  NotificationLog: 'Notification Logs'
};

// Model descriptions for admin panel
const MODEL_DESCRIPTIONS = {
  User: 'Manage user accounts, roles, and profile information',
  Message: 'View and manage chat messages across all conversations',
  Conversation: 'Manage chat conversations and their settings',
  ConversationParticipant: 'Manage conversation participants and their roles',
  MessageVersion: 'View message edit history and audit trail',
  DeviceToken: 'Manage push notification device tokens',
  TokenHistory: 'View token registration and lifecycle audit trail',
  Session: 'Monitor active user sessions and connection status',
  NotificationCategory: 'Manage notification categories and organization',
  NotificationEvent: 'Configure notification events and triggers',
  NotificationTemplate: 'Create and manage notification message templates',
  NotificationPreference: 'View and modify user notification preferences',
  NotificationLog: 'Monitor notification delivery status and history'
};

// Response codes and messages
const RESPONSE_CODES = {
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

const RESPONSE_MESSAGES = {
  SUCCESS: 'Operation completed successfully',
  ERROR: 'Operation failed',
  VALIDATION_ERROR: 'Invalid input provided',
  NOT_FOUND: 'Requested resource not found',
  FORBIDDEN: 'Access denied',
  UNAUTHORIZED: 'Authentication required',
  RATE_LIMITED: 'Too many requests, please try again later',
  INTERNAL_ERROR: 'Internal server error occurred'
};

// Database operation constants
const DB_OPERATIONS = {
  CREATE: 'CREATE',
  READ: 'READ',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LIST: 'LIST',
  SCHEMA: 'SCHEMA',
  STATS: 'STATS'
};

// Validation constants
const VALIDATION_RULES = {
  UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  MODEL_NAME_REGEX: /^[A-Za-z][A-Za-z0-9]*$/,
  MAX_RECORD_ID_LENGTH: 50,
  MAX_MODEL_NAME_LENGTH: 50,
  MAX_SEARCH_QUERY_LENGTH: 100,
  MAX_FILTER_JSON_LENGTH: 1000
};

module.exports = {
  ADMIN_ACCESS_CONFIG,
  AVAILABLE_MODELS,
  MODEL_DISPLAY_NAMES,
  MODEL_DESCRIPTIONS,
  RESPONSE_CODES,
  RESPONSE_MESSAGES,
  DB_OPERATIONS,
  VALIDATION_RULES
};