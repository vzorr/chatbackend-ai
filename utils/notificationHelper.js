// utils/notificationHelper.js - Helper functions for notification system

const {
  EVENT_CATEGORY_MAPPING,
  EVENT_PRIORITY_MAPPING,
  NOTIFICATION_EVENTS,
  NOTIFICATION_CATEGORIES,
  APP_IDS
} = require('../config/notifiction-constants');

/**
 * Get the category for a given event key
 * @param {string} eventKey - The event key (e.g., 'job.posted')
 * @returns {string} - The category key ('activity', 'contracts', 'reminders', 'chat')
 */
const getEventCategory = (eventKey) => {
  for (const [category, events] of Object.entries(EVENT_CATEGORY_MAPPING)) {
    if (events.includes(eventKey)) {
      return category;
    }
  }
  return 'activity'; // default category
};

/**
 * Get the default priority for a given event key
 * @param {string} eventKey - The event key (e.g., 'payment.overdue')
 * @returns {string} - The priority level ('low', 'normal', 'high')
 */
const getEventPriority = (eventKey) => {
  for (const [priority, events] of Object.entries(EVENT_PRIORITY_MAPPING)) {
    if (events.includes(eventKey)) {
      return priority;
    }
  }
  return 'normal'; // default priority
};

/**
 * Convert event key to human-readable name
 * @param {string} eventKey - The event key (e.g., 'job.application_received')
 * @returns {string} - Human readable name ('Job Application Received')
 */
const formatEventName = (eventKey) => {
  return eventKey
    .split('.')
    .map(part => part.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' '))
    .join(' ');
};

/**
 * Get all events for a specific category
 * @param {string} categoryKey - The category key ('activity', 'contracts', etc.)
 * @returns {string[]} - Array of event keys in that category
 */
const getEventsByCategory = (categoryKey) => {
  return EVENT_CATEGORY_MAPPING[categoryKey] || [];
};

/**
 * Get all events for a specific priority level
 * @param {string} priorityLevel - The priority level ('low', 'normal', 'high', 'urgent')
 * @returns {string[]} - Array of event keys with that priority
 */
const getEventsByPriority = (priorityLevel) => {
  return EVENT_PRIORITY_MAPPING[priorityLevel] || [];
};

/**
 * Check if an event belongs to a specific category
 * @param {string} eventKey - The event key
 * @param {string} categoryKey - The category key
 * @returns {boolean} - True if event belongs to category
 */
const isEventInCategory = (eventKey, categoryKey) => {
  const categoryEvents = EVENT_CATEGORY_MAPPING[categoryKey] || [];
  return categoryEvents.includes(eventKey);
};

/**
 * Get template key for an event and app combination
 * @param {string} eventKey - The event key
 * @param {string} appId - The app ID
 * @returns {string} - Template key for database lookup
 */
const getTemplateKey = (eventKey, appId) => {
  return `${eventKey}_${appId}`;
};

/**
 * Determine target app based on user role and event type
 * @param {string} userRole - User role ('customer', 'usta')
 * @param {string} eventKey - The event key
 * @returns {string} - App ID that should receive the notification
 */
const getTargetApp = (userRole, eventKey) => {
  // Customer users get customer app notifications
  if (userRole === 'customer') {
    return APP_IDS.CUSTOMER_APP;
  }
  
  // Usta users get usta app notifications
  if (userRole === 'usta') {
    return APP_IDS.USTA_APP;
  }
  
  // Default fallback based on event type
  const customerEvents = [
    'job.posted',
    'contract.signed',
    'work.submitted',
    'payment.due_reminder',
    'job.application_received'
  ];
  
  if (customerEvents.includes(eventKey)) {
    return APP_IDS.CUSTOMER_APP;
  }
  
  return APP_IDS.USTA_APP;
};

/**
 * Generate notification payload for an event
 * @param {string} eventKey - The event key
 * @param {Object} data - Event-specific data
 * @param {string} recipientId - User ID of recipient
 * @param {string} userRole - Role of recipient
 * @returns {Object} - Notification payload object
 */
const generateNotificationPayload = (eventKey, data = {}, recipientId, userRole) => {
  const category = getEventCategory(eventKey);
  const priority = getEventPriority(eventKey);
  const appId = getTargetApp(userRole, eventKey);
  
  return {
    eventKey,
    recipientId,
    categoryKey: category,
    appId,
    priority,
    data,
    platforms: ['ios', 'android'],
    channels: ['push'],
    timestamp: new Date().toISOString()
  };
};

/**
 * Validate event key exists in system
 * @param {string} eventKey - The event key to validate
 * @returns {boolean} - True if event exists
 */
const isValidEvent = (eventKey) => {
  const allEvents = Object.values(NOTIFICATION_EVENTS);
  return allEvents.includes(eventKey);
};

/**
 * Get all available notification events
 * @returns {Object} - All notification events organized by category
 */
const getAllEventsByCategory = () => {
  const result = {};
  
  for (const [category, events] of Object.entries(EVENT_CATEGORY_MAPPING)) {
    result[category] = events.map(eventKey => ({
      key: eventKey,
      name: formatEventName(eventKey),
      priority: getEventPriority(eventKey)
    }));
  }
  
  return result;
};

/**
 * Get notification statistics summary
 * @returns {Object} - Summary of events, categories, and priorities
 */
const getNotificationStats = () => {
  const allEvents = Object.values(NOTIFICATION_EVENTS);
  const categories = Object.keys(EVENT_CATEGORY_MAPPING);
  const priorities = Object.keys(EVENT_PRIORITY_MAPPING);
  
  return {
    totalEvents: allEvents.length,
    totalCategories: categories.length,
    eventsByCategory: Object.fromEntries(
      categories.map(cat => [cat, EVENT_CATEGORY_MAPPING[cat].length])
    ),
    eventsByPriority: Object.fromEntries(
      priorities.map(pri => [pri, EVENT_PRIORITY_MAPPING[pri].length])
    )
  };
};

/**
 * Search events by keyword
 * @param {string} keyword - Search term
 * @returns {string[]} - Array of matching event keys
 */
const searchEvents = (keyword) => {
  const allEvents = Object.values(NOTIFICATION_EVENTS);
  const searchTerm = keyword.toLowerCase();
  
  return allEvents.filter(eventKey => 
    eventKey.toLowerCase().includes(searchTerm) ||
    formatEventName(eventKey).toLowerCase().includes(searchTerm)
  );
};

module.exports = {
  // Core helper functions
  getEventCategory,
  getEventPriority,
  formatEventName,
  
  // Event queries
  getEventsByCategory,
  getEventsByPriority,
  isEventInCategory,
  getAllEventsByCategory,
  
  // Template and app helpers
  getTemplateKey,
  getTargetApp,
  
  // Notification creation
  generateNotificationPayload,
  
  // Validation and utilities
  isValidEvent,
  getNotificationStats,
  searchEvents
};