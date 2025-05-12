// routes/users.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { User, ConversationParticipant, Conversation } = require('../db/models');
const authenticate = require('../middleware/authentication');
const redisService = require('../services/redis');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');


// Register new user
router.post('/register', async (req, res, next) => {
  try {
    const { email, name, password, phone } = req.body;

    if (!email || !password || !phone) {
      logger.warn('Missing required fields in registration request');
      return res.status(400).json({ error: 'Email, phone, and password are required' });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      logger.warn(`Registration attempt with existing email: ${email}`);
      return res.status(409).json({ error: 'Email already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      id: uuidv4(),
      email,
      name,
      phone,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name
      }
    });
  } catch (error) {
    logger.error('Error in /users/register route', { error });
    next(error);
  }
});

// Sync user from main app using JWT
router.post('/sync', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const externalId = decoded.id || decoded.userId;
    const name = decoded.name || decoded.fullname;
    const email = decoded.email;
    const phone = decoded.phone || decoded.phonenumber || decoded.mobile;
    const app = decoded.app || decoded.application;

    if (!externalId) {
      return res.status(400).json({ error: 'Invalid token: missing user ID' });
    }

    let user = await User.findOne({ where: { externalId } });

    if (!user) {
      user = await User.create({
        id: externalId,
        externalId,
        email: email || null,
        name:  name || null,
        phone:  phone || null,
        //role: decoded.role || 'client',
        isOnline: false
      });
      logger.info(`User synced from main app and created: ${externalId}`);
    } else {
      logger.info(`User already exists: ${externalId}`);
    }

    res.status(200).json({
      message: 'User sync successful',
      user: {
        id: user.id,
        externalId: user.externalId,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    logger.error('Error syncing user from main app', { error });
    next(error);
  }
});

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
