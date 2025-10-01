// socket/handlers/connectionHandlers.js
const logger = require('../../utils/logger');
const presenceService = require('../../services/socket/presenceService');
const conversationService = require('../../services/socket/conversationService');
const redisService = require('../../services/redis');

module.exports = (io, socket) => {
  const userId = socket.user.id;
  const socketId = socket.id;
  const userName = socket.user.name || 'N/A';

  // ===== DEBUGGING: Log all incoming events =====
  const originalOnevent = socket.onevent;
  socket.onevent = function(packet) {
    const args = packet.data || [];
    logger.debug(`[SOCKET EVENT RECEIVED] User ${userId} | Event: ${args[0]}`, {
      socketId,
      eventName: args[0],
      payload: args[1],
      timestamp: new Date().toISOString()
    });
    originalOnevent.call(this, packet);
  };

  // On connection
  (async () => {
    try {
      logger.info(`[CONNECTION START] User ${userId} connecting...`, {
        socketId,
        userName,
        timestamp: new Date().toISOString()
      });

      await presenceService.updateUserSocketMap(userId, socketId, 'add');
      await presenceService.updateUserPresence(userId, true, socketId);
      presenceService.broadcastUserStatus(io, userId, true);

      logger.info(`[CONNECTION] User ${userId} connected with socket ${socketId}`);

      socket.emit('initial_data', {
        userId,
        conversations: await conversationService.getUserConversations(userId),
        unreadCounts: await redisService.getUnreadCounts(userId),
        onlineUsers: await redisService.getOnlineUsers()
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

      logger.info(`[CONNECTION SUCCESS] User ${userId} fully initialized`, {
        socketId,
        conversationCount: conversationIds.length
      });
    } catch (error) {
      logger.error(`[CONNECTION ERROR] Error during socket connection: ${error.message}`, {
        error: error.stack,
        userId,
        socketId
      });
    }
  })();

  socket.on('connection_status', async () => {
    try {
      logger.debug(`[CONNECTION STATUS] Request from user ${userId}`, { socketId });
      
      const isConnected = socket.connected;
      socket.emit('connection_status_response', {
        connected: isConnected,
        socketId: socket.id,
        userId: userId,
        serverTime: new Date().toISOString()
      });

      logger.debug(`[CONNECTION STATUS] Response sent to user ${userId}`, {
        socketId,
        connected: isConnected
      });
    } catch (error) {
      logger.error(`[CONNECTION STATUS ERROR] ${error.message}`, {
        error: error.stack,
        userId,
        socketId
      });
    }
  });

  // ===== ENHANCED get_all_online_users HANDLER WITH DEBUGGING =====
  socket.on('get_all_online_users', async (payload) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info(`[GET_ALL_ONLINE_USERS] ⬇️ REQUEST RECEIVED`, {
      requestId,
      userId,
      socketId,
      payload,
      timestamp: new Date().toISOString()
    });

    try {
      // Check if redisService has getOnlineUsers method
      if (!redisService.getOnlineUsers) {
        logger.error(`[GET_ALL_ONLINE_USERS] ❌ redisService.getOnlineUsers is not defined`, {
          requestId,
          userId,
          redisServiceMethods: Object.keys(redisService)
        });
        
        socket.emit('error', {
          code: 'GET_ALL_ONLINE_USERS_FAILED',
          message: 'getOnlineUsers method not available',
          requestId
        });
        return;
      }

      logger.debug(`[GET_ALL_ONLINE_USERS] 🔍 Fetching online users from Redis...`, {
        requestId,
        userId
      });

      const onlineUsers = await redisService.getOnlineUsers();
      
      logger.info(`[GET_ALL_ONLINE_USERS] ✅ Online users fetched successfully`, {
        requestId,
        userId,
        socketId,
        count: onlineUsers?.length || 0,
        users: onlineUsers,
        timestamp: new Date().toISOString()
      });

      const response = {
        users: onlineUsers,
        count: onlineUsers?.length || 0,
        timestamp: Date.now(),
        requestId
      };

      logger.debug(`[GET_ALL_ONLINE_USERS] 📤 Emitting response to client`, {
        requestId,
        userId,
        socketId,
        response
      });

      socket.emit('all_online_users', response);

      logger.info(`[GET_ALL_ONLINE_USERS] ⬆️ RESPONSE SENT`, {
        requestId,
        userId,
        socketId,
        eventName: 'all_online_users',
        userCount: response.count,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error(`[GET_ALL_ONLINE_USERS] ❌ ERROR occurred`, {
        requestId,
        userId,
        socketId,
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      
      socket.emit('error', {
        code: 'GET_ALL_ONLINE_USERS_FAILED',
        message: 'Failed to retrieve online users list',
        error: error.message,
        requestId
      });

      // Also emit empty response as fallback
      socket.emit('all_online_users', {
        users: [],
        count: 0,
        timestamp: Date.now(),
        requestId,
        error: true
      });
    }
  });

  // Note: If client tries multiple event names, server should standardize on ONE
  // The client's retry mechanism will find the correct event name

  socket.on('disconnect', async () => {
    try {
      logger.info(`[DISCONNECT] User ${userId} disconnecting...`, {
        socketId,
        timestamp: new Date().toISOString()
      });

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

      logger.info(`[DISCONNECT] User ${userId} disconnected from socket ${socketId}`, {
        stillOnline,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`[DISCONNECT ERROR] ${error.message}`, {
        error: error.stack,
        userId,
        socketId
      });
    }
  });

  // ===== DEBUGGING: Test event to verify socket communication =====
  socket.on('ping', async (data) => {
    logger.debug(`[PING] Received from user ${userId}`, {
      socketId,
      data,
      timestamp: new Date().toISOString()
    });
    
    socket.emit('pong', {
      userId,
      socketId,
      timestamp: Date.now(),
      receivedData: data
    });
    
    logger.debug(`[PONG] Sent to user ${userId}`, { socketId });
  });

  // ===== LOG ALL REGISTERED EVENT LISTENERS =====
  setTimeout(() => {
    const eventNames = Object.keys(socket._events || {});
    logger.info(`[SOCKET EVENTS] Registered event listeners for user ${userId}`, {
      socketId,
      eventNames,
      count: eventNames.length
    });
  }, 100);
};