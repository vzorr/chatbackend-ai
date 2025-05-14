// socket/handlers/conversationHandlers.js
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const redisService = require('../../services/redis');
const queueService = require('../../services/queue/queueService');
const presenceService = require('../../services/socket/presenceService');
const { Op } = require('sequelize');

module.exports = (io, socket) => {
  const userId = socket.user.id;

  // Get models safely
  const getModels = () => {
    try {
      const models = db.getModels();
      const { ConversationParticipant, Conversation, User } = models;
      
      if (!ConversationParticipant || !Conversation || !User) {
        throw new Error('Required models not available');
      }
      
      return { ConversationParticipant, Conversation, User };
    } catch (error) {
      logger.error('Error getting models', { error: error.message });
      throw error;
    }
  };

  // Join a conversation
  socket.on('join_conversation', async ({ conversationId }) => {
    try {
      if (!conversationId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId is required'
        });
      }

      const { ConversationParticipant, Conversation } = getModels();

      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });

      if (!participation) {
        return socket.emit('error', {
          code: 'NOT_AUTHORIZED',
          message: 'Not a participant in this conversation'
        });
      }

      // Join the conversation room
      socket.join(`conversation:${conversationId}`);

      // Cache conversation data
      const conversation = await Conversation.findByPk(conversationId);
      if (conversation) {
        await redisService.cacheConversation(conversation);
      }

      socket.emit('conversation_joined', {
        conversationId,
        timestamp: Date.now()
      });

      logger.info(`User ${userId} joined conversation ${conversationId}`);
    } catch (error) {
      logger.error(`Error joining conversation: ${error.message}`, {
        error: error.stack,
        userId,
        conversationId
      });
      socket.emit('error', {
        code: 'JOIN_CONVERSATION_FAILED',
        message: 'Failed to join conversation'
      });
    }
  });

  // Leave a conversation
  socket.on('leave_conversation', async ({ conversationId }) => {
    try {
      if (!conversationId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId is required'
        });
      }

      socket.leave(`conversation:${conversationId}`);

      socket.emit('conversation_left', {
        conversationId,
        timestamp: Date.now()
      });

      logger.info(`User ${userId} left conversation ${conversationId}`);
    } catch (error) {
      logger.error(`Error leaving conversation: ${error.message}`, {
        error: error.stack,
        userId,
        conversationId
      });
      socket.emit('error', {
        code: 'LEAVE_CONVERSATION_FAILED',
        message: 'Failed to leave conversation'
      });
    }
  });

  // Create a new conversation
  socket.on('create_conversation', async ({ participantIds, jobId, jobTitle }) => {
    try {
      if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'participantIds array is required'
        });
      }

      const { ConversationParticipant, Conversation } = getModels();

      // Ensure current user is included
      const allParticipantIds = [...new Set([userId, ...participantIds])];
      const conversationId = uuidv4();

      // Create conversation directly in database
      const conversation = await Conversation.create({
        id: conversationId,
        jobId,
        jobTitle,
        participantIds: allParticipantIds,
        lastMessageAt: new Date()
      });

      // Create participant records
      const participantRecords = allParticipantIds.map(pId => ({
        id: uuidv4(),
        conversationId,
        userId: pId,
        unreadCount: 0,
        joinedAt: new Date()
      }));

      await ConversationParticipant.bulkCreate(participantRecords);

      // Join the conversation room
      socket.join(`conversation:${conversationId}`);

      // Notify all participants
      allParticipantIds.forEach((participantId) => {
        const participantSocketId = presenceService.getSocketId(participantId);
        if (participantSocketId) {
          io.to(participantSocketId).emit('added_to_conversation', {
            conversationId,
            conversation: conversation.toJSON(),
            timestamp: Date.now()
          });
        }
      });

      socket.emit('conversation_created', {
        conversationId,
        conversation: conversation.toJSON(),
        timestamp: Date.now()
      });

      logger.info(`User ${userId} created conversation ${conversationId}`);
    } catch (error) {
      logger.error(`Error creating conversation: ${error.message}`, {
        error: error.stack,
        userId,
        jobId,
        participantIds
      });
      socket.emit('error', {
        code: 'CREATE_CONVERSATION_FAILED',
        message: 'Failed to create conversation'
      });
    }
  });

  // Add participants to existing conversation
  socket.on('add_participants', async ({ conversationId, participantIds }) => {
    try {
      if (!conversationId || !participantIds || !Array.isArray(participantIds)) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId and participantIds array are required'
        });
      }

      const { ConversationParticipant, Conversation } = getModels();

      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });

      if (!participation) {
        return socket.emit('error', {
          code: 'NOT_AUTHORIZED',
          message: 'Not a participant in this conversation'
        });
      }

      // Get conversation
      const conversation = await Conversation.findByPk(conversationId);
      if (!conversation) {
        return socket.emit('error', {
          code: 'NOT_FOUND',
          message: 'Conversation not found'
        });
      }

      // Add new participants
      const newParticipantIds = [...new Set(participantIds)].filter(
        pId => !conversation.participantIds.includes(pId)
      );

      if (newParticipantIds.length === 0) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'All users are already participants'
        });
      }

      // Update conversation
      const updatedParticipantIds = [...conversation.participantIds, ...newParticipantIds];
      await conversation.update({ participantIds: updatedParticipantIds });

      // Create participant records
      const participantRecords = newParticipantIds.map(pId => ({
        id: uuidv4(),
        conversationId,
        userId: pId,
        unreadCount: 0,
        joinedAt: new Date()
      }));

      await ConversationParticipant.bulkCreate(participantRecords);

      // Notify all participants
      io.to(`conversation:${conversationId}`).emit('participants_added', {
        conversationId,
        newParticipantIds,
        addedBy: userId,
        timestamp: Date.now()
      });

      logger.info(`User ${userId} added participants to conversation ${conversationId}`, {
        newParticipantIds
      });
    } catch (error) {
      logger.error(`Error adding participants: ${error.message}`, {
        error: error.stack,
        userId,
        conversationId,
        participantIds
      });
      socket.emit('error', {
        code: 'ADD_PARTICIPANTS_FAILED',
        message: 'Failed to add participants'
      });
    }
  });

  // Remove participant from conversation
  socket.on('remove_participant', async ({ conversationId, participantId }) => {
    try {
      if (!conversationId || !participantId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId and participantId are required'
        });
      }

      const { ConversationParticipant, Conversation } = getModels();

      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });

      if (!participation) {
        return socket.emit('error', {
          code: 'NOT_AUTHORIZED',
          message: 'Not a participant in this conversation'
        });
      }

      // Get conversation
      const conversation = await Conversation.findByPk(conversationId);
      if (!conversation) {
        return socket.emit('error', {
          code: 'NOT_FOUND',
          message: 'Conversation not found'
        });
      }

      // Check if participant exists
      if (!conversation.participantIds.includes(participantId)) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'User is not a participant'
        });
      }

      // Update conversation
      const updatedParticipantIds = conversation.participantIds.filter(
        id => id !== participantId
      );

      await conversation.update({ participantIds: updatedParticipantIds });

      // Update participant record
      await ConversationParticipant.update(
        { leftAt: new Date() },
        { where: { conversationId, userId: participantId } }
      );

      // Notify all participants
      io.to(`conversation:${conversationId}`).emit('participant_removed', {
        conversationId,
        participantId,
        removedBy: userId,
        timestamp: Date.now()
      });

      // If removed user is online, notify them
      const removedUserSocketId = presenceService.getSocketId(participantId);
      if (removedUserSocketId) {
        io.to(removedUserSocketId).emit('removed_from_conversation', {
          conversationId,
          removedBy: userId,
          timestamp: Date.now()
        });
      }

      logger.info(`User ${userId} removed participant ${participantId} from conversation ${conversationId}`);
    } catch (error) {
      logger.error(`Error removing participant: ${error.message}`, {
        error: error.stack,
        userId,
        conversationId,
        participantId
      });
      socket.emit('error', {
        code: 'REMOVE_PARTICIPANT_FAILED',
        message: 'Failed to remove participant'
      });
    }
  });

  // Get conversation details
  socket.on('get_conversation', async ({ conversationId }) => {
    try {
      if (!conversationId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId is required'
        });
      }

      const { ConversationParticipant, Conversation, User } = getModels();

      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });

      if (!participation) {
        return socket.emit('error', {
          code: 'NOT_AUTHORIZED',
          message: 'Not a participant in this conversation'
        });
      }

      // Get conversation from cache or database
      let conversation = await redisService.getConversation(conversationId);
      
      if (!conversation) {
        const dbConversation = await Conversation.findByPk(conversationId);
        if (dbConversation) {
          conversation = dbConversation.toJSON();
          await redisService.cacheConversation(conversation);
        }
      }

      if (!conversation) {
        return socket.emit('error', {
          code: 'NOT_FOUND',
          message: 'Conversation not found'
        });
      }

      // Get participant details
      const participants = await User.findAll({
        where: { id: { [Op.in]: conversation.participantIds } },
        attributes: ['id', 'name', 'avatar']
      });

      socket.emit('conversation_details', {
        conversation,
        participants: participants.map(p => p.toJSON()),
        unreadCount: participation.unreadCount,
        timestamp: Date.now()
      });

      logger.debug(`Sent conversation details for ${conversationId} to user ${userId}`);
    } catch (error) {
      logger.error(`Error getting conversation: ${error.message}`, {
        error: error.stack,
        userId,
        conversationId
      });
      socket.emit('error', {
        code: 'GET_CONVERSATION_FAILED',
        message: 'Failed to get conversation details'
      });
    }
  });

  // Get user's conversations
  socket.on('get_conversations', async ({ limit = 20, offset = 0 }) => {
    try {
      const { ConversationParticipant, Conversation } = getModels();

      // Get user's conversation participations
      const participations = await ConversationParticipant.findAll({
        where: { userId },
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['joinedAt', 'DESC']]
      });

      if (participations.length === 0) {
        socket.emit('conversations_list', {
          conversations: [],
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: 0,
          timestamp: Date.now()
        });
        return;
      }

      const conversationIds = participations.map(p => p.conversationId);

      // Get conversations
      const conversations = await Conversation.findAll({
        where: { id: { [Op.in]: conversationIds } },
        order: [['lastMessageAt', 'DESC']]
      });

      // Get unread counts
      const unreadCounts = await redisService.getUnreadCounts(userId);

      // Enrich conversations with unread counts
      const enrichedConversations = conversations.map(conv => ({
        ...conv.toJSON(),
        unreadCount: unreadCounts[conv.id] || 0
      }));

      socket.emit('conversations_list', {
        conversations: enrichedConversations,
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: participations.length,
        timestamp: Date.now()
      });

      logger.debug(`Sent conversations list to user ${userId}`, {
        conversationCount: enrichedConversations.length
      });
    } catch (error) {
      logger.error(`Error getting conversations: ${error.message}`, {
        error: error.stack,
        userId,
        limit,
        offset
      });
      socket.emit('error', {
        code: 'GET_CONVERSATIONS_FAILED',
        message: 'Failed to get conversations'
      });
    }
  });

  // Update conversation
  socket.on('update_conversation', async ({ conversationId, updates }) => {
    try {
      if (!conversationId || !updates) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId and updates are required'
        });
      }

      const { ConversationParticipant, Conversation } = getModels();

      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });

      if (!participation) {
        return socket.emit('error', {
          code: 'NOT_AUTHORIZED',
          message: 'Not a participant in this conversation'
        });
      }

      // Get conversation
      const conversation = await Conversation.findByPk(conversationId);
      if (!conversation) {
        return socket.emit('error', {
          code: 'NOT_FOUND',
          message: 'Conversation not found'
        });
      }

      // Update allowed fields only
      const allowedUpdates = {};
      if (updates.jobTitle !== undefined) allowedUpdates.jobTitle = updates.jobTitle;
      if (updates.jobId !== undefined) allowedUpdates.jobId = updates.jobId;

      await conversation.update(allowedUpdates);

      // Cache updated conversation
      await redisService.cacheConversation(conversation.toJSON());

      // Notify all participants
      io.to(`conversation:${conversationId}`).emit('conversation_updated', {
        conversationId,
        updates: allowedUpdates,
        updatedBy: userId,
        timestamp: Date.now()
      });

      socket.emit('conversation_update_success', {
        conversationId,
        updates: allowedUpdates,
        timestamp: Date.now()
      });

      logger.info(`User ${userId} updated conversation ${conversationId}`, {
        updates: allowedUpdates
      });
    } catch (error) {
      logger.error(`Error updating conversation: ${error.message}`, {
        error: error.stack,
        userId,
        conversationId,
        updates
      });
      socket.emit('error', {
        code: 'UPDATE_CONVERSATION_FAILED',
        message: 'Failed to update conversation'
      });
    }
  });

  // Get conversation participants
  socket.on('get_participants', async ({ conversationId }) => {
    try {
      if (!conversationId) {
        return socket.emit('error', {
          code: 'INVALID_REQUEST',
          message: 'conversationId is required'
        });
      }

      const { ConversationParticipant, User } = getModels();

      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });

      if (!participation) {
        return socket.emit('error', {
          code: 'NOT_AUTHORIZED',
          message: 'Not a participant in this conversation'
        });
      }

      // Get all participants
      const participants = await ConversationParticipant.findAll({
        where: { conversationId },
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'avatar', 'isOnline', 'lastSeen']
        }]
      });

      // Get presence data from Redis for real-time status
      const userIds = participants.map(p => p.userId);
      const presenceMap = await redisService.getUsersPresence(userIds);

      // Enrich participant data with presence
      const enrichedParticipants = participants.map(p => {
        const presence = presenceMap[p.userId];
        return {
          ...p.toJSON(),
          user: {
            ...p.user.toJSON(),
            isOnline: presence ? presence.isOnline : p.user.isOnline,
            lastSeen: presence && presence.lastSeen ? presence.lastSeen : p.user.lastSeen
          }
        };
      });

      socket.emit('participants_data', {
        conversationId,
        participants: enrichedParticipants,
        timestamp: Date.now()
      });

      logger.debug(`Sent participants data for conversation ${conversationId}`, {
        participantCount: enrichedParticipants.length
      });
    } catch (error) {
      logger.error(`Error getting participants: ${error.message}`, {
        error: error.stack,
        userId,
        conversationId
      });
      socket.emit('error', {
        code: 'GET_PARTICIPANTS_FAILED',
        message: 'Failed to get participants'
      });
    }
  });
};