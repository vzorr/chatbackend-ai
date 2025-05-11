// services/queue.js
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const { User, Message, Conversation } = require('../db/models');

// Create Redis client for queue operations
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined
});

// Queue names
const QUEUES = {
  MESSAGES: 'queue:messages',
  PRESENCE: 'queue:presence',
  NOTIFICATIONS: 'queue:notifications',
  CONVERSATIONS: 'queue:conversations'
};

// Enqueue message for processing
const enqueueMessage = async (messageData) => {
  const id = messageData.id || uuidv4();
  const payload = {
    ...messageData,
    id,
    queuedAt: Date.now()
  };
  
  await redisClient.rpush(QUEUES.MESSAGES, JSON.stringify(payload));
  logger.info(`Message ${id} enqueued for processing`);
  
  return { messageId: id };
};

// Enqueue presence update
const enqueuePresenceUpdate = async (userId, isOnline, socketId = null) => {
  const payload = {
    userId,
    isOnline,
    socketId,
    timestamp: Date.now()
  };
  
  await redisClient.rpush(QUEUES.PRESENCE, JSON.stringify(payload));
  logger.info(`Presence update for user ${userId} enqueued`);
  
  return true;
};

// Enqueue notification
const enqueueNotification = async (userId, type, data) => {
  const payload = {
    id: uuidv4(),
    userId,
    type,
    data,
    timestamp: Date.now()
  };
  
  await redisClient.rpush(QUEUES.NOTIFICATIONS, JSON.stringify(payload));
  logger.info(`Notification for user ${userId} enqueued`);
  
  return true;
};

// Enqueue conversation operation
const enqueueConversationOperation = async (operation, data) => {
  const id = data.id || uuidv4();
  const payload = {
    operation,
    data: {
      ...data,
      id
    },
    timestamp: Date.now()
  };
  
  await redisClient.rpush(QUEUES.CONVERSATIONS, JSON.stringify(payload));
  logger.info(`Conversation operation ${operation} enqueued`);
  
  return { conversationId: id };
};

// Process messages from queue (worker function)
const processMessageQueue = async () => {
  const message = await redisClient.lpop(QUEUES.MESSAGES);
  
  if (!message) return null;
  
  try {
    const data = JSON.parse(message);
    
    // Create message in database
    await Message.create(data);
    
    // Update conversation last message time if applicable
    if (data.conversationId) {
      await Conversation.update(
        { lastMessageAt: new Date() },
        { where: { id: data.conversationId } }
      );
    }
    
    logger.info(`Message ${data.id} processed successfully`);
    return data.id;
  } catch (error) {
    logger.error(`Error processing message: ${error}`);
    // Re-queue for retry
    await redisClient.rpush(QUEUES.MESSAGES, message);
    return null;
  }
};

// Process presence updates
const processPresenceQueue = async () => {
  const update = await redisClient.lpop(QUEUES.PRESENCE);
  
  if (!update) return null;
  
  try {
    const data = JSON.parse(update);
    
    // Update user status in database
    await User.update(
      { 
        isOnline: data.isOnline,
        socketId: data.socketId,
        lastSeen: data.isOnline ? null : new Date()
      },
      { where: { id: data.userId } }
    );
    
    logger.info(`Presence update for user ${data.userId} processed`);
    return data.userId;
  } catch (error) {
    logger.error(`Error processing presence update: ${error}`);
    return null;
  }
};

module.exports = {
  enqueueMessage,
  enqueuePresenceUpdate,
  enqueueNotification,
  enqueueConversationOperation,
  processMessageQueue,
  processPresenceQueue,
  redisClient,
  QUEUES
};