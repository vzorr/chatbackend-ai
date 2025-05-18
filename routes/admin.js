const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { User, Message, Conversation } = require('../db/models');
const { authenticate } = require('../middleware/authentication');
const { validateUUID } = require('../utils/validation');
const logger = require('../utils/logger');

// Admin authorization middleware - Updated for new administrator role
const authorizeAdmin = async (req, res, next) => {
  if (req.user.role !== 'administrator') {
    return res.status(403).json({ error: 'Forbidden: Administrator access required' });
  }
  next();
};

// Get system stats
router.get('/stats', authenticate, authorizeAdmin, async (req, res, next) => {
  try {
    const userCount = await User.count();
    const messageCount = await Message.count();
    const conversationCount = await Conversation.count();
    
    // Last 24 hours activity
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const newUsers = await User.count({
      where: { createdAt: { [Op.gte]: yesterday } }
    });
    
    const newMessages = await Message.count({
      where: { createdAt: { [Op.gte]: yesterday } }
    });
    
    const activeUsers = await User.count({
      where: { lastSeen: { [Op.gte]: yesterday } }
    });

    // Role distribution - updated for new roles
    const roleDistribution = await User.findAll({
      attributes: ['role', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['role']
    });
    
    res.json({
      totalStats: {
        users: userCount,
        messages: messageCount,
        conversations: conversationCount
      },
      last24Hours: {
        newUsers,
        activeUsers,
        messagesSent: newMessages
      },
      roleDistribution: roleDistribution.reduce((acc, item) => {
        acc[item.role] = parseInt(item.get('count'));
        return acc;
      }, {}),
      timestamp: new Date()
    });
    
  } catch (error) {
    next(error);
  }
});
// Get all users with filtering and pagination - updated for new roles
router.get('/users', authenticate, authorizeAdmin, async (req, res, next) => {
  try {
    const { 
      search, 
      role, // Now accepts customer, usta, administrator
      isOnline, 
      sortBy = 'createdAt', 
      sortOrder = 'DESC',
      limit = 20, 
      offset = 0 
    } = req.query;
    
    // Build where clause
    const where = {};
    
    if (search) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { phone: { [Op.iLike]: `%${search}%` } }
      ];
    }
    
    if (role) {
      // Validate role
      if (!['customer', 'usta', 'administrator'].includes(role)) {
        return res.status(400).json({ 
          error: 'Invalid role filter. Must be one of: customer, usta, administrator' 
        });
      }
      where.role = role;
    }
    
    if (isOnline !== undefined) {
      where.isOnline = isOnline === 'true';
    }
    
    // Validate sort options
    const validSortFields = ['name', 'createdAt', 'lastSeen'];
    const validSortOrders = ['ASC', 'DESC'];
    
    const actualSortBy = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
    const actualSortOrder = validSortOrders.includes(sortOrder.toUpperCase()) 
      ? sortOrder.toUpperCase() : 'DESC';
    
    // Execute query
    const users = await User.findAndCountAll({
      where,
      order: [[actualSortBy, actualSortOrder]],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      users: users.rows,
      total: users.count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    next(error);
  }
});

// Update user - updated for new roles
router.put('/users/:id', authenticate, authorizeAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role, isActive } = req.body;
    
    if (!validateUUID(id)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    const user = await User.findByPk(id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update fields
    const updates = {};
    if (name !== undefined) updates.name = name;
    
    // Validate role if provided
    if (role !== undefined) {
      if (!['customer', 'usta', 'administrator'].includes(role)) {
        return res.status(400).json({ 
          error: 'Invalid role. Must be one of: customer, usta, administrator' 
        });
      }
      updates.role = role;
    }
    
    if (isActive !== undefined) updates.isActive = isActive;
    
    await user.update(updates);
    
    res.json({
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
        avatar: user.avatar,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
    
  } catch (error) {
    next(error);
  }
});
// Delete user
router.delete('/users/:id', authenticate, authorizeAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!validateUUID(id)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }
    
    const user = await User.findByPk(id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await user.destroy();
    
    res.json({
      success: true,
      message: `User ${id} deleted successfully`
    });
    
  } catch (error) {
    next(error);
  }
});

// Message monitoring
router.get('/messages', authenticate, authorizeAdmin, async (req, res, next) => {
  try {
    const { 
      conversationId, 
      userId,
      startDate,
      endDate,
      limit = 50, 
      offset = 0 
    } = req.query;
    
    // Build where clause
    const where = {};
    
    if (conversationId) {
      where.conversationId = conversationId;
    }
    
    if (userId) {
      where[Op.or] = [
        { senderId: userId },
        { receiverId: userId }
      ];
    }
    
    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      
      if (startDate) {
        where.createdAt[Op.gte] = new Date(startDate);
      }
      
      if (endDate) {
        where.createdAt[Op.lte] = new Date(endDate);
      }
    }
    
    // Execute query
    const messages = await Message.findAndCountAll({
      where,
      include: [
        { model: User, as: 'sender', attributes: ['id', 'name', 'phone'] },
        { model: User, as: 'receiver', attributes: ['id', 'name', 'phone'] }
      ],
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      messages: messages.rows,
      total: messages.count,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;