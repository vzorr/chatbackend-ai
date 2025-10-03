// socket/handlers/connectionHandlers.js
const logger = require('../../utils/logger');
const presenceService = require('../../services/socket/presenceService');
const conversationService = require('../../services/socket/conversationService');
const redisService = require('../../services/redis');

module.exports = (io, socket) => {

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔥 SOCKET CONNECTION DETECTED');
  console.log('Socket ID:', socket.id);
  console.log('User:', socket.user);
  console.log('Time:', new Date().toISOString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const userId = socket.user.id;
  const socketId = socket.id;
  
  const userName = socket.user.name || 
                   (socket.user.firstName && socket.user.lastName ? 
                    `${socket.user.firstName} ${socket.user.lastName}` : 
                    socket.user.firstName || socket.user.lastName) || 
                   'Unknown User';

   // ===== DEBUGGING: Log all incoming events =====
  const originalOnevent = socket.onevent;
  socket.onevent = function(packet) {
    const args = packet.data || [];
    
     // Console log for immediate visibility
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[SOCKET EVENT RECEIVED]');
    console.log('User ID:', userId);
    console.log('Socket ID:', socketId);
    console.log('Event Name:', args[0]);
    console.log('Payload:', JSON.stringify(args[1], null, 2));
    console.log('Timestamp:', new Date().toISOString());
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    
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
        userDetails: {
          id: socket.user.id,
          name: socket.user.name,
          firstName: socket.user.firstName,
          lastName: socket.user.lastName
        },
        timestamp: new Date().toISOString()
      });

      // Update presence in Redis
      await presenceService.updateUserSocketMap(userId, socketId, 'add');
      await presenceService.updateUserPresence(userId, true, socketId);
      
      logger.info(`[CONNECTION] Updated Redis presence for user ${userId}`);
      
      // Broadcast to presence subscribers
      presenceService.broadcastUserStatus(io, userId, true);

      // Fetch online users for this connecting client
      const onlineUsers = await redisService.getOnlineUsers();
      
      logger.info(`[CONNECTION] Fetched online users for initial_data`, {
        userId,
        count: onlineUsers.length,
        usersList: onlineUsers.map(u => ({ id: u.id, name: u.name }))
      });

      // Send initial data to the connecting client
      const conversations = await conversationService.getUserConversations(userId);
      const unreadCounts = await redisService.getUnreadCounts(userId);
      
      const initialData = {
        userId,
        conversations,
        unreadCounts,
        onlineUsers
      };

      logger.info(`[CONNECTION] Sending initial_data`, {
        userId,
        conversationCount: conversations?.length || 0,
        onlineUserCount: onlineUsers?.length || 0
      });

      socket.emit('initial_data', initialData);
      
      // Notify OTHER clients about this user coming online
      socket.broadcast.emit('user_online', {
        id: userId,
        name: userName,
        firstName: socket.user.firstName,
        lastName: socket.user.lastName,
        isOnline: true,
        lastSeen: null
      });

      // Join conversation rooms
      const conversationIds = await conversationService.getUserConversationIds(userId);
      conversationIds.forEach((conversationId) => {
        socket.join(`conversation:${conversationId}`);
      });

      // Send connection confirmation
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

      // Broadcast UPDATED online users list to ALL clients (including this one)
      const updatedOnlineUsers = await redisService.getOnlineUsers();
      
      logger.info(`[CONNECTION] Broadcasting all_online_users to all clients`, {
        count: updatedOnlineUsers.length,
        usersList: updatedOnlineUsers.map(u => ({ id: u.id, name: u.name }))
      });
      
      io.emit('all_online_users', {
        users: updatedOnlineUsers,
        count: updatedOnlineUsers.length,
        timestamp: Date.now()
      });

      logger.info(`[CONNECTION SUCCESS] User ${userId} fully initialized`, {
        socketId,
        conversationCount: conversationIds.length,
        onlineUserCount: updatedOnlineUsers.length
      });
      
    } catch (error) {
      logger.error(`[CONNECTION ERROR] Error during socket connection`, {
        error: error.message,
        stack: error.stack,
        userId,
        socketId
      });
    }
  })();

  // Debug Redis keys
  socket.on('debug_redis', async () => {
    try {
      const presenceKeys = await redisService.redisClient.keys('presence:user:*');
      const keyData = {};
      
      for (const key of presenceKeys) {
        const data = await redisService.redisClient.get(key);
        keyData[key] = data ? JSON.parse(data) : null;
      }
      
      logger.info('[DEBUG] Redis presence keys', {
        count: presenceKeys.length,
        keys: presenceKeys,
        dataSnapshot: Object.keys(keyData).slice(0, 5)
      });
      
      socket.emit('debug_redis_response', {
        keysCount: presenceKeys.length,
        keys: presenceKeys,
        data: keyData
      });
    } catch (error) {
      logger.error('[DEBUG] Redis debug error', { error: error.message });
      socket.emit('debug_redis_response', { error: error.message });
    }
  });

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
      logger.error(`[CONNECTION STATUS ERROR]`, {
        error: error.message,
        stack: error.stack,
        userId,
        socketId
      });
    }
  });

  // Get all online users handler
  socket.on('get_all_online_users', async (payload) => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info(`[GET_ALL_ONLINE_USERS] REQUEST RECEIVED`, {
      requestId,
      userId,
      socketId,
      payload,
      timestamp: new Date().toISOString()
    });

    try {
      if (!redisService.getOnlineUsers) {
        logger.error(`[GET_ALL_ONLINE_USERS] redisService.getOnlineUsers is not defined`, {
          requestId,
          userId,
          availableMethods: Object.keys(redisService)
        });
        
        socket.emit('error', {
          code: 'GET_ALL_ONLINE_USERS_FAILED',
          message: 'getOnlineUsers method not available',
          requestId
        });
        return;
      }

      const onlineUsers = await redisService.getOnlineUsers();
      
      logger.info(`[GET_ALL_ONLINE_USERS] Online users fetched successfully`, {
        requestId,
        userId,
        socketId,
        count: onlineUsers?.length || 0,
        usersList: onlineUsers?.map(u => ({ id: u.id, name: u.name })) || []
      });

      const response = {
        users: onlineUsers,
        count: onlineUsers?.length || 0,
        timestamp: Date.now(),
        requestId
      };

      socket.emit('all_online_users', response);

      logger.info(`[GET_ALL_ONLINE_USERS] RESPONSE SENT`, {
        requestId,
        userId,
        socketId,
        userCount: response.count
      });

    } catch (error) {
      logger.error(`[GET_ALL_ONLINE_USERS] ERROR occurred`, {
        requestId,
        userId,
        socketId,
        error: error.message,
        stack: error.stack
      });
      
      socket.emit('error', {
        code: 'GET_ALL_ONLINE_USERS_FAILED',
        message: 'Failed to retrieve online users list',
        error: error.message,
        requestId
      });

      socket.emit('all_online_users', {
        users: [],
        count: 0,
        timestamp: Date.now(),
        requestId,
        error: true
      });
    }
  });

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
        
        socket.broadcast.emit('user_offline', {
          id: userId,
          name: userName,
          isOnline: false,
          lastSeen: new Date().toISOString()
        });
        
        // Broadcast updated online users list
        const onlineUsers = await redisService.getOnlineUsers();
        io.emit('all_online_users', {
          users: onlineUsers,
          count: onlineUsers.length,
          timestamp: Date.now()
        });
      }

      logger.info(`[DISCONNECT] User ${userId} disconnected from socket ${socketId}`, {
        stillOnline,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`[DISCONNECT ERROR]`, {
        error: error.message,
        stack: error.stack,
        userId,
        socketId
      });
    }
  });

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

  // Log registered event listeners
  setTimeout(() => {
    const eventNames = Object.keys(socket._events || {});
    logger.info(`[SOCKET EVENTS] Registered event listeners for user ${userId}`, {
      socketId,
      eventNames,
      count: eventNames.length
    });
  }, 100);
};