// /services/socket/messageService.js
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { Message, MessageVersion, Conversation, ConversationParticipant } = require('../../db/models');
const queueService = require('../queue/queueService');
const redisService = require('../redis');

class MessageService {
  async handleSendMessage(io, socket, payload) {
    // Extract and validate payload
    const {
      messageId = uuidv4(), clientTempId, jobId,
      receiverId, conversationId, messageType = 'text',
      textMsg, text, messageImages = [], images = [],
      audioFile = '', audio = '', replyToMessageId = null, attachments = []
    } = payload;

    const userId = socket.user.id;
    let targetConversationId = conversationId;

    // Determine conversation or create one
    if (!targetConversationId && receiverId) {
      targetConversationId = await this.ensureDirectConversation(userId, receiverId);
      socket.join(`conversation:${targetConversationId}`);
    }

    const finalTextContent = textMsg || text || '';
    const finalImages = messageImages.length ? messageImages : images;
    const finalAudio = audioFile || audio;

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

    // Queue and create message
    await queueService.enqueueMessage(messageData);
    const message = await Message.create(messageData);

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

    const messageWithSender = { ...messageData, sender };
    io.to(`conversation:${targetConversationId}`).emit('new_message', messageWithSender);
    socket.emit('message_sent', { id: messageId, clientTempId, conversationId: targetConversationId, timestamp: Date.now() });

    return { message, participants: await this.getOtherParticipants(targetConversationId, userId), notifyRecipients: true };
  }

  async ensureDirectConversation(userId, receiverId) {
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
    await queueService.enqueueConversationOperation('create', {
      id: newConversationId,
      participantIds: [userId, receiverId],
      lastMessageAt: new Date()
    });

    await ConversationParticipant.bulkCreate([
      { id: uuidv4(), conversationId: newConversationId, userId, unreadCount: 0, joinedAt: new Date() },
      { id: uuidv4(), conversationId: newConversationId, userId: receiverId, unreadCount: 1, joinedAt: new Date() }
    ]);

    return newConversationId;
  }

  async getOtherParticipants(conversationId, excludeUserId) {
    const participants = await ConversationParticipant.findAll({
      where: { conversationId, userId: { [Op.ne]: excludeUserId } }
    });
    return participants.map(p => p.userId);
  }

  async handleMarkRead(io, socket, { messageIds, conversationId }) {
    const userId = socket.user.id;
    if (!messageIds?.length && conversationId) {
      const messages = await Message.findAll({ where: { conversationId, receiverId: userId, status: { [Op.ne]: 'read' } } });
      messageIds = messages.map(m => m.id);
    }
    if (messageIds?.length) {
      await Message.update({ status: 'read' }, { where: { id: { [Op.in]: messageIds } } });
      await ConversationParticipant.update({ unreadCount: 0 }, { where: { conversationId, userId } });
      await redisService.resetUnreadCount(userId, conversationId);
      socket.emit('messages_marked_read', { messageIds });
      socket.emit('message_read', { messageIds });
    }
  }

  async handleUpdateMessage(io, socket, { messageId, newContent }) {
    const userId = socket.user.id;
    const message = await Message.findOne({ where: { id: messageId, senderId: userId } });
    if (!message) throw new Error('Message not found or unauthorized');
    await MessageVersion.create({ id: uuidv4(), messageId, versionContent: message.content, editedAt: new Date() });
    message.content = { ...message.content, ...newContent, edited: true, editedAt: new Date().toISOString() };
    await message.save();
    await redisService.cacheMessage(message);
    if (message.conversationId) io.to(`conversation:${message.conversationId}`).emit('message_updated', { messageId, content: message.content });
  }

  async handleDeleteMessage(io, socket, { messageId }) {
    const userId = socket.user.id;
    const message = await Message.findOne({ where: { id: messageId, senderId: userId } });
    if (!message) throw new Error('Message not found or unauthorized');
    message.deleted = true;
    await message.save();
    await redisService.cacheMessage(message);
    if (message.conversationId) io.to(`conversation:${message.conversationId}`).emit('message_deleted', { messageId, deletedAt: new Date().toISOString() });
    socket.emit('message_deleted_confirmation', { messageId, deletedAt: new Date().toISOString() });
  }
}

module.exports = new MessageService();
