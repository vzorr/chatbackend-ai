// routes/users.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { User, ConversationParticipant, Conversation } = require('../db/models');
const authenticate = require('../middleware/authenticate');
const redisService = require('../services/redis');

// Get user list
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { search, limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;
    
    // Build query conditions
    const where = {
      id: { [Op.ne]: userId } // Exclude current user
    };
    
    // Add search filter if provided
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    // Query users
    const users = await User.findAll({
      where,
      attributes: ['id', 'name', 'phone', 'avatar', 'isOnline', 'lastSeen'],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [
        ['isOnline', 'DESC'],
        ['lastSeen', 'DESC'],
        ['name', 'ASC']
      ]
    });
    
    // Get presence info from Redis for more accurate status
    const userIds = users.map(user => user.id);
    const presenceMap = await redisService.getUsersPresence(userIds);
    
    // Enrich users with Redis presence data
    const enrichedUsers = users.map(user => {
      const presence = presenceMap[user.id];
      return {
        ...user.toJSON(),
        isOnline: presence ? presence.isOnline : user.isOnline,
        lastSeen: presence && presence.lastSeen ? presence.lastSeen : user.lastSeen
      };
    });
    
    res.json({
      users: enrichedUsers,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    next(error);
  }
});

// Get user by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const user = await User.findByPk(id, {
      attributes: ['id', 'name', 'phone', 'avatar', 'isOnline', 'lastSeen']
    });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Get presence info from Redis for more accurate status
    const presence = await redisService.getUserPresence(id);
    
    const userData = {
      ...user.toJSON(),
      isOnline: presence ? presence.isOnline : user.isOnline,
      lastSeen: presence && presence.lastSeen ? presence.lastSeen : user.lastSeen
    };
    
    res.json({ user: userData });
    
  } catch (error) {
    next(error);
  }
});

// Get users by conversation
router.get('/by-conversation/:conversationId', authenticate, async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user.id;
    
    // Verify user is a participant
    const participation = await ConversationParticipant.findOne({
      where: { conversationId, userId }
    });
    
    if (!participation) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }
    
    // Get conversation to get participant IDs
    const conversation = await Conversation.findByPk(conversationId);
    
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    
    // Get users
    const users = await User.findAll({
      where: { id: { [Op.in]: conversation.participantIds } },
      attributes: ['id', 'name', 'phone', 'avatar', 'isOnline', 'lastSeen']
    });
    
    // Get presence info from Redis
    const userIds = users.map(user => user.id);
    const presenceMap = await redisService.getUsersPresence(userIds);
    
    // Enrich users with Redis presence data
    const enrichedUsers = users.map(user => {
      const presence = presenceMap[user.id];
      return {
        ...user.toJSON(),
        isOnline: presence ? presence.isOnline : user.isOnline,
        lastSeen: presence && presence.lastSeen ? presence.lastSeen : user.lastSeen
      };
    });
    
    res.json({ users: enrichedUsers });
    
  } catch (error) {
    next(error);
  }
});

// Get online status for multiple users
router.post('/status', authenticate, async (req, res, next) => {
  try {
    const { userIds } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: 'User IDs array is required' });
    }
    
    // Get presence info from Redis
    const presenceMap = await redisService.getUsersPresence(userIds);
    
    // Format response
    const statusMap = {};
    userIds.forEach(userId => {
      const presence = presenceMap[userId];
      statusMap[userId] = {
        isOnline: presence ? presence.isOnline : false,
        lastSeen: presence && presence.lastSeen ? presence.lastSeen : null
      };
    });
    
    res.json({ statuses: statusMap });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;
