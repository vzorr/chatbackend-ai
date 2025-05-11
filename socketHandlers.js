// socketHandlers.js
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const redisAdapter = require('socket.io-redis');
const logger = require('./utils/logger');
const { 
  User, 
  Message, 
  MessageVersion, 
  Conversation, 
  ConversationParticipant 
} = require('./db/models');
const redisService = require('./services/redis');
const queueService = require('./services/queue');

module.exports = (io) => {
  // Use Redis adapter for scalability across multiple nodes
  if (process.env.REDIS_HOST) {
    const redisConfig = {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined
    };
    
    io.adapter(redisAdapter({
      pubClient: new require('ioredis')(redisConfig),
      subClient: new require('ioredis')(redisConfig)
    }));
    
    logger.info('Socket.IO connected to Redis adapter');
  }

  // Keep track of online users for quick lookup
  const userSocketMap = new Map();
  const socketUserMap = new Map();

  // Socket middleware for authentication and logging
  io.use(async (socket, next) => {
    try {
      const userId = socket.handshake.auth.userId || socket.handshake.query.userId;
      
      if (!userId) {
        return next(new Error('Authentication required'));
      }
      
      // Try to find the user
      const user = await User.findByPk(userId);
      
      if (!user) {
        return next(new Error('User not found'));
      }
      
      // Attach user to socket for later use
      socket.user = user;
      
      logger.info(`User ${userId} authenticated for socket ${socket.id}`);
      next();
    } catch (error) {
      logger.error(`Socket authentication error: ${error}`);
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    const socketId = socket.id;
    
    try {
      // Store user connection
      userSocketMap.set(userId, socketId);
      socketUserMap.set(socketId, userId);
      
      // Update user status
      await queueService.enqueuePresenceUpdate(userId, true, socketId);
      
      // Broadcast user status to interested parties
      broadcastUserStatus(userId, true);
      
      logger.info(`User ${userId} connected with socket ${socketId}`);
      
      // Join user's conversation rooms
      const userConversations = await ConversationParticipant.findAll({
        where: { userId },
        attributes: ['conversationId']
      });
      
      userConversations.forEach(({ conversationId }) => {
        socket.join(`conversation:${conversationId}`);
      });
      
      // Notify user of successful connection
      socket.emit('connection_established', {
        userId,
        socketId,
        timestamp: Date.now()
      });
      
    } catch (error) {
      logger.error(`Error handling socket connection: ${error}`);
    }

    // Message handlers
    socket.on('send_message', async (messagePayload) => {
      try {
        logger.info(`Received message from user ${userId}`);
        
        // Validate required fields
        if (!messagePayload.receiverId && !messagePayload.conversationId) {
          socket.emit('error', { 
            code: 'INVALID_MESSAGE',
            message: 'Either receiverId or conversationId is required' 
          });
          return;
        }
        
        const {
          messageId = uuidv4(),
          clientTempId,
          jobId,
          receiverId,
          conversationId,
          messageType = 'text',
          textMsg,
          messageImages = [],
          audioFile = '',
          replyToMessageId = null,
          attachments = []
        } = messagePayload;
        
        // Handle direct messages (create conversation if needed)
        let targetConversationId = conversationId;
        
        if (!targetConversationId && receiverId) {
          // Check if conversation already exists between these users
          const conversations = await Conversation.findAll({
            where: {
              participantIds: {
                [Op.contains]: [userId, receiverId]
              }
            }
          });
          
          // Filter for direct conversations (just 2 participants)
          const directConversations = conversations.filter(c => 
            c.participantIds.length === 2 && 
            c.participantIds.includes(userId) && 
            c.participantIds.includes(receiverId)
          );
          
          if (directConversations.length > 0) {
            // Use existing conversation
            targetConversationId = directConversations[0].id;
          } else {
            // Create new conversation
            const newConversation = {
              id: uuidv4(),
              participantIds: [userId, receiverId],
              lastMessageAt: new Date()
            };
            
            const { conversationId: createdId } = await queueService.enqueueConversationOperation(
              'create',
              newConversation
            );
            
            targetConversationId = newConversation.id;
            
            // Join socket to the new conversation room
            socket.join(`conversation:${targetConversationId}`);
          }
        }
        
        // Prepare message for database
        const messageData = {
          id: messageId,
          conversationId: targetConversationId,
          jobId,
          senderId: userId,
          receiverId: receiverId || null,
          type: messageType,
          content: {
            text: textMsg,
            images: messageImages,
            audio: audioFile,
            replyTo: replyToMessageId,
            attachments
          },
          status: 'sent',
          clientTempId,
          deleted: false,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        // Queue the message for processing
        await queueService.enqueueMessage(messageData);
        
        // Emit message pending status to sender
        socket.emit('message_pending', {
          messageId,
          clientTempId,
          conversationId: targetConversationId,
          timestamp: Date.now()
        });
        
        // Broadcast to conversation room
        io.to(`conversation:${targetConversationId}`).emit('new_message', {
          ...messageData,
          sender: {
            id: userId,
            name: socket.user.name,
            avatar: socket.user.avatar
          }
        });
        
        // Send notifications for offline users
        if (targetConversationId) {
          const participants = await ConversationParticipant.findAll({
            where: {
              conversationId: targetConversationId,
              userId: { [Op.ne]: userId }
            }
          });
          
          // Get online status for all participants
          const participantIds = participants.map(p => p.userId);
          const presenceMap = await redisService.getUsersPresence(participantIds);
          
          // Send notifications to offline users
          for (const participant of participants) {
            const isOnline = presenceMap[participant.userId]?.isOnline || false;
            
            if (!isOnline) {
              await queueService.enqueueNotification(
                participant.userId,
                'new_message',
                {
                  conversationId: targetConversationId,
                  messageId,
                  sender: {
                    id: userId,
                    name: socket.user.name
                  },
                  preview: textMsg ? textMsg.substring(0, 100) : 'New message'
                }
              );
            }
          }
        }
        
      } catch (error) {
        logger.error(`Error handling send_message: ${error}`);
        socket.emit('error', { 
          code: 'MESSAGE_FAILED', 
          message: 'Failed to process message' 
        });
      }
    });

    // Message reading
    socket.on('mark_read', async ({ messageIds, conversationId }) => {
      try {
        if (!messageIds || !messageIds.length) {
          if (!conversationId) {
            socket.emit('error', { 
              code: 'INVALID_REQUEST', 
              message: 'Either messageIds or conversationId is required' 
            });
            return;
          }
          
          // If only conversationId provided, mark all messages in conversation as read
          const messages = await Message.findAll({
            where: {
              conversationId,
              receiverId: userId,
              status: { [Op.ne]: 'read' }
            }
          });
          
          messageIds = messages.map(m => m.id);
        }
        
        if (messageIds.length === 0) {
          return; // Nothing to mark as read
        }
        
        // Update message status in database
        await Message.update(
          { status: 'read' },
          { where: { id: messageIds } }
        );
        
        // Reset unread count in conversation participant
        if (conversationId) {
          await ConversationParticipant.update(
            { unreadCount: 0 },
            { where: { conversationId, userId } }
          );
          
          // Reset Redis unread count
          await redisService.resetUnreadCount(userId, conversationId);
        }
        
        // Confirm to user
        socket.emit('messages_marked_read', { messageIds });
        
        // Notify senders that their messages were read
        const messages = await Message.findAll({
          where: { id: messageIds },
          attributes: ['id', 'senderId', 'conversationId']
        });
        
        // Group by sender for efficiency
        const senderMessages = {};
        messages.forEach(message => {
          if (!senderMessages[message.senderId]) {
            senderMessages[message.senderId] = [];
          }
          senderMessages[message.senderId].push({
            messageId: message.id,
            conversationId: message.conversationId
          });
        });
        
        // Notify each sender
        Object.entries(senderMessages).forEach(([senderId, msgs]) => {
          const senderSocketId = userSocketMap.get(senderId);
          
          if (senderSocketId) {
            io.to(senderSocketId).emit('messages_read_by_recipient', {
              messages: msgs,
              readBy: userId,
              readAt: new Date().toISOString()
            });
          }
        });
        
      } catch (error) {
        logger.error(`Error handling mark_read: ${error}`);
        socket.emit('error', { 
          code: 'READ_FAILED', 
          message: 'Failed to mark messages as read' 
        });
      }
    });

    // Message editing
    socket.on('update_message', async ({ messageId, newContent }) => {
      try {
        // Verify message ownership
        const message = await Message.findOne({
          where: { id: messageId, senderId: userId }
        });
        
        if (!message) {
          socket.emit('error', { 
            code: 'NOT_FOUND', 
            message: 'Message not found or not authorized to edit' 
          });
          return;
        }
        
        // Store original version
        await MessageVersion.create({
          messageId,
          versionContent: message.content,
          editedAt: new Date()
        });
        
        // Update message content
        const updatedContent = {
          ...message.content,
          ...newContent,
          edited: true,
          editedAt: new Date().toISOString()
        };
        
        message.content = updatedContent;
        await message.save();
        
        // Update message in cache
        await redisService.cacheMessage(message);
        
        // Notify conversation participants
        if (message.conversationId) {
          io.to(`conversation:${message.conversationId}`).emit('message_updated', {
            messageId,
            content: updatedContent,
            editedAt: new Date().toISOString()
          });
        } else if (message.receiverId) {
          // Direct message update
          const receiverSocketId = userSocketMap.get(message.receiverId);
          
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('message_updated', {
              messageId,
              content: updatedContent,
              editedAt: new Date().toISOString()
            });
          }
        }
        
      } catch (error) {
        logger.error(`Error handling update_message: ${error}`);
        socket.emit('error', { 
          code: 'UPDATE_FAILED', 
          message: 'Failed to update message' 
        });
      }
    });

    // Message deletion
    socket.on('delete_message', async ({ messageId }) => {
      try {
        // Verify message ownership
        const message = await Message.findOne({
          where: { id: messageId, senderId: userId }
        });
        
        if (!message) {
          socket.emit('error', { 
            code: 'NOT_FOUND', 
            message: 'Message not found or not authorized to delete' 
          });
          return;
        }
        
        // Soft delete the message
        message.deleted = true;
        await message.save();
        
        // Update message in cache
        await redisService.cacheMessage(message);
        
        // Notify conversation participants
        if (message.conversationId) {
          io.to(`conversation:${message.conversationId}`).emit('message_deleted', {
            messageId,
            deletedAt: new Date().toISOString()
          });
        } else if (message.receiverId) {
          // Direct message deletion
          const receiverSocketId = userSocketMap.get(message.receiverId);
          
          if (receiverSocketId) {
            io.to(receiverSocketId).emit('message_deleted', {
              messageId,
              deletedAt: new Date().toISOString()
            });
          }
        }
        
      } catch (error) {
        logger.error(`Error handling delete_message: ${error}`);
        socket.emit('error', { 
          code: 'DELETE_FAILED', 
          message: 'Failed to delete message' 
        });
      }
    });

    // Conversation handlers
    socket.on('fetch_conversations', async (data = {}) => {
      try {
        const { limit = 20, offset = 0 } = data;
        
        // Get user's conversations from database
        const participations = await ConversationParticipant.findAll({
          where: { userId },
          include: [{
            model: Conversation,
            as: 'conversation',
            include: [{
              model: Message,
              as: 'messages',
              limit: 1,
              order: [['createdAt', 'DESC']]
            }]
          }],
          order: [[{model: Conversation, as: 'conversation'}, 'lastMessageAt', 'DESC']],
          limit,
          offset
        });
        
        // Get unread counts
        const unreadCounts = await redisService.getUnreadCounts(userId);
        
        // Format response
        const conversations = await Promise.all(participations.map(async (participation) => {
          const conversation = participation.conversation;
          
          // Get participant details
          const participantDetails = await User.findAll({
            where: { id: { [Op.in]: conversation.participantIds } },
            attributes: ['id', 'name', 'avatar', 'isOnline', 'lastSeen']
          });
          
          return {
            id: conversation.id,
            jobId: conversation.jobId,
            jobTitle: conversation.jobTitle,
            lastMessageAt: conversation.lastMessageAt,
            participants: participantDetails,
            unreadCount: unreadCounts[conversation.id] || participation.unreadCount || 0,
            lastMessage: conversation.messages && conversation.messages[0] ? conversation.messages[0] : null
          };
        }));
        
        socket.emit('conversations_list', {
          conversations,
          offset,
          limit,
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error(`Error handling fetch_conversations: ${error}`);
        socket.emit('error', { 
          code: 'FETCH_FAILED', 
          message: 'Failed to fetch conversations' 
        });
      }
    });

    socket.on('fetch_conversation_messages', async ({ conversationId, limit = 50, offset = 0 }) => {
      try {
        // Verify user is a participant
        const participation = await ConversationParticipant.findOne({
          where: { conversationId, userId }
        });
        
        if (!participation) {
          socket.emit('error', { 
            code: 'NOT_AUTHORIZED', 
            message: 'Not a participant in this conversation' 
          });
          return;
        }
        
        // Try to get from cache first
        let messages = await redisService.getConversationMessages(conversationId, limit, offset);
        
        // Fall back to database if cache miss
        if (!messages || messages.length === 0) {
          messages = await Message.findAll({
            where: { 
              conversationId,
              deleted: false
            },
            order: [['createdAt', 'DESC']],
            limit,
            offset
          });
          
          // Cache messages for future use
          for (const message of messages) {
            await redisService.cacheMessage(message);
          }
        }
        
        // Get sender info
        const senderIds = [...new Set(messages.map(m => m.senderId))];
        const senders = await User.findAll({
          where: { id: { [Op.in]: senderIds } },
          attributes: ['id', 'name', 'avatar']
        });
        
        const senderMap = senders.reduce((map, sender) => {
          map[sender.id] = sender;
          return map;
        }, {});
        
        // Enrich messages with sender info
        const enrichedMessages = messages.map(message => ({
          ...message,
          sender: senderMap[message.senderId] || { id: message.senderId }
        }));
        
        // Reply to client
        socket.emit('conversation_messages', {
          conversationId,
          messages: enrichedMessages,
          offset,
          limit,
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error(`Error handling fetch_conversation_messages: ${error}`);
        socket.emit('error', { 
          code: 'FETCH_FAILED', 
          message: 'Failed to fetch conversation messages' 
        });
      }
    });

    // Typing indicators
    socket.on('typing', async ({ conversationId }) => {
      try {
        // Verify user is a participant
        const participation = await ConversationParticipant.findOne({
          where: { conversationId, userId }
        });
        
        if (!participation) {
          return; // Silently ignore
        }
        
        // Set typing status in Redis
        await redisService.setUserTyping(userId, conversationId);
        
        // Broadcast to conversation participants
        socket.to(`conversation:${conversationId}`).emit('user_typing', {
          userId,
          conversationId,
          userName: socket.user.name,
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error(`Error handling typing: ${error}`);
      }
    });

    socket.on('get_typing_users', async ({ conversationId }) => {
      try {
        const typingUsers = await redisService.getUsersTyping(conversationId);
        
        // Get user details
        const users = await User.findAll({
          where: { id: { [Op.in]: typingUsers } },
          attributes: ['id', 'name']
        });
        
        socket.emit('typing_users', {
          conversationId,
          users,
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error(`Error handling get_typing_users: ${error}`);
      }
    });

    // Presence handlers
    socket.on('get_online_status', async ({ userIds }) => {
      try {
        const presenceMap = await redisService.getUsersPresence(userIds);
        
        // Format response
        const statusMap = {};
        Object.entries(presenceMap).forEach(([userId, presence]) => {
          statusMap[userId] = presence ? presence.isOnline : false;
        });
        
        socket.emit('online_status', {
          statuses: statusMap,
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error(`Error handling get_online_status: ${error}`);
      }
    });

    // Clean up on disconnect
    socket.on('disconnect', async () => {
      try {
        // Update user status
        await queueService.enqueuePresenceUpdate(userId, false);
        
        // Remove from maps
        userSocketMap.delete(userId);
        socketUserMap.delete(socketId);
        
        // Broadcast user status to interested parties
        broadcastUserStatus(userId, false);
        
        logger.info(`User ${userId} disconnected from socket ${socketId}`);
      } catch (error) {
        logger.error(`Error handling disconnect: ${error}`);
      }
    });
  });

  // Helper function to broadcast user status
  const broadcastUserStatus = async (userId, isOnline) => {
    try {
      // Get user's participations
      const participations = await ConversationParticipant.findAll({
        where: { userId }
      });
      
      // Broadcast to all conversations
      for (const { conversationId } of participations) {
        io.to(`conversation:${conversationId}`).emit('user_status_change', {
          userId,
          isOnline,
          lastSeen: isOnline ? null : new Date().toISOString()
        });
      }
    } catch (error) {
      logger.error(`Error broadcasting user status: ${error}`);
    }
  };

  return {
    userSocketMap,
    socketUserMap,
    broadcastUserStatus
  };
};