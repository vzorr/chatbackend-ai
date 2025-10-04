// socket/handlers/connectionHandlers.js
const logger = require('../../utils/logger');
const redisService = require('../../services/redis');
const conversationService = require('../../services/socket/conversationService');
const db = require('../../db');

module.exports = (io, socket) => {
  const userId = socket.user.id;
  const socketId = socket.id;
  
  const userName = socket.user.name || 
                   (socket.user.firstName && socket.user.lastName ? 
                    `${socket.user.firstName} ${socket.user.lastName}` : 
                    socket.user.firstName || socket.user.lastName) || 
                   'Unknown User';

  // ===================================================================
  // CONNECTION INITIALIZATION
  // ===================================================================
  (async () => {
    try {
      logger.info('[CONNECTION START] User connecting...', {
        socketId,
        userId,
        userName
      });

      // Add socket to Redis presence (multi-device support)
      await redisService.addUserSocket(userId, socketId, {
        name: userName,
        avatar: socket.user.avatar,
        email: socket.user.email,
        role: socket.user.role
      });
      
      logger.info('[CONNECTION] Updated Redis presence for user', { userId, socketId });

      // Update database (async, fire-and-forget for performance)
      db.getModels().User.update(
        { 
          isOnline: true, 
          socketId,
          lastSeen: null 
        },
        { where: { id: userId } }
      ).catch(err => 
        logger.error('[CONNECTION] DB update failed (non-blocking)', { 
          userId, 
          error: err.message 
        })
      );

      // Notify other clients about this user coming online
      socket.broadcast.emit('user_online', {
        id: userId,
        name: userName,
        firstName: socket.user.firstName,
        lastName: socket.user.lastName,
        avatar: socket.user.avatar,
        isOnline: true,
        lastSeen: null
      });

      // Fetch user data in parallel
      const [conversations, onlineUsers] = await Promise.all([
        conversationService.getUserConversations(userId),
        redisService.getOnlineUsers()
      ]);
      
      logger.info('[CONNECTION] Fetched user data', {
        userId,
        conversationCount: conversations?.length || 0,
        onlineUserCount: onlineUsers?.length || 0
      });

      // Send initial data to connecting client
      socket.emit('initial_data', {
        userId,
        conversations,
        onlineUsers
      });

      // Join conversation rooms
      conversations.forEach(conv => {
        socket.join(`conversation:${conv.id}`);
      });

      // Send connection confirmation
      socket.emit('connection_established', {
        userId,
        socketId,
        timestamp: Date.now()
      });

      // Broadcast updated online users list to ALL clients
      io.emit('all_online_users', {
        users: onlineUsers,
        count: onlineUsers.length,
        timestamp: Date.now()
      });

      logger.info('[CONNECTION SUCCESS] User fully initialized', {
        userId,
        socketId,
        conversationCount: conversations.length,
        onlineUserCount: onlineUsers.length
      });
      
    } catch (error) {
      logger.error('[CONNECTION ERROR]', {
        error: error.message,
        stack: error.stack,
        userId,
        socketId
      });
    }
  })();

  // ===================================================================
  // GET PRESENCE FOR SPECIFIC USERS (on-demand)
  // ===================================================================
  socket.on('get_presence', async ({ userIds }) => {
    try {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'userIds must be a non-empty array'
        });
      }

      const presence = await redisService.getUsersPresence(userIds);
      
      socket.emit('presence_status', {
        presence,
        timestamp: Date.now()
      });
      
      logger.debug('[GET_PRESENCE] Sent presence for users', {
        userId,
        requestedCount: userIds.length
      });

    } catch (error) {
      logger.error('[GET_PRESENCE ERROR]', {
        userId,
        error: error.message
      });
      socket.emit('error', {
        code: 'PRESENCE_FETCH_FAILED',
        message: 'Failed to get presence information'
      });
    }
  });

  // ===================================================================
  // GET ALL ONLINE USERS
  // ===================================================================
  socket.on('get_all_online_users', async () => {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('[GET_ALL_ONLINE_USERS] Request received', {
      requestId,
      userId,
      socketId
    });

    try {
      const onlineUsers = await redisService.getOnlineUsers();
      
      logger.info('[GET_ALL_ONLINE_USERS] Fetched successfully', {
        requestId,
        count: onlineUsers?.length || 0
      });

      socket.emit('all_online_users', {
        users: onlineUsers,
        count: onlineUsers?.length || 0,
        timestamp: Date.now(),
        requestId
      });

    } catch (error) {
      logger.error('[GET_ALL_ONLINE_USERS ERROR]', {
        requestId,
        userId,
        error: error.message
      });
      
      socket.emit('error', {
        code: 'GET_ALL_ONLINE_USERS_FAILED',
        message: 'Failed to retrieve online users',
        requestId
      });
    }
  });

  // ===================================================================
  // CONNECTION STATUS CHECK
  // ===================================================================
  socket.on('connection_status', () => {
    socket.emit('connection_status_response', {
      connected: socket.connected,
      socketId: socket.id,
      userId: userId,
      serverTime: new Date().toISOString()
    });
  });

  // ===================================================================
  // DISCONNECT HANDLER
  // ===================================================================
  socket.on('disconnect', async () => {
    try {
      logger.info('[DISCONNECT] User disconnecting...', {
        socketId,
        userId
      });

      // Remove socket from Redis presence
      const result = await redisService.removeUserSocket(userId, socketId);
      
      // Only update DB and broadcast if user is fully offline
      if (!result.stillOnline) {
        // Update database (async, fire-and-forget)
        db.getModels().User.update(
          { 
            isOnline: false, 
            socketId: null,
            lastSeen: new Date()
          },
          { where: { id: userId } }
        ).catch(err => 
          logger.error('[DISCONNECT] DB update failed (non-blocking)', { 
            userId, 
            error: err.message 
          })
        );

        // Notify other clients that user is offline
        socket.broadcast.emit('user_offline', {
          id: userId,
          name: userName,
          isOnline: false,
          lastSeen: result.lastSeen
        });
        
        // Broadcast updated online users list
        const onlineUsers = await redisService.getOnlineUsers();
        io.emit('all_online_users', {
          users: onlineUsers,
          count: onlineUsers.length,
          timestamp: Date.now()
        });

        logger.info('[DISCONNECT] User fully offline', {
          userId,
          socketId,
          lastSeen: result.lastSeen
        });
      } else {
        logger.info('[DISCONNECT] User still online on other devices', {
          userId,
          socketId,
          stillOnline: true
        });
      }

    } catch (error) {
      logger.error('[DISCONNECT ERROR]', {
        error: error.message,
        userId,
        socketId
      });
    }
  });

  // ===================================================================
  // HEALTH CHECK (ping/pong)
  // ===================================================================
  socket.on('ping', (data) => {
    socket.emit('pong', {
      userId,
      socketId,
      timestamp: Date.now(),
      receivedData: data
    });
  });
};