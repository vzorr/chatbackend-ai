// routes/users.js - CLEAN APPROACH
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');


const { authenticate } = require('../middleware/authentication');
const redisService = require('../services/redis');
const logger = require('../utils/logger');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

// ✅ BETTER: Direct import from exception handler
const { asyncHandler, createOperationalError, createSystemError } = require('../middleware/exceptionHandler');

// Register new user
router.post('/register', 
  asyncHandler(async (req, res) => {
    const { email, name, password, phone } = req.body;

    // Validate required fields
    if (!email || !password || !phone) {
      logger.warn('Missing required fields in registration request');
      throw createOperationalError('Email, phone, and password are required', 400, 'MISSING_REQUIRED_FIELDS');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw createOperationalError('Invalid email format', 400, 'INVALID_EMAIL_FORMAT');
    }

    // Validate password strength
    /*if (password.length < 6) {
      throw createOperationalError('Password must be at least 6 characters long', 400, 'WEAK_PASSWORD');
    }*/

    // Validate phone format (basic check)
    if (phone.length < 10) {
      throw createOperationalError('Phone number must be at least 10 digits', 400, 'INVALID_PHONE_FORMAT');
    }

    // Validate name if provided
    if (name && (typeof name !== 'string' || name.trim().length === 0)) {
      throw createOperationalError('Name must be a valid string', 400, 'INVALID_NAME');
    }

    try {
  
      // Verify user is a participant
           // Lazy load models
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;


      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        logger.warn(`Registration attempt with existing email: ${email}`);
        throw createOperationalError('Email already in use', 409, 'EMAIL_EXISTS');
      }

      // Check if phone already exists
      const existingPhone = await User.findOne({ where: { phone } });
      if (existingPhone) {
        logger.warn(`Registration attempt with existing phone: ${phone}`);
        throw createOperationalError('Phone number already in use', 409, 'PHONE_EXISTS');
      }

      // Hash password
     /* const hashedPassword = await bcrypt.hash(password, 10);

      // Create new user
      const newUser = await User.create({
        id: uuidv4(),
        email: email.toLowerCase().trim(),
        name: name ? name.trim() : null,
        phone: phone.trim(),
        password: hashedPassword,
        role: 'customer', // Default role
        isOnline: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
     */
      logger.info(`New user registered: ${email}`);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          phone: newUser.phone
        }
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }

      if (error.name === 'SequelizeUniqueConstraintError') {
        const field = error.errors[0]?.path || 'field';
        throw createOperationalError(`${field} already exists`, 409, 'DUPLICATE_FIELD');
      }

      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(`Validation failed: ${details}`, 400, 'VALIDATION_ERROR');
      }

      logger.error('Error in /users/register route', { error: error.message });
      throw createSystemError('Failed to register user', error);
    }
  })
);

// Sync user from main app using JWT
router.post('/sync', 
  asyncHandler(async (req, res) => {
    const { token } = req.body;

    if (!token) {
      throw createOperationalError('Token is required', 400, 'MISSING_TOKEN');
    }

    if (typeof token !== 'string' || token.trim().length === 0) {
      throw createOperationalError('Token must be a valid string', 400, 'INVALID_TOKEN_FORMAT');
    }

    try {
   
      // Verify and decode token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      const externalId = decoded.id || decoded.userId;
      const name = decoded.name || decoded.fullname;
      const email = decoded.email;
      const phone = decoded.phone || decoded.phonenumber || decoded.mobile;
      const role = decoded.role || 'customer';

      if (!externalId) {
        throw createOperationalError('Invalid token: missing user ID', 400, 'INVALID_TOKEN_STRUCTURE');
      }

      // Validate role if provided
      const validRoles = ['customer', 'usta', 'administrator'];
      const normalizedRole = role.toLowerCase();
      if (!validRoles.includes(normalizedRole)) {
        throw createOperationalError(`Invalid role. Must be one of: ${validRoles.join(', ')}`, 400, 'INVALID_ROLE');
      }

      
    
      const { User, ConversationParticipant, Conversation } = require('../db/models');

      // Find or create user
      let user = await User.findOne({ where: { externalId } });

      if (!user) {
        // Create new user
        user = await User.create({
          id: uuidv4(),
          externalId,
          email: email || null,
          name: name || null,
          phone: phone || null,
          role: normalizedRole,
          isOnline: false,
          metaData: {
            source: 'sync',
            syncedAt: new Date().toISOString(),
            originalToken: {
              iat: decoded.iat,
              exp: decoded.exp
            }
          }
        });
        
        logger.info(`User synced from main app and created: ${externalId}`);
      } else {
        // Update existing user with new data
        const updateData = {
          updatedAt: new Date()
        };

        if (email && email !== user.email) updateData.email = email;
        if (name && name !== user.name) updateData.name = name;
        if (phone && phone !== user.phone) updateData.phone = phone;
        if (normalizedRole !== user.role) updateData.role = normalizedRole;

        // Update metadata
        updateData.metaData = {
          ...user.metaData,
          lastSyncAt: new Date().toISOString(),
          syncCount: (user.metaData?.syncCount || 0) + 1
        };

        await user.update(updateData);
        logger.info(`User data updated during sync: ${externalId}`);
      }

      res.status(200).json({
        success: true,
        message: 'User sync successful',
        user: {
          id: user.id,
          externalId: user.externalId,
          email: user.email,
          name: user.name,
          phone: user.phone,
          role: user.role
        }
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw createOperationalError('Token has expired', 401, 'TOKEN_EXPIRED');
      }

      if (error.name === 'JsonWebTokenError') {
        throw createOperationalError('Invalid token format', 401, 'INVALID_TOKEN');
      }

      if (error.isOperational) {
        throw error;
      }

      logger.error('Error syncing user from main app', { error: error.message });
      throw createSystemError('Failed to sync user from main app', error);
    }
  })
);

// Get user list
router.get('/', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { search, limit = 20, offset = 0, role, online } = req.query;
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

    // Validate role filter
    if (role && !['customer', 'usta', 'administrator'].includes(role.toLowerCase())) {
      throw createOperationalError('Invalid role filter. Must be one of: customer, usta, administrator', 400, 'INVALID_ROLE_FILTER');
    }

    // Validate online filter
    if (online && !['true', 'false'].includes(online.toLowerCase())) {
      throw createOperationalError('Online filter must be "true" or "false"', 400, 'INVALID_ONLINE_FILTER');
    }
    
    try {


      // Verify user is a participant
           // Lazy load models
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;
      // Build query conditions
      const where = {
        id: { [Op.ne]: userId } // Exclude current user
      };
      
      // Add search filter if provided
      if (search && search.trim().length > 0) {
        const searchTerm = search.trim();
        where[Op.or] = [
          { name: { [Op.iLike]: `%${searchTerm}%` } },
          { phone: { [Op.iLike]: `%${searchTerm}%` } },
          { email: { [Op.iLike]: `%${searchTerm}%` } }
        ];
      }

      // Add role filter
      if (role) {
        where.role = role.toLowerCase();
      }

      // Add online filter
      if (online) {
        where.isOnline = online.toLowerCase() === 'true';
      }
      
      // Query users
      const { count, rows: users } = await User.findAndCountAll({
        where,
        attributes: ['id', 'name', 'phone', 'email', 'avatar', 'role', 'isOnline', 'lastSeen'],
        limit: parsedLimit,
        offset: parsedOffset,
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
        success: true,
        users: enrichedUsers,
        total: count,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: (parsedOffset + users.length) < count
      });
    } catch (error) {
      throw createSystemError('Failed to retrieve users', error);
    }
  })
);

// Get user by ID
// Get user by ID - Updated to handle user existence checks better
router.get('/:id', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    if (!id) {
      throw createOperationalError('User ID is required', 400, 'MISSING_USER_ID');
    }

    // Basic UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw createOperationalError('Invalid user ID format', 400, 'INVALID_USER_ID_FORMAT');
    }
    
    try {
      // Lazy load models
      const db = require('../db/models');
      const { User } = db;

      // Try to find user by ID first
      let user = await User.findByPk(id, {
        attributes: ['id', 'externalId', 'name', 'phone', 'email', 'avatar', 'role', 'isOnline', 'lastSeen', 'createdAt', 'updatedAt']
      });
      
      // If not found by ID, try by externalId
      if (!user) {
        user = await User.findOne({
          where: { externalId: id },
          attributes: ['id', 'externalId', 'name', 'phone', 'email', 'avatar', 'role', 'isOnline', 'lastSeen', 'createdAt', 'updatedAt']
        });
      }
      
      if (!user) {
        // Return 404 instead of throwing error for user existence checks
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            statusCode: 404
          }
        });
      }
      
      // Don't get Redis presence for simple existence checks
      // This might be causing issues
      const userData = user.toJSON();
      
      res.json({ 
        success: true,
        user: userData 
      });
    } catch (error) {
      // Log the error but don't expose internal errors
      logger.error('Error in GET /users/:id', { 
        error: error.message, 
        stack: error.stack,
        userId: id 
      });
      
      // Return 404 for any database errors during user check
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_CHECK_FAILED',
          message: 'Failed to check user existence',
          statusCode: 404
        }
      });
    }
  })
);

// Get users by conversation
router.get('/by-conversation/:conversationId', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const userId = req.user.id;
    
    if (!conversationId) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }

    // Basic UUID format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(conversationId)) {
      throw createOperationalError('Invalid conversation ID format', 400, 'INVALID_CONVERSATION_ID_FORMAT');
    }
    
    try {
      
      // Verify user is a participant
           // Lazy load models
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;

      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
      }
      
      // Get conversation to get participant IDs
      const conversation = await Conversation.findByPk(conversationId);
      
      if (!conversation) {
        throw createOperationalError('Conversation not found', 404, 'CONVERSATION_NOT_FOUND');
      }
      
      if (!conversation.participantIds || conversation.participantIds.length === 0) {
        return res.json({ 
          success: true,
          users: [],
          count: 0
        });
      }
      
      // Get users
      const users = await User.findAll({
        where: { id: { [Op.in]: conversation.participantIds } },
        attributes: ['id', 'name', 'phone', 'email', 'avatar', 'role', 'isOnline', 'lastSeen']
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
      
      res.json({ 
        success: true,
        users: enrichedUsers,
        count: enrichedUsers.length
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve conversation users', error);
    }
  })
);

// Get online status for multiple users
router.post('/status', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { userIds } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      throw createOperationalError('User IDs array is required and cannot be empty', 400, 'INVALID_USER_IDS');
    }

    if (userIds.length > 100) {
      throw createOperationalError('Cannot check status for more than 100 users at once', 400, 'TOO_MANY_USER_IDS');
    }

    // Validate user ID formats
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const userId of userIds) {
      if (typeof userId !== 'string' || !uuidRegex.test(userId)) {
        throw createOperationalError('All user IDs must be valid UUID strings', 400, 'INVALID_USER_ID_FORMAT');
      }
    }
    
    try {

      
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
      
      res.json({ 
        success: true,
        statuses: statusMap,
        count: Object.keys(statusMap).length
      });
    } catch (error) {
      throw createSystemError('Failed to retrieve user statuses', error);
    }
  })
);

/**
 * @route PUT /api/v1/users/profile
 * @desc Update user profile
 * @access Private
 */
router.put('/profile', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { name, avatar, phone } = req.body;
    const userId = req.user.id;

    // Validate at least one field is provided
    if (name === undefined && avatar === undefined && phone === undefined) {
      throw createOperationalError('At least one field (name, avatar, or phone) must be provided', 400, 'NO_UPDATE_FIELDS');
    }

    // Validate name if provided
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      throw createOperationalError('Name must be a valid non-empty string', 400, 'INVALID_NAME');
    }

    // Validate phone if provided
    if (phone !== undefined) {
      if (typeof phone !== 'string' || phone.trim().length < 10) {
        throw createOperationalError('Phone number must be at least 10 digits', 400, 'INVALID_PHONE');
      }
    }

    // Validate avatar URL if provided
    if (avatar !== undefined) {
      if (typeof avatar !== 'string' || (avatar.trim().length > 0 && !avatar.startsWith('http'))) {
        throw createOperationalError('Avatar must be a valid URL or empty string', 400, 'INVALID_AVATAR_URL');
      }
    }

    try {
      // Verify user is a participant
           // Lazy load models
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;

      // Check if phone is already taken by another user
      if (phone !== undefined && phone.trim().length > 0) {
        const existingUser = await User.findOne({
          where: {
            phone: phone.trim(),
            id: { [Op.ne]: userId }
          }
        });

        if (existingUser) {
          throw createOperationalError('Phone number is already in use by another user', 409, 'PHONE_EXISTS');
        }
      }

      // Build update object
      const updateData = {
        updatedAt: new Date()
      };

      if (name !== undefined) updateData.name = name.trim();
      if (phone !== undefined) updateData.phone = phone.trim();
      if (avatar !== undefined) updateData.avatar = avatar.trim() || null;

      // Update user
      const [updatedRowsCount] = await User.update(updateData, {
        where: { id: userId }
      });

      if (updatedRowsCount === 0) {
        throw createOperationalError('User not found', 404, 'USER_NOT_FOUND');
      }

      // Get updated user data
      const updatedUser = await User.findByPk(userId, {
        attributes: ['id', 'name', 'phone', 'email', 'avatar', 'role', 'updatedAt']
      });

      logger.info(`User profile updated: ${userId}`);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        user: updatedUser
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }

      if (error.name === 'SequelizeUniqueConstraintError') {
        throw createOperationalError('Phone number is already in use', 409, 'PHONE_EXISTS');
      }

      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(`Validation failed: ${details}`, 400, 'VALIDATION_ERROR');
      }

      throw createSystemError('Failed to update user profile', error);
    }
  })
);

/**
 * @route POST /api/v1/users/change-password
 * @desc Change user password
 * @access Private
 */
router.post('/change-password', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      throw createOperationalError('Current password and new password are required', 400, 'MISSING_PASSWORDS');
    }

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      throw createOperationalError('Passwords must be strings', 400, 'INVALID_PASSWORD_TYPE');
    }

    if (newPassword.length < 6) {
      throw createOperationalError('New password must be at least 6 characters long', 400, 'WEAK_PASSWORD');
    }

    if (currentPassword === newPassword) {
      throw createOperationalError('New password must be different from current password', 400, 'SAME_PASSWORD');
    }

    try {

      // Verify user is a participant
           // Lazy load models
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;
      
      // Get user with password
      const user = await User.findByPk(userId, {
        attributes: ['id', 'password']
      });

      if (!user) {
        throw createOperationalError('User not found', 404, 'USER_NOT_FOUND');
      }

      if (!user.password) {
        throw createOperationalError('Password not set for this user. Please contact support.', 400, 'NO_PASSWORD_SET');
      }

      // Verify current password
      const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isCurrentPasswordValid) {
        throw createOperationalError('Current password is incorrect', 401, 'INVALID_CURRENT_PASSWORD');
      }

      // Hash new password
      const hashedNewPassword = await bcrypt.hash(newPassword, 10);

      // Update password
      await User.update(
        { 
          password: hashedNewPassword,
          updatedAt: new Date()
        },
        { where: { id: userId } }
      );

      logger.info(`Password changed for user: ${userId}`);

      res.json({
        success: true,
        message: 'Password changed successfully'
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to change password', error);
    }
  })
);

/**
 * @route GET /api/v1/users/search
 * @desc Search users with advanced filters
 * @access Private
 */
router.get('/search', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { 
      q, // search query
      role, 
      online, 
      limit = 20, 
      offset = 0,
      sortBy = 'name',
      sortOrder = 'ASC'
    } = req.query;
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

    // Validate search query
    if (q && (typeof q !== 'string' || q.trim().length < 2)) {
      throw createOperationalError('Search query must be at least 2 characters', 400, 'INVALID_SEARCH_QUERY');
    }

    // Validate sort parameters
    const validSortFields = ['name', 'email', 'phone', 'role', 'createdAt', 'lastSeen'];
    if (!validSortFields.includes(sortBy)) {
      throw createOperationalError(`Invalid sortBy field. Must be one of: ${validSortFields.join(', ')}`, 400, 'INVALID_SORT_FIELD');
    }

    const validSortOrders = ['ASC', 'DESC'];
    if (!validSortOrders.includes(sortOrder.toUpperCase())) {
      throw createOperationalError('Sort order must be ASC or DESC', 400, 'INVALID_SORT_ORDER');
    }

    // Validate role filter
    if (role && !['customer', 'usta', 'administrator'].includes(role.toLowerCase())) {
      throw createOperationalError('Invalid role filter. Must be one of: customer, usta, administrator', 400, 'INVALID_ROLE_FILTER');
    }

    // Validate online filter
    if (online && !['true', 'false'].includes(online.toLowerCase())) {
      throw createOperationalError('Online filter must be "true" or "false"', 400, 'INVALID_ONLINE_FILTER');
    }

    try {

      // Verify user is a participant
           // Lazy load models
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;


      // Build query conditions
      const where = {
        id: { [Op.ne]: userId } // Exclude current user
      };

      // Add search filter
      if (q && q.trim().length > 0) {
        const searchTerm = q.trim();
        where[Op.or] = [
          { name: { [Op.iLike]: `%${searchTerm}%` } },
          { phone: { [Op.iLike]: `%${searchTerm}%` } },
          { email: { [Op.iLike]: `%${searchTerm}%` } }
        ];
      }

      // Add role filter
      if (role) {
        where.role = role.toLowerCase();
      }

      // Add online filter
      if (online) {
        where.isOnline = online.toLowerCase() === 'true';
      }

      // Execute search
      const { count, rows: users } = await User.findAndCountAll({
        where,
        attributes: ['id', 'name', 'phone', 'email', 'avatar', 'role', 'isOnline', 'lastSeen', 'createdAt'],
        limit: parsedLimit,
        offset: parsedOffset,
        order: [[sortBy, sortOrder.toUpperCase()]]
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

      res.json({
        success: true,
        users: enrichedUsers,
        total: count,
        limit: parsedLimit,
        offset: parsedOffset,
        hasMore: (parsedOffset + users.length) < count,
        query: q || '',
        filters: {
          role: role || null,
          online: online || null
        },
        sort: {
          field: sortBy,
          order: sortOrder.toUpperCase()
        }
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to search users', error);
    }
  })
);

/**
 * @route GET /api/v1/users/me
 * @desc Get current user profile
 * @access Private
 */
router.get('/me', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;

    try {

      // Verify user is a participant
           // Lazy load models
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;

      const user = await User.findByPk(userId, {
        attributes: [
          'id', 'externalId', 'name', 'phone', 'email', 
          'avatar', 'role', 'isOnline', 'lastSeen', 
          'createdAt', 'updatedAt'
        ]
      });

      if (!user) {
        throw createOperationalError('User profile not found', 404, 'USER_NOT_FOUND');
      }

      // Get presence info from Redis
      const presence = await redisService.getUserPresence(userId);

      const userData = {
        ...user.toJSON(),
        isOnline: presence ? presence.isOnline : user.isOnline,
        lastSeen: presence && presence.lastSeen ? presence.lastSeen : user.lastSeen
      };

      res.json({
        success: true,
        user: userData
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve user profile', error);
    }
  })
);

/**
 * @route POST /api/v1/users/bulk-status
 * @desc Get status for multiple users with additional info
 * @access Private
 */
router.post('/bulk-status', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { userIds, includeDetails = false } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      throw createOperationalError('User IDs array is required and cannot be empty', 400, 'INVALID_USER_IDS');
    }

    if (userIds.length > 100) {
      throw createOperationalError('Cannot check status for more than 100 users at once', 400, 'TOO_MANY_USER_IDS');
    }

    // Validate user ID formats
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    for (const userId of userIds) {
      if (typeof userId !== 'string' || !uuidRegex.test(userId)) {
        throw createOperationalError('All user IDs must be valid UUID strings', 400, 'INVALID_USER_ID_FORMAT');
      }
    }

    try {

      // Verify user is a participant
           // Lazy load models
      const db = require('../db/models');
      const { Conversation, ConversationParticipant, Message, User } = db;
      // Get presence info from Redis
      const presenceMap = await redisService.getUsersPresence(userIds);

      let userDetails = {};
      if (includeDetails) {
        // Get basic user details if requested
        const users = await User.findAll({
          where: { id: { [Op.in]: userIds } },
          attributes: ['id', 'name', 'avatar', 'role']
        });

        userDetails = users.reduce((map, user) => {
          map[user.id] = {
            name: user.name,
            avatar: user.avatar,
            role: user.role
          };
          return map;
        }, {});
      }

      // Format response
      const statusMap = {};
      userIds.forEach(userId => {
        const presence = presenceMap[userId];
        statusMap[userId] = {
          isOnline: presence ? presence.isOnline : false,
          lastSeen: presence && presence.lastSeen ? presence.lastSeen : null,
          ...(includeDetails && userDetails[userId] ? userDetails[userId] : {})
        };
      });

      res.json({
        success: true,
        statuses: statusMap,
        count: Object.keys(statusMap).length,
        includeDetails
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve bulk user statuses', error);
    }
  })
);

module.exports = router;