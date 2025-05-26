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
  console.log( " payload.clientTempId" +  payload.clientTempId);
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

    // Determine conversation or create one
    if (!targetConversationId && receiverId) {
      targetConversationId = await this.ensureDirectConversation(userId, receiverId);
      socket.join(`conversation:${targetConversationId}`);
    }

    const finalTextContent = textMsg || text || '';
    const finalImages = messageImages.length ? messageImages : images;
    const finalAudio = audioFile || audio;

    const isTempId = typeof messageId === 'string' && messageId.startsWith('temp-');
    const safeMessageId = isTempId ? undefined : messageId;

    const messageData = {
      ...(safeMessageId && { id: safeMessageId }), // ✅ only include if valid UUID
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
      clientTempId, // ✅ used for frontend matching
      deleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // ✅ Clean, structured log
    console.log('🧾 Prepared messageData for DB insert:', {
      id: messageData.id || '[auto-generated]',
      clientTempId: messageData.clientTempId,
      conversationId: messageData.conversationId,
      jobId: messageData.jobId,
      senderId: messageData.senderId,
      receiverId: messageData.receiverId,
      type: messageData.type,
      content: messageData.content,
      status: messageData.status,
      deleted: messageData.deleted,
      createdAt: messageData.createdAt,
      updatedAt: messageData.updatedAt
    });

    // Create message directly in database and queue for additional processing
    const message = await Message.create(messageData);
    await queueService.enqueueMessage(messageData);

    // Update conversation
    await Conversation.update(
      { lastMessageAt: new Date() },
      { where: { id: targetConversationId } }
    );

    // Unread count update
    await ConversationParticipant.increment(
      'unreadCount',
      { where: { conversationId: targetConversationId, userId: { [Op.ne]: userId } } }
    );

    const sender = {
      id: userId,
      name: socket.user.name,
      avatar: socket.user.avatar
    };

    const messageWithSender = { ...messageData, id: message.id, sender };

    io.to(`conversation:${targetConversationId}`).emit('new_message', messageWithSender);

    console.log('🚀 About to emit message_sent with data:', {
    id: message.id,
    messageId: message.id,
    clientTempId:clientTempId,
    tempId: clientTempId,
    conversationId: targetConversationId,
    timestamp: Date.now()
    });

    // ✅ Emit both for frontend compatibility
    socket.emit('message_sent', {
      id: message.id,
      messageId: message.id,
      clientTempId: clientTempId,
      tempId: clientTempId,
      conversationId: targetConversationId,
      timestamp: Date.now()
    });

    return {
      message,
      participants: await this.getOtherParticipants(targetConversationId, userId),
      notifyRecipients: true
    };
  } catch (error) {
    logger.error('Error handling send message', {
      userId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}



  async ensureDirectConversation(userId, receiverId) {
    try {
      const models = db.getModels();
      const { Conversation, ConversationParticipant } = models;

      if (!Conversation || !ConversationParticipant) {
        throw new Error('Required models not initialized');
      }

      const conversations = await Conversation.findAll({
        where: { participantIds: { [Op.contains]: [userId, receiverId] } }
      });

      const directConversation = conversations.find(c =>
        c.participantIds.length === 2 &&
        c.participantIds.includes(userId) &&
        c.participantIds.includes(receiverId)
      );

      if (directConversation) return directConversation.id;

      const newConversationId = uuidv4();
      
      // Create the conversation directly in the database
      await Conversation.create({
        id: newConversationId,
        participantIds: [userId, receiverId],
        lastMessageAt: new Date()
      });

      // Now create the participant records
      await ConversationParticipant.bulkCreate([
        { id: uuidv4(), conversationId: newConversationId, userId, unreadCount: 0, joinedAt: new Date() },
        { id: uuidv4(), conversationId: newConversationId, userId: receiverId, unreadCount: 1, joinedAt: new Date() }
      ]);

      return newConversationId;
    } catch (error) {
      logger.error('Error ensuring direct conversation', {
        userId,
        receiverId,
        error: error.message
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