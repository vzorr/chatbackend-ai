// services/queue.js
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const { User, Message, Conversation, ConversationParticipant } = require('../db/models');

// Create Redis client for queue operations
const redisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 5,
  retryStrategy: (times) => {
    if (times > 10) {
      logger.error('Redis retry attempts exhausted. Connection failed.');
      return null; // Don't retry anymore
    }
    const delay = Math.min(times * 100, 3000); // Gradually increase delay up to 3s
    logger.warn(`Redis connection attempt ${times} failed. Retrying in ${delay}ms...`);
    return delay;
  },
});

// Queue names
const QUEUES = {
  MESSAGES: 'queue:messages',
  PRESENCE: 'queue:presence',
  NOTIFICATIONS: 'queue:notifications',
  CONVERSATIONS: 'queue:conversations',
  OFFLINE_MESSAGES: 'queue:offline_messages',
  DELIVERY_RECEIPTS: 'queue:delivery_receipts',
  READ_RECEIPTS: 'queue:read_receipts',
  BATCH_OPERATIONS: 'queue:batch_operations'
};

// Offline messages storage keys
const OFFLINE_STORAGE = {
  USER_MESSAGES: (userId) => `offline:messages:${userId}`,
  USER_NOTIFICATIONS: (userId) => `offline:notifications:${userId}`,
  MESSAGE_TTL: 60 * 60 * 24 * 7 // 7 days
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

// Enqueue batch of messages for processing
const enqueueBatchMessages = async (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages array is required and cannot be empty');
  }
  
  const results = [];
  const pipeline = redisClient.pipeline();
  
  for (const msg of messages) {
    const id = msg.id || uuidv4();
    const payload = {
      ...msg,
      id,
      queuedAt: Date.now()
    };
    
    pipeline.rpush(QUEUES.MESSAGES, JSON.stringify(payload));
    results.push({ messageId: id, clientTempId: msg.clientTempId });
  }
  
  await pipeline.exec();
  logger.info(`Batch of ${messages.length} messages enqueued for processing`);
  
  return { messages: results };
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

// Store message for offline user
const storeOfflineMessage = async (userId, message) => {
  try {
    const key = OFFLINE_STORAGE.USER_MESSAGES(userId);
    await redisClient.rpush(key, JSON.stringify({
      ...message,
      storedAt: Date.now()
    }));
    await redisClient.expire(key, OFFLINE_STORAGE.MESSAGE_TTL);
    
    logger.info(`Message ${message.id} stored for offline user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`Error storing offline message: ${error}`);
    return false;
  }
};

// Get and clear offline messages for user
const getOfflineMessages = async (userId) => {
  try {
    const key = OFFLINE_STORAGE.USER_MESSAGES(userId);
    const messages = await redisClient.lrange(key, 0, -1);
    
    if (messages.length > 0) {
      await redisClient.del(key);
      logger.info(`Retrieved ${messages.length} offline messages for user ${userId}`);
    }
    
    return messages.map(msg => JSON.parse(msg));
  } catch (error) {
    logger.error(`Error retrieving offline messages: ${error}`);
    return [];
  }
};

// Store notification for offline user
const storeOfflineNotification = async (userId, notification) => {
  try {
    const key = OFFLINE_STORAGE.USER_NOTIFICATIONS(userId);
    await redisClient.rpush(key, JSON.stringify({
      ...notification,
      storedAt: Date.now()
    }));
    await redisClient.expire(key, OFFLINE_STORAGE.MESSAGE_TTL);
    
    logger.info(`Notification stored for offline user ${userId}`);
    return true;
  } catch (error) {
    logger.error(`Error storing offline notification: ${error}`);
    return false;
  }
};

// Get and clear offline notifications for user
const getOfflineNotifications = async (userId) => {
  try {
    const key = OFFLINE_STORAGE.USER_NOTIFICATIONS(userId);
    const notifications = await redisClient.lrange(key, 0, -1);
    
    if (notifications.length > 0) {
      await redisClient.del(key);
      logger.info(`Retrieved ${notifications.length} offline notifications for user ${userId}`);
    }
    
    return notifications.map(notif => JSON.parse(notif));
  } catch (error) {
    logger.error(`Error retrieving offline notifications: ${error}`);
    return [];
  }
};

// Enqueue delivery receipt
const enqueueDeliveryReceipt = async (userId, messageIds) => {
  const payload = {
    userId,
    messageIds,
    timestamp: Date.now()
  };
  
  await redisClient.rpush(QUEUES.DELIVERY_RECEIPTS, JSON.stringify(payload));
  logger.info(`Delivery receipt for ${messageIds.length} messages enqueued`);
  
  return true;
};

// Enqueue read receipt
const enqueueReadReceipt = async (userId, messageIds, conversationId = null) => {
  const payload = {
    userId,
    messageIds,
    conversationId,
    timestamp: Date.now()
  };
  
  await redisClient.rpush(QUEUES.READ_RECEIPTS, JSON.stringify(payload));
  logger.info(`Read receipt for ${messageIds.length} messages enqueued`);
  
  return true;
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
    // Re-queue for retry with a delay to avoid infinite loop
    setTimeout(async () => {
      await redisClient.rpush(QUEUES.MESSAGES, message);
    }, 5000);
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

// Process delivery receipts
const processDeliveryReceiptsQueue = async () => {
  const receipt = await redisClient.lpop(QUEUES.DELIVERY_RECEIPTS);
  
  if (!receipt) return null;
  
  try {
    const data = JSON.parse(receipt);
    const { userId, messageIds } = data;
    
    if (!userId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return null;
    }
    
    // Update message status to delivered
    await Message.update(
      { status: 'delivered' },
      { 
        where: { 
          id: messageIds,
          receiverId: userId,
          status: 'sent'
        } 
      }
    );
    
    logger.info(`Delivery receipts for ${messageIds.length} messages processed`);
    return { userId, count: messageIds.length };
  } catch (error) {
    logger.error(`Error processing delivery receipts: ${error}`);
    return null;
  }
};

// Process read receipts
const processReadReceiptsQueue = async () => {
  const receipt = await redisClient.lpop(QUEUES.READ_RECEIPTS);
  
  if (!receipt) return null;
  
  try {
    const data = JSON.parse(receipt);
    const { userId, messageIds, conversationId } = data;
    
    if (!userId || (!messageIds && !conversationId)) {
      return null;
    }
    
    // For specific messages
    if (messageIds && messageIds.length > 0) {
      await Message.update(
        { status: 'read' },
        { 
          where: { 
            id: messageIds,
            receiverId: userId
          } 
        }
      );
    }
    
    // For entire conversation
    if (conversationId) {
      await Message.update(
        { status: 'read' },
        {
          where: {
            conversationId,
            receiverId: userId,
            status: { [Op.ne]: 'read' }
          }
        }
      );
      
      // Reset unread count in participant record
      await ConversationParticipant.update(
        { unreadCount: 0 },
        { where: { conversationId, userId } }
      );
    }
    
    logger.info(`Read receipts processed for user ${userId}`);
    return { userId, conversationId, messageCount: messageIds ? messageIds.length : 'all' };
  } catch (error) {
    logger.error(`Error processing read receipts: ${error}`);
    return null;
  }
};

// Process conversation operations
const processConversationQueue = async () => {
  const operation = await redisClient.lpop(QUEUES.CONVERSATIONS);
  
  if (!operation) return null;
  
  try {
    const { operation: opType, data } = JSON.parse(operation);
    
    switch (opType) {
      case 'create':
        await Conversation.create(data);
        logger.info(`Conversation ${data.id} created`);
        break;
        
      case 'update':
        await Conversation.update(
          data,
          { where: { id: data.id } }
        );
        logger.info(`Conversation ${data.id} updated`);
        break;
        
      case 'delete':
        // Soft delete by marking as inactive
        await Conversation.update(
          { active: false },
          { where: { id: data.id } }
        );
        logger.info(`Conversation ${data.id} soft-deleted`);
        break;
        
      default:
        logger.warn(`Unknown conversation operation: ${opType}`);
    }
    
    return { operationType: opType, conversationId: data.id };
  } catch (error) {
    logger.error(`Error processing conversation operation: ${error}`);
    return null;
  }
};

// Process batch operations
const processBatchQueue = async () => {
  const batch = await redisClient.lpop(QUEUES.BATCH_OPERATIONS);
  
  if (!batch) return null;
  
  try {
    const { type, operations, userId } = JSON.parse(batch);
    
    if (!type || !operations || !Array.isArray(operations)) {
      return null;
    }
    
    let results;
    
    switch (type) {
      case 'messages_send':
        results = await processBatchMessages(operations, userId);
        break;
        
      case 'messages_update':
        results = await processBatchMessageUpdates(operations, userId);
        break;
        
      case 'messages_delete':
        results = await processBatchMessageDeletions(operations, userId);
        break;
        
      default:
        logger.warn(`Unknown batch operation type: ${type}`);
        return null;
    }
    
    logger.info(`Batch operation of type ${type} with ${operations.length} items processed`);
    return { type, count: operations.length, results };
  } catch (error) {
    logger.error(`Error processing batch operation: ${error}`);
    return null;
  }
};

// Helper for processing batch message sends
const processBatchMessages = async (messages, userId) => {
  const results = [];
  
  for (const msg of messages) {
    try {
      const message = {
        ...msg,
        id: msg.id || uuidv4(),
        senderId: userId,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await Message.create(message);
      
      results.push({
        success: true,
        messageId: message.id,
        clientTempId: msg.clientTempId
      });
    } catch (error) {
      results.push({
        success: false,
        clientTempId: msg.clientTempId,
        error: error.message
      });
    }
  }
  
  return results;
};

// Helper for processing batch message updates
const processBatchMessageUpdates = async (updates, userId) => {
  const results = [];
  
  for (const update of updates) {
    try {
      const { messageId, content } = update;
      
      // Verify ownership
      const message = await Message.findOne({
        where: { id: messageId, senderId: userId }
      });
      
      if (!message) {
        throw new Error('Message not found or not authorized to edit');
      }
      
      // Update message
      message.content = { ...message.content, ...content, edited: true, editedAt: new Date() };
      await message.save();
      
      results.push({
        success: true,
        messageId,
        clientTempId: update.clientTempId
      });
    } catch (error) {
      results.push({
        success: false,
        messageId: update.messageId,
        clientTempId: update.clientTempId,
        error: error.message
      });
    }
  }
  
  return results;
};

// Helper for processing batch message deletions
const processBatchMessageDeletions = async (deletions, userId) => {
  const results = [];
  
  for (const deletion of deletions) {
    try {
      const { messageId } = deletion;
      
      // Verify ownership
      const message = await Message.findOne({
        where: { id: messageId, senderId: userId }
      });
      
      if (!message) {
        throw new Error('Message not found or not authorized to delete');
      }
      
      // Soft delete
      message.deleted = true;
      await message.save();
      
      results.push({
        success: true,
        messageId,
        clientTempId: deletion.clientTempId
      });
    } catch (error) {
      results.push({
        success: false,
        messageId: deletion.messageId,
        clientTempId: deletion.clientTempId,
        error: error.message
      });
    }
  }
  
  return results;
};

// Health check
const ping = async () => {
  try {
    const result = await redisClient.ping();
    return { status: 'ok', result };
  } catch (error) {
    logger.error(`Redis ping failed: ${error}`);
    return { status: 'error', error: error.message };
  }
};

// Get queue statistics
const getQueueStats = async () => {
  try {
    const pipeline = redisClient.pipeline();
    
    Object.values(QUEUES).forEach(queue => {
      pipeline.llen(queue);
    });
    
    const results = await pipeline.exec();
    const stats = {};
    
    Object.values(QUEUES).forEach((queue, index) => {
      const [error, length] = results[index];
      stats[queue] = error ? -1 : length;
    });
    
    return stats;
  } catch (error) {
    logger.error(`Error getting queue stats: ${error}`);
    return {};
  }
};

module.exports = {
  enqueueMessage,
  enqueueBatchMessages,
  enqueuePresenceUpdate,
  enqueueNotification,
  enqueueConversationOperation,
  enqueueDeliveryReceipt,
  enqueueReadReceipt,
  storeOfflineMessage,
  getOfflineMessages,
  storeOfflineNotification,
  getOfflineNotifications,
  processMessageQueue,
  processPresenceQueue,
  processDeliveryReceiptsQueue,
  processReadReceiptsQueue,
  processConversationQueue,
  processBatchQueue,
  ping,
  getQueueStats,
  redisClient,
  QUEUES,
  OFFLINE_STORAGE
};