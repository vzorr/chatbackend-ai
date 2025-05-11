// routes/conversations.js
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
const authenticate = require('../middleware/authenticate');
const redisService = require('../services/redis');
const queueService = require('../services/queue');

// Get all conversations for current user
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;
    
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
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    // Get unread counts
    const unreadCounts = await redisService.getUnreadCounts(userId);
    
    // Format response
    const conversations = await Promise.all(participations.map(async (participation) => {
      const conversation = participation.conversation;
      
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
    
    res.json({
      conversations,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    next(error);
  }
});

// Get single conversation
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Verify user is a participant
    const participation = await ConversationParticipant.findOne({
      where: { conversationId: id, userId }
    });
    
    if (!participation) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
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
      return res.status(404).json({ error: 'Conversation not found' });
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
    next(error);
  }
});

// Create new conversation
router.post('/', authenticate, async (req, res, next) => {
  try {
    const { participantIds, jobId, jobTitle } = req.body;
    const userId = req.user.id;
    
    // Validate participants
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: 'Participant IDs array is required' });
    }
    
    // Ensure current user is included
    const allParticipantIds = [...new Set([userId, ...participantIds])];
    
    // Create conversation
    const conversationId = uuidv4();
    const conversationData = {
      id: conversationId,
      jobId,
      jobTitle,
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
      conversation: {
        id: conversationId,
        jobId,
        jobTitle,
        participantIds: allParticipantIds,
        participants: participantUsers,
        lastMessageAt: new Date(),
        unreadCount: 0
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// Add participants to conversation
router.post('/:id/participants', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { participantIds } = req.body;
    const userId = req.user.id;
    
    // Validate
    if (!participantIds || !Array.isArray(participantIds) || participantIds.length === 0) {
      return res.status(400).json({ error: 'Participant IDs array is required' });
    }
    
    // Verify user is a participant
    const participation = await ConversationParticipant.findOne({
      where: { conversationId: id, userId }
    });
    
    if (!participation) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }
    
    // Get conversation
    const conversation = await Conversation.findByPk(id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Add new participants
    const newParticipantIds = [...new Set(participantIds)].filter(pId => 
      !conversation.participantIds.includes(pId)
    );
    
    if (newParticipantIds.length === 0) {
      return res.status(400).json({ error: 'All users are already participants' });
    }
    
    // Update conversation participants
    const updatedParticipantIds = [...conversation.participantIds, ...newParticipantIds];
    
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
      addedParticipantIds: newParticipantIds
    });
    
  } catch (error) {
    next(error);
  }
});

// Remove participant from conversation
router.delete('/:id/participants/:participantId', authenticate, async (req, res, next) => {
  try {
    const { id, participantId } = req.params;
    const userId = req.user.id;
    
    // Verify current user is a participant
    const participation = await ConversationParticipant.findOne({
      where: { conversationId: id, userId }
    });
    
    if (!participation) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }
    
    // Check if removing self or another user
    const isSelf = userId === participantId;
    
    // Get conversation
    const conversation = await Conversation.findByPk(id);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Verify target is a participant
    if (!conversation.participantIds.includes(participantId)) {
      return res.status(400).json({ error: 'User is not a participant' });
    }
    
    // Update conversation participants
    const updatedParticipantIds = conversation.participantIds.filter(id => id !== participantId);
    
    // Prevent removing last participant
    if (updatedParticipantIds.length === 0) {
      return res.status(400).json({ error: 'Cannot remove last participant' });
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
      success: true
    });
    
  } catch (error) {
    next(error);
  }
});

// Mark conversation as read
router.post('/:id/read', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Verify user is a participant
    const participation = await ConversationParticipant.findOne({
      where: { conversationId: id, userId }
    });
    
    if (!participation) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }
    
    // Reset unread count in participant record
    await ConversationParticipant.update(
      { unreadCount: 0 },
      { where: { conversationId: id, userId } }
    );
    
    // Reset Redis unread count
    await redisService.resetUnreadCount(userId, id);
    
    // Mark all unread messages as read
    await Message.update(
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
      success: true
    });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;
