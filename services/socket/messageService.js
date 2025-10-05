// services/socket/messageService.js - ENHANCED WITH FILE UPLOAD SUPPORT
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const db = require('../../db');
const queueService = require('../queue/queueService');
const redisService = require('../redis');
const logger = require('../../utils/logger');

class MessageService {

  async handleSendMessage(io, socket, payload) {
    console.log('🔥 Incoming payload:', JSON.stringify(payload, null, 2));
    
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
      fileUrl = '', // NEW: For uploaded files
      fileName = '', // NEW: Original file name
      fileSize = 0, // NEW: File size
      fileType = '', // NEW: File MIME type
      replyToMessageId = null,
      attachments = []
    } = payload;

    const userId = socket.user.id;
    let targetConversationId = conversationId;

    try {
      if (!db.isInitialized()) {
        await db.waitForInitialization();
      }

      const models = db.getModels();
      const { Message, Conversation, ConversationParticipant } = models;

      if (!Message || !Conversation || !ConversationParticipant) {
        throw new Error('Required models not initialized');
      }

      // CONVERSATION RESOLUTION
      if (!targetConversationId && receiverId) {
        const conversationService = require('./conversationService');
        targetConversationId = await conversationService.findOrCreateConversation(
          userId, 
          receiverId, 
          jobId,
          payload.jobTitle
        );
        socket.join(`conversation:${targetConversationId}`);
      }

      if (!targetConversationId) {
        throw new Error('Could not determine target conversation ID');
      }

      // ENHANCED CONTENT PROCESSING WITH FILE SUPPORT
      const finalTextContent = textMsg || text || '';
      const finalImages = messageImages.length ? messageImages : images;
      const finalAudio = audioFile || audio;
      const finalFileUrl = fileUrl || '';
      
      // Handle attachments array (can include multiple files)
      const finalAttachments = attachments.length ? attachments : [];
      
      // If single file is provided, add to attachments
      if (finalFileUrl && fileName) {
        finalAttachments.push({
          url: finalFileUrl,
          name: fileName,
          size: fileSize,
          type: fileType,
          uploadedAt: new Date().toISOString()
        });
      }

      // VALIDATION: Ensure message has content
      if (!finalTextContent && 
          !finalImages.length && 
          !finalAudio && 
          !finalAttachments.length) {
        throw new Error('Message must contain text, images, audio, or file attachments');
      }

      // DETERMINE MESSAGE TYPE BASED ON CONTENT
      let determinedMessageType = messageType;
      if (!determinedMessageType || determinedMessageType === 'text') {
        if (finalImages.length > 0) {
          determinedMessageType = 'image';
        } else if (finalAudio) {
          determinedMessageType = 'audio';
        } else if (finalAttachments.length > 0) {
          determinedMessageType = 'file';
        }
      }

      const isTempId = typeof messageId === 'string' && messageId.startsWith('temp-');
      const safeMessageId = isTempId ? undefined : messageId;

      // BUILD MESSAGE DATA WITH FILE SUPPORT
      const messageData = {
        ...(safeMessageId && { id: safeMessageId }),
        conversationId: targetConversationId,
        jobId: jobId || null,
        senderId: userId,
        receiverId: receiverId || null,
        type: determinedMessageType,
        content: {
          text: finalTextContent,
          images: finalImages,
          audio: finalAudio,
          attachments: finalAttachments, // File attachments
          replyTo: replyToMessageId,
          // Additional file metadata for easy access
          hasFiles: finalAttachments.length > 0,
          fileCount: finalAttachments.length
        },
        status: 'sent',
        clientTempId,
        deleted: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      console.log('📋 Message data prepared:', {
        id: messageData.id || '[auto-generated]',
        type: messageData.type,
        hasText: !!finalTextContent,
        hasImages: finalImages.length > 0,
        hasAudio: !!finalAudio,
        hasFiles: finalAttachments.length > 0,
        fileCount: finalAttachments.length
      });

      // TRANSACTION HANDLING
      let transaction;
      try {
        const sequelizeInstance = models.sequelize || models.Message.sequelize || db.sequelize;
        transaction = sequelizeInstance ? await sequelizeInstance.transaction() : null;
      } catch (transactionError) {
        logger.warn('Transaction creation failed, proceeding without transaction');
        transaction = null;
      }
      
      try {
        // CREATE MESSAGE
        const createOptions = transaction ? { transaction } : {};
        const message = await Message.create(messageData, createOptions);
        console.log('✅ Message created:', message.id);
        
        // UPDATE CONVERSATION
        const updateOptions = transaction ? { transaction } : {};
        await Conversation.update(
          { 
            lastMessageAt: new Date(),
            ...(jobId && { jobId, jobTitle: payload.jobTitle || null })
          },
          { 
            where: { id: targetConversationId },
            ...updateOptions
          }
        );

        // UPDATE UNREAD COUNTS
        const incrementOptions = transaction ? { transaction } : {};
        await ConversationParticipant.increment(
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

        // COMMIT TRANSACTION
        if (transaction) {
          await transaction.commit();
        }
        
        // QUEUE FOR PROCESSING
        await queueService.enqueueMessage({
          ...messageData,
          id: message.id
        });

        // BUILD SENDER INFO
        const sender = {
          id: userId,
          name: socket.user.name || 'Unknown User',
          avatar: socket.user.avatar || null,
          role: socket.user.role || 'user'
        };

        // COMPLETE MESSAGE OBJECT
        const messageWithSender = { 
          ...messageData, 
          id: message.id, 
          sender,
          timestamp: message.createdAt.toISOString()
        };

        // BROADCAST TO CONVERSATION
        io.to(`conversation:${targetConversationId}`).emit('new_message', messageWithSender);

        // SEND CONFIRMATION TO SENDER
        socket.emit('message_sent', {
          id: message.id,
          messageId: message.id,
          clientTempId: clientTempId,
          tempId: clientTempId,
          conversationId: targetConversationId,
          jobId: jobId || null,
          status: 'sent',
          timestamp: message.createdAt.toISOString(),
          serverTimestamp: Date.now()
        });

        return {
          success: true,
          message: messageWithSender,
          conversationId: targetConversationId,
          participants: await this.getOtherParticipants(targetConversationId, userId),
          notifyRecipients: true,
          isNewConversation: !conversationId
        };

      } catch (dbError) {
        if (transaction) {
          await transaction.rollback();
        }
        throw dbError;
      }

    } catch (error) {
      logger.error('Error handling send message', {
        userId,
        error: error.message,
        stack: error.stack
      });

      socket.emit('message_send_error', {
        clientTempId: clientTempId,
        error: error.message,
        code: error.code || 'SEND_MESSAGE_ERROR',
        timestamp: Date.now()
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