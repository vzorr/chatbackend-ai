// config/constants.js - CONSOLIDATED VERSION (Data Only)

const BUSINESS_ENTITY_TYPES = {
  JOB: 'job',
  CONTRACT: 'contract',
  WORK_SUBMISSION: 'work_submission',
  WORK_REVIEW: 'work_review',
  MILESTONE: 'milestone',
  PAYMENT: 'payment',
  CHAT: 'chat',
  USER: 'user',
  SYSTEM: 'system'
};

// App IDs for different platforms (Only USTA_APP and CUSTOMER_APP)
const APP_IDS = {
  USTA_APP: 'com.myusta.myusta',
  CUSTOMER_APP: 'com.myusta.myustacustomer'
};

// Notification Categories
const NOTIFICATION_CATEGORIES = {
  ACTIVITY: 'activity',
  CONTRACTS: 'contracts', 
  REMINDERS: 'reminders',
  CHAT: 'chat'
};

// User Roles
const USER_ROLES = {
  CUSTOMER: 'customer',
  USTA: 'usta',
  ADMINISTRATOR: 'administrator'
};

// CONSOLIDATED NOTIFICATION_EVENTS (using job.event_name format)
const NOTIFICATION_EVENTS = {
  // ===== JOB RELATED EVENTS =====
  JOB_POSTED: 'job.posted',
  JOB_UPDATED: 'job.updated',
  JOB_PROPOSALS_RECEIVED: 'job.proposals_received',
  JOB_PROPOSAL_RECEIVED: 'job.proposal_received', // Individual proposal
  JOB_APPLICATION_RECEIVED: 'job.application_received',
  JOB_APPLICATION_SENT: 'job.application_sent',
  JOB_APPLICATION_ACCEPTED: 'job.application_accepted',
  JOB_APPLICATION_REJECTED: 'job.application_rejected',
  JOB_CONTRACTOR_SELECTED: 'job.contractor_selected',
  JOB_ACTIVE: 'job.active',
  JOB_COMPLETED: 'job.completed',
  JOB_CANCELLED: 'job.cancelled',
  
  // ===== CONTRACT RELATED EVENTS =====
  CONTRACT_CREATED: 'contract.created',
  CONTRACT_SENT: 'contract.sent',
  CONTRACT_ACCEPTED: 'contract.accepted',
  CONTRACT_REJECTED: 'contract.rejected',
  CONTRACT_PENDING_SIGNATURE: 'contract.pending_signature',
  CONTRACT_SIGNED: 'contract.signed',
  CONTRACT_CANCELLED: 'contract.cancelled',
  CONTRACT_UPDATED: 'contract.updated',
  CONTRACT_COMPLETED: 'contract.completed',
  CONTRACT_TERMINATED: 'contract.terminated',
  CONTRACT_OVERDUE: 'contract.overdue',
  
  // Contract work phases
  CONTRACT_WORK_STARTED: 'contract.work_started',
  CONTRACT_WORK_AUTHORIZED: 'contract.work_authorized',
  CONTRACT_FULFILLED: 'contract.fulfilled',
  
  // Contract payments
  CONTRACT_PAYMENT_DUE: 'contract.payment_due',
  CONTRACT_PAYMENT_RECEIVED: 'contract.payment_received',
  CONTRACT_PAYMENT_RELEASED: 'contract.payment_released',
  
  // ===== WORK SUBMISSION EVENTS =====
  WORK_SUBMITTED: 'work.submitted',
  WORK_APPROVED: 'work.approved',
  WORK_REJECTED: 'work.rejected',
  WORK_COMPLETED: 'work.completed',
  WORK_REVISION_REQUESTED: 'work.revision_requested',
  WORK_DEADLINE_APPROACHING: 'work.deadline_approaching',
  
  // ===== WORK REVIEW EVENTS =====
  REVIEW_CREATED: 'review.created',
  REVIEW_SUBMITTED: 'review.submitted',
  REVIEW_APPROVED: 'review.approved',
  REVIEW_REJECTED: 'review.rejected',
  REVIEW_DECISION_MADE: 'review.decision_made',
  REVIEW_REVISION_INSTRUCTIONS: 'review.revision_instructions',
  
  // ===== PAYMENT EVENTS =====
  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  PAYMENT_RECEIVED: 'payment.received',
  PAYMENT_PROCESSED: 'payment.processed',
  PAYMENT_RELEASED: 'payment.released',
  PAYMENT_DUE_REMINDER: 'payment.due_reminder',
  PAYMENT_OVERDUE: 'payment.overdue',
  
  // ===== MILESTONE EVENTS =====
  MILESTONE_CREATED: 'milestone.created',
  MILESTONE_COMPLETED: 'milestone.completed',
  MILESTONE_PAYMENT: 'milestone.payment',
  MILESTONE_UPDATED: 'milestone.updated',
  
  // ===== PROPOSAL EVENTS =====
  PROPOSAL_RECEIVED: 'proposal.received',
  PROPOSAL_ACCEPTED: 'proposal.accepted',
  PROPOSAL_REJECTED: 'proposal.rejected',
  
  // ===== COMMUNICATION EVENTS =====
  CHAT_NEW_MESSAGE: 'chat.new_message',
  CHAT_MESSAGE_RECEIVED: 'chat.message_received',
  CHAT_MESSAGE_READ: 'chat.message_read',
  
  // ===== USER EVENTS =====
  USER_ACCOUNT_CREATED: 'user.account_created',
  USER_ACCOUNT_VERIFIED: 'user.account_verified',
  USER_PROFILE_COMPLETED: 'user.profile_completed',
  USER_PROFILE_VERIFIED: 'user.profile_verified',
  USER_PASSWORD_RESET: 'user.password_reset',
  USER_LOGIN_ATTEMPT: 'user.login_attempt',
  USER_INVITATION_RECEIVED: 'user.invitation_received',
  USER_ACCOUNT_SECURITY: 'user.account_security',
  
  // ===== RATING/REVIEW EVENTS =====
  RATING_GIVEN: 'rating.given',
  RATING_RECEIVED: 'rating.received',
  RATING_REVIEW_RECEIVED: 'rating.review_received',
  RATING_REVIEW_REQUEST: 'rating.review_request',
  RATING_UPDATED: 'rating.updated',
  
  // ===== SYSTEM EVENTS =====
  SYSTEM_ANNOUNCEMENT: 'system.announcement',
  SYSTEM_MAINTENANCE: 'system.maintenance',
  SYSTEM_UPDATE: 'system.update',
  
  // ===== REMINDER EVENTS =====
  DEADLINE_REMINDER: 'deadline.reminder',
  REMINDER_DEADLINE_APPROACHING: 'reminder.deadline_approaching',
  REMINDER_DEADLINE_OVERDUE: 'reminder.deadline_overdue',
  REMINDER_PROFILE_INCOMPLETE: 'reminder.profile_incomplete',
  REMINDER_VERIFICATION_REQUIRED: 'reminder.verification_required',
  PROFILE_INCOMPLETE: 'profile.incomplete',
  VERIFICATION_REQUIRED: 'verification.required',
  
  // ===== MEDIA EVENTS =====
  MEDIA_UPLOAD_REQUESTED: 'media.upload_requested',
  MEDIA_UPLOAD_CONFIRMED: 'media.upload_confirmed',
  MEDIA_UPLOAD_FAILED: 'media.upload_failed',
  MEDIA_PROCESSING_COMPLETE: 'media.processing_complete'
};

// Event categories for notification service (maps events to categories)
const EVENT_CATEGORY_MAPPING = {
  // ACTIVITY CATEGORY
  activity: [
    'job.posted',
    'job.updated',
    'job.application_received',
    'job.application_sent',
    'job.application_accepted',
    'job.application_rejected',
    'job.completed',
    'work.submitted',
    'work.approved',
    'work.completed',
    'rating.given',
    'rating.received',
    'rating.review_received',
    'user.account_verified',
    'user.profile_completed',
    'user.profile_verified',
    'proposal.received',
    'proposal.accepted',
    'proposal.rejected'
  ],
  
  // CONTRACTS CATEGORY
  contracts: [
    'contract.created',
    'contract.sent',
    'contract.accepted',
    'contract.rejected',
    'contract.pending_signature',
    'contract.signed',
    'contract.work_started',
    'contract.work_authorized',
    'contract.fulfilled',
    'contract.completed',
    'contract.payment_due',
    'contract.payment_received',
    'contract.payment_released',
    'payment.initiated',
    'payment.completed',
    'payment.failed',
    'payment.received',
    'payment.processed',
    'payment.released',
    'milestone.created',
    'milestone.completed',
    'milestone.payment',
    'work.revision_requested',
    'review.created',
    'review.submitted',
    'review.approved',
    'review.rejected',
    'review.decision_made'
  ],
  
  // REMINDERS CATEGORY
  reminders: [
    'payment.due_reminder',
    'payment.overdue',
    'deadline.reminder',
    'reminder.deadline_approaching',
    'reminder.deadline_overdue',
    'reminder.profile_incomplete',
    'reminder.verification_required',
    'profile.incomplete',
    'verification.required',
    'work.deadline_approaching',
    'contract.overdue',
    'system.announcement',
    'system.maintenance',
    'system.update'
  ],
  
  // CHAT CATEGORY
  chat: [
    'chat.new_message',
    'chat.message_received',
    'chat.message_read'
  ]
};

// Notification Priorities (matching database ENUM)
const NOTIFICATION_PRIORITIES = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high'
  // Note: 'urgent' is not supported by database ENUM
};

// Priority mapping for events (determines default priority)
// Note: Database ENUM supports 'low', 'normal', 'high' only
const EVENT_PRIORITY_MAPPING = {
  // HIGH PRIORITY EVENTS (was urgent, now high)
  high: [
    'contract.signed',
    'contract.terminated',
    'payment.completed',
    'payment.failed',
    'payment.received',
    'payment.overdue',
    'contract.overdue',
    'deadline.reminder',
    'reminder.deadline_overdue',
    'work.approved',
    'work.rejected',
    'user.account_security',
    'system.maintenance'
  ],
  
  // LOW PRIORITY EVENTS
  low: [
    'chat.message_read',
    'user.login_attempt',
    'media.processing_complete',
    'system.update'
  ]
  
  // All other events default to 'normal' priority
};

// Notification Channels
const NOTIFICATION_CHANNELS = {
  PUSH: 'push',
  EMAIL: 'email',
  SMS: 'sms',
  IN_APP: 'in_app'
};

// Notification Platforms
const NOTIFICATION_PLATFORMS = {
  IOS: 'ios',
  ANDROID: 'android',
  WEB: 'web'
};

// Notification Status
const NOTIFICATION_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  READ: 'read'
};

module.exports = {
  // Core entities
  BUSINESS_ENTITY_TYPES,
  USER_ROLES,
  
  // App configuration
  APP_IDS,
  
  // Notification system
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENTS,
  EVENT_CATEGORY_MAPPING,
  EVENT_PRIORITY_MAPPING,
  
  // Notification configuration
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PLATFORMS,
  NOTIFICATION_STATUS
};