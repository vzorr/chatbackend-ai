// /services/socket/presenceService.js
const redisService = require('../redis');
const userSocketMap = new Map();
const logger = require('../../utils/logger');

class PresenceService {
  async updateUserSocketMap(userId, socketId, action) {
    if (action === 'add') {
      userSocketMap.set(userId, socketId);
    } else if (action === 'remove' && userSocketMap.get(userId) === socketId) {
      userSocketMap.delete(userId);
    }
  }

  async updateUserPresence(userId, isOnline, socketId = null) {
    await redisService.updateUserPresence(userId, isOnline, socketId);
  }

  async isUserStillOnline(userId) {
    return redisService.isUserStillOnline(userId);
  }

  broadcastUserStatus(io, userId, isOnline) {
    io.emit(isOnline ? 'user_online' : 'user_offline', {
      id: userId,
      isOnline,
      lastSeen: isOnline ? null : new Date().toISOString()
    });
  }

  getSocketId(userId) {
    return userSocketMap.get(userId);
  }
}

module.exports = new PresenceService();
