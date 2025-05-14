// socket/handlers/presenceHandler.js
const logger = require('../../utils/logger');
const presenceService = require('../../services/socket/presenceService');
const redisService = require('../../services/redis');
const db = require('../../db');

module.exports = (io, socket) => {
  const userId = socket.user.id;

  // Handle manual presence updates from client
  socket.on('set_presence', async ({ status }) => {
    try {
      const isOnline = status === 'online' || status === true;
      
      await presenceService.updateUserPresence(userId, isOnline, socket.id);
      presenceService.broadcastUserStatus(io, userId, isOnline);
      
      socket.emit('presence_updated', {
        userId,
        status: isOnline ? 'online' : 'offline',
        timestamp: Date.now()
      });
      
      logger.info(`User ${userId} manually set presence to ${status}`);
    } catch (error) {
      logger.error(`Error setting presence for user ${userId}: ${error}`);
      socket.emit('error', {
        code: 'PRESENCE_UPDATE_FAILED',
        message: 'Failed to update presence status'
      });
    }
  });

  // Get user's current presence
  socket.on('get_presence', async ({ userIds }) => {
    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'userIds must be a non-empty array'
        });
      }

      const presenceMap = await redisService.getUsersPresence(userIds);
      
      // Get last seen from database for users not in cache
      const uncachedUsers = userIds.filter(id => !presenceMap[id]);
      
      if (uncachedUsers.length > 0) {
        const models = db.getModels();
        const User = models.User;
        
        if (!User) {
          logger.error('User model not found in database models');
          throw new Error('User model not available');
        }
        
        const users = await User.findAll({
          where: { id: uncachedUsers },
          attributes: ['id', 'isOnline', 'lastSeen']
        });
        
        users.forEach(user => {
          presenceMap[user.id] = {
            isOnline: user.isOnline,
            lastSeen: user.lastSeen
          };
        });
      }
      
      socket.emit('presence_status', {
        presence: presenceMap,
        timestamp: Date.now()
      });
      
      logger.debug(`Sent presence status for ${userIds.length} users to ${userId}`);
    } catch (error) {
      logger.error(`Error getting presence for users: ${error}`);
      socket.emit('error', {
        code: 'PRESENCE_FETCH_FAILED',
        message: 'Failed to get presence information'
      });
    }
  });

  // Subscribe to presence updates for specific users
  socket.on('subscribe_presence', async ({ userIds }) => {
    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'userIds must be a non-empty array'
        });
      }

      // Join presence rooms for each user
      userIds.forEach(targetUserId => {
        socket.join(`presence:${targetUserId}`);
      });
      
      socket.emit('presence_subscribed', {
        userIds,
        timestamp: Date.now()
      });
      
      logger.info(`User ${userId} subscribed to presence updates for ${userIds.length} users`);
    } catch (error) {
      logger.error(`Error subscribing to presence: ${error}`);
      socket.emit('error', {
        code: 'SUBSCRIPTION_FAILED',
        message: 'Failed to subscribe to presence updates'
      });
    }
  });

  // Unsubscribe from presence updates
  socket.on('unsubscribe_presence', async ({ userIds }) => {
    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'userIds must be a non-empty array'
        });
      }

      // Leave presence rooms
      userIds.forEach(targetUserId => {
        socket.leave(`presence:${targetUserId}`);
      });
      
      socket.emit('presence_unsubscribed', {
        userIds,
        timestamp: Date.now()
      });
      
      logger.info(`User ${userId} unsubscribed from presence updates for ${userIds.length} users`);
    } catch (error) {
      logger.error(`Error unsubscribing from presence: ${error}`);
      socket.emit('error', {
        code: 'UNSUBSCRIPTION_FAILED',
        message: 'Failed to unsubscribe from presence updates'
      });
    }
  });

  // Handle typing status
  socket.on('typing', async ({ conversationId, isTyping }) => {
    try {
      if (!conversationId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId is required'
        });
      }

      if (isTyping) {
        await redisService.setUserTyping(userId, conversationId);
      }
      
      // Broadcast to conversation participants
      socket.to(`conversation:${conversationId}`).emit('user_typing', {
        userId,
        conversationId,
        isTyping,
        timestamp: Date.now()
      });
      
      // Emit acknowledgment back to sender
      socket.emit('typing_status_updated', {
        conversationId,
        isTyping,
        timestamp: Date.now()
      });
      
      logger.debug(`User ${userId} ${isTyping ? 'started' : 'stopped'} typing in conversation ${conversationId}`);
    } catch (error) {
      logger.error(`Error handling typing status: ${error}`);
      socket.emit('error', {
        code: 'TYPING_UPDATE_FAILED',
        message: 'Failed to update typing status'
      });
    }
  });

  // Get users typing in a conversation
  socket.on('get_typing_users', async ({ conversationId }) => {
    try {
      if (!conversationId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId is required'
        });
      }

      const typingUsers = await redisService.getUsersTyping(conversationId);
      
      socket.emit('typing_users', {
        conversationId,
        userIds: typingUsers.filter(id => id !== userId), // Don't include self
        timestamp: Date.now()
      });
      
      logger.debug(`Sent typing users for conversation ${conversationId} to user ${userId}`);
    } catch (error) {
      logger.error(`Error getting typing users: ${error}`);
      socket.emit('error', {
        code: 'TYPING_FETCH_FAILED',
        message: 'Failed to get typing users'
      });
    }
  });

  // Handle last seen update on activity
  socket.on('update_last_seen', async () => {
    try {
      const models = db.getModels();
      const User = models.User;
      
      if (!User) {
        throw new Error('User model not available');
      }
      
      await User.update(
        { lastSeen: new Date() },
        { where: { id: userId } }
      );
      
      socket.emit('last_seen_updated', {
        userId,
        lastSeen: new Date().toISOString()
      });
      
      logger.debug(`Updated last seen for user ${userId}`);
    } catch (error) {
      logger.error(`Error updating last seen: ${error}`);
      socket.emit('error', {
        code: 'LAST_SEEN_UPDATE_FAILED',
        message: 'Failed to update last seen'
      });
    }
  });

  // Handle invisible mode
  socket.on('set_invisible_mode', async ({ enabled }) => {
    try {
      const models = db.getModels();
      const User = models.User;
      
      if (!User) {
        throw new Error('User model not available');
      }
      
      const user = await User.findByPk(userId);
      
      if (!user) {
        return socket.emit('error', {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        });
      }

      // Update user metadata for invisible mode
      const metaData = user.metaData || {};
      metaData.invisibleMode = enabled;
      
      await user.update({ metaData });
      
      // Update presence visibility
      await presenceService.updateUserPresence(userId, !enabled, socket.id);
      
      socket.emit('invisible_mode_updated', {
        enabled,
        timestamp: Date.now()
      });
      
      logger.info(`User ${userId} set invisible mode to ${enabled}`);
    } catch (error) {
      logger.error(`Error setting invisible mode: ${error}`);
      socket.emit('error', {
        code: 'INVISIBLE_MODE_FAILED',
        message: 'Failed to update invisible mode'
      });
    }
  });

  // Handle heartbeat for connection monitoring
  socket.on('heartbeat', async () => {
    try {
      const timestamp = Date.now();
      
      // Update Redis presence to keep connection alive
      await presenceService.updateUserPresence(userId, true, socket.id);
      
      socket.emit('heartbeat_ack', {
        timestamp,
        userId,
        socketId: socket.id
      });
      
      logger.debug(`Heartbeat received from user ${userId}`);
    } catch (error) {
      logger.error(`Error handling heartbeat: ${error}`);
    }
  });
};