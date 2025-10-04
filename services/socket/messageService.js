// /services/socket/messageService.js
const { v4: uuidv4 } = require('uuid');
const { Op, UUID } = require('sequelize');
const db = require('../../db');
const queueService = require('../queue/queueService');
const redisService = require('../redis');
const logger = require('../../utils/logger');

class MessageService {


// services/socket/messageService.js

async handleSendMessage(io, socket, payload) {
  // Extract and validate payload
  console.log('🔥 Incoming payload:', JSON.stringify(payload, null, 2));
  console.log("payload.clientTempId:", payload.clientTempId);
  
  const {
    jobId = payload.jobId,
    messageId = uuidv4(),
    clientTempId = payload.clientTempId || null,
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
    // Ensure DB initialization
    if (!db.isInitialized()) {
      logger.info('Database not initialized, waiting...');
      await db.waitForInitialization();
    }

    const models = db.getModels();
    const { Message, MessageVersion, Conversation, ConversationParticipant } = models;

    if (!Message || !Conversation || !ConversationParticipant) {
      throw new Error('Required models not initialized');
    }

    // CONVERSATION RESOLUTION - Use ConversationService
    if (!targetConversationId && receiverId) {
      console.log('🔍 Finding or creating conversation:', {
        userId,
        receiverId,
        jobId,
        hasJobId: !!jobId
      });

      const conversationService = require('./conversationService');
      
      // Use conversationService for proper separation of concerns
      targetConversationId = await conversationService.findOrCreateConversation(
        userId, 
        receiverId, 
        jobId,
        payload.jobTitle
      );

      console.log('✅ Using conversation:', {
        conversationId: targetConversationId,
        isNew: !conversationId
      });
      
      // Join the conversation room for real-time updates
      socket.join(`conversation:${targetConversationId}`);
    }

    // Validation: Ensure we have a target conversation
    if (!targetConversationId) {
      throw new Error('Could not determine target conversation ID');
    }

    // Content processing
    const finalTextContent = textMsg || text || '';
    const finalImages = messageImages.length ? messageImages : images;
    const finalAudio = audioFile || audio;

    // Validation: Ensure we have some content
    if (!finalTextContent && !finalImages.length && !finalAudio && !attachments.length) {
      throw new Error('Message must contain text, images, audio, or attachments');
    }

    // Message ID handling
    const isTempId = typeof messageId === 'string' && messageId.startsWith('temp-');
    const safeMessageId = isTempId ? undefined : messageId;

    // Build message data structure
    const messageData = {
      ...(safeMessageId && { id: safeMessageId }),
      conversationId: targetConversationId,
      jobId: jobId || null,
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

    console.log('📋 Prepared messageData for DB insert:', {
      id: messageData.id || '[auto-generated]',
      clientTempId: messageData.clientTempId,
      conversationId: messageData.conversationId,
      jobId: messageData.jobId,
      senderId: messageData.senderId,
      receiverId: messageData.receiverId,
      type: messageData.type,
      contentText: messageData.content.text?.substring(0, 50) + '...',
      hasImages: messageData.content.images?.length > 0,
      hasAudio: !!messageData.content.audio,
      hasAttachments: messageData.content.attachments?.length > 0,
      status: messageData.status,
      deleted: messageData.deleted
    });

    // Transaction handling
    let transaction;
    try {
      let sequelizeInstance = null;
      if (models.sequelize) {
        sequelizeInstance = models.sequelize;
      } else if (models.Message.sequelize) {
        sequelizeInstance = models.Message.sequelize;
      } else if (db.sequelize) {
        sequelizeInstance = db.sequelize;
      }
      
      if (sequelizeInstance) {
        transaction = await sequelizeInstance.transaction();
        console.log('✅ Transaction created successfully');
      } else {
        logger.warn('Using fallback - no sequelize instance found');
        transaction = null;
      }
      
    } catch (transactionError) {
      logger.error('Failed to create transaction', {
        error: transactionError.message,
        stack: transactionError.stack
      });
      transaction = null;
      console.log('⚠️ Transaction creation failed, proceeding without transaction');
    }
    
    try {
      // Create message in database
      const createOptions = transaction ? { transaction } : {};
      const message = await Message.create(messageData, createOptions);
      console.log('✅ Message created in database:', message.id);
      
      // Update conversation last message timestamp
      const updateOptions = transaction ? { transaction } : {};
      await Conversation.update(
        { 
          lastMessageAt: new Date(),
          // Update job info if this is a job conversation
          ...(jobId && { jobId, jobTitle: payload.jobTitle || null })
        },
        { 
          where: { id: targetConversationId },
          ...updateOptions
        }
      );
      console.log('✅ Conversation updated with last message time');

      // Update unread counts for other participants
      const incrementOptions = transaction ? { transaction } : {};
      const unreadUpdateResult = await ConversationParticipant.increment(
        'unreadCount',
        { 
          where: { 
            conversationId: targetConversationId, 
            userId: { [Op.ne]: userId },
            leftAt: null
          },
          ...incrementOptions
        }
      );

      console.log('📊 Updated unread counts for participants:', unreadUpdateResult);

      // Commit transaction if it exists
      if (transaction) {
        await transaction.commit();
        console.log('✅ Transaction committed successfully');
      }
      
      // Queue for additional processing (notifications, etc.)
      await queueService.enqueueMessage({
        ...messageData,
        id: message.id
      });

      // Build sender information
      const sender = {
        id: userId,
        name: socket.user.name || 'Unknown User',
        avatar: socket.user.avatar || null,
        role: socket.user.role || 'user'
      };

      // Complete message object for real-time updates
      const messageWithSender = { 
        ...messageData, 
        id: message.id, 
        sender,
        timestamp: message.createdAt.toISOString()
      };

      // Broadcast to all conversation participants
      console.log('📡 Broadcasting new message to conversation:', targetConversationId);
      io.to(`conversation:${targetConversationId}`).emit('new_message', messageWithSender);

      // Send confirmation to sender
      const confirmationData = {
        id: message.id,
        messageId: message.id,
        clientTempId: clientTempId,
        tempId: clientTempId,
        conversationId: targetConversationId,
        jobId: jobId || null,
        status: 'sent',
        timestamp: message.createdAt.toISOString(),
        serverTimestamp: Date.now()
      };

      console.log('🚀 Emitting message_sent confirmation:', confirmationData);
      socket.emit('message_sent', confirmationData);

      // Return comprehensive result
      return {
        success: true,
        message: messageWithSender,
        conversationId: targetConversationId,
        participants: await this.getOtherParticipants(targetConversationId, userId),
        notifyRecipients: true,
        isNewConversation: !conversationId
      };

    } catch (dbError) {
      // Rollback transaction on database error
      if (transaction) {
        await transaction.rollback();
        console.log('🔄 Transaction rolled back due to error');
      }
      throw dbError;
    }

  } catch (error) {
    // Error handling and logging
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

    // Emit error to sender for better UX
    socket.emit('message_send_error', {
      clientTempId: clientTempId,
      error: error.message,
      code: error.code || 'SEND_MESSAGE_ERROR',
      timestamp: Date.now()
    });

    throw error;
  }
}

// Helper method - keep this
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