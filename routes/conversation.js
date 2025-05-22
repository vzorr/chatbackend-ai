// routes/conversations.js - CLEAN APPROACH
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { 
  Conversation, 
  ConversationParticipant, 
  Message, 
  User 
} = require('../db/models');
const { authenticate } = require('../middleware/authentication');
const redisService = require('../services/redis');
const queueService = require('../services/queue/queueService');

// ✅ BETTER: Direct import from exception handler
const { asyncHandler, createOperationalError, createSystemError } = require('../middleware/exceptionHandler');

// Get all conversations for current user
router.get('/', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;
    
    // Validate query parameters
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw createOperationalError('Limit must be a number between 1 and 100', 400, 'INVALID_LIMIT');
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw createOperationalError('Offset must be a non-negative number', 400, 'INVALID_OFFSET');
    }
    
    try {
      // Get user's conversations
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
        limit: parsedLimit,
        offset: parsedOffset
      });
      
      // Get unread counts
      const unreadCounts = await redisService.getUnreadCounts(userId);
      
      // Format response
      const conversations = await Promise.all(participations.map(async (participation) => {
        const conversation = participation.conversation;
        
        if (!conversation) {
          return null; // Skip invalid participations
        }
        
        // Get participant details
        const participantIds = conversation.participantIds || [];
        if (participantIds.length === 0) {
          return null; // Skip conversations with no participants
        }
        
        const participantUsers = await User.findAll({
          where: { id: { [Op.in]: participantIds } },
          attributes: ['id', 'name', 'avatar']
        });
        
        // Get presence info
        const presenceMap = await redisService.getUsersPresence(participantIds);
        
        // Enrich participant data
        const participants = participantUsers.map(user => {
          const presence = presenceMap[user.id];
          return {
            ...user.toJSON(),
            isOnline: presence ? presence.isOnline : false,
            lastSeen: presence && presence.lastSeen ? presence.lastSeen : null
          };
        });
        
        return {
          id: conversation.id,
          jobId: conversation.jobId,
          jobTitle: conversation.jobTitle,
          lastMessageAt: conversation.lastMessageAt,
          participants,
          unreadCount: unreadCounts[conversation.id] || participation.unreadCount || 0,
          lastMessage: conversation.messages && conversation.messages[0] ? conversation.messages[0] : null
        };
      }));
      
      // Filter out null conversations
      const validConversations = conversations.filter(conv => conv !== null);
      
      res.json({
        success: true,
        conversations: validConversations,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: participations.length === parsedLimit
      });
    } catch (error) {
      throw createSystemError('Failed to retrieve conversations', error);
    }
  })
);

// Get single conversation
router.get('/:id', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    try {
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: id, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
      }
      
      // Get conversation
      const conversation = await Conversation.findByPk(id, {
        include: [{
          model: Message,
          as: 'messages',
          limit: 1,
          order: [['createdAt', 'DESC']]
        }]
      });
      
      if (!conversation) {
        throw createOperationalError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }
      
      // Get participant details
      const participantIds = conversation.participantIds || [];
      const participantUsers = await User.findAll({
        where: { id: { [Op.in]: participantIds } },
        attributes: ['id', 'name', 'avatar']
      });
      
      // Get presence info
      const presenceMap = await redisService.getUsersPresence(participantIds);
      
      // Enrich participant data
      const participants = participantUsers.map(user => {
        const presence = presenceMap[user.id];
        return {
          ...user.toJSON(),
          isOnline: presence ? presence.isOnline : false,
          lastSeen: presence && presence.lastSeen ? presence.lastSeen : null
        };
      });
      
      res.json({
        success: true,
        conversation: {
          id: conversation.id,
          jobId: conversation.jobId,
          jobTitle: conversation.jobTitle,
          lastMessageAt: conversation.lastMessageAt,
          participants,
          unreadCount: participation.unreadCount || 0,
          lastMessage: conversation.messages && conversation.messages[0] ? conversation.messages[0] : null
        }
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve conversation', error);
    }
  })
);

// Create new conversation
router.post('/', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { participantIds, jobId, jobTitle } = req.body;
    const userId = req.user.id;
    
    // Validate participants
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      throw createOperationalError('Participant IDs array is required and cannot be empty', 400, 'INVALID_PARTICIPANTS');
    }
    
    if (participantIds.length > 50) {
      throw createOperationalError('Cannot have more than 50 participants in a conversation', 400, 'TOO_MANY_PARTICIPANTS');
    }
    
    // Validate participant format
    for (const participantId of participantIds) {
      if (typeof participantId !== 'string' || participantId.trim().length === 0) {
        throw createOperationalError('All participant IDs must be valid strings', 400, 'INVALID_PARTICIPANT_FORMAT');
      }
    }
    
    // Validate jobId if provided
    if (jobId && (typeof jobId !== 'string' || jobId.trim().length === 0)) {
      throw createOperationalError('Job ID must be a valid string', 400, 'INVALID_JOB_ID');
    }
    
    // Validate jobTitle if provided
    if (jobTitle && (typeof jobTitle !== 'string' || jobTitle.trim().length === 0)) {
      throw createOperationalError('Job title must be a valid string', 400, 'INVALID_JOB_TITLE');
    }
    
    try {
      // Ensure current user is included
      const allParticipantIds = [...new Set([userId, ...participantIds])];
      
      // Verify all participants exist
      const existingUsers = await User.findAll({
        where: { id: { [Op.in]: allParticipantIds } },
        attributes: ['id']
      });
      
      const existingUserIds = existingUsers.map(user => user.id);
      const missingUserIds = allParticipantIds.filter(id => !existingUserIds.includes(id));
      
      if (missingUserIds.length > 0) {
        throw createOperationalError(`Some participant IDs do not exist: ${missingUserIds.join(', ')}`, 400, 'INVALID_PARTICIPANTS');
      }
      
      // Create conversation
      const conversationId = uuidv4();
      const conversationData = {
        id: conversationId,
        jobId: jobId || null,
        jobTitle: jobTitle || null,
        participantIds: allParticipantIds,
        lastMessageAt: new Date()
      };
      
      await queueService.enqueueConversationOperation(
        'create',
        conversationData
      );
      
      // Create participants records in the database directly
      const participantRecords = allParticipantIds.map(pId => ({
        id: uuidv4(),
        conversationId,
        userId: pId,
        unreadCount: pId === userId ? 0 : 1, // Current user has no unread messages
        joinedAt: new Date()
      }));
      
      await ConversationParticipant.bulkCreate(participantRecords);
      
      // Get participant details
      const participantUsers = await User.findAll({
        where: { id: { [Op.in]: allParticipantIds } },
        attributes: ['id', 'name', 'avatar']
      });
      
      res.status(201).json({
        success: true,
        conversation: {
          id: conversationId,
          jobId: jobId || null,
          jobTitle: jobTitle || null,
          participantIds: allParticipantIds,
          participants: participantUsers,
          lastMessageAt: new Date(),
          unreadCount: 0
        }
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw createOperationalError('Conversation with these participants already exists', 409, 'CONVERSATION_EXISTS');
      }
      
      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(`Validation failed: ${details}`, 400, 'VALIDATION_ERROR');
      }
      
      throw createSystemError('Failed to create conversation', error);
    }
  })
);

// Add participants to conversation
router.post('/:id/participants', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { participantIds } = req.body;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    // Validate
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      throw createOperationalError('Participant IDs array is required and cannot be empty', 400, 'INVALID_PARTICIPANTS');
    }
    
    if (participantIds.length > 20) {
      throw createOperationalError('Cannot add more than 20 participants at once', 400, 'TOO_MANY_PARTICIPANTS');
    }
    
    // Validate participant format
    for (const participantId of participantIds) {
      if (typeof participantId !== 'string' || participantId.trim().length === 0) {
        throw createOperationalError('All participant IDs must be valid strings', 400, 'INVALID_PARTICIPANT_FORMAT');
      }
    }
    
    try {
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: id, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
      }
      
      // Get conversation
      const conversation = await Conversation.findByPk(id);
      
      if (!conversation) {
        throw createOperationalError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }
      
      // Verify new participants exist
      const existingUsers = await User.findAll({
        where: { id: { [Op.in]: participantIds } },
        attributes: ['id']
      });
      
      const existingUserIds = existingUsers.map(user => user.id);
      const missingUserIds = participantIds.filter(id => !existingUserIds.includes(id));
      
      if (missingUserIds.length > 0) {
        throw createOperationalError(`Some participant IDs do not exist: ${missingUserIds.join(', ')}`, 400, 'INVALID_PARTICIPANTS');
      }
      
      // Add new participants
      const newParticipantIds = [...new Set(participantIds)].filter(pId => 
        !conversation.participantIds.includes(pId)
      );
      
      if (newParticipantIds.length === 0) {
        throw createOperationalError('All users are already participants', 400, 'ALREADY_PARTICIPANTS');
      }
      
      // Check total participant limit
      const updatedParticipantIds = [...conversation.participantIds, ...newParticipantIds];
      if (updatedParticipantIds.length > 50) {
        throw createOperationalError('Conversation cannot have more than 50 participants', 400, 'PARTICIPANT_LIMIT_EXCEEDED');
      }
      
      // Update conversation participants
      await queueService.enqueueConversationOperation(
        'update',
        {
          id,
          participantIds: updatedParticipantIds
        }
      );
      
      // Create participant records
      const participantRecords = newParticipantIds.map(pId => ({
        id: uuidv4(),
        conversationId: id,
        userId: pId,
        unreadCount: 1, // New participants have 1 unread message
        joinedAt: new Date()
      }));
      
      await ConversationParticipant.bulkCreate(participantRecords);
      
      // Add system message
      const addedUsers = await User.findAll({
        where: { id: { [Op.in]: newParticipantIds } },
        attributes: ['id', 'name']
      });
      
      const addedNames = addedUsers.map(user => user.name).join(', ');
      const adderName = req.user.name;
      
      const systemMessage = {
        id: uuidv4(),
        conversationId: id,
        senderId: userId,
        receiverId: null,
        type: 'system',
        content: {
          text: `${adderName} added ${addedNames} to the conversation`,
          systemAction: 'add_participants',
          addedUserIds: newParticipantIds
        },
        status: 'sent',
        isSystemMessage: true
      };
      
      await queueService.enqueueMessage(systemMessage);
      
      res.json({
        success: true,
        addedParticipantIds: newParticipantIds,
        message: `Added ${newParticipantIds.length} participant(s) to the conversation`
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to add participants to conversation', error);
    }
  })
);

// Remove participant from conversation
router.delete('/:id/participants/:participantId', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id, participantId } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    if (!participantId) {
      throw createOperationalError('Participant ID is required', 400, 'MISSING_PARTICIPANT_ID');
    }
    
    try {
      // Verify current user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: id, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
      }
      
      // Check if removing self or another user
      const isSelf = userId === participantId;
      
      // Get conversation
      const conversation = await Conversation.findByPk(id);
      
      if (!conversation) {
        throw createOperationalError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }
      
      // Verify target is a participant
      if (!conversation.participantIds.includes(participantId)) {
        throw createOperationalError('User is not a participant in this conversation', 400, 'NOT_PARTICIPANT');
      }
      
      // Update conversation participants
      const updatedParticipantIds = conversation.participantIds.filter(id => id !== participantId);
      
      // Prevent removing last participant
      if (updatedParticipantIds.length === 0) {
        throw createOperationalError('Cannot remove the last participant from a conversation', 400, 'LAST_PARTICIPANT');
      }
      
      await queueService.enqueueConversationOperation(
        'update',
        {
          id,
          participantIds: updatedParticipantIds
        }
      );
      
      // Update participant record
      await ConversationParticipant.update(
        { leftAt: new Date() },
        { where: { conversationId: id, userId: participantId } }
      );
      
      // Add system message
      const removedUser = await User.findByPk(participantId, {
        attributes: ['id', 'name']
      });
      
      const removedName = removedUser ? removedUser.name : 'Unknown user';
      const removerName = isSelf ? removedName : req.user.name;
      
      const systemMessage = {
        id: uuidv4(),
        conversationId: id,
        senderId: userId,
        receiverId: null,
        type: 'system',
        content: {
          text: isSelf 
            ? `${removedName} left the conversation`
            : `${removerName} removed ${removedName} from the conversation`,
          systemAction: isSelf ? 'leave_conversation' : 'remove_participant',
          removedUserId: participantId
        },
        status: 'sent',
        isSystemMessage: true
      };
      
      await queueService.enqueueMessage(systemMessage);
      
      res.json({
        success: true,
        message: isSelf ? 'Left conversation successfully' : 'Participant removed successfully'
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to remove participant from conversation', error);
    }
  })
);

// Mark conversation as read
router.post('/:id/read', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    try {
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: id, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
      }
      
      // Reset unread count in participant record
      await ConversationParticipant.update(
        { unreadCount: 0 },
        { where: { conversationId: id, userId } }
      );
      
      // Reset Redis unread count
      await redisService.resetUnreadCount(userId, id);
      
      // Mark all unread messages as read
      const updatedCount = await Message.update(
        { status: 'read' },
        { 
          where: { 
            conversationId: id, 
            receiverId: userId,
            status: { [Op.ne]: 'read' }
          } 
        }
      );
      
      res.json({
        success: true,
        message: 'Conversation marked as read',
        messagesMarkedRead: updatedCount[0] || 0
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to mark conversation as read', error);
    }
  })
);

/**
 * @route DELETE /api/v1/conversations/:id
 * @desc Delete a conversation (soft delete)
 * @access Private
 */
router.delete('/:id', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    try {
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: id, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
      }
      
      // Get conversation
      const conversation = await Conversation.findByPk(id);
      
      if (!conversation) {
        throw createOperationalError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }
      
      // For now, just remove the user from the conversation
      // (You might want to implement full conversation deletion logic)
      const updatedParticipantIds = conversation.participantIds.filter(pId => pId !== userId);
      
      if (updatedParticipantIds.length === 0) {
        // If this was the last participant, mark conversation as deleted
        await Conversation.update(
          { deleted: true, deletedAt: new Date() },
          { where: { id } }
        );
      } else {
        // Update participant list
        await queueService.enqueueConversationOperation(
          'update',
          {
            id,
            participantIds: updatedParticipantIds
          }
        );
      }
      
      // Update participant record
      await ConversationParticipant.update(
        { leftAt: new Date() },
        { where: { conversationId: id, userId } }
      );
      
      res.json({
        success: true,
        message: 'Conversation deleted successfully'
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to delete conversation', error);
    }
  })
);

module.exports = router;