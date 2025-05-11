// routes/messages.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { 
  Message, 
  MessageVersion, 
  Conversation, 
  ConversationParticipant,
  User 
} = require('../db/models');
const authenticate = require('../middleware/authenticate');
const redisService = require('../services/redis');
const queueService = require('../services/queue');

// Get messages for a conversation
router.get('/conversation/:conversationId', authenticate, async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { limit = 50, before, after } = req.query;
    const userId = req.user.id;
    
    // Verify user is a participant
    const participation = await ConversationParticipant.findOne({
      where: { conversationId, userId }
    });
    
    if (!participation) {
      return res.status(403).json({ error: 'Not a participant in this conversation' });
    }
    
    // Build query
    const where = { 
      conversationId,
      deleted: false
    };
    
    // Add time filters
    if (before) {
      where.createdAt = { ...where.createdAt, [Op.lt]: new Date(before) };
    }
    
    if (after) {
      where.createdAt = { ...where.createdAt, [Op.gt]: new Date(after) };
    }
    
    // Get messages
    const messages = await Message.findAll({
      where,
      order: [['createdAt', before ? 'DESC' : 'ASC']],
      limit: parseInt(limit)
    });
    
    // Get sender details
    const senderIds = [...new Set(messages.map(m => m.senderId))];
    
    const senders = await User.findAll({
      where: { id: { [Op.in]: senderIds } },
      attributes: ['id', 'name', 'avatar']
    });
    
    const senderMap = senders.reduce((map, sender) => {
      map[sender.id] = sender;
      return map;
    }, {});
    
    // Format response
    const formattedMessages = messages.map(message => ({
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      sender: senderMap[message.senderId],
      type: message.type,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt
    }));
    
    // If getting messages for first time, mark them as delivered
    if (!before && !after) {
      const messageIds = messages
        .filter(m => m.senderId !== userId && m.status === 'sent')
        .map(m => m.id);
      
      if (messageIds.length > 0) {
        await Message.update(
          { status: 'delivered' },
          { where: { id: { [Op.in]: messageIds } } }
        );
      }
    }
    
    res.json({
      messages: formattedMessages,
      limit: parseInt(limit)
    });
    
  } catch (error) {
    next(error);
  }
});

// Get message by ID
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Get message
    const message = await Message.findByPk(id);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    // Verify user is sender or recipient or conversation participant
    if (message.senderId !== userId && message.receiverId !== userId) {
      // Check if user is conversation participant
      if (message.conversationId) {
        const participation = await ConversationParticipant.findOne({
          where: { conversationId: message.conversationId, userId }
        });
        
        if (!participation) {
          return res.status(403).json({ error: 'Not authorized to view this message' });
        }
      } else {
        return res.status(403).json({ error: 'Not authorized to view this message' });
      }
    }
    
    // Get sender details
    const sender = await User.findByPk(message.senderId, {
      attributes: ['id', 'name', 'avatar']
    });
    
    // Format response
    const formattedMessage = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      sender,
      receiverId: message.receiverId,
      type: message.type,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt
    };
    
    res.json({ message: formattedMessage });
    
  } catch (error) {
    next(error);
  }
});

// Send a message
router.post('/', authenticate, async (req, res, next) => {
  try {
    const {
      conversationId,
      receiverId,
      type = 'text',
      text,
      images = [],
      audio = null,
      replyToMessageId = null,
      attachments = [],
      clientTempId
    } = req.body;
    
    const userId = req.user.id;
    
    // Validate
    if (!conversationId && !receiverId) {
      return res.status(400).json({ error: 'Either conversationId or receiverId is required' });
    }
    
    if (!text && images.length === 0 && !audio && attachments.length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }
    
    // Handle direct messages (create conversation if needed)
    let targetConversationId = conversationId;
    
    if (!targetConversationId && receiverId) {
      // Check if conversation already exists between these users
      const conversations = await Conversation.findAll({
        where: {
          participantIds: {
            [Op.contains]: [userId, receiverId]
          }
        }
      });
      
      // Filter for direct conversations (just 2 participants)
      const directConversations = conversations.filter(c => 
        c.participantIds.length === 2 && 
        c.participantIds.includes(userId) && 
        c.participantIds.includes(receiverId)
      );
      
      if (directConversations.length > 0) {
        // Use existing conversation
        targetConversationId = directConversations[0].id;
      } else {
        // Create new conversation
        const newConversation = {
          id: uuidv4(),
          participantIds: [userId, receiverId],
          lastMessageAt: new Date()
        };
        
        await queueService.enqueueConversationOperation(
          'create',
          newConversation
        );
        
        // Create conversation participants
        await ConversationParticipant.bulkCreate([
          {
            id: uuidv4(),
            conversationId: newConversation.id,
            userId,
            unreadCount: 0,
            joinedAt: new Date()
          },
          {
            id: uuidv4(),
            conversationId: newConversation.id,
            userId: receiverId,
            unreadCount: 1,
            joinedAt: new Date()
          }
        ]);
        
        targetConversationId = newConversation.id;
      }
    } else if (targetConversationId) {
      // Verify user is a conversation participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: targetConversationId, userId }
      });
      
      if (!participation) {
        return res.status(403).json({ error: 'Not a participant in this conversation' });
      }
    }
    
    // Create message ID
    const messageId = uuidv4();
    
    // Prepare message data
    const messageData = {
      id: messageId,
      conversationId: targetConversationId,
      senderId: userId,
      receiverId: receiverId || null,
      type,
      content: {
        text,
        images,
        audio,
        replyTo: replyToMessageId,
        attachments
      },
      status: 'sent',
      clientTempId,
      deleted: false
    };
    
    // Queue message for processing
    await queueService.enqueueMessage(messageData);
    
    // Update conversation last message time
    if (targetConversationId) {
      await Conversation.update(
        { lastMessageAt: new Date() },
        { where: { id: targetConversationId } }
      );
    }
    
    // Get conversation to increment unread counts
    if (targetConversationId) {
      const conversation = await Conversation.findByPk(targetConversationId);
      
      if (conversation) {
        // Increment unread count for all participants except sender
        await ConversationParticipant.increment(
          'unreadCount',
          {
            where: {
              conversationId: targetConversationId,
              userId: { [Op.ne]: userId }
            }
          }
        );
        
        // Update Redis unread counts
        const otherParticipants = conversation.participantIds.filter(id => id !== userId);
        
        for (const participantId of otherParticipants) {
          await redisService.incrementUnreadCount(participantId, targetConversationId);
        }
      }
    }
    
    // Get sender details
    const sender = await User.findByPk(userId, {
      attributes: ['id', 'name', 'avatar']
    });
    
    // Format response
    const response = {
      id: messageId,
      conversationId: targetConversationId,
      senderId: userId,
      sender,
      receiverId: receiverId || null,
      type,
      content: {
        text,
        images,
        audio,
        replyTo: replyToMessageId,
        attachments
      },
      status: 'sent',
      clientTempId,
      createdAt: new Date()
    };
    
    res.status(201).json({ message: response });
    
  } catch (error) {
    next(error);
  }
});

// Update a message
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text, images, attachments } = req.body;
    const userId = req.user.id;
    
    // Find message
    const message = await Message.findByPk(id);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    // Verify ownership
    if (message.senderId !== userId) {
      return res.status(403).json({ error: 'Not authorized to update this message' });
    }
    
    // Check if message can be edited (not deleted)
    if (message.deleted) {
      return res.status(400).json({ error: 'Deleted messages cannot be edited' });
    }
    
    // Check if editing allowed based on message type
    if (!['text', 'image', 'file'].includes(message.type)) {
      return res.status(400).json({ error: `Messages of type '${message.type}' cannot be edited` });
    }
    
    // Create message version
    await MessageVersion.create({
      id: uuidv4(),
      messageId: id,
      versionContent: message.content,
      editedAt: new Date()
    });
    
    // Update message content
    const updatedContent = {
      ...message.content
    };
    
    if (text !== undefined) {
      updatedContent.text = text;
    }
    
    if (images !== undefined) {
      updatedContent.images = images;
    }
    
    if (attachments !== undefined) {
      updatedContent.attachments = attachments;
    }
    
    // Add edit metadata
    updatedContent.edited = true;
    updatedContent.editedAt = new Date().toISOString();
    
    // Save changes
    message.content = updatedContent;
    await message.save();
    
    // Cache updated message
    await redisService.cacheMessage(message);
    
    // Format response
    const response = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      updatedAt: message.updatedAt
    };
    
    res.json({ message: response });
    
  } catch (error) {
    next(error);
  }
});

// Delete a message
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Find message
    const message = await Message.findByPk(id);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    // Verify ownership
    if (message.senderId !== userId) {
      return res.status(403).json({ error: 'Not authorized to delete this message' });
    }
    
    // Soft delete the message
    message.deleted = true;
    await message.save();
    
    // Update cache
    await redisService.cacheMessage(message);
    
    res.json({ success: true });
    
  } catch (error) {
    next(error);
  }
});

// Get message versions (edit history)
router.get('/:id/versions', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Find message
    const message = await Message.findByPk(id);
    
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    // Verify user is sender, recipient, or conversation participant
    if (message.senderId !== userId && message.receiverId !== userId) {
      if (message.conversationId) {
        const participation = await ConversationParticipant.findOne({
          where: { conversationId: message.conversationId, userId }
        });
        
        if (!participation) {
          return res.status(403).json({ error: 'Not authorized to view this message history' });
        }
      } else {
        return res.status(403).json({ error: 'Not authorized to view this message history' });
      }
    }
    
    // Get versions
    const versions = await MessageVersion.findAll({
      where: { messageId: id },
      order: [['editedAt', 'DESC']]
    });
    
    res.json({ versions });
    
  } catch (error) {
    next(error);
  }
});

// Deliver messages
router.post('/deliver', authenticate, async (req, res, next) => {
  try {
    const { messageIds } = req.body;
    const userId = req.user.id;
    
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'Message IDs array is required' });
    }
    
    // Update status
    await Message.update(
      { status: 'delivered' },
      { 
        where: { 
          id: { [Op.in]: messageIds },
          receiverId: userId,
          status: 'sent'
        } 
      }
    );
    
    res.json({ success: true });
    
  } catch (error) {
    next(error);
  }
});

// Mark messages as read
router.post('/read', authenticate, async (req, res, next) => {
  try {
    const { messageIds } = req.body;
    const userId = req.user.id;
    
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({ error: 'Message IDs array is required' });
    }
    
    // Update status
    await Message.update(
      { status: 'read' },
      { 
        where: { 
          id: { [Op.in]: messageIds },
          receiverId: userId,
          status: { [Op.ne]: 'read' }
        } 
      }
    );
    
    // Find unique conversation IDs
    const messages = await Message.findAll({
      where: { id: { [Op.in]: messageIds } },
      attributes: ['conversationId']
    });
    
    const conversationIds = [...new Set(
      messages
        .map(msg => msg.conversationId)
        .filter(id => id !== null)
    )];
    
    // Reset unread counts for these conversations
    if (conversationIds.length > 0) {
      await ConversationParticipant.update(
        { unreadCount: 0 },
        { 
          where: { 
            conversationId: { [Op.in]: conversationIds },
            userId
          } 
        }
      );
      
      // Reset Redis unread counts
      for (const conversationId of conversationIds) {
        await redisService.resetUnreadCount(userId, conversationId);
      }
    }
    
    res.json({ success: true });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;