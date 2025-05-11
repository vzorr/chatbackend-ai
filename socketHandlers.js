// socketHandlers.js
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
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
  // Socket.IO configuration optimized for React Native and other clients
  if (io) {
    io.engine.on("connection_error", (err) => {
      logger.error(`Socket.IO connection error: ${err.message}`);
    });
  }

  // Use Redis adapter for scalability across multiple nodes
  if (process.env.REDIS_HOST) {
    const redisConfig = {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined
    };
    
    try {
      const { createAdapter } = require('socket.io-redis');
      io.adapter(createAdapter({
        pubClient: new Redis(redisConfig),
        subClient: new Redis(redisConfig)
      }));
      
      logger.info('Socket.IO connected to Redis adapter');
    } catch (error) {
      logger.error(`Failed to connect Socket.IO to Redis: ${error}`);
      logger.info('Socket.IO will use in-memory adapter');
    }
  }

  // Keep track of online users for quick lookup
  const userSocketMap = new Map();
  const socketUserMap = new Map();

  // Socket middleware for authentication and logging
  io.use(async (socket, next) => {
    try {
      // Support for various client formats of authentication
      let userId = null;
      
      // Check auth in different places to support various client implementations
      const authToken = socket.handshake.auth.token || 
                        socket.handshake.headers.authorization?.replace('Bearer ', '') ||
                        socket.handshake.query.token;
                        
      const directUserId = socket.handshake.auth.userId || 
                          socket.handshake.query.userId;
      
      if (directUserId) {
        // Client provided user ID directly
        userId = directUserId;
      } else if (authToken) {
        // Client provided a JWT token
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.verify(authToken, process.env.JWT_SECRET);
          userId = decoded.id || decoded.userId || decoded.sub;
        } catch (err) {
          return next(new Error('Invalid authentication token'));
        }
      }
      
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
      
      // Also send connection_success for React Native clients
      socket.emit('connection_success', {
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
          text, // Support both naming conventions
          messageImages = [],
          images = [], // Support both naming conventions
          audioFile = '',
          audio = '', // Support both naming conventions
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
            const newConversationId = uuidv4();
            const newConversation = {
              id: newConversationId,
              participantIds: [userId, receiverId],
              lastMessageAt: new Date()
            };
            
            await queueService.enqueueConversationOperation(
              'create',
              newConversation
            );
            
            targetConversationId = newConversationId;
            
            // Create participants
            await ConversationParticipant.bulkCreate([
              {
                id: uuidv4(),
                conversationId: newConversationId,
                userId: userId,
                unreadCount: 0,
                joinedAt: new Date()
              },
              {
                id: uuidv4(),
                conversationId: newConversationId,
                userId: receiverId,
                unreadCount: 1,
                joinedAt: new Date()
              }
            ]);
            
            // Join socket to the new conversation room
            socket.join(`conversation:${targetConversationId}`);
          }
        }
        
        // Support different field naming conventions from different clients
        const finalTextContent = textMsg || text || '';
        const finalImages = messageImages.length ? messageImages : images;
        const finalAudio = audioFile || audio;
        
        // Prepare message for database
        const messageData = {
          id: messageId,
          conversationId: targetConversationId,
          jobId,
          senderId: userId,
          receiverId: receiverId || null,
          type: messageType,
          content: {
            text: finalTextContent,
            images: finalImages,
            audio: finalAudio,
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
        
        // Create message directly for immediate feedback
        await Message.create(messageData);
        
        // Update conversation last message time
        await Conversation.update(
          { lastMessageAt: new Date() },
          { where: { id: targetConversationId } }
        );
        
        // Increment unread count for other participants
        if (targetConversationId) {
          await ConversationParticipant.increment(
            'unreadCount',
            {
              where: {
                conversationId: targetConversationId,
                userId: { [Op.ne]: userId }
              }
            }
          );
        }
        
        // Get sender info for the response
        const sender = {
          id: userId,
          name: socket.user.name,
          avatar: socket.user.avatar
        };
        
        const messageWithSender = {
          ...messageData,
          sender
        };
        
        // Broadcast to conversation room
        io.to(`conversation:${targetConversationId}`).emit('new_message', messageWithSender);
        
        // Also emit message_sent for compatibility with some clients
        socket.emit('message_sent', {
          id: messageId,
          clientTempId,
          conversationId: targetConversationId,
          timestamp: Date.now()
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
                  preview: finalTextContent ? finalTextContent.substring(0, 100) : 'New message'
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
          { where: { id: { [Op.in]: messageIds } } }
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
        
        // Also emit with message_read for compatibility
        socket.emit('message_read', { messageIds });
        
        // Notify senders that their messages were read
        const messages = await Message.findAll({
          where: { id: { [Op.in]: messageIds } },
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
          id: uuidv4(),
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
        
        // Confirm to sender
        socket.emit('message_deleted_confirmation', {
          messageId,
          deletedAt: new Date().toISOString()
        });
        
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
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
        // Get unread counts
        const unreadCounts = await redisService.getUnreadCounts(userId);
        
        // Format response
        const conversations = await Promise.all(participations.map(async (participation) => {
          const conversation = participation.conversation;
          if (!conversation) return null;
          
          // Get participant details
          const participantIds = conversation.participantIds || [];
          const participantDetails = await User.findAll({
            where: { id: { [Op.in]: participantIds } },
            attributes: ['id', 'name', 'avatar', 'isOnline', 'lastSeen']
          });
          
          return {
            id: conversation.id,
            jobId: conversation.jobId,
            jobTitle: conversation.jobTitle,
            lastMessageAt: conversation.lastMessageAt,
            participants: participantDetails,
            unreadCount: unreadCounts[conversation.id] || participation.unreadCount || 0,
            lastMessage: conversation.messages && conversation.messages.length > 0 ? conversation.messages[0] : null
          };
        }));
        
        // Filter out nulls from any conversations that might have been deleted
        const validConversations = conversations.filter(c => c !== null);
        
        socket.emit('conversations_list', {
          conversations: validConversations,
          total: validConversations.length,
          offset: parseInt(offset),
          limit: parseInt(limit),
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

    // Also support get_conversations for React Native clients
    socket.on('get_conversations', async (data = {}) => {
      try {
        const { limit = 20, offset = 0 } = data;
        
        // Reuse the same logic as fetch_conversations
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
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
        // Get unread counts
        const unreadCounts = await redisService.getUnreadCounts(userId);
        
        // Format response
        const conversations = await Promise.all(participations.map(async (participation) => {
          const conversation = participation.conversation;
          if (!conversation) return null;
          
          // Get participant details
          const participantIds = conversation.participantIds || [];
          const participantDetails = await User.findAll({
            where: { id: { [Op.in]: participantIds } },
            attributes: ['id', 'name', 'avatar', 'isOnline', 'lastSeen']
          });
          
          return {
            id: conversation.id,
            jobId: conversation.jobId,
            jobTitle: conversation.jobTitle,
            lastMessageAt: conversation.lastMessageAt,
            participants: participantDetails,
            unreadCount: unreadCounts[conversation.id] || participation.unreadCount || 0,
            lastMessage: conversation.messages && conversation.messages.length > 0 ? conversation.messages[0] : null
          };
        }));
        
        // Filter out nulls from any conversations that might have been deleted
        const validConversations = conversations.filter(c => c !== null);
        
        socket.emit('conversations', {
          conversations: validConversations,
          total: validConversations.length,
          offset: parseInt(offset),
          limit: parseInt(limit),
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error(`Error handling get_conversations: ${error}`);
        socket.emit('error', { 
          code: 'FETCH_FAILED', 
          message: 'Failed to fetch conversations' 
        });
      }
    });
 
    socket.on('fetch_conversation_messages', async ({ conversationId, limit = 50, offset = 0, before }) => {
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
        
        // Build the where clause
        const where = { 
          conversationId,
          deleted: false
        };
        
        // Add time condition if 'before' is specified
        if (before) {
          where.createdAt = { [Op.lt]: new Date(before) };
        }
        
        // Get messages from database
        const messages = await Message.findAll({
          where,
          order: [['createdAt', 'DESC']],
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
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
        
        // Cache messages for future use
        for (const message of messages) {
          await redisService.cacheMessage(message);
        }
        
        // Format messages for response
        const formattedMessages = messages.map(message => {
          const sender = senderMap[message.senderId] || { id: message.senderId };
          
          return {
            id: message.id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            sender: {
              id: sender.id,
              name: sender.name || 'Unknown',
              avatar: sender.avatar
            },
            receiverId: message.receiverId,
            type: message.type,
            content: message.content,
            status: message.status,
            clientTempId: message.clientTempId,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt
          };
        });
        
        // Mark messages as delivered if they're not read yet
        const unreadMessageIds = messages
          .filter(m => m.senderId !== userId && m.status === 'sent')
          .map(m => m.id);
          
        if (unreadMessageIds.length > 0) {
          await Message.update(
            { status: 'delivered' },
            { where: { id: { [Op.in]: unreadMessageIds } } }
          );
          
          // Notify senders about delivered messages
          const deliveredMessages = await Message.findAll({
            where: { id: { [Op.in]: unreadMessageIds } },
            attributes: ['id', 'senderId']
          });
          
          // Group by sender
          const deliveredBySender = {};
          deliveredMessages.forEach(message => {
            if (!deliveredBySender[message.senderId]) {
              deliveredBySender[message.senderId] = [];
            }
            deliveredBySender[message.senderId].push(message.id);
          });
          
          // Notify each sender
          Object.entries(deliveredBySender).forEach(([senderId, messageIds]) => {
            const senderSocketId = userSocketMap.get(senderId);
            if (senderSocketId) {
              io.to(senderSocketId).emit('messages_delivered', {
                messageIds,
                deliveredTo: userId,
                deliveredAt: new Date().toISOString()
              });
            }
          });
        }
        
        // Reply to client
        socket.emit('conversation_messages', {
          conversationId,
          messages: formattedMessages,
          offset: parseInt(offset),
          limit: parseInt(limit),
          hasMore: messages.length === parseInt(limit),
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

    // Also support get_messages for React Native clients
    socket.on('get_messages', async ({ conversationId, limit = 50, offset = 0, before }) => {
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
        
        // Build the where clause
        const where = { 
          conversationId,
          deleted: false
        };
        
        // Add time condition if 'before' is specified
        if (before) {
          where.createdAt = { [Op.lt]: new Date(before) };
        }
        
        // Get messages from database
        const messages = await Message.findAll({
          where,
          order: [['createdAt', 'DESC']],
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
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
        
        // Format messages for response (using format compatible with React Native clients)
        const formattedMessages = messages.map(message => {
          const sender = senderMap[message.senderId] || { id: message.senderId };
          
          return {
            id: message.id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            sender: {
              id: sender.id,
              name: sender.name || 'Unknown',
              avatar: sender.avatar
            },
            receiverId: message.receiverId,
            type: message.type,
            content: message.content,
            status: message.status,
            clientTempId: message.clientTempId,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt
          };
        });
        
        // Reply to client with format compatible with React Native clients
        socket.emit('messages', {
          conversationId,
          messages: formattedMessages,
          offset: parseInt(offset),
          limit: parseInt(limit),
          hasMore: messages.length === parseInt(limit),
          timestamp: Date.now()
        });
        
      } catch (error) {
        logger.error(`Error handling get_messages: ${error}`);
        socket.emit('error', { 
          code: 'FETCH_FAILED', 
          message: 'Failed to fetch messages' 
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

   // Also support typing_start for React Native clients
   socket.on('typing_start', async ({ conversationId }) => {
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
         userName: socket.user.name,
         timestamp: Date.now()
       });
       
       // Also emit with typing_started for React Native clients
       socket.to(`conversation:${conversationId}`).emit('typing_started', {
         userId,
         conversationId,
         userName: socket.user.name,
         timestamp: Date.now()
       });
       
     } catch (error) {
       logger.error(`Error handling typing_start: ${error}`);
     }
   });

   // Support typing_stop for React Native clients
   socket.on('typing_stop', async ({ conversationId }) => {
     try {
       // Broadcast to conversation participants
       socket.to(`conversation:${conversationId}`).emit('typing_stopped', {
         userId,
         conversationId,
         userName: socket.user.name,
         timestamp: Date.now()
       });
       
     } catch (error) {
       logger.error(`Error handling typing_stop: ${error}`);
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
         statusMap[userId] = presence ? {
           isOnline: presence.isOnline,
           lastSeen: presence.lastSeen
         } : {
           isOnline: false,
           lastSeen: null
         };
       });
       
       socket.emit('online_status', {
         statuses: statusMap,
         timestamp: Date.now()
       });
       
     } catch (error) {
       logger.error(`Error handling get_online_status: ${error}`);
     }
   });

   // Check presence status - alternative format for React Native clients
   socket.on('check_presence', async ({ userIds }) => {
     try {
       const presenceMap = await redisService.getUsersPresence(userIds);
       
       // Format response
       const statuses = {};
       Object.entries(presenceMap).forEach(([userId, presence]) => {
         statuses[userId] = presence ? {
           online: presence.isOnline,
           lastSeen: presence.lastSeen
         } : {
           online: false,
           lastSeen: null
         };
       });
       
       socket.emit('presence_status', {
         statuses,
         timestamp: Date.now()
       });
       
     } catch (error) {
       logger.error(`Error handling check_presence: ${error}`);
     }
   });

   // Create or join conversation
   socket.on('create_conversation', async ({ participants, jobId, jobTitle }) => {
     try {
       if (!participants || !Array.isArray(participants) || participants.length === 0) {
         socket.emit('error', {
           code: 'INVALID_REQUEST',
           message: 'At least one participant is required'
         });
         return;
       }
       
       // Ensure current user is included
       const allParticipantIds = Array.from(new Set([userId, ...participants]));
       
       // Check if conversation already exists with exactly these participants
       const existingConversations = await Conversation.findAll({
         where: {
           participantIds: {
             [Op.contains]: allParticipantIds
           }
         }
       });
       
       // Find exact match (same participants, no more, no less)
       const exactMatch = existingConversations.find(conv => 
         conv.participantIds.length === allParticipantIds.length && 
         allParticipantIds.every(id => conv.participantIds.includes(id))
       );
       
       if (exactMatch) {
         // Return existing conversation
         const participantDetails = await User.findAll({
           where: { id: { [Op.in]: exactMatch.participantIds } },
           attributes: ['id', 'name', 'avatar', 'isOnline', 'lastSeen']
         });
         
         socket.emit('conversation_created', {
           isNew: false,
           conversation: {
             id: exactMatch.id,
             jobId: exactMatch.jobId,
             jobTitle: exactMatch.jobTitle,
             participants: participantDetails,
             participantIds: exactMatch.participantIds,
             lastMessageAt: exactMatch.lastMessageAt,
             createdAt: exactMatch.createdAt
           }
         });
         
         // Join the conversation room
         socket.join(`conversation:${exactMatch.id}`);
         
         return;
       }
       
       // Create new conversation
       const conversationId = uuidv4();
       const newConversation = {
         id: conversationId,
         jobId,
         jobTitle,
         participantIds: allParticipantIds,
         lastMessageAt: new Date()
       };
       
       // Create conversation in database
       await Conversation.create(newConversation);
       
       // Create participants
       const participantRecords = allParticipantIds.map(participantId => ({
         id: uuidv4(),
         conversationId,
         userId: participantId,
         unreadCount: participantId === userId ? 0 : 0, // No messages yet
         joinedAt: new Date()
       }));
       
       await ConversationParticipant.bulkCreate(participantRecords);
       
       // Get participant details
       const participantDetails = await User.findAll({
         where: { id: { [Op.in]: allParticipantIds } },
         attributes: ['id', 'name', 'avatar', 'isOnline', 'lastSeen']
       });
       
       // Join the conversation room
       socket.join(`conversation:${conversationId}`);
       
       // Notify creator about successful creation
       socket.emit('conversation_created', {
         isNew: true,
         conversation: {
           id: conversationId,
           jobId,
           jobTitle,
           participants: participantDetails,
           participantIds: allParticipantIds,
           lastMessageAt: new Date(),
           createdAt: new Date()
         }
       });
       
       // Notify other participants that they've been added to a conversation
       allParticipantIds.forEach(participantId => {
         if (participantId !== userId) {
           const participantSocketId = userSocketMap.get(participantId);
           if (participantSocketId) {
             io.to(participantSocketId).emit('added_to_conversation', {
               conversationId,
               addedBy: userId,
               conversation: {
                 id: conversationId,
                 jobId,
                 jobTitle,
                 participants: participantDetails,
                 participantIds: allParticipantIds,
                 lastMessageAt: new Date(),
                 createdAt: new Date()
               }
             });
             
             // Add them to the conversation room
             const participantSocket = io.sockets.sockets.get(participantSocketId);
             if (participantSocket) {
               participantSocket.join(`conversation:${conversationId}`);
             }
           }
         }
       });
       
     } catch (error) {
       logger.error(`Error handling create_conversation: ${error}`);
       socket.emit('error', {
         code: 'CREATE_FAILED',
         message: 'Failed to create conversation'
       });
     }
   });

   // Leave conversation
   socket.on('leave_conversation', async ({ conversationId }) => {
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
       
       // Get conversation
       const conversation = await Conversation.findByPk(conversationId);
       
       if (!conversation) {
         socket.emit('error', {
           code: 'NOT_FOUND',
           message: 'Conversation not found'
         });
         return;
       }
       
       // Update participant record
       participation.leftAt = new Date();
       await participation.save();
       
       // Remove user from conversation room
       socket.leave(`conversation:${conversationId}`);
       
       // Create system message
       const systemMessage = {
         id: uuidv4(),
         conversationId,
         senderId: userId,
         receiverId: null,
         type: 'system',
         content: {
           text: `${socket.user.name} left the conversation`,
           action: 'leave',
           userId
         },
         status: 'sent',
         isSystemMessage: true,
         createdAt: new Date(),
         updatedAt: new Date()
       };
       
       // Create message in database
       await Message.create(systemMessage);
       
       // Update conversation last message time
       await Conversation.update(
         { lastMessageAt: new Date() },
         { where: { id: conversationId } }
       );
       
       // Notify other participants
       socket.to(`conversation:${conversationId}`).emit('user_left_conversation', {
         conversationId,
         userId,
         userName: socket.user.name,
         leftAt: new Date().toISOString(),
         message: systemMessage
       });
       
       // Confirm to user
       socket.emit('left_conversation', {
         conversationId,
         leftAt: new Date().toISOString()
       });
       
     } catch (error) {
       logger.error(`Error handling leave_conversation: ${error}`);
       socket.emit('error', {
         code: 'LEAVE_FAILED',
         message: 'Failed to leave conversation'
       });
     }
   });

   // Add users to conversation
   socket.on('add_users_to_conversation', async ({ conversationId, userIds }) => {
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
       
       // Get conversation
       const conversation = await Conversation.findByPk(conversationId);
       
       if (!conversation) {
         socket.emit('error', {
           code: 'NOT_FOUND',
           message: 'Conversation not found'
         });
         return;
       }
       
       // Filter out users already in the conversation
       const newUserIds = userIds.filter(id => !conversation.participantIds.includes(id));
       
       if (newUserIds.length === 0) {
         socket.emit('error', {
           code: 'ALREADY_MEMBERS',
           message: 'All users are already members of this conversation'
         });
         return;
       }
       
       // Update conversation participants
       const updatedParticipantIds = [...conversation.participantIds, ...newUserIds];
       conversation.participantIds = updatedParticipantIds;
       await conversation.save();
       
       // Create participant records
       const participantRecords = newUserIds.map(id => ({
         id: uuidv4(),
         conversationId,
         userId: id,
         unreadCount: 0,
         joinedAt: new Date()
       }));
       
       await ConversationParticipant.bulkCreate(participantRecords);
       
       // Get new user details
       const newUsers = await User.findAll({
         where: { id: { [Op.in]: newUserIds } },
         attributes: ['id', 'name', 'avatar']
       });
       
       // Create system message
       const newUserNames = newUsers.map(u => u.name).join(', ');
       const systemMessage = {
         id: uuidv4(),
         conversationId,
         senderId: userId,
         receiverId: null,
         type: 'system',
         content: {
           text: `${socket.user.name} added ${newUserNames} to the conversation`,
           action: 'add_users',
           addedBy: userId,
           addedUsers: newUserIds
         },
         status: 'sent',
         isSystemMessage: true,
         createdAt: new Date(),
         updatedAt: new Date()
       };
       
       // Create message in database
       await Message.create(systemMessage);
       
       // Update conversation last message time
       await Conversation.update(
         { lastMessageAt: new Date() },
         { where: { id: conversationId } }
       );
       
       // Notify existing participants
       io.to(`conversation:${conversationId}`).emit('users_added_to_conversation', {
         conversationId,
         addedBy: userId,
         addedUsers: newUsers,
         timestamp: Date.now(),
         message: systemMessage
       });
       
       // Notify new participants
       newUserIds.forEach(newUserId => {
         const newUserSocketId = userSocketMap.get(newUserId);
         if (newUserSocketId) {
           const newUserSocket = io.sockets.sockets.get(newUserSocketId);
           if (newUserSocket) {
             // Add to conversation room
             newUserSocket.join(`conversation:${conversationId}`);
             
             // Send notification
             io.to(newUserSocketId).emit('added_to_conversation', {
               conversationId,
               addedBy: userId,
               conversation: {
                 id: conversation.id,
                 jobId: conversation.jobId,
                 jobTitle: conversation.jobTitle,
                 participants: updatedParticipantIds,
                 lastMessageAt: conversation.lastMessageAt,
                 createdAt: conversation.createdAt
               }
             });
           }
         }
       });
       
     } catch (error) {
       logger.error(`Error handling add_users_to_conversation: ${error}`);
       socket.emit('error', {
         code: 'ADD_FAILED',
         message: 'Failed to add users to conversation'
       });
     }
   });

   // Ping/Pong for connection health check
   socket.on('ping', (data = {}) => {
     socket.emit('pong', {
       userId,
       socketId,
       timestamp: Date.now(),
       echo: data.echo
     });
   });

   // Client health check - useful for React Native which sometimes has issues with WebSocket reconnection
   socket.on('client_health_check', async (data = {}) => {
     try {
       // Update last seen time
       await queueService.enqueuePresenceUpdate(userId, true, socketId);
       
       // Return connection info
       socket.emit('health_check_response', {
         status: 'connected',
         userId,
         socketId,
         serverTime: new Date().toISOString(),
         uptime: process.uptime(),
         clientData: data
       });
     } catch (error) {
       logger.error(`Error handling client_health_check: ${error}`);
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

 // Function to check for zombie connections (connections that are still open but inactive)
 const checkZombieConnections = async () => {
   try {
     const now = Date.now();
     const timeoutThreshold = 10 * 60 * 1000; // 10 minutes
     
     // Check each socket
     for (const [socketId, userId] of socketUserMap.entries()) {
       const socket = io.sockets.sockets.get(socketId);
       
       if (!socket) {
         // Socket no longer exists, clean up maps
         socketUserMap.delete(socketId);
         if (userSocketMap.get(userId) === socketId) {
           userSocketMap.delete(userId);
         }
         continue;
       }
       
       // Check if the socket has any activity
       const lastActivity = socket.handshake.issued || 0;
       if (now - lastActivity > timeoutThreshold) {
         // Socket is inactive, disconnect it
         logger.info(`Disconnecting zombie socket ${socketId} for user ${userId}`);
         socket.disconnect(true);
         
         // Clean up maps
         socketUserMap.delete(socketId);
         if (userSocketMap.get(userId) === socketId) {
           userSocketMap.delete(userId);
         }
         
         // Update user status
         await queueService.enqueuePresenceUpdate(userId, false);
       }
     }
   } catch (error) {
     logger.error(`Error checking zombie connections: ${error}`);
   }
 };

 // Run zombie connection check periodically
 setInterval(checkZombieConnections, 15 * 60 * 1000); // Every 15 minutes

 return {
   userSocketMap,
   socketUserMap,
   broadcastUserStatus
 };
};