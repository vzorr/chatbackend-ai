// services/socket/presenceService.js
const redisService = require('../redis');
const db = require('../../db');
const logger = require('../../utils/logger');
const { Op } = require('sequelize');

class PresenceService {
  constructor() {
    // In-memory map for quick socket ID lookups
    this.userSocketMap = new Map(); // userId -> socketId
    this.socketUserMap = new Map(); // socketId -> userId
  }

  /**
   * Update the in-memory socket mapping
   */
  async updateUserSocketMap(userId, socketId, action) {
    try {
      if (action === 'add') {
        this.userSocketMap.set(userId, socketId);
        this.socketUserMap.set(socketId, userId);
        logger.debug(`Added socket mapping: user ${userId} -> socket ${socketId}`);
      } else if (action === 'remove') {
        const existingSocketId = this.userSocketMap.get(userId);
        if (existingSocketId === socketId) {
          this.userSocketMap.delete(userId);
          this.socketUserMap.delete(socketId);
          logger.debug(`Removed socket mapping: user ${userId} -> socket ${socketId}`);
        }
      }
    } catch (error) {
      logger.error('Error updating user socket map', {
        userId,
        socketId,
        action,
        error: error.message
      });
    }
  }

  /**
   * Update user presence in Redis with user details
   */
  async updateUserPresence(userId, isOnline, socketId = null) {
    try {
      const key = redisService.KEY_PREFIXES.USER_PRESENCE + userId;
      
      // Default user info
      let userName = 'Unknown User';
      let userEmail = null;
      let userAvatar = null;
      let userPhone = null;
      let userRole = null;
      
      // Get user details from database
      if (isOnline) {
        try {
          // Ensure DB is initialized
          if (!db.isInitialized()) {
            await db.waitForInitialization();
          }
          
          const models = db.getModels();
          const user = await models.User.findByPk(userId, {
            attributes: ['id', 'name', 'firstName', 'lastName', 'email', 'phone', 'avatar', 'role']
          });
          
          if (user) {
            // Use the virtual fullName getter or fallback to name
            userName = user.fullName || user.name || user.email || user.phone || 'Unknown User';
            userEmail = user.email;
            userAvatar = user.avatar;
            userPhone = user.phone;
            userRole = user.role;
          }
        } catch (error) {
          logger.error('Error fetching user details for presence', {
            userId,
            error: error.message
          });
        }
      }
      
      const data = JSON.stringify({
        userId,
        userName,
        userEmail,
        userAvatar,
        userPhone,
        userRole,
        isOnline,
        socketId: isOnline ? socketId : null,
        lastSeen: isOnline ? null : new Date().toISOString(),
        updatedAt: Date.now()
      });
      
      await redisService.redisClient.set(key, data);
      await redisService.redisClient.expire(key, redisService.TTL.USER_PRESENCE);
      
      // Also update database
      await this.updateDatabasePresence(userId, isOnline, socketId);
      
      logger.debug(`Updated presence for user ${userId} (${userName}): ${isOnline ? 'online' : 'offline'}`);
      return true;
    } catch (error) {
      logger.error('Error updating user presence', {
        userId,
        isOnline,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Update user presence in database (matching your User model fields)
   */
  async updateDatabasePresence(userId, isOnline, socketId = null) {
    try {
      if (!db.isInitialized()) {
        await db.waitForInitialization();
      }
      
      const models = db.getModels();
      const updateData = {
        isOnline,
        socketId: isOnline ? socketId : null,
        lastSeen: isOnline ? null : new Date()
      };
      
      await models.User.update(updateData, {
        where: { id: userId }
      });
      
      logger.debug(`Updated database presence for user ${userId}`);
    } catch (error) {
      logger.error('Error updating database presence', {
        userId,
        isOnline,
        error: error.message
      });
    }
  }

  /**
   * Check if user is still online
   */
  async isUserStillOnline(userId) {
    try {
      return await redisService.isUserStillOnline(userId);
    } catch (error) {
      logger.error('Error checking if user is online', {
        userId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Broadcast user status change to all connected clients
   */
  broadcastUserStatus(io, userId, isOnline, userName = null, userAvatar = null) {
    try {
      const eventData = {
        id: userId,
        name: userName || 'Unknown User',
        avatar: userAvatar,
        isOnline,
        lastSeen: isOnline ? null : new Date().toISOString()
      };
      
      io.emit(isOnline ? 'user_online' : 'user_offline', eventData);
      
      logger.debug(`Broadcasted ${isOnline ? 'online' : 'offline'} status for user ${userId}`);
    } catch (error) {
      logger.error('Error broadcasting user status', {
        userId,
        isOnline,
        error: error.message
      });
    }
  }

  /**
   * Get socket ID for a user
   */
  getSocketId(userId) {
    return this.userSocketMap.get(userId);
  }

  /**
   * Get user ID for a socket
   */
  getUserId(socketId) {
    return this.socketUserMap.get(socketId);
  }

  /**
   * Get all online users with full details from Redis and Database
   */
  async getOnlineUsersWithDetails() {
    try {
      const onlineUsers = await redisService.getOnlineUsers();
      
      if (!onlineUsers.length) {
        return [];
      }
      
      // Get additional user details from database
      const userIds = onlineUsers.map(u => u.id);
      
      if (!db.isInitialized()) {
        await db.waitForInitialization();
      }
      
      const models = db.getModels();
      const users = await models.User.findAll({
        where: { id: { [Op.in]: userIds } },
        attributes: ['id', 'name', 'firstName', 'lastName', 'email', 'phone', 'avatar', 'role']
      });
      
      // Create a map for quick lookup
      const userMap = new Map(users.map(u => [u.id, u]));
      
      // Enrich online users with database details
      const enrichedUsers = onlineUsers.map(onlineUser => {
        const dbUser = userMap.get(onlineUser.id);
        return {
          id: onlineUser.id,
          name: dbUser?.fullName || dbUser?.name || 'Unknown User',
          firstName: dbUser?.firstName,
          lastName: dbUser?.lastName,
          email: dbUser?.email,
          phone: dbUser?.phone,
          avatar: dbUser?.avatar,
          role: dbUser?.role,
          isOnline: true,
          socketId: onlineUser.socketId,
          lastSeen: onlineUser.lastSeen,
          updatedAt: onlineUser.updatedAt
        };
      });
      
      logger.debug(`Retrieved ${enrichedUsers.length} online users with details`);
      return enrichedUsers;
    } catch (error) {
      logger.error('Error getting online users with details', {
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Get count of online users
   */
  async getOnlineUserCount() {
    try {
      const onlineUsers = await redisService.getOnlineUsers();
      return onlineUsers.length;
    } catch (error) {
      logger.error('Error getting online user count', {
        error: error.message
      });
      return 0;
    }
  }

  /**
   * Check if specific user is online
   */
  async isUserOnline(userId) {
    try {
      const presence = await redisService.getUserPresence(userId);
      return presence && presence.isOnline === true;
    } catch (error) {
      logger.error('Error checking user online status', {
        userId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get online users by role
   */
  async getOnlineUsersByRole(role) {
    try {
      const allOnlineUsers = await this.getOnlineUsersWithDetails();
      return allOnlineUsers.filter(user => user.role === role);
    } catch (error) {
      logger.error('Error getting online users by role', {
        role,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Clear all socket mappings (useful for cleanup/restart)
   */
  clearSocketMappings() {
    this.userSocketMap.clear();
    this.socketUserMap.clear();
    logger.info('Cleared all socket mappings');
  }

  /**
   * Get all socket mappings (for debugging)
   */
  getSocketMappings() {
    return {
      userToSocket: Object.fromEntries(this.userSocketMap),
      socketToUser: Object.fromEntries(this.socketUserMap),
      totalUsers: this.userSocketMap.size,
      totalSockets: this.socketUserMap.size
    };
  }
}

module.exports = new PresenceService();