// socket/handlers/connectionHandlers.js
const logger = require('../../utils/logger');
const presenceService = require('../../services/socket/presenceService');
const conversationService = require('../../services/socket/conversationService');

module.exports = (io, socket) => {
  const userId = socket.user.id;
  const socketId = socket.id;
  const userName = socket.user.name || 'N/A';

  // On connection
  (async () => {
    try {
      await presenceService.updateUserSocketMap(userId, socketId, 'add');
      await presenceService.updateUserPresence(userId, true, socketId);
      presenceService.broadcastUserStatus(io, userId, true);

      logger.info(`User ${userId} connected with socket ${socketId}`);

      socket.emit('initial_data', {
        userId,
        conversations: await conversationService.getUserConversations(userId),
        unreadCounts: await redisService.getUnreadCounts(userId),
        onlineUsers: await redisService.getOnlineUsers() // if needed
      });
      
      io.emit('user_online', {
        id: userId,
        name: userName,
        isOnline: true,
        lastSeen: null
      });

      const conversationIds = await conversationService.getUserConversationIds(userId);
      conversationIds.forEach((conversationId) => {
        socket.join(`conversation:${conversationId}`);
      });

      socket.emit('connection_established', {
        userId,
        socketId,
        timestamp: Date.now()
      });
      socket.emit('connection_success', {
        userId,
        socketId,
        timestamp: Date.now()
      });
    } catch (error) {
      logger.error(`Error during socket connection: ${error.message}`, {
        error: error.stack,
        userId,
        socketId
      });
    }
  })();

  socket.on('connection_status', async () => {
    try {
      const isConnected = socket.connected;
      socket.emit('connection_status_response', {
        connected: isConnected,
        socketId: socket.id,
        userId: userId,
        serverTime: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Error handling connection_status: ${error.message}`, {
        error: error.stack,
        userId,
        socketId
      });
    }
  });

  socket.on('disconnect', async () => {
    try {
      await presenceService.updateUserSocketMap(userId, socketId, 'remove');
      const stillOnline = await presenceService.isUserStillOnline(userId);
      if (!stillOnline) {
        await presenceService.updateUserPresence(userId, false);
        presenceService.broadcastUserStatus(io, userId, false);
        io.emit('user_offline', {
          id: userId,
          name: userName,
          isOnline: false,
          lastSeen: new Date().toISOString()
        });
      }

      logger.info(`User ${userId} disconnected from socket ${socketId}`);
    } catch (error) {
      logger.error(`Error during socket disconnection: ${error.message}`, {
        error: error.stack,
        userId,
        socketId
      });
    }
  });
};