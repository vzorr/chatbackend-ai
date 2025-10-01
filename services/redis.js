// services/redis.js
const Redis = require('ioredis');
const { promisify } = require('util');
const logger = require('../utils/logger');

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
        return null; // Don't retry anymore
      }
      const delay = Math.min(times * 100, 3000); // Gradually increase delay up to 3s
      logger.warn(`Redis connection attempt ${times} failed. Retrying in ${delay}ms...`);
      return delay;
    },
    // Reconnect on error
    reconnectOnError: (err) => {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        // Reconnect when Redis is in read-only mode (for failover scenarios)
        return true;
      }
      return false;
    }
  };

  const client = new Redis(redisOptions);
  
  // Event handlers for connection management
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

// User presence functions
const setUserOnline = async (userId, socketId) => {
  const key = KEY_PREFIXES.USER_PRESENCE + userId;
  const data = JSON.stringify({
    isOnline: true,
    socketId,
    lastSeen: null,
    updatedAt: Date.now()
  });
  
  await redisClient.set(key, data);
  await redisClient.expire(key, TTL.USER_PRESENCE);
  return true;
};

const setUserOffline = async (userId) => {
  const key = KEY_PREFIXES.USER_PRESENCE + userId;
  
  // Get current data first
  const current = await redisClient.get(key);
  let data;
  
  if (current) {
    // Update existing data
    const parsed = JSON.parse(current);
    data = JSON.stringify({
      ...parsed,
      isOnline: false,
      socketId: null,
      lastSeen: new Date().toISOString(),
      updatedAt: Date.now()
    });
  } else {
    // Create new entry
    data = JSON.stringify({
      isOnline: false,
      socketId: null,
      lastSeen: new Date().toISOString(),
      updatedAt: Date.now()
    });
  }
  
  await redisClient.set(key, data);
  await redisClient.expire(key, TTL.USER_PRESENCE);
  return true;
};

const getUserPresence = async (userId) => {
  const key = KEY_PREFIXES.USER_PRESENCE + userId;
  const data = await redisClient.get(key);
  
  if (!data) return null;
  
  return JSON.parse(data);
};

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
      presenceMap[userIds[index]] = JSON.parse(data);
    }
  });
  
  return presenceMap;
};

// Conversation functions
const cacheConversation = async (conversation) => {
  const key = KEY_PREFIXES.CONVERSATION + conversation.id;
  await redisClient.set(key, JSON.stringify(conversation));
  await redisClient.expire(key, TTL.CONVERSATION);
  
  // Also store the participants for quick lookup
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
  // Find all conversations where the user is a participant
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
      // Extract the conversation ID from the key
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

// Message functions
const cacheMessage = async (message) => {
  // Cache individual message
  const messageKey = KEY_PREFIXES.MESSAGE + message.id;
  await redisClient.set(messageKey, JSON.stringify(message));
  await redisClient.expire(messageKey, TTL.MESSAGES);
  
  // If it belongs to a conversation, add to the conversation's message list
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
  
  // Get message IDs ordered by timestamp (most recent first)
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

// Fixed - removed "this." references
const isUserStillOnline = async (userId) => {
  const presence = await getUserPresence(userId);
  return presence && presence.isOnline;
}

const updateUserPresence = async (userId, isOnline, socketId = null) => {
  if (isOnline) {
    return await setUserOnline(userId, socketId);
  } else {
    return await setUserOffline(userId);
  }
}

// Typing indicator functions - UPDATED
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
    
    // Check for expired typing sessions (older than 5 seconds)
    Object.entries(data).forEach(([userId, timestamp]) => {
      const age = now - parseInt(timestamp);
      if (age < 5000) {
        typingUsers.push(userId);
      } else {
        expiredUsers.push(userId);
      }
    });
    
    // Clean up expired users
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

// Unread messages count
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
  
  // Convert string counts to numbers
  const counts = {};
  Object.entries(data).forEach(([conversationId, count]) => {
    counts[conversationId] = parseInt(count);
  });
  
  return counts;
};

// Health check function
const ping = async () => {
  try {
    return await redisClient.ping();
  } catch (error) {
    logger.error(`Redis ping failed: ${error}`);
    return false;
  }
};


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
          if (presence.isOnline) {
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
    
    logger.info(`[Redis] Found ${onlineUserIds.length} online user IDs, fetching user details...`, {
      userIds: onlineUserIds
    });
    
    // Fetch user details from database
    try {
      const models = db.getModels();
      const User = models.User;
      
      if (!User) {
        logger.error('[Redis] User model not available');
        // Return basic data without names
        return onlineUserIds.map(userId => ({
          id: userId,
          name: 'Unknown User',
          isOnline: true,
          socketId: presenceData[userId].socketId,
          lastSeen: null
        }));
      }
      
      const users = await User.findAll({
        where: { id: onlineUserIds },
        attributes: ['id', 'name', 'firstName', 'lastName', 'email', 'avatar', 'role']
      });
      
      logger.info(`[Redis] Fetched ${users.length} user records from database`);
      
      const onlineUsers = users.map(user => {
        // Use fullName getter or construct name from firstName/lastName
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
          socketId: presenceData[user.id].socketId,
          lastSeen: null,
          updatedAt: presenceData[user.id].updatedAt
        };
      });
      
      logger.info(`[Redis] Returning ${onlineUsers.length} online users with full details`, {
        users: onlineUsers.map(u => ({ id: u.id, name: u.name }))
      });
      
      return onlineUsers;
      
    } catch (dbError) {
      logger.error('[Redis] Database error while fetching user details', { 
        error: dbError.message,
        stack: dbError.stack 
      });
      
      // Fallback: return basic data
      return onlineUserIds.map(userId => ({
        id: userId,
        name: 'Unknown User',
        isOnline: true,
        socketId: presenceData[userId].socketId,
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

module.exports = {
  redisClient,
  setUserOnline,
  setUserOffline,
  getUserPresence,
  getUsersPresence,
  cacheConversation,
  getConversation,
  getUserConversations,
  cacheMessage,
  getMessage,
  getConversationMessages,
  setUserTyping,
  removeUserTyping,
  getUsersTyping,
  incrementUnreadCount,
  resetUnreadCount,
  getUnreadCounts,
  ping,
  KEY_PREFIXES,
  TTL,
  updateUserPresence,
  isUserStillOnline,
  getOnlineUsers,
};