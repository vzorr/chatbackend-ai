// /services/socket/messageService.js
const { v4: uuidv4 } = require('uuid');
const { Op, UUID } = require('sequelize');
const db = require('../../db');
const queueService = require('../queue/queueService');
const redisService = require('../redis');
const logger = require('../../utils/logger');

class MessageService {


async handleSendMessage(io, socket, payload) {
  // Extract and validate payload
  console.log('📥 Incoming payload:', JSON.stringify(payload, null, 2));
  console.log("payload.clientTempId:", payload.clientTempId);
  
  const {
    jobId = payload.jobId,
    messageId = uuidv4(),
    clientTempId = payload.clientTempId || null, // ✅ Accept string temp ID from client
    receiverId,
    conversationId,
    messageType = 'text',
    textMsg,
    text,
    messageImages = [],
    images = [],
    audioFile = '',
    audio = '',
    replyToMessageId = null,
    attachments = []
  } = payload;

  const userId = socket.user.id;
  let targetConversationId = conversationId;

  try {
    const models = db.getModels();
    const { Message, MessageVersion, Conversation, ConversationParticipant } = models;

    if (!Message || !Conversation || !ConversationParticipant) {
      throw new Error('Required models not initialized');
    }

    // ✅ ENHANCED: Better conversation resolution logic
    if (!targetConversationId && receiverId) {
      console.log('🔍 Finding or creating conversation:', {
        userId,
        receiverId,
        jobId,
        hasJobId: !!jobId
      });

      // ✅ STEP 1: Try to find existing conversation using enhanced method
      const existingConversation = await conversationService.findDirectConversation(
        userId, 
        receiverId, 
        jobId // ✅ This will be null for direct messages, jobId for job chats
      );

      if (existingConversation) {
        targetConversationId = existingConversation.id;
        console.log('✅ Using existing conversation:', {
          conversationId: targetConversationId,
          type: existingConversation.type,
          jobId: existingConversation.jobId,
          participantCount: existingConversation.participantIds?.length
        });
      } else {
        // ✅ STEP 2: Create new conversation with proper type and metadata
        console.log('🔨 Creating new conversation:', {
          userId,
          receiverId,
          jobId,
          type: jobId ? 'job_chat' : 'direct_message'
        });
        
        targetConversationId = await this.createNewConversation(
          userId, 
          receiverId, 
          jobId,
          payload.jobTitle // Pass job title if available
        );
        
        console.log('✅ Created new conversation:', targetConversationId);
      }
      
      // Join the conversation room for real-time updates
      socket.join(`conversation:${targetConversationId}`);
    }

    // ✅ VALIDATION: Ensure we have a target conversation
    if (!targetConversationId) {
      throw new Error('Could not determine target conversation ID');
    }

    // ✅ ENHANCED: Better content processing
    const finalTextContent = textMsg || text || '';
    const finalImages = messageImages.length ? messageImages : images;
    const finalAudio = audioFile || audio;

    // ✅ VALIDATION: Ensure we have some content
    if (!finalTextContent && !finalImages.length && !finalAudio && !attachments.length) {
      throw new Error('Message must contain text, images, audio, or attachments');
    }

    // ✅ ENHANCED: Better message ID handling
    const isTempId = typeof messageId === 'string' && messageId.startsWith('temp-');
    const safeMessageId = isTempId ? undefined : messageId;

    // ✅ ENHANCED: Better message data structure
    const messageData = {
      ...(safeMessageId && { id: safeMessageId }), // Only include if valid UUID
      conversationId: targetConversationId,
      jobId: jobId || null, // ✅ Explicitly set jobId
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
      clientTempId, // ✅ Used for frontend matching
      deleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // ✅ Enhanced logging
    console.log('🧾 Prepared messageData for DB insert:', {
      id: messageData.id || '[auto-generated]',
      clientTempId: messageData.clientTempId,
      conversationId: messageData.conversationId,
      jobId: messageData.jobId,
      senderId: messageData.senderId,
      receiverId: messageData.receiverId,
      type: messageData.type,
      contentText: messageData.content.text?.substring(0, 50) + '...', // Truncate for logging
      hasImages: messageData.content.images?.length > 0,
      hasAudio: !!messageData.content.audio,
      hasAttachments: messageData.content.attachments?.length > 0,
      status: messageData.status,
      deleted: messageData.deleted
    });

    // ✅ TRANSACTION: Wrap database operations in transaction for consistency
    const transaction = await db.sequelize.transaction();
    
    try {
      // Create message in database
      const message = await Message.create(messageData, { transaction });
      
      // Update conversation last message timestamp
      await Conversation.update(
        { 
          lastMessageAt: new Date(),
          // ✅ Update job info if this is the first message in a job conversation
          ...(jobId && { jobId, jobTitle: payload.jobTitle || null })
        },
        { 
          where: { id: targetConversationId },
          transaction
        }
      );

      // ✅ ENHANCED: Better unread count management
      const unreadUpdateResult = await ConversationParticipant.increment(
        'unreadCount',
        { 
          where: { 
            conversationId: targetConversationId, 
            userId: { [Op.ne]: userId },
            leftAt: null // ✅ Only increment for active participants
          },
          transaction
        }
      );

      console.log('📊 Updated unread counts for participants:', unreadUpdateResult);

      // Commit transaction
      await transaction.commit();
      
      // ✅ Queue for additional processing (notifications, etc.)
      await queueService.enqueueMessage({
        ...messageData,
        id: message.id // Use the actual database ID
      });

      // ✅ ENHANCED: Better sender information
      const sender = {
        id: userId,
        name: socket.user.name || 'Unknown User',
        avatar: socket.user.avatar || null,
        role: socket.user.role || 'user'
      };

      // ✅ ENHANCED: Complete message object for real-time updates
      const messageWithSender = { 
        ...messageData, 
        id: message.id, 
        sender,
        timestamp: message.createdAt.toISOString() // Use actual DB timestamp
      };

      // ✅ Emit to all conversation participants
      console.log('📡 Broadcasting new message to conversation:', targetConversationId);
      io.to(`conversation:${targetConversationId}`).emit('new_message', messageWithSender);

      // ✅ ENHANCED: Better confirmation to sender
      const confirmationData = {
        id: message.id,
        messageId: message.id,
        clientTempId: clientTempId,
        tempId: clientTempId, // Legacy compatibility
        conversationId: targetConversationId,
        jobId: jobId || null,
        status: 'sent',
        timestamp: message.createdAt.toISOString(),
        serverTimestamp: Date.now()
      };

      console.log('🚀 Emitting message_sent confirmation:', confirmationData);
      socket.emit('message_sent', confirmationData);

      // ✅ ENHANCED: Return comprehensive result
      return {
        success: true,
        message: messageWithSender,
        conversationId: targetConversationId,
        participants: await this.getOtherParticipants(targetConversationId, userId),
        notifyRecipients: true,
        isNewConversation: !conversationId // Flag if this created a new conversation
      };

    } catch (dbError) {
      // Rollback transaction on database error
      await transaction.rollback();
      throw dbError;
    }

  } catch (error) {
    // ✅ ENHANCED: Better error handling and logging
    const errorDetails = {
      userId,
      receiverId,
      jobId,
      conversationId,
      clientTempId,
      error: error.message,
      stack: error.stack,
      payload: {
        hasText: !!(textMsg || text),
        hasImages: messageImages.length > 0 || images.length > 0,
        hasAudio: !!(audioFile || audio),
        hasAttachments: attachments.length > 0
      }
    };

    logger.error('Error handling send message', errorDetails);

    // ✅ Emit error to sender for better UX
    socket.emit('message_send_error', {
      clientTempId: clientTempId,
      error: error.message,
      code: error.code || 'SEND_MESSAGE_ERROR',
      timestamp: Date.now()
    });

    throw error;
  }
}

/**
 * Create new conversation based on context (job chat vs direct message)
 */
async createNewConversation(senderId, receiverId, jobId = null, jobTitle = null) {
  try {
    const models = db.getModels();
    const { Conversation, ConversationParticipant } = models;
    
    if (!Conversation || !ConversationParticipant) {
      throw new Error('Required models not initialized');
    }
    
    const newConversationId = uuidv4();
    
    // ✅ Create conversation with proper type and metadata
    const conversationData = {
      id: newConversationId,
      type: jobId ? 'job_chat' : 'direct_message',
      participantIds: [senderId, receiverId],
      createdBy: senderId,
      status: 'active',
      lastMessageAt: new Date()
    };
    
    // ✅ Add job-specific fields only for job chats
    if (jobId) {
      conversationData.jobId = jobId;
      if (jobTitle) {
        conversationData.jobTitle = jobTitle;
      }
    }
    
    const transaction = await db.sequelize.transaction();
    
    try {
      // Create conversation
      await Conversation.create(conversationData, { transaction });

      // Create participant records
      await ConversationParticipant.bulkCreate([
        { 
          id: uuidv4(), 
          conversationId: newConversationId, 
          userId: senderId, 
          unreadCount: 0, 
          joinedAt: new Date() 
        },
        { 
          id: uuidv4(), 
          conversationId: newConversationId, 
          userId: receiverId, 
          unreadCount: 0, // Will be incremented when message is sent
          joinedAt: new Date() 
        }
      ], { transaction });

      await transaction.commit();

      logger.info('Created new conversation:', {
        conversationId: newConversationId,
        type: conversationData.type,
        jobId: conversationData.jobId,
        jobTitle: conversationData.jobTitle,
        participants: [senderId, receiverId]
      });

      return newConversationId;

    } catch (dbError) {
      await transaction.rollback();
      throw dbError;
    }

  } catch (error) {
    logger.error('Error creating new conversation', {
      senderId,
      receiverId,
      jobId,
      jobTitle,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

  async getOtherParticipants(conversationId, excludeUserId) {
    try {
      const models = db.getModels();
      const { ConversationParticipant } = models;

      if (!ConversationParticipant) {
        throw new Error('ConversationParticipant model not initialized');
      }

      const participants = await ConversationParticipant.findAll({
        where: { conversationId, userId: { [Op.ne]: excludeUserId } }
      });
      return participants.map(p => p.userId);
    } catch (error) {
      logger.error('Error getting other participants', {
        conversationId,
        error: error.message
      });
      return [];
    }
  }

  async handleMarkRead(io, socket, { messageIds, conversationId }) {
    const userId = socket.user.id;
    
    try {
      const models = db.getModels();
      const { Message, ConversationParticipant } = models;

      if (!Message || !ConversationParticipant) {
        throw new Error('Required models not initialized');
      }

      if (!messageIds?.length && conversationId) {
        const messages = await Message.findAll({ 
          where: { conversationId, receiverId: userId, status: { [Op.ne]: 'read' } } 
        });
        messageIds = messages.map(m => m.id);
      }
      
      if (messageIds?.length) {
        await Message.update(
          { status: 'read' }, 
          { where: { id: { [Op.in]: messageIds } } }
        );
        await ConversationParticipant.update(
          { unreadCount: 0 }, 
          { where: { conversationId, userId } }
        );
        await redisService.resetUnreadCount(userId, conversationId);
        socket.emit('messages_marked_read', { messageIds });
        socket.emit('message_read', { messageIds });
      }
    } catch (error) {
      logger.error('Error marking messages as read', {
        userId,
        error: error.message
      });
      throw error;
    }
  }

  async handleUpdateMessage(io, socket, { messageId, newContent }) {
    const userId = socket.user.id;
    
    try {
      const models = db.getModels();
      const { Message, MessageVersion } = models;

      if (!Message || !MessageVersion) {
        throw new Error('Required models not initialized');
      }

      const message = await Message.findOne({ 
        where: { id: messageId, senderId: userId } 
      });
      
      if (!message) throw new Error('Message not found or unauthorized');
      
      await MessageVersion.create({ 
        id: uuidv4(), 
        messageId, 
        versionContent: message.content, 
        editedAt: new Date() 
      });
      
      message.content = { 
        ...message.content, 
        ...newContent, 
        edited: true, 
        editedAt: new Date().toISOString() 
      };
      
      await message.save();
      await redisService.cacheMessage(message);
      
      if (message.conversationId) {
        io.to(`conversation:${message.conversationId}`).emit('message_updated', { 
          messageId, 
          content: message.content 
        });
      }
    } catch (error) {
      logger.error('Error updating message', {
        userId,
        messageId,
        error: error.message
      });
      throw error;
    }
  }

  async handleDeleteMessage(io, socket, { messageId }) {
    const userId = socket.user.id;
    
    try {
      const models = db.getModels();
      const { Message } = models;

      if (!Message) {
        throw new Error('Message model not initialized');
      }

      const message = await Message.findOne({ 
        where: { id: messageId, senderId: userId } 
      });
      
      if (!message) throw new Error('Message not found or unauthorized');
      
      message.deleted = true;
      await message.save();
      await redisService.cacheMessage(message);
      
      if (message.conversationId) {
        io.to(`conversation:${message.conversationId}`).emit('message_deleted', { 
          messageId, 
          deletedAt: new Date().toISOString() 
        });
      }
      
      socket.emit('message_deleted_confirmation', { 
        messageId, 
        deletedAt: new Date().toISOString() 
      });
    } catch (error) {
      logger.error('Error deleting message', {
        userId,
        messageId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new MessageService();