// routes/messages.js - CLEAN APPROACH
const express = require('express');
const router = express.Router();
const { Op, Sequelize } = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const { 
  Message, 
  MessageVersion, 
  Conversation, 
  ConversationParticipant,
  User 
} = require('../db/models');
const { authenticate } = require('../middleware/authentication');
const redisService = require('../services/redis');
const queueService = require('../services/queue/queueService');
const logger = require('../utils/logger');

// ✅ BETTER: Direct import from exception handler
const { asyncHandler, createOperationalError, createSystemError } = require('../middleware/exceptionHandler');

/**
 * @swagger
 * tags:
 *   name: Messages
 *   description: Message management
 */

/**
 * @route GET /api/v1/messages/conversation/:conversationId
 * @desc Get messages for a conversation
 * @access Private
 */
router.get('/conversation/:conversationId', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { limit = 50, before, after } = req.query;
    const userId = req.user.id;
    
    if (!conversationId) {
      throw createOperationalError('Conversation ID is required', 400, 'MISSING_CONVERSATION_ID');
    }
    
    // Validate query parameters
    const parsedLimit = parseInt(limit);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw createOperationalError('Limit must be a number between 1 and 100', 400, 'INVALID_LIMIT');
    }
    
    // Validate date parameters
    if (before && isNaN(Date.parse(before))) {
      throw createOperationalError('Invalid before date format', 400, 'INVALID_BEFORE_DATE');
    }
    
    if (after && isNaN(Date.parse(after))) {
      throw createOperationalError('Invalid after date format', 400, 'INVALID_AFTER_DATE');
    }
    
    try {
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
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
        limit: parsedLimit
      });
      
      // Get sender details
      const senderIds = [...new Set(messages.map(m => m.senderId))];
      
      const senders = await User.findAll({
        where: { id: { [Op.in]: senderIds } },
        attributes: ['id', 'name', 'avatar']
      });
      
      const senderMap = senders.reduce((map, sender) => {
        map[sender.id] = sender.toJSON ? sender.toJSON() : sender;
        return map;
      }, {});
      
      // Format response - Handle both Sequelize instances and plain objects
      const formattedMessages = messages.map(message => {
        const messageData = message.toJSON ? message.toJSON() : message;
        
        return {
          id: messageData.id,
          conversationId: messageData.conversationId,
          senderId: messageData.senderId,
          sender: senderMap[messageData.senderId],
          type: messageData.type,
          content: messageData.content,
          status: messageData.status,
          createdAt: messageData.createdAt,
          updatedAt: messageData.updatedAt
        };
      });
      
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
        limit: parsedLimit,
        hasMore: messages.length === parsedLimit
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve conversation messages', error);
    }
  })
);

/**
 * @route GET /api/v1/messages/:id
 * @desc Get a message by ID
 * @access Private
 */
router.get('/:id', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Message ID is required', 400, 'MISSING_MESSAGE_ID');
    }
    
    try {
      // Get message
      const message = await Message.findByPk(id);
      
      if (!message) {
        throw createOperationalError('Message not found', 404, 'MESSAGE_NOT_FOUND');
      }
      
      // Verify user is sender or recipient or conversation participant
      if (message.senderId !== userId && message.receiverId !== userId) {
        // Check if user is conversation participant
        if (message.conversationId) {
          const participation = await ConversationParticipant.findOne({
            where: { conversationId: message.conversationId, userId }
          });
          
          if (!participation) {
            throw createOperationalError('Not authorized to view this message', 403, 'NOT_AUTHORIZED');
          }
        } else {
          throw createOperationalError('Not authorized to view this message', 403, 'NOT_AUTHORIZED');
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
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve message', error);
    }
  })
);

/**
 * @route POST /api/v1/messages
 * @desc Send a message
 * @access Private
 */
router.post('/', 
  authenticate, 
  asyncHandler(async (req, res) => {
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
      throw createOperationalError('Either conversationId or receiverId is required', 400, 'MISSING_TARGET');
    }
    
    if (!text && images.length === 0 && !audio && attachments.length === 0) {
      throw createOperationalError('Message content is required', 400, 'MESSAGE_EMPTY');
    }
    
    // Validate message type
    const validTypes = ['text', 'image', 'file', 'emoji', 'audio', 'system'];
    if (!validTypes.includes(type)) {
      throw createOperationalError(`Invalid message type. Must be one of: ${validTypes.join(', ')}`, 400, 'INVALID_MESSAGE_TYPE');
    }
    
    // Validate text length if provided
    if (text && typeof text === 'string' && text.length > 10000) {
      throw createOperationalError('Message text cannot exceed 10,000 characters', 400, 'TEXT_TOO_LONG');
    }
    
    // Validate images array
    if (images && (!Array.isArray(images) || images.length > 10)) {
      throw createOperationalError('Images must be an array with maximum 10 items', 400, 'INVALID_IMAGES');
    }
    
    // Validate attachments array
    if (attachments && (!Array.isArray(attachments) || attachments.length > 5)) {
      throw createOperationalError('Attachments must be an array with maximum 5 items', 400, 'INVALID_ATTACHMENTS');
    }
    
    try {
      // Handle direct messages (create conversation if needed)
      let targetConversationId = conversationId;
      let newConversation = false;
      
      if (!targetConversationId && receiverId) {
        // Validate receiverId
        const receiverExists = await User.findByPk(receiverId);
        if (!receiverExists) {
          throw createOperationalError('Receiver user not found', 404, 'RECEIVER_NOT_FOUND');
        }
        
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
          throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
        }
      }
      
      // Validate reply message if provided
      if (replyToMessageId) {
        const replyMessage = await Message.findByPk(replyToMessageId);
        if (!replyMessage || replyMessage.conversationId !== targetConversationId) {
          throw createOperationalError('Invalid reply message', 400, 'INVALID_REPLY_MESSAGE');
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
      if (error.isOperational) {
        throw error;
      }
      
      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(`Validation failed: ${details}`, 400, 'VALIDATION_ERROR');
      }
      
      throw createSystemError('Failed to send message', error);
    }
  })
);

/**
 * @route POST /api/v1/messages/batch
 * @desc Send multiple messages in a batch
 * @access Private
 */
router.post('/batch', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { messages } = req.body;
    const userId = req.user.id;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      throw createOperationalError('Messages array is required and cannot be empty', 400, 'INVALID_MESSAGES_ARRAY');
    }
    
    // Limit batch size
    const MAX_BATCH_SIZE = 50;
    if (messages.length > MAX_BATCH_SIZE) {
      throw createOperationalError(`Batch size cannot exceed ${MAX_BATCH_SIZE} messages`, 400, 'BATCH_TOO_LARGE');
    }
    
    // Validate all messages
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      
      if (!msg.conversationId && !msg.receiverId) {
        throw createOperationalError(`Message at index ${i} must have either conversationId or receiverId`, 400, 'INVALID_MESSAGE_TARGET');
      }
      
      if (!msg.text && !(msg.images && msg.images.length) && !msg.audio && !(msg.attachments && msg.attachments.length)) {
        throw createOperationalError(`Message at index ${i} must have content (text, images, audio, or attachments)`, 400, 'MESSAGE_EMPTY');
      }
      
      // Validate message text length
      if (msg.text && typeof msg.text === 'string' && msg.text.length > 10000) {
        throw createOperationalError(`Message at index ${i} text cannot exceed 10,000 characters`, 400, 'TEXT_TOO_LONG');
      }
      
      // Validate message type
      const validTypes = ['text', 'image', 'file', 'emoji', 'audio'];
      if (msg.type && !validTypes.includes(msg.type)) {
        throw createOperationalError(`Message at index ${i} has invalid type. Must be one of: ${validTypes.join(', ')}`, 400, 'INVALID_MESSAGE_TYPE');
      }
    }
    
    try {
      // Format messages with sender ID
      const processedMessages = messages.map(msg => ({
        ...msg,
        id: uuidv4(),
        senderId: userId,
        status: 'sent',
        type: msg.type || 'text',
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
        results,
        processed: results.length
      });
    } catch (error) {
      throw createSystemError('Failed to process batch messages', error);
    }
  })
);

/**
 * @route PUT /api/v1/messages/:id
 * @desc Update a message
 * @access Private
 */
router.put('/:id', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { text, images, attachments } = req.body;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Message ID is required', 400, 'MISSING_MESSAGE_ID');
    }
    
    // Validate at least one field is provided
    if (text === undefined && images === undefined && attachments === undefined) {
      throw createOperationalError('At least one field (text, images, or attachments) must be provided', 400, 'NO_UPDATE_FIELDS');
    }
    
    // Validate text length if provided
    if (text !== undefined && typeof text === 'string' && text.length > 10000) {
      throw createOperationalError('Message text cannot exceed 10,000 characters', 400, 'TEXT_TOO_LONG');
    }
    
    // Validate images array if provided
    if (images !== undefined && (!Array.isArray(images) || images.length > 10)) {
      throw createOperationalError('Images must be an array with maximum 10 items', 400, 'INVALID_IMAGES');
    }
    
    // Validate attachments array if provided
    if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length > 5)) {
      throw createOperationalError('Attachments must be an array with maximum 5 items', 400, 'INVALID_ATTACHMENTS');
    }
    
    try {
      // Find message
      const message = await Message.findByPk(id);
      
      if (!message) {
        throw createOperationalError('Message not found', 404, 'MESSAGE_NOT_FOUND');
      }
      
      // Verify ownership
      if (message.senderId !== userId) {
        throw createOperationalError('Not authorized to update this message', 403, 'NOT_AUTHORIZED');
      }
      
      // Check if message can be edited (not deleted)
      if (message.deleted) {
        throw createOperationalError('Deleted messages cannot be edited', 400, 'MESSAGE_DELETED');
      }
      
      // Check if editing allowed based on message type
      if (!['text', 'image', 'file'].includes(message.type)) {
        throw createOperationalError(`Messages of type '${message.type}' cannot be edited`, 400, 'INVALID_MESSAGE_TYPE');
      }
      
      // Check message age (optional: prevent editing very old messages)
      const messageAge = Date.now() - new Date(message.createdAt).getTime();
      const maxEditAge = 24 * 60 * 60 * 1000; // 24 hours
      if (messageAge > maxEditAge) {
        throw createOperationalError('Messages older than 24 hours cannot be edited', 400, 'MESSAGE_TOO_OLD');
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
      if (error.isOperational) {
        throw error;
      }
      
      if (error.name === 'SequelizeValidationError') {
        const details = error.errors.map(e => e.message).join(', ');
        throw createOperationalError(`Validation failed: ${details}`, 400, 'VALIDATION_ERROR');
      }
      
      throw createSystemError('Failed to update message', error);
    }
  })
);

/**
 * @route DELETE /api/v1/messages/:id
 * @desc Delete a message
 * @access Private
 */
router.delete('/:id', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Message ID is required', 400, 'MISSING_MESSAGE_ID');
    }
    
    try {
      // Find message
      const message = await Message.findByPk(id);
      
      if (!message) {
        throw createOperationalError('Message not found', 404, 'MESSAGE_NOT_FOUND');
      }
      
      // Verify ownership
      if (message.senderId !== userId) {
        throw createOperationalError('Not authorized to delete this message', 403, 'NOT_AUTHORIZED');
      }
      
      // Check if already deleted
      if (message.deleted) {
        throw createOperationalError('Message is already deleted', 400, 'ALREADY_DELETED');
      }
      
      // Soft delete the message
      message.deleted = true;
      await message.save();
      
      // Update cache
      await redisService.cacheMessage(message);
      
      res.json({ 
        success: true,
        message: 'Message deleted successfully'
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to delete message', error);
    }
  })
);

/**
 * @route GET /api/v1/messages/:id/versions
 * @desc Get message versions (edit history)
 * @access Private
 */
router.get('/:id/versions', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    
    if (!id) {
      throw createOperationalError('Message ID is required', 400, 'MISSING_MESSAGE_ID');
    }
    
    try {
      // Find message
      const message = await Message.findByPk(id);
      
      if (!message) {
        throw createOperationalError('Message not found', 404, 'MESSAGE_NOT_FOUND');
      }
      
      // Verify user is sender, recipient, or conversation participant
      if (message.senderId !== userId && message.receiverId !== userId) {
        if (message.conversationId) {
          const participation = await ConversationParticipant.findOne({
            where: { conversationId: message.conversationId, userId }
          });
          
          if (!participation) {
            throw createOperationalError('Not authorized to view this message history', 403, 'NOT_AUTHORIZED');
          }
        } else {
          throw createOperationalError('Not authorized to view this message history', 403, 'NOT_AUTHORIZED');
        }
      }
      
      // Get versions
      const versions = await MessageVersion.findAll({
        where: { messageId: id },
        order: [['editedAt', 'DESC']]
      });
      
      res.json({ 
        success: true,
        versions,
        count: versions.length
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve message versions', error);
    }
  })
);

/**
 * @route POST /api/v1/messages/deliver
 * @desc Mark messages as delivered
 * @access Private
 */
router.post('/deliver', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { messageIds } = req.body;
    const userId = req.user.id;
    
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      throw createOperationalError('Message IDs array is required and cannot be empty', 400, 'INVALID_MESSAGE_IDS');
    }
    
    if (messageIds.length > 100) {
      throw createOperationalError('Cannot mark more than 100 messages as delivered at once', 400, 'TOO_MANY_MESSAGES');
    }
    
    try {
      // Queue delivery receipt for processing
      await queueService.enqueueDeliveryReceipt(userId, messageIds);
      
      // Update message status immediately for UI feedback
      const [updatedCount] = await Message.update(
        { status: 'delivered' },
        { 
          where: { 
            id: { [Op.in]: messageIds },
            receiverId: userId,
            status: 'sent'
          } 
        }
      );
      
      res.json({ 
        success: true,
        message: `${updatedCount} messages marked as delivered`
      });
    } catch (error) {
      throw createSystemError('Failed to mark messages as delivered', error);
    }
  })
);

/**
 * @route POST /api/v1/messages/read
 * @desc Mark messages as read
 * @access Private
 */
router.post('/read', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { messageIds, conversationId } = req.body;
    const userId = req.user.id;
    
    // More flexible validation
    if (!messageIds && !conversationId) {
      throw createOperationalError('Either messageIds array or conversationId is required', 400, 'MISSING_PARAMETERS');
    }
    
    // If messageIds is provided, validate it's an array (can be empty if conversationId is provided)
    if (messageIds !== undefined && !Array.isArray(messageIds)) {
      throw createOperationalError('Message IDs must be an array', 400, 'INVALID_MESSAGE_IDS_FORMAT');
    }
    
    // If only messageIds is provided, it must not be empty
    if (messageIds && !conversationId && messageIds.length === 0) {
      throw createOperationalError('Message IDs array cannot be empty when conversationId is not provided', 400, 'EMPTY_MESSAGE_IDS');
    }
    
    if (messageIds && messageIds.length > 100) {
      throw createOperationalError('Cannot mark more than 100 messages as read at once', 400, 'TOO_MANY_MESSAGES');
    }
    
    try {
      // Queue read receipt for processing
      await queueService.enqueueReadReceipt(userId, messageIds || [], conversationId);
      
      let updatedCount = 0;
      
      // Process immediately for UI feedback
      if (messageIds && messageIds.length > 0) {
        // Update specific messages
        const [count] = await Message.update(
          { status: 'read' },
          { 
            where: { 
              id: { [Op.in]: messageIds },
              receiverId: userId,
              status: { [Op.ne]: 'read' }
            } 
          }
        );
        updatedCount += count;
      }
      
      if (conversationId) {
        // Verify user is a participant
        const participation = await ConversationParticipant.findOne({
          where: { conversationId, userId }
        });
        
        if (!participation) {
          throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
        }
        
        // Update all messages in conversation
        const [count] = await Message.update(
          { status: 'read' },
          { 
            where: { 
              conversationId,
              receiverId: userId,
              status: { [Op.ne]: 'read' }
            } 
          }
        );
        updatedCount += count;
        
        // Reset unread count for this conversation
        await ConversationParticipant.update(
          { unreadCount: 0 },
          { where: { conversationId, userId } }
        );
        
        // Reset Redis unread count
        await redisService.resetUnreadCount(userId, conversationId);
      }
      
      res.json({ 
        success: true,
        message: `${updatedCount} messages marked as read`
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to mark messages as read', error);
    }
  })
);

/**
 * @route GET /api/v1/messages/offline
 * @desc Get offline messages for the authenticated user
 * @access Private
 */
router.get('/offline', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    
    try {
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
      throw createSystemError('Failed to retrieve offline messages', error);
    }
  })
);

/**
 * @route GET /api/v1/messages/search
 * @desc Search messages
 * @access Private
 */
router.get('/search', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { query, conversationId, limit = 20, offset = 0 } = req.query;
    const userId = req.user.id;
    
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      throw createOperationalError('Search query must be at least 2 characters', 400, 'INVALID_QUERY');
    }
    
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
          throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
        }
        
        searchConditions[Op.and].push({ conversationId });
      }
      
      // Execute search with pagination
      const { count, rows: messages } = await Message.findAndCountAll({
        where: searchConditions,
        order: [['createdAt', 'DESC']],
        limit: parsedLimit,
        offset: parsedOffset
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
        limit: parsedLimit,
        offset: parsedOffset,
        query,
        hasMore: (parsedOffset + formattedMessages.length) < count
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to search messages', error);
    }
  })
);

/**
 * @route GET /api/v1/messages/stats
 * @desc Get message statistics
 * @access Private
 */
router.get('/stats', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { conversationId, period = 'week' } = req.query;
    const userId = req.user.id;
    
    // Validate period
    const validPeriods = ['day', 'week', 'month', 'year'];
    if (!validPeriods.includes(period)) {
      throw createOperationalError(`Invalid period. Must be one of: ${validPeriods.join(', ')}`, 400, 'INVALID_PERIOD');
    }
    
    try {
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
          throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
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
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve message statistics', error);
    }
  })
);

/**
 * @route GET /api/v1/messages/history/user/:userId
 * @desc Get message history with a specific user
 * @access Private
 */
router.get('/history/user/:userId', 
  authenticate, 
  asyncHandler(async (req, res) => {
    const { userId: otherUserId } = req.params;
    const currentUserId = req.user.id;
    
    if (!otherUserId) {
      throw createOperationalError('User ID is required', 400, 'MISSING_USER_ID');
    }
    
    if (otherUserId === currentUserId) {
      throw createOperationalError('Cannot get message history with yourself', 400, 'INVALID_USER_ID');
    }
    
    try {
      // Verify other user exists
      const otherUser = await User.findByPk(otherUserId);
      if (!otherUser) {
        throw createOperationalError('User not found', 404, 'USER_NOT_FOUND');
      }
      
      // Find or create conversation
      const conversations = await Conversation.findAll({
        where: {
          participantIds: {
            [Op.contains]: [currentUserId, otherUserId]
          }
        }
      });
      
      const directConversation = conversations.find(c => 
        c.participantIds.length === 2 && 
        c.participantIds.includes(currentUserId) && 
        c.participantIds.includes(otherUserId)
      );
      
      if (!directConversation) {
        return res.json({ 
          success: true, 
          messages: [], 
          conversationId: null,
          total: 0
        });
      }
      
      // Use existing conversation message logic
      req.params.conversationId = directConversation.id;
      
      // Get messages for this conversation
      const { limit = 50, before, after } = req.query;
      const parsedLimit = parseInt(limit) || 50;
      
      const where = { 
        conversationId: directConversation.id,
        deleted: false
      };
      
      if (before) {
        where.createdAt = { ...where.createdAt, [Op.lt]: new Date(before) };
      }
      
      if (after) {
        where.createdAt = { ...where.createdAt, [Op.gt]: new Date(after) };
      }
      
      const messages = await Message.findAll({
        where,
        order: [['createdAt', before ? 'DESC' : 'ASC']],
        limit: parsedLimit
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
      
      res.json({
        success: true,
        messages: formattedMessages,
        conversationId: directConversation.id,
        total: formattedMessages.length,
        hasMore: messages.length === parsedLimit
      });
    } catch (error) {
      if (error.isOperational) {
        throw error;
      }
      throw createSystemError('Failed to retrieve message history', error);
    }
  })
);

module.exports = router;