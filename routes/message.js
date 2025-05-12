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
const authenticate = require('../middleware/authentication');
const redisService = require('../services/redis');
const queueService = require('../services/queue/queueService');
const logger = require('../utils/logger');

/**
 * @swagger
 * tags:
 *   name: Messages
 *   description: Message management
 */

/**
 * @swagger
 * /api/messages/conversation/{conversationId}:
 *   get:
 *     summary: Get messages for a conversation
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: conversationId
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: Conversation ID
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of messages to retrieve
 *       - in: query
 *         name: before
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Get messages before this timestamp
 *       - in: query
 *         name: after
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Get messages after this timestamp
 *     responses:
 *       200:
 *         description: List of messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *                 limit:
 *                   type: integer
 *       403:
 *         description: Not a participant in the conversation
 *       401:
 *         description: Unauthorized
 */
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
      return res.status(403).json({
        success: false,
        error: {
          code: 'NOT_AUTHORIZED',
          message: 'Not a participant in this conversation',
          status: 403
        }
      });
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
        await queueService.enqueueDeliveryReceipt(userId, messageIds);
        
        // Update status immediately for UI feedback
        await Message.update(
          { status: 'delivered' },
          { where: { id: { [Op.in]: messageIds } } }
        );
      }
    }
    
    res.json({
      success: true,
      messages: formattedMessages,
      limit: parseInt(limit),
      hasMore: messages.length === parseInt(limit)
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages/{id}:
 *   get:
 *     summary: Get a message by ID
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: Message ID
 *     responses:
 *       200:
 *         description: Message details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   $ref: '#/components/schemas/Message'
 *       404:
 *         description: Message not found
 *       403:
 *         description: Not authorized to view this message
 *       401:
 *         description: Unauthorized
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Get message
    const message = await Message.findByPk(id);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Message not found',
          status: 404
        }
      });
    }
    
    // Verify user is sender or recipient or conversation participant
    if (message.senderId !== userId && message.receiverId !== userId) {
      // Check if user is conversation participant
      if (message.conversationId) {
        const participation = await ConversationParticipant.findOne({
          where: { conversationId: message.conversationId, userId }
        });
        
        if (!participation) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'NOT_AUTHORIZED',
              message: 'Not authorized to view this message',
              status: 403
            }
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          error: {
            code: 'NOT_AUTHORIZED',
            message: 'Not authorized to view this message',
            status: 403
          }
        });
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
    
    res.json({ 
      success: true,
      message: formattedMessage 
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages:
 *   post:
 *     summary: Send a message
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversationId:
 *                 type: string
 *                 format: uuid
 *                 description: Conversation ID (required if receiverId not provided)
 *               receiverId:
 *                 type: string
 *                 format: uuid
 *                 description: Receiver user ID (required if conversationId not provided)
 *               type:
 *                 type: string
 *                 enum: [text, image, file, emoji, audio, system]
 *                 default: text
 *               text:
 *                 type: string
 *                 description: Message text content
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uri
 *                 description: Array of image URLs
 *               audio:
 *                 type: string
 *                 format: uri
 *                 description: Audio file URL
 *               replyToMessageId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the message being replied to
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     url:
 *                       type: string
 *                       format: uri
 *                     name:
 *                       type: string
 *                     type:
 *                       type: string
 *                     size:
 *                       type: integer
 *               clientTempId:
 *                 type: string
 *                 description: Temporary client-side ID for tracking message status
 *     responses:
 *       201:
 *         description: Message sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Not a participant in the conversation
 *       401:
 *         description: Unauthorized
 */
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
      return res.status(400).json({ 
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Either conversationId or receiverId is required',
          status: 400
        }
      });
    }
    
    if (!text && images.length === 0 && !audio && attachments.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Message content is required',
          status: 400
        }
      });
    }
    
    // Handle direct messages (create conversation if needed)
    let targetConversationId = conversationId;
    let newConversation = false;
    
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
        const newConvId = uuidv4();
        await queueService.enqueueConversationOperation(
          'create',
          {
            id: newConvId,
            participantIds: [userId, receiverId],
            lastMessageAt: new Date()
          }
        );
        
        // Create conversation participants
        await ConversationParticipant.bulkCreate([
          {
            id: uuidv4(),
            conversationId: newConvId,
            userId,
            unreadCount: 0,
            joinedAt: new Date()
          },
          {
            id: uuidv4(),
            conversationId: newConvId,
            userId: receiverId,
            unreadCount: 1,
            joinedAt: new Date()
          }
        ]);
        
        targetConversationId = newConvId;
        newConversation = true;
      }
    } else if (targetConversationId) {
      // Verify user is a conversation participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId: targetConversationId, userId }
      });
      
      if (!participation) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'NOT_AUTHORIZED',
            message: 'Not a participant in this conversation',
            status: 403
          }
        });
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
      deleted: false,
      createdAt: new Date(),
      updatedAt: new Date()
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
    
    res.status(201).json({ 
      success: true,
      message: response,
      newConversation
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages/batch:
 *   post:
 *     summary: Send multiple messages in a batch
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     conversationId:
 *                       type: string
 *                       format: uuid
 *                     receiverId:
 *                       type: string
 *                       format: uuid
 *                     type:
 *                       type: string
 *                       enum: [text, image, file, emoji, audio, system]
 *                     text:
 *                       type: string
 *                     images:
 *                       type: array
 *                       items:
 *                         type: string
 *                     audio:
 *                       type: string
 *                     clientTempId:
 *                       type: string
 *     responses:
 *       201:
 *         description: Messages batch processing results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       success:
 *                         type: boolean
 *                       messageId:
 *                         type: string
 *                       clientTempId:
 *                         type: string
 *                       error:
 *                         type: string
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/batch', authenticate, async (req, res, next) => {
  try {
    const { messages } = req.body;
    const userId = req.user.id;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Messages array is required and cannot be empty',
          status: 400
        }
      });
    }
    
    // Limit batch size
    const MAX_BATCH_SIZE = 50;
    if (messages.length > MAX_BATCH_SIZE) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BATCH_TOO_LARGE',
          message: `Batch size cannot exceed ${MAX_BATCH_SIZE} messages`,
          status: 400
        }
      });
    }
    
    // Validate all messages
    for (const msg of messages) {
      if (!msg.conversationId && !msg.receiverId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_MESSAGE',
            message: 'Each message must have either conversationId or receiverId',
            status: 400
          }
        });
      }
      
      if (!msg.text && !(msg.images && msg.images.length) && !msg.audio) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_MESSAGE',
            message: 'Each message must have content (text, images, or audio)',
            status: 400
          }
        });
      }
    }
    
    // Format messages with sender ID
    const processedMessages = messages.map(msg => ({
      ...msg,
      id: uuidv4(),
      senderId: userId,
      status: 'sent',
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    
    // Queue batch processing
    await queueService.enqueueBatchMessages(processedMessages);
    
    // Create result array with message IDs
    const results = processedMessages.map(msg => ({
      success: true,
      messageId: msg.id,
      clientTempId: msg.clientTempId,
      conversationId: msg.conversationId
    }));
    
    res.status(201).json({
      success: true,
      results
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages/{id}:
 *   put:
 *     summary: Update a message
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: Message ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *               attachments:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Message updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   $ref: '#/components/schemas/Message'
 *       400:
 *         description: Invalid request
 *       403:
 *         description: Not authorized to update this message
 *       404:
 *         description: Message not found
 *       401:
 *         description: Unauthorized
 */
router.put('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text, images, attachments } = req.body;
    const userId = req.user.id;
    
    // Find message
    const message = await Message.findByPk(id);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Message not found',
          status: 404
        }
      });
    }
    
    // Verify ownership
    if (message.senderId !== userId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'NOT_AUTHORIZED',
          message: 'Not authorized to update this message',
          status: 403
        }
      });
    }
    
    // Check if message can be edited (not deleted)
    if (message.deleted) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OPERATION',
          message: 'Deleted messages cannot be edited',
          status: 400
        }
      });
    }
    
    // Check if editing allowed based on message type
    if (!['text', 'image', 'file'].includes(message.type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OPERATION',
          message: `Messages of type '${message.type}' cannot be edited`,
          status: 400
        }
      });
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
    
    res.json({
      success: true,
      message: response
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages/{id}:
 *   delete:
 *     summary: Delete a message
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: Message ID
 *     responses:
 *       200:
 *         description: Message deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       403:
 *         description: Not authorized to delete this message
 *       404:
 *         description: Message not found
 *       401:
 *         description: Unauthorized
 */
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Find message
    const message = await Message.findByPk(id);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Message not found',
          status: 404
        }
      });
    }
    
    // Verify ownership
    if (message.senderId !== userId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'NOT_AUTHORIZED',
          message: 'Not authorized to delete this message',
          status: 403
        }
      });
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

/**
 * @swagger
 * /api/messages/{id}/versions:
 *   get:
 *     summary: Get message versions (edit history)
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *           format: uuid
 *         required: true
 *         description: Message ID
 *     responses:
 *       200:
 *         description: Message versions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 versions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MessageVersion'
 *       403:
 *         description: Not authorized to view this message history
 *       404:
 *         description: Message not found
 *       401:
 *         description: Unauthorized
 */
router.get('/:id/versions', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    
    // Find message
    const message = await Message.findByPk(id);
    
    if (!message) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Message not found',
          status: 404
        }
      });
    }
    
    // Verify user is sender, recipient, or conversation participant
    if (message.senderId !== userId && message.receiverId !== userId) {
      if (message.conversationId) {
        const participation = await ConversationParticipant.findOne({
          where: { conversationId: message.conversationId, userId }
        });
        
        if (!participation) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'NOT_AUTHORIZED',
              message: 'Not authorized to view this message history',
              status: 403
            }
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          error: {
            code: 'NOT_AUTHORIZED',
            message: 'Not authorized to view this message history',
            status: 403
          }
        });
      }
    }
    
    // Get versions
    const versions = await MessageVersion.findAll({
      where: { messageId: id },
      order: [['editedAt', 'DESC']]
    });
    
    res.json({ 
      success: true,
      versions 
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages/deliver:
 *   post:
 *     summary: Mark messages as delivered
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messageIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *     responses:
 *       200:
 *         description: Messages marked as delivered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/deliver', authenticate, async (req, res, next) => {
  try {
    const { messageIds } = req.body;
    const userId = req.user.id;
    
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Message IDs array is required',
          status: 400
        }
      });
    }
    
    // Queue delivery receipt for processing
    await queueService.enqueueDeliveryReceipt(userId, messageIds);
    
    // Update message status immediately for UI feedback
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

/**
 * @swagger
 * /api/messages/read:
 *   post:
 *     summary: Mark messages as read
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messageIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *               conversationId:
 *                 type: string
 *                 format: uuid
 *                 description: If provided, all messages in this conversation will be marked as read
 *     responses:
 *       200:
 *         description: Messages marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.post('/read', authenticate, async (req, res, next) => {
  try {
    const { messageIds, conversationId } = req.body;
    const userId = req.user.id;
    
    if (!messageIds && !conversationId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Either messageIds array or conversationId is required',
          status: 400
        }
      });
    }
    
    // Queue read receipt for processing
    await queueService.enqueueReadReceipt(userId, messageIds, conversationId);
    
    // Process immediately for UI feedback
    if (messageIds && messageIds.length > 0) {
      // Update specific messages
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
    }
    
    if (conversationId) {
      // Update all messages in conversation
      await Message.update(
        { status: 'read' },
        { 
          where: { 
            conversationId,
            receiverId: userId,
            status: { [Op.ne]: 'read' }
          } 
        }
      );
      
      // Reset unread count for this conversation
      await ConversationParticipant.update(
        { unreadCount: 0 },
        { where: { conversationId, userId } }
      );
      
      // Reset Redis unread count
      await redisService.resetUnreadCount(userId, conversationId);
    }
    
    // Find unique conversation IDs for notifying senders
    if (messageIds && messageIds.length > 0) {
      const messages = await Message.findAll({
        where: { id: { [Op.in]: messageIds } },
        attributes: ['conversationId', 'senderId']
      });
      
      const conversationIds = [...new Set(
        messages
          .map(msg => msg.conversationId)
          .filter(id => id !== null)
      )];
      
      // For conversation-specific notifications
      if (conversationIds.length > 0) {
        // This would typically be handled through socket notifications
        // but we're also updating unread counts in Redis for reliability
        for (const convId of conversationIds) {
          await redisService.resetUnreadCount(userId, convId);
        }
      }
      
      // Group message IDs by sender for notifications
      const messagesBySender = {};
      messages.forEach(msg => {
        if (!messagesBySender[msg.senderId]) {
          messagesBySender[msg.senderId] = [];
        }
        messagesBySender[msg.senderId].push(msg.id);
      });
      
      // This would typically trigger socket notifications to senders
      // The actual socket notification is handled by the worker processing the queue
    }
    
    res.json({ success: true });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages/offline:
 *   get:
 *     summary: Get offline messages for the authenticated user
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Offline messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *                 count:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */
router.get('/offline', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Get offline messages
    const messages = await queueService.getOfflineMessages(userId);
    
    // Get sender details for messages
    if (messages.length > 0) {
      const senderIds = [...new Set(messages.map(m => m.senderId))];
      
      const senders = await User.findAll({
        where: { id: { [Op.in]: senderIds } },
        attributes: ['id', 'name', 'avatar']
      });
      
      const senderMap = senders.reduce((map, sender) => {
        map[sender.id] = sender;
        return map;
      }, {});
      
      // Attach sender info to messages
      messages.forEach(message => {
        message.sender = senderMap[message.senderId] || { id: message.senderId };
      });
    }
    
    res.json({
      success: true,
      messages,
      count: messages.length
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages/search:
 *   get:
 *     summary: Search messages
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: query
 *         schema:
 *           type: string
 *         required: true
 *         description: Search query
 *       - in: query
 *         name: conversationId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Limit search to a specific conversation
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Maximum number of results
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Result offset for pagination
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 messages:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Message'
 *                 total:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 offset:
 *                   type: integer
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
router.get('/search', authenticate, async (req, res, next) => {
  try {
    const { query, conversationId, limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;
    
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'Search query must be at least 2 characters',
          status: 400
        }
      });
    }
    
    // Build search conditions
    const searchConditions = {
      [Op.and]: [
        // Either user is sender or receiver, or user is in conversation
        {
          [Op.or]: [
            { senderId: userId },
            { receiverId: userId },
            { 
              conversationId: {
                [Op.in]: Sequelize.literal(`(
                  SELECT "conversationId" FROM "conversation_participants" 
                  WHERE "userId" = '${userId}'
                )`)
              }
            }
          ]
        },
        // Message content contains search query
        Sequelize.literal(`"content"->>'text' ILIKE '%${query.replace(/'/g, "''")}%'`),
        // Message is not deleted
        { deleted: false }
      ]
    };
    
    // Add conversation filter if provided
    if (conversationId) {
      // Verify user is a participant in this conversation
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'NOT_AUTHORIZED',
            message: 'Not a participant in this conversation',
            status: 403
          }
        });
      }
      
      searchConditions[Op.and].push({ conversationId });
    }
    
    // Execute search with pagination
    const { count, rows: messages } = await Message.findAndCountAll({
      where: searchConditions,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
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
    
    // Format messages
    const formattedMessages = messages.map(message => {
      const sender = senderMap[message.senderId] || { id: message.senderId };
      
      return {
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
    });
    
    res.json({
      success: true,
      messages: formattedMessages,
      total: count,
      limit: parseInt(limit),
      offset: parseInt(offset),
      query
    });
    
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/messages/stats:
 *   get:
 *     summary: Get message statistics
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: conversationId
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Get stats for a specific conversation
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month, year]
 *           default: week
 *         description: Time period for statistics
 *     responses:
 *       200:
 *         description: Message statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sentCount:
 *                   type: integer
 *                 receivedCount:
 *                   type: integer
 *                 totalCount:
 *                   type: integer
 *                 averageResponseTime:
 *                   type: number
 *                 messagesByType:
 *                   type: object
 *       401:
 *         description: Unauthorized
 */
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const { conversationId, period = 'week' } = req.query;
    const userId = req.user.id;
    
    // Determine date range
    const now = new Date();
    let startDate;
    
    switch (period) {
      case 'day':
        startDate = new Date(now.setDate(now.getDate() - 1));
        break;
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      case 'year':
        startDate = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default:
        startDate = new Date(now.setDate(now.getDate() - 7)); // Default to week
    }
    
    // Build conditions
    const conditions = {
      [Op.and]: [
        {
          [Op.or]: [
            { senderId: userId },
            { receiverId: userId }
          ]
        },
        { createdAt: { [Op.gte]: startDate } },
        { deleted: false }
      ]
    };
    
    if (conversationId) {
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'NOT_AUTHORIZED',
            message: 'Not a participant in this conversation',
            status: 403
          }
        });
      }
      
      conditions[Op.and].push({ conversationId });
    }
    
    // Get message counts
    const sentCount = await Message.count({
      where: {
        ...conditions,
        senderId: userId
      }
    });
    
    const receivedCount = await Message.count({
      where: {
        ...conditions,
        receiverId: userId
      }
    });
    
    // Get message type distribution
    const messagesByType = await Message.findAll({
      attributes: [
        'type',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'count']
      ],
      where: conditions,
      group: ['type']
    });
    
    const typeDistribution = messagesByType.reduce((obj, item) => {
      obj[item.type] = parseInt(item.get('count'));
      return obj;
    }, {});
    
    // Get average response time (only applicable for conversations)
    let averageResponseTime = null;
    
    if (conversationId) {
      // This is a simplified calculation and may need adjustment
      // based on your exact requirements
      const messages = await Message.findAll({
        where: conditions,
        order: [['createdAt', 'ASC']],
        attributes: ['id', 'senderId', 'createdAt']
      });
      
      let totalResponseTime = 0;
      let responseCount = 0;
      let lastMessage = null;
      
      for (const message of messages) {
        if (lastMessage && message.senderId !== lastMessage.senderId) {
          // This is a response
          const responseTime = message.createdAt - lastMessage.createdAt;
          totalResponseTime += responseTime;
          responseCount++;
        }
        
        lastMessage = message;
      }
      
      if (responseCount > 0) {
        // Convert to seconds
        averageResponseTime = totalResponseTime / responseCount / 1000;
      }
    }
    
    res.json({
      success: true,
      sentCount,
      receivedCount,
      totalCount: sentCount + receivedCount,
      messagesByType: typeDistribution,
      averageResponseTime,
      period,
      startDate,
      endDate: new Date()
    });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;