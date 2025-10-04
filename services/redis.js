// services/redis.js
const Redis = require('ioredis');
const { promisify } = require('util');
const logger = require('../utils/logger');
const db = require('../db');

// Create Redis connection with options for resilience
const createRedisClient = () => {
  const redisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 5,
    retryStrategy: (times) => {
      if (times > 10) {
        logger.error('Redis retry attempts exhausted. Connection failed.');
        return null;
      }
      const delay = Math.min(times * 100, 3000);
      logger.warn(`Redis connection attempt ${times} failed. Retrying in ${delay}ms...`);
      return delay;
    },
    reconnectOnError: (err) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        return true;
      }
      return false;
    }
  };

  const client = new Redis(redisOptions);
  
  client.on('connect', () => {
    logger.info('Redis client connected');
  });
  
  client.on('error', (err) => {
    logger.error(`Redis client error: ${err}`);
  });
  
  client.on('ready', () => {
    logger.info('Redis client ready');
  });
  
  client.on('close', () => {
    logger.warn('Redis client connection closed');
  });

  client.on('reconnecting', () => {
    logger.info('Redis client reconnecting');
  });

  return client;
};

const redisClient = createRedisClient();

// Key prefixes for different data types
const KEY_PREFIXES = {
  USER_PRESENCE: 'presence:user:',
  USER_SESSIONS: 'sessions:user:',
  CONVERSATION: 'conversation:',
  CONVERSATION_MESSAGES: 'conversation:messages:',
  CONVERSATION_PARTICIPANTS: 'conversation:participants:',
  MESSAGE: 'message:',
  TYPING_STATUS: 'typing:',
  UNREAD_COUNT: 'unread:user:'
};

// TTLs for different types of data
const TTL = {
  USER_PRESENCE: 60 * 60, // 1 hour
  CONVERSATION: 24 * 60 * 60, // 1 day
  MESSAGES: 7 * 24 * 60 * 60, // 7 days
  TYPING_STATUS: 30 // 30 seconds
};

// ============================================================================
// UPDATED PRESENCE FUNCTIONS - Multi-Device Support
// ============================================================================

/**
 * Add socket to user's presence (supports multiple devices)
 * @param {string} userId - User ID
 * @param {string} socketId - Socket ID to add
 * @param {object} userDetails - User details (name, avatar, email, role)
 * @returns {object} Updated presence data
 */
const addUserSocket = async (userId, socketId, userDetails = {}) => {
  try {
    const key = KEY_PREFIXES.USER_PRESENCE + userId;
    
    // Get current presence
    let presence = null;
    const current = await redisClient.get(key);
    if (current) {
      try {
        presence = JSON.parse(current);
      } catch (parseError) {
        logger.warn('Could not parse existing presence data', { userId });
      }
    }
    
    // Add socket to list (avoid duplicates)
    const socketIds = presence?.socketIds || [];
    if (!socketIds.includes(socketId)) {
      socketIds.push(socketId);
    }
    
    // Update presence with user details
    const data = {
      userId,
      name: userDetails.name || presence?.name || 'Unknown User',
      avatar: userDetails.avatar || presence?.avatar || null,
      email: userDetails.email || presence?.email || null,
      role: userDetails.role || presence?.role || 'user',
      isOnline: true,
      socketIds,
      lastSeen: null,
      updatedAt: Date.now()
    };
    
    await redisClient.set(key, JSON.stringify(data));
    await redisClient.expire(key, TTL.USER_PRESENCE);
    
    logger.debug('Added socket to user presence', { 
      userId, 
      socketId, 
      totalSockets: socketIds.length 
    });
    
    return data;
    
  } catch (error) {
    logger.error('Error adding user socket', { 
      userId, 
      socketId, 
      error: error.message 
    });
    throw error;
  }
};

/**
 * Remove socket from user's presence
 * @param {string} userId - User ID
 * @param {string} socketId - Socket ID to remove
 * @returns {object} { stillOnline: boolean, lastSeen?: string }
 */
const removeUserSocket = async (userId, socketId) => {
  try {
    const key = KEY_PREFIXES.USER_PRESENCE + userId;
    
    // Get current presence
    const current = await redisClient.get(key);
    if (!current) {
      return { stillOnline: false };
    }
    
    let presence;
    try {
      presence = JSON.parse(current);
    } catch (parseError) {
      logger.error('Could not parse presence data', { userId });
      return { stillOnline: false };
    }
    
    // Remove socket from list
    const socketIds = (presence.socketIds || []).filter(id => id !== socketId);
    
    // Still has other sockets?
    if (socketIds.length > 0) {
      presence.socketIds = socketIds;
      presence.updatedAt = Date.now();
      
      await redisClient.set(key, JSON.stringify(presence));
      await redisClient.expire(key, TTL.USER_PRESENCE);
      
      logger.debug('Removed socket, user still online', { 
        userId, 
        socketId, 
        remainingSockets: socketIds.length 
      });
      
      return { stillOnline: true };
    }
    
    // No more sockets - user fully offline
    const lastSeen = new Date().toISOString();
    presence.isOnline = false;
    presence.socketIds = [];
    presence.lastSeen = lastSeen;
    presence.updatedAt = Date.now();
    
    await redisClient.set(key, JSON.stringify(presence));
    await redisClient.expire(key, TTL.USER_PRESENCE);
    
    logger.debug('User fully offline', { userId, socketId, lastSeen });
    
    return { stillOnline: false, lastSeen };
    
  } catch (error) {
    logger.error('Error removing user socket', { 
      userId, 
      socketId, 
      error: error.message 
    });
    return { stillOnline: false };
  }
};

/**
 * Get presence for a single user
 */
const getUserPresence = async (userId) => {
  const key = KEY_PREFIXES.USER_PRESENCE + userId;
  const data = await redisClient.get(key);
  
  if (!data) return null;
  
  try {
    return JSON.parse(data);
  } catch (error) {
    logger.error('Error parsing user presence', { userId, error: error.message });
    return null;
  }
};

/**
 * Get presence for multiple users (optimized with pipeline)
 */
const getUsersPresence = async (userIds) => {
  if (!userIds || !userIds.length) return {};
  
  const pipeline = redisClient.pipeline();
  userIds.forEach(userId => {
    pipeline.get(KEY_PREFIXES.USER_PRESENCE + userId);
  });
  
  const results = await pipeline.exec();
  const presenceMap = {};
  
  results.forEach((result, index) => {
    const [err, data] = result;
    if (err) {
      logger.error(`Error fetching presence for user ${userIds[index]}: ${err}`);
      presenceMap[userIds[index]] = null;
    } else if (!data) {
      presenceMap[userIds[index]] = null;
    } else {
      try {
        presenceMap[userIds[index]] = JSON.parse(data);
      } catch (parseError) {
        logger.error('Error parsing presence data', { userId: userIds[index] });
        presenceMap[userIds[index]] = null;
      }
    }
  });
  
  return presenceMap;
};

/**
 * Check if user is still online
 */
const isUserStillOnline = async (userId) => {
  const presence = await getUserPresence(userId);
  return presence && presence.isOnline === true && presence.socketIds?.length > 0;
};

/**
 * Get all online users with full details
 */
const getOnlineUsers = async () => {
  try {
    // Get all user presence keys
    const keys = await redisClient.keys(KEY_PREFIXES.USER_PRESENCE + '*');
    
    if (!keys.length) {
      logger.info('[Redis] No online users found (no presence keys)');
      return [];
    }
    
    // Get all presence data
    const pipeline = redisClient.pipeline();
    keys.forEach(key => {
      pipeline.get(key);
    });
    
    const results = await pipeline.exec();
    const onlineUserIds = [];
    const presenceData = {};
    
    results.forEach((result, index) => {
      const [err, data] = result;
      if (!err && data) {
        try {
          const presence = JSON.parse(data);
          if (presence.isOnline && presence.socketIds?.length > 0) {
            const userId = keys[index].replace(KEY_PREFIXES.USER_PRESENCE, '');
            onlineUserIds.push(userId);
            presenceData[userId] = presence;
          }
        } catch (parseError) {
          logger.error('[Redis] Error parsing presence data', { error: parseError.message });
        }
      }
    });
    
    if (onlineUserIds.length === 0) {
      logger.info('[Redis] No users currently online');
      return [];
    }
    
    logger.info(`[Redis] Found ${onlineUserIds.length} online users`, {
      userIds: onlineUserIds
    });
    
    // Fetch user details from database
    try {
      // Ensure DB is initialized
      if (!db.isInitialized()) {
        logger.warn('[Redis] Database not initialized yet, waiting...');
        await db.waitForInitialization();
      }

      const models = db.getModels();
      const User = models.User;
      
      if (!User) {
        logger.error('[Redis] User model not available');
        // Return data from Redis cache
        return onlineUserIds.map(userId => ({
          id: userId,
          name: presenceData[userId]?.name || 'Unknown User',
          avatar: presenceData[userId]?.avatar,
          email: presenceData[userId]?.email,
          role: presenceData[userId]?.role,
          isOnline: true,
          socketIds: presenceData[userId]?.socketIds || [],
          lastSeen: null
        }));
      }
      
      const users = await User.findAll({
        where: { id: onlineUserIds },
        attributes: ['id', 'name', 'firstName', 'lastName', 'email', 'avatar', 'role']
      });
      
      logger.info(`[Redis] Fetched ${users.length} user records from database`);
      
      const onlineUsers = users.map(user => {
        const displayName = user.fullName || 
                          user.name || 
                          (user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : null) ||
                          user.firstName || 
                          user.lastName || 
                          'Unknown User';
        
        return {
          id: user.id,
          name: displayName,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          avatar: user.avatar,
          role: user.role,
          isOnline: true,
          socketIds: presenceData[user.id]?.socketIds || [],
          lastSeen: null,
          updatedAt: presenceData[user.id]?.updatedAt
        };
      });
      
      logger.info(`[Redis] Returning ${onlineUsers.length} online users with full details`);
      
      return onlineUsers;
      
    } catch (dbError) {
      logger.error('[Redis] Database error while fetching user details', { 
        error: dbError.message,
        stack: dbError.stack 
      });
      
      // Fallback: return data from Redis cache
      return onlineUserIds.map(userId => ({
        id: userId,
        name: presenceData[userId]?.name || 'Unknown User',
        avatar: presenceData[userId]?.avatar,
        email: presenceData[userId]?.email,
        role: presenceData[userId]?.role,
        isOnline: true,
        socketIds: presenceData[userId]?.socketIds || [],
        lastSeen: null
      }));
    }
    
  } catch (error) {
    logger.error('[Redis] Error getting online users', { 
      error: error.message,
      stack: error.stack 
    });
    return [];
  }
};

// ============================================================================
// CONVERSATION FUNCTIONS
// ============================================================================

const cacheConversation = async (conversation) => {
  const key = KEY_PREFIXES.CONVERSATION + conversation.id;
  await redisClient.set(key, JSON.stringify(conversation));
  await redisClient.expire(key, TTL.CONVERSATION);
  
  if (conversation.participantIds && conversation.participantIds.length) {
    const participantsKey = KEY_PREFIXES.CONVERSATION_PARTICIPANTS + conversation.id;
    await redisClient.del(participantsKey);
    await redisClient.sadd(participantsKey, ...conversation.participantIds);
    await redisClient.expire(participantsKey, TTL.CONVERSATION);
  }
  
  return true;
};

const getConversation = async (conversationId) => {
  const key = KEY_PREFIXES.CONVERSATION + conversationId;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
};

const getUserConversations = async (userId) => {
  const pattern = `${KEY_PREFIXES.CONVERSATION_PARTICIPANTS}*`;
  const keys = await redisClient.keys(pattern);
  
  if (!keys.length) return [];
  
  const pipeline = redisClient.pipeline();
  
  for (const key of keys) {
    pipeline.sismember(key, userId);
  }
  
  const results = await pipeline.exec();
  const conversationIds = [];
  
  results.forEach((result, index) => {
    const [err, isMember] = result;
    if (!err && isMember === 1) {
      const conversationId = keys[index].replace(KEY_PREFIXES.CONVERSATION_PARTICIPANTS, '');
      conversationIds.push(conversationId);
    }
  });
  
  if (!conversationIds.length) return [];
  
  const conversationPipeline = redisClient.pipeline();
  conversationIds.forEach(id => {
    conversationPipeline.get(KEY_PREFIXES.CONVERSATION + id);
  });
  
  const conversationResults = await conversationPipeline.exec();
  const conversations = [];
  
  conversationResults.forEach((result) => {
    const [err, data] = result;
    if (!err && data) {
      conversations.push(JSON.parse(data));
    }
  });
  
  return conversations;
};

const deleteConversation = async (conversationId) => {
  try {
    const pipeline = redisClient.pipeline();
    
    const conversationKey = KEY_PREFIXES.CONVERSATION + conversationId;
    pipeline.del(conversationKey);
    
    const participantsKey = KEY_PREFIXES.CONVERSATION_PARTICIPANTS + conversationId;
    pipeline.del(participantsKey);
    
    const messagesKey = KEY_PREFIXES.CONVERSATION_MESSAGES + conversationId;
    pipeline.del(messagesKey);
    
    const typingKey = KEY_PREFIXES.TYPING_STATUS + conversationId;
    pipeline.del(typingKey);
    
    await pipeline.exec();
    
    logger.info(`Deleted conversation ${conversationId} from Redis cache`);
    return true;
    
  } catch (error) {
    logger.error('Error deleting conversation from Redis', {
      conversationId,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};

const deleteConversationMessages = async (conversationId) => {
  try {
    const messagesKey = KEY_PREFIXES.CONVERSATION_MESSAGES + conversationId;
    
    const messageIds = await redisClient.zrange(messagesKey, 0, -1);
    
    if (messageIds.length > 0) {
      const pipeline = redisClient.pipeline();
      
      messageIds.forEach(messageId => {
        pipeline.del(KEY_PREFIXES.MESSAGE + messageId);
      });
      
      pipeline.del(messagesKey);
      
      await pipeline.exec();
      
      logger.info(`Deleted ${messageIds.length} messages for conversation ${conversationId} from Redis`);
    }
    
    return true;
    
  } catch (error) {
    logger.error('Error deleting conversation messages from Redis', {
      conversationId,
      error: error.message
    });
    return false;
  }
};

// ============================================================================
// MESSAGE FUNCTIONS
// ============================================================================

const cacheMessage = async (message) => {
  const messageKey = KEY_PREFIXES.MESSAGE + message.id;
  await redisClient.set(messageKey, JSON.stringify(message));
  await redisClient.expire(messageKey, TTL.MESSAGES);
  
  if (message.conversationId) {
    const listKey = KEY_PREFIXES.CONVERSATION_MESSAGES + message.conversationId;
    await redisClient.zadd(listKey, message.createdAt.getTime() || Date.now(), message.id);
    await redisClient.expire(listKey, TTL.MESSAGES);
  }
  
  return true;
};

const getMessage = async (messageId) => {
  const key = KEY_PREFIXES.MESSAGE + messageId;
  const data = await redisClient.get(key);
  return data ? JSON.parse(data) : null;
};

const getConversationMessages = async (conversationId, limit = 50, offset = 0) => {
  const listKey = KEY_PREFIXES.CONVERSATION_MESSAGES + conversationId;
  
  const messageIds = await redisClient.zrevrange(listKey, offset, offset + limit - 1);
  
  if (!messageIds.length) return [];
  
  const pipeline = redisClient.pipeline();
  messageIds.forEach(id => {
    pipeline.get(KEY_PREFIXES.MESSAGE + id);
  });
  
  const results = await pipeline.exec();
  const messages = [];
  
  results.forEach((result) => {
    const [err, data] = result;
    if (!err && data) {
      messages.push(JSON.parse(data));
    }
  });
  
  return messages;
};

// ============================================================================
// TYPING INDICATOR FUNCTIONS
// ============================================================================

const setUserTyping = async (userId, conversationId, ttlMs = 3000) => {
  try {
    const key = KEY_PREFIXES.TYPING_STATUS + conversationId;
    await redisClient.hset(key, userId, Date.now());
    await redisClient.expire(key, Math.ceil(ttlMs / 1000));
    logger.debug(`Set typing status for user ${userId} in conversation ${conversationId}`);
    return true;
  } catch (error) {
    logger.error('Error setting user typing status', {
      userId,
      conversationId,
      error: error.message
    });
    return false;
  }
};

const removeUserTyping = async (userId, conversationId) => {
  try {
    const key = KEY_PREFIXES.TYPING_STATUS + conversationId;
    await redisClient.hdel(key, userId);
    logger.debug(`Removed typing status for user ${userId} in conversation ${conversationId}`);
    return true;
  } catch (error) {
    logger.error('Error removing user typing status', {
      userId,
      conversationId,
      error: error.message
    });
    return false;
  }
};

const getUsersTyping = async (conversationId) => {
  try {
    const key = KEY_PREFIXES.TYPING_STATUS + conversationId;
    const data = await redisClient.hgetall(key);
    
    if (!data || Object.keys(data).length === 0) {
      return [];
    }
    
    const typingUsers = [];
    const expiredUsers = [];
    const now = Date.now();
    
    Object.entries(data).forEach(([userId, timestamp]) => {
      const age = now - parseInt(timestamp);
      if (age < 5000) {
        typingUsers.push(userId);
      } else {
        expiredUsers.push(userId);
      }
    });
    
    if (expiredUsers.length > 0) {
      await redisClient.hdel(key, ...expiredUsers);
    }
    
    logger.debug(`Found ${typingUsers.length} users typing in conversation ${conversationId}`);
    return typingUsers;
  } catch (error) {
    logger.error('Error getting users typing', {
      conversationId,
      error: error.message
    });
    return [];
  }
};

// ============================================================================
// UNREAD COUNT FUNCTIONS
// ============================================================================

const incrementUnreadCount = async (userId, conversationId) => {
  const key = KEY_PREFIXES.UNREAD_COUNT + userId;
  await redisClient.hincrby(key, conversationId, 1);
  return true;
};

const resetUnreadCount = async (userId, conversationId) => {
  const key = KEY_PREFIXES.UNREAD_COUNT + userId;
  await redisClient.hset(key, conversationId, 0);
  return true;
};

const getUnreadCounts = async (userId) => {
  const key = KEY_PREFIXES.UNREAD_COUNT + userId;
  const data = await redisClient.hgetall(key);
  
  if (!data) return {};
  
  const counts = {};
  Object.entries(data).forEach(([conversationId, count]) => {
    counts[conversationId] = parseInt(count);
  });
  
  return counts;
};

// ============================================================================
// HEALTH CHECK
// ============================================================================

const ping = async () => {
  try {
    return await redisClient.ping();
  } catch (error) {
    logger.error(`Redis ping failed: ${error}`);
    return false;
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  redisClient,
  
  // Presence functions (UPDATED - multi-device support)
  addUserSocket,           // NEW - replaces setUserOnline
  removeUserSocket,        // NEW - replaces setUserOffline
  getUserPresence,
  getUsersPresence,
  isUserStillOnline,
  getOnlineUsers,
  
  // Conversation functions
  cacheConversation,
  getConversation,
  getUserConversations,
  deleteConversation,
  deleteConversationMessages,
  
  // Message functions
  cacheMessage,
  getMessage,
  getConversationMessages,
  
  // Typing functions
  setUserTyping,
  removeUserTyping,
  getUsersTyping,
  
  // Unread counts
  incrementUnreadCount,
  resetUnreadCount,
  getUnreadCounts,
  
  // Health check
  ping,
  
  // Constants
  KEY_PREFIXES,
  TTL
};