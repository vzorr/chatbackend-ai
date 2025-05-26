// routes/conversations.js - UPDATED FOR CLIENT PAYLOAD COMPATIBILITY
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const { authenticate } = require('../middleware/authentication');
const redisService = require('../services/redis');
const queueService = require('../services/queue/queueService');

const { asyncHandler, createOperationalError, createSystemError } = require('../middleware/exceptionHandler');

// Get all conversations for current user
router.get('/', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { 
      limit = 20, 
      offset = 0, 
      type, 
      status, 
      isPinned,
      isMuted 
    } = req.query;
    const userId = req.user.id;
    
    logger.info('GET /conversations - Starting request', {
      userId,
      limit,
      offset,
      type,
      status,
      isPinned,
      isMuted,
      userObject: req.user
    });
    
    // Validate query parameters
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      logger.error('Invalid limit parameter', { limit, parsedLimit });
      throw createOperationalError('Limit must be a number between 1 and 100', 400, 'INVALID_LIMIT');
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      logger.error('Invalid offset parameter', { offset, parsedOffset });
      throw createOperationalError('Offset must be a non-negative number', 400, 'INVALID_OFFSET');
    }
    
    // Validate filters
    if (type && !['job_chat', 'direct_message'].includes(type)) {
      throw createOperationalError('Invalid type. Must be job_chat or direct_message', 400, 'INVALID_TYPE');
    }
    
    if (status && !['active', 'closed', 'archived'].includes(status)) {
      throw createOperationalError('Invalid status. Must be active, closed, or archived', 400, 'INVALID_STATUS');
    }

    try {
      // Import db and get models dynamically
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;
      
      logger.info('Database models loaded', {
        hasDb: !!db,
        modelKeys: Object.keys(db || {}),
        hasConversation: !!Conversation,
        hasConversationParticipant: !!ConversationParticipant,
        hasMessage: !!Message,
        hasUser: !!User
      });
      
      // Check if models exist
      if (!Conversation || !ConversationParticipant || !Message || !User) {
        logger.error('Models not initialized', {
          hasConversation: !!Conversation,
          hasConversationParticipant: !!ConversationParticipant,
          hasMessage: !!Message,
          hasUser: !!User
        });
        throw new Error('Database models not initialized');
      }
      
      // Build participant query conditions
      const participantWhere = { userId };
      if (isPinned !== undefined) {
        participantWhere.isPinned = isPinned === 'true';
      }
      if (isMuted !== undefined) {
        participantWhere.isMuted = isMuted === 'true';
      }
      
      // Build conversation query conditions
      const conversationWhere = {};
      if (type) {
        conversationWhere.type = type;
      }
      if (status) {
        conversationWhere.status = status;
      }
      
      // Get user's conversations
      logger.info('Fetching participations', {
        userId,
        limit: parsedLimit,
        offset: parsedOffset,
        participantWhere,
        conversationWhere
      });
      
      const participations = await ConversationParticipant.findAll({
        where: participantWhere,
        include: [{
          model: Conversation,
          as: 'conversation',
          where: conversationWhere,
          include: [{
            model: Message,
            as: 'messages',
            limit: 1,
            order: [['createdAt', 'DESC']],
            required: false,
            where: { deleted: false }
          }]
        }],
        order: [
          ['isPinned', 'DESC'],
          [{model: Conversation, as: 'conversation'}, 'lastMessageAt', 'DESC']
        ],
        limit: parsedLimit,
        offset: parsedOffset
      });
      
      logger.info('Participations query completed', {
        userId,
        participationsFound: participations.length,
        hasParticipations: participations && participations.length > 0
      });
      
      // Format response according to client structure
      const conversations = await Promise.all(participations.map(async (participation, index) => {
        const conversation = participation.conversation;
        
        logger.info(`Processing conversation ${index}`, {
          hasConversation: !!conversation,
          conversationId: conversation?.id
        });
        
        if (!conversation) {
          logger.warn(`Skipping participation ${index} - no conversation object`, {
            participationId: participation.id,
            participationData: participation.toJSON()
          });
          return null;
        }
        
        // Get all participants with details
        const allParticipants = await ConversationParticipant.findAll({
          where: { conversationId: conversation.id },
          include: [{
            model: User,
            as: 'user',
            attributes: ['id', 'name', 'avatar', 'role']
          }]
        });
        
        // Get presence info
        const participantIds = allParticipants.map(p => p.userId);
        const presenceMap = await redisService.getUsersPresence(participantIds);
        
        // Format participants according to client structure
        const participants = allParticipants.map(p => ({
          userId: p.userId,
          role: p.user.role,
          joinedAt: p.joinedAt,
          isActive: !p.leftAt,
          // Additional fields for UI
          name: p.user.name,
          avatar: p.user.avatar,
          isOnline: presenceMap[p.userId]?.isOnline || false,
          lastSeen: presenceMap[p.userId]?.lastSeen || null
        }));
        
        // Format last message with sender details
        let lastMessage = null;
        if (conversation.messages && conversation.messages[0]) {
          const message = conversation.messages[0];
          const sender = participants.find(p => p.userId === message.senderId);
          lastMessage = {
            id: message.id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            sender: sender ? {
              id: sender.userId,
              name: sender.name,
              avatar: sender.avatar
            } : null,
            type: message.type,
            content: message.content,
            status: message.status,
            createdAt: message.createdAt
          };
        }
        
        // Build conversation object according to client structure
        const conversationData = {
          id: conversation.id,
          type: conversation.type || 'direct_message',
          participants,
          metadata: {
            jobId: conversation.jobId,
            jobTitle: conversation.jobTitle,
            status: conversation.status || 'active',
            createdBy: conversation.createdBy || conversation.participantIds[0],
            closedAt: conversation.closedAt
          },
          settings: {
            isMuted: participation.isMuted || false,
            isPinned: participation.isPinned || false,
            notificationEnabled: participation.notificationEnabled !== false
          },
          lastMessage,
          unreadCount: participation.unreadCount || 0,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        };
        
        logger.info(`Formatted conversation ${conversation.id}`, {
          conversationId: conversation.id,
          hasLastMessage: !!conversationData.lastMessage,
          participantCount: conversationData.participants.length,
          unreadCount: conversationData.unreadCount
        });
        
        return conversationData;
      }));
      
      // Filter out null conversations
      const validConversations = conversations.filter(conv => conv !== null);
      
      logger.info('Conversation formatting completed', {
        totalProcessed: conversations.length,
        validConversations: validConversations.length,
        nullConversations: conversations.length - validConversations.length
      });
      
      const responseData = {
        success: true,
        conversations: validConversations,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: participations.length === parsedLimit
      };
      
      logger.info('Sending response', {
        userId,
        conversationCount: validConversations.length,
        hasMore: responseData.hasMore
      });
      
      res.json(responseData);
      
    } catch (error) {
      logger.error('Error in GET /conversations - detailed', {
        errorMessage: error.message,
        errorStack: error.stack,
        errorName: error.name,
        userId,
        originalError: error,
        errorType: error.constructor.name,
        isOperational: error.isOperational
      });
      
      if (error.name === 'SequelizeDatabaseError') {
        logger.error('Database error details', {
          sql: error.sql,
          parameters: error.parameters,
          table: error.table,
          fields: error.fields
        });
      }
      
      if (error.isOperational) {
        throw error;
      }
      
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
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;
      
      if (!Conversation || !ConversationParticipant || !Message || !User) {
        logger.error('Models not initialized in GET /:id', {
          hasConversation: !!Conversation,
          hasConversationParticipant: !!ConversationParticipant,
          hasMessage: !!Message,
          hasUser: !!User
        });
        throw new Error('Database models not initialized');
      }
      
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
          order: [['createdAt', 'DESC']],
          where: { deleted: false },
          required: false
        }]
      });
      
      if (!conversation) {
        throw createOperationalError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }
      
      // Get all participants with details
      const allParticipants = await ConversationParticipant.findAll({
        where: { conversationId: conversation.id },
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'avatar', 'role']
        }]
      });
      
      // Get presence info
      const participantIds = allParticipants.map(p => p.userId);
      const presenceMap = await redisService.getUsersPresence(participantIds);
      
      // Format participants
      const participants = allParticipants.map(p => ({
        userId: p.userId,
        role: p.user.role,
        joinedAt: p.joinedAt,
        isActive: !p.leftAt,
        name: p.user.name,
        avatar: p.user.avatar,
        isOnline: presenceMap[p.userId]?.isOnline || false,
        lastSeen: presenceMap[p.userId]?.lastSeen || null
      }));
      
      // Format last message
      let lastMessage = null;
      if (conversation.messages && conversation.messages[0]) {
        const message = conversation.messages[0];
        const sender = participants.find(p => p.userId === message.senderId);
        lastMessage = {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          sender: sender ? {
            id: sender.userId,
            name: sender.name,
            avatar: sender.avatar
          } : null,
          type: message.type,
          content: message.content,
          status: message.status,
          createdAt: message.createdAt
        };
      }
      
      res.json({
        success: true,
        conversation: {
          id: conversation.id,
          type: conversation.type || 'direct_message',
          participants,
          metadata: {
            jobId: conversation.jobId,
            jobTitle: conversation.jobTitle,
            status: conversation.status || 'active',
            createdBy: conversation.createdBy || conversation.participantIds[0],
            closedAt: conversation.closedAt
          },
          settings: {
            isMuted: participation.isMuted || false,
            isPinned: participation.isPinned || false,
            notificationEnabled: participation.notificationEnabled !== false
          },
          lastMessage,
          unreadCount: participation.unreadCount || 0,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
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
    const { 
      participantIds, 
      type = 'direct_message',
      jobId, 
      jobTitle,
      status = 'active' 
    } = req.body;
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
    
    // Validate type
    if (!['job_chat', 'direct_message'].includes(type)) {
      throw createOperationalError('Type must be either job_chat or direct_message', 400, 'INVALID_TYPE');
    }
    
    // Validate job info for job_chat
    if (type === 'job_chat' && !jobId) {
      throw createOperationalError('Job ID is required for job chat', 400, 'MISSING_JOB_ID');
    }
    
    // Validate status
    if (!['active', 'closed', 'archived'].includes(status)) {
      throw createOperationalError('Status must be active, closed, or archived', 400, 'INVALID_STATUS');
    }
    
    try {
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, User } = db;
      
      if (!Conversation || !ConversationParticipant || !User) {
        logger.error('Models not initialized in POST /', {
          hasConversation: !!Conversation,
          hasConversationParticipant: !!ConversationParticipant,
          hasUser: !!User
        });
        throw new Error('Database models not initialized');
      }
      
      // Ensure current user is included
      const allParticipantIds = [...new Set([userId, ...participantIds])];
      
      // Verify all participants exist
      const existingUsers = await User.findAll({
        where: { id: { [Op.in]: allParticipantIds } },
        attributes: ['id', 'name', 'avatar', 'role']
      });
      
      const existingUserIds = existingUsers.map(user => user.id);
      const missingUserIds = allParticipantIds.filter(id => !existingUserIds.includes(id));
      
      if (missingUserIds.length > 0) {
        throw createOperationalError(`Some participant IDs do not exist: ${missingUserIds.join(', ')}`, 400, 'INVALID_PARTICIPANTS');
      }
      
      // For direct messages, check if conversation already exists
      if (type === 'direct_message' && allParticipantIds.length === 2) {
        const existingConversations = await Conversation.findAll({
          where: {
            type: 'direct_message',
            participantIds: {
              [Op.contains]: allParticipantIds
            }
          }
        });
        
        const directConversation = existingConversations.find(c => 
          c.participantIds.length === 2 && 
          c.participantIds.every(id => allParticipantIds.includes(id))
        );
        
        if (directConversation) {
          throw createOperationalError('Direct conversation already exists between these users', 409, 'CONVERSATION_EXISTS');
        }
      }
      
      // Create conversation
      const conversationId = uuidv4();
      const conversationData = {
        id: conversationId,
        type,
        jobId: jobId || null,
        jobTitle: jobTitle || null,
        participantIds: allParticipantIds,
        status,
        createdBy: userId,
        lastMessageAt: new Date()
      };
      
      // Create conversation in database
      const conversation = await Conversation.create(conversationData);
      
      // Create participants records
      const participantRecords = allParticipantIds.map(pId => ({
        id: uuidv4(),
        conversationId,
        userId: pId,
        unreadCount: pId === userId ? 0 : 0, // Start with 0 for all
        joinedAt: new Date(),
        // Default settings
        isMuted: false,
        isPinned: false,
        notificationEnabled: true
      }));
      
      await ConversationParticipant.bulkCreate(participantRecords);
      
      // Format participants for response
      const participants = existingUsers
        .filter(user => allParticipantIds.includes(user.id))
        .map(user => ({
          userId: user.id,
          role: user.role,
          joinedAt: new Date(),
          isActive: true,
          name: user.name,
          avatar: user.avatar
        }));
      
      res.status(201).json({
        success: true,
        conversation: {
          id: conversationId,
          type,
          participants,
          metadata: {
            jobId: jobId || null,
            jobTitle: jobTitle || null,
            status,
            createdBy: userId,
            closedAt: null
          },
          settings: {
            isMuted: false,
            isPinned: false,
            notificationEnabled: true
          },
          lastMessage: null,
          unreadCount: 0,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
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

// Update conversation settings
router.patch('/:id/settings', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isMuted, isPinned, notificationEnabled } = req.body;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    // Validate at least one setting is provided
    if (isMuted === undefined && isPinned === undefined && notificationEnabled === undefined) {
      throw createOperationalError('At least one setting must be provided', 400, 'NO_SETTINGS_PROVIDED');
    }
    
    try {
      const db = require('../db/models');
      const { ConversationParticipant } = db;
      
      // Find participant record
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: id, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
      }
      
      // Update settings
      if (isMuted !== undefined) participation.isMuted = isMuted;
      if (isPinned !== undefined) participation.isPinned = isPinned;
      if (notificationEnabled !== undefined) participation.notificationEnabled = notificationEnabled;
      
      await participation.save();
      
      res.json({
        success: true,
        settings: {
          isMuted: participation.isMuted,
          isPinned: participation.isPinned,
          notificationEnabled: participation.notificationEnabled
        }
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to update conversation settings', error);
    }
  })
);

// Update conversation status
router.patch('/:id/status', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    if (!status) {
      throw createOperationalError('Status is required', 400, 'MISSING_STATUS');
    }
    
    if (!['active', 'closed', 'archived'].includes(status)) {
      throw createOperationalError('Invalid status. Must be active, closed, or archived', 400, 'INVALID_STATUS');
    }
    
    try {
      const db = require('../db/models');
      const { Conversation, ConversationParticipant } = db;
      
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
      
      // Update status
      const previousStatus = conversation.status;
      conversation.status = status;
      
      if (status === 'closed' && !conversation.closedAt) {
        conversation.closedAt = new Date();
      } else if (status === 'active' && conversation.closedAt) {
        conversation.closedAt = null;
      }
      
      await conversation.save();
      
      // Add system message about status change
      const systemMessage = {
        id: uuidv4(),
        conversationId: id,
        senderId: userId,
        receiverId: null,
        type: 'system',
        content: {
          text: `Conversation status changed from ${previousStatus} to ${status}`,
          systemAction: 'status_change',
          previousStatus,
          newStatus: status
        },
        status: 'sent',
        isSystemMessage: true
      };
      
      await queueService.enqueueMessage(systemMessage);
      
      res.json({
        success: true,
        conversation: {
          id: conversation.id,
          status: conversation.status,
          closedAt: conversation.closedAt
        }
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to update conversation status', error);
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
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, User } = db;
      
      if (!Conversation || !ConversationParticipant || !User) {
        logger.error('Models not initialized in POST /:id/participants', {
          hasConversation: !!Conversation,
          hasConversationParticipant: !!ConversationParticipant,
          hasUser: !!User
        });
        throw new Error('Database models not initialized');
      }
      
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
      
      // Check if conversation is closed/archived
      if (conversation.status !== 'active') {
        throw createOperationalError(`Cannot add participants to ${conversation.status} conversation`, 400, 'CONVERSATION_NOT_ACTIVE');
      }
      
      // Verify new participants exist
      const existingUsers = await User.findAll({
        where: { id: { [Op.in]: participantIds } },
        attributes: ['id', 'name', 'role']
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
      conversation.participantIds = updatedParticipantIds;
      await conversation.save();
      
      // Create participant records
      const participantRecords = newParticipantIds.map(pId => ({
        id: uuidv4(),
        conversationId: id,
        userId: pId,
        unreadCount: 0,
        joinedAt: new Date(),
        isMuted: false,
        isPinned: false,
        notificationEnabled: true
      }));
      
      await ConversationParticipant.bulkCreate(participantRecords);
      
      // Add system message
      const addedUsers = existingUsers.filter(user => newParticipantIds.includes(user.id));
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
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, User } = db;
      
      if (!Conversation || !ConversationParticipant || !User) {
        logger.error('Models not initialized in DELETE /:id/participants/:participantId', {
          hasConversation: !!Conversation,
          hasConversationParticipant: !!ConversationParticipant,
          hasUser: !!User
        });
        throw new Error('Database models not initialized');
      }
      
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
      
      conversation.participantIds = updatedParticipantIds;
      await conversation.save();
      
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
      const db = require('../db/models');
      const { ConversationParticipant, Message } = db;
      
      if (!ConversationParticipant || !Message) {
        logger.error('Models not initialized in POST /:id/read', {
          hasConversationParticipant: !!ConversationParticipant,
          hasMessage: !!Message
        });
        throw new Error('Database models not initialized');
      }
      
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: id, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
      }
      
      // Reset unread count and update last read time
      participation.unreadCount = 0;
      participation.lastReadAt = new Date();
      await participation.save();
      
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

// Delete/Archive conversation
router.delete('/:id', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { permanent = false } = req.query;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    try {
      const db = require('../db/models');
      const { Conversation, ConversationParticipant } = db;
      
      if (!Conversation || !ConversationParticipant) {
        logger.error('Models not initialized in DELETE /:id', {
          hasConversation: !!Conversation,
          hasConversationParticipant: !!ConversationParticipant
        });
        throw new Error('Database models not initialized');
      }
      
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
      
      if (permanent === 'true') {
        // Remove user from conversation permanently
        const updatedParticipantIds = conversation.participantIds.filter(pId => pId !== userId);
        
        if (updatedParticipantIds.length === 0) {
          // If this was the last participant, archive the conversation
          conversation.status = 'archived';
          conversation.deletedAt = new Date();
          await conversation.save();
        } else {
          // Update participant list
          conversation.participantIds = updatedParticipantIds;
          await conversation.save();
        }
        
        // Update participant record
        await ConversationParticipant.update(
          { leftAt: new Date() },
          { where: { conversationId: id, userId } }
        );
      } else {
        // Soft delete - just archive for the user
        conversation.status = 'archived';
        await conversation.save();
      }
      
      res.json({
        success: true,
        message: permanent === 'true' ? 'Left conversation permanently' : 'Conversation archived'
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to delete conversation', error);
    }
  })
);

// Search conversations
router.get('/search', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { query, limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;
    
    if (!query || query.trim().length < 2) {
      throw createOperationalError('Search query must be at least 2 characters', 400, 'INVALID_QUERY');
    }
    
    // Validate pagination
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw createOperationalError('Limit must be a number between 1 and 100', 400, 'INVALID_LIMIT');
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      throw createOperationalError('Offset must be a non-negative number', 400, 'INVALID_OFFSET');
    }
    
    try {
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, User, Message } = db;
      const { Sequelize } = db;
      
      // Search in conversations where user is a participant
      const participations = await ConversationParticipant.findAll({
        where: { userId },
        include: [{
          model: Conversation,
          as: 'conversation',
          where: {
            [Op.or]: [
              { jobTitle: { [Op.iLike]: `%${query}%` } },
              Sequelize.literal(`EXISTS (
                SELECT 1 FROM users u 
                WHERE u.id = ANY(conversation.participant_ids) 
                AND u.name ILIKE '%${query.replace(/'/g, "''")}%'
              )`)
            ]
          }
        }],
        limit: parsedLimit,
        offset: parsedOffset
      });
      
      // Format results
      const results = await Promise.all(participations.map(async (participation) => {
        const conversation = participation.conversation;
        if (!conversation) return null;
        
        // Get participants
        const allParticipants = await ConversationParticipant.findAll({
          where: { conversationId: conversation.id },
          include: [{
            model: User,
            as: 'user',
            attributes: ['id', 'name', 'avatar', 'role']
          }]
        });
        
        const participants = allParticipants.map(p => ({
          userId: p.userId,
          role: p.user.role,
          joinedAt: p.joinedAt,
          isActive: !p.leftAt,
          name: p.user.name,
          avatar: p.user.avatar
        }));
        
        return {
          id: conversation.id,
          type: conversation.type || 'direct_message',
          participants,
          metadata: {
            jobId: conversation.jobId,
            jobTitle: conversation.jobTitle,
            status: conversation.status || 'active',
            createdBy: conversation.createdBy || conversation.participantIds[0],
            closedAt: conversation.closedAt
          },
          settings: {
            isMuted: participation.isMuted || false,
            isPinned: participation.isPinned || false,
            notificationEnabled: participation.notificationEnabled !== false
          },
          unreadCount: participation.unreadCount || 0,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt
        };
      }));
      
      const validResults = results.filter(r => r !== null);
      
      res.json({
        success: true,
        conversations: validResults,
        total: validResults.length,
        limit: parsedLimit,
        offset: parsedOffset,
        query,
        hasMore: participations.length === parsedLimit
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to search conversations', error);
    }
  })
);

module.exports = router;