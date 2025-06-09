// /socket/handlers/messageHandlers.js
const logger = require('../../utils/logger');
const messageService = require('../../services/socket/messageService');
const conversationService = require('../../services/socket/conversationService');
const presenceService = require('../../services/socket/presenceService');
const notificationService = require('../../services/notifications/notificationService');
const userService = require('../../services/socket/userService');
const redisService = require('../../services/redis');
const db = require('../../db');

module.exports = (io, socket) => {
  const userId = socket.user.id;

  // Typing timeout tracking
  const typingTimeouts = new Map();
  const TYPING_TIMEOUT = 3000; // 3 seconds

  socket.on('send_message', async (messagePayload) => {
    try {
      const result = await messageService.handleSendMessage(io, socket, messagePayload);
      if (result.notifyRecipients && result.participants) {
        await notificationService.sendMessageNotification(result.message, result.participants);
      }
    } catch (error) {
      logger.error(`Error handling send_message: ${error}`);
      socket.emit('error', { code: 'MESSAGE_FAILED', message: 'Failed to process message' });
    }
  });

  socket.on('mark_read', async ({ messageIds, conversationId }) => {
    try {
      await messageService.handleMarkRead(io, socket, { messageIds, conversationId });
    } catch (error) {
      logger.error(`Error handling mark_read: ${error}`);
      socket.emit('error', { code: 'READ_FAILED', message: 'Failed to mark messages as read' });
    }
  });

  socket.on('update_message', async ({ messageId, newContent }) => {
    try {
      await messageService.handleUpdateMessage(io, socket, { messageId, newContent });
    } catch (error) {
      logger.error(`Error handling update_message: ${error}`);
      socket.emit('error', { code: 'UPDATE_FAILED', message: 'Failed to update message' });
    }
  });

  socket.on('delete_message', async ({ messageId }) => {
    try {
      await messageService.handleDeleteMessage(io, socket, { messageId });
    } catch (error) {
      logger.error(`Error handling delete_message: ${error}`);
      socket.emit('error', { code: 'DELETE_FAILED', message: 'Failed to delete message' });
    }
  });

  // ✅ TYPING HANDLERS - Added to existing message handlers
  
  // Handle typing status
  socket.on('typing', async (payload) => {
    try {
      const { conversationId, isTyping } = payload;
      
      if (!conversationId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId is required'
        });
      }

      // Verify user is participant in conversation
      const models = db.getModels();
      const { ConversationParticipant } = models;
      
      if (ConversationParticipant) {
        const participation = await ConversationParticipant.findOne({
          where: { conversationId, userId }
        });
        
        if (!participation) {
          return socket.emit('error', {
            code: 'NOT_AUTHORIZED',
            message: 'Not a participant in this conversation'
          });
        }
      }

      const typingKey = `${userId}:${conversationId}`;

      if (isTyping) {
        // Start typing
        await redisService.setUserTyping?.(userId, conversationId, TYPING_TIMEOUT);
        
        // Clear existing timeout
        const existingTimeout = typingTimeouts.get(typingKey);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
        }
        
        // Set auto-stop timeout
        const timeoutId = setTimeout(async () => {
          try {
            await redisService.removeUserTyping?.(userId, conversationId);
            socket.to(`conversation:${conversationId}`).emit('user_typing', {
              userId,
              conversationId,
              isTyping: false,
              timestamp: Date.now()
            });
            typingTimeouts.delete(typingKey);
          } catch (error) {
            logger.error('Error in typing timeout:', error);
          }
        }, TYPING_TIMEOUT);
        
        typingTimeouts.set(typingKey, timeoutId);
        
        // Broadcast to conversation participants
        socket.to(`conversation:${conversationId}`).emit('user_typing', {
          userId,
          conversationId,
          isTyping: true,
          timestamp: Date.now()
        });
        
      } else {
        // Stop typing
        await redisService.removeUserTyping?.(userId, conversationId);
        
        // Clear timeout
        const existingTimeout = typingTimeouts.get(typingKey);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          typingTimeouts.delete(typingKey);
        }
        
        // Broadcast stop typing
        socket.to(`conversation:${conversationId}`).emit('user_typing', {
          userId,
          conversationId,
          isTyping: false,
          timestamp: Date.now()
        });
      }
      
      // Send confirmation to sender
      socket.emit('typing_status_updated', {
        conversationId,
        isTyping,
        timestamp: Date.now()
      });
      
      logger.debug(`User ${userId} ${isTyping ? 'started' : 'stopped'} typing in conversation ${conversationId}`);
      
    } catch (error) {
      logger.error(`Error handling typing: ${error.message}`, {
        userId,
        payload,
        error: error.stack
      });
      socket.emit('error', {
        code: 'TYPING_FAILED',
        message: 'Failed to update typing status'
      });
    }
  });

  // Get users currently typing in a conversation
  socket.on('get_typing_users', async ({ conversationId }) => {
    try {
      if (!conversationId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId is required'
        });
      }

      // Verify user is participant
      const models = db.getModels();
      const { ConversationParticipant } = models;
      
      if (ConversationParticipant) {
        const participation = await ConversationParticipant.findOne({
          where: { conversationId, userId }
        });
        
        if (!participation) {
          return socket.emit('error', {
            code: 'NOT_AUTHORIZED',
            message: 'Not a participant in this conversation'
          });
        }
      }

      // Get typing users (if redis method exists)
      let typingUsers = [];
      if (redisService.getUsersTyping) {
        typingUsers = await redisService.getUsersTyping(conversationId);
        // Filter out current user
        typingUsers = typingUsers.filter(id => id !== userId);
      }
      
      socket.emit('typing_users', {
        conversationId,
        userIds: typingUsers,
        timestamp: Date.now()
      });
      
      logger.debug(`Sent typing users for conversation ${conversationId} to user ${userId}`);
      
    } catch (error) {
      logger.error(`Error getting typing users: ${error.message}`, {
        userId,
        conversationId,
        error: error.stack
      });
      socket.emit('error', {
        code: 'GET_TYPING_USERS_FAILED',
        message: 'Failed to get typing users'
      });
    }
  });

  // Cleanup typing on disconnect
  socket.on('disconnect', async () => {
    try {
      // Clear all typing timeouts for this user
      const userTimeouts = Array.from(typingTimeouts.keys())
        .filter(key => key.startsWith(`${userId}:`));
      
      for (const key of userTimeouts) {
        const timeoutId = typingTimeouts.get(key);
        if (timeoutId) {
          clearTimeout(timeoutId);
          typingTimeouts.delete(key);
        }
        
        // Extract conversationId and cleanup
        const conversationId = key.split(':')[1];
        if (conversationId) {
          try {
            await redisService.removeUserTyping?.(userId, conversationId);
            // Broadcast stop typing
            socket.to(`conversation:${conversationId}`).emit('user_typing', {
              userId,
              conversationId,
              isTyping: false,
              timestamp: Date.now()
            });
          } catch (error) {
            logger.error('Error cleaning up typing on disconnect:', error);
          }
        }
      }
      
      logger.debug(`Cleaned up typing status for disconnected user ${userId}`);
    } catch (error) {
      logger.error(`Error cleaning up typing on disconnect: ${error.message}`, {
        userId,
        error: error.stack
      });
    }
  });
};