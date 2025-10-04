// services/socket/conversationService.js
const { Op } = require('sequelize');
const db = require('../../db');
const logger = require('../../utils/logger');
const redisService = require('../redis');
const { v4: uuidv4 } = require('uuid');

class ConversationService {
  /**
   * Ensure database is initialized
   */
  async ensureDbInitialized() {
    if (!db.isInitialized()) {
      logger.info('ConversationService: Database not initialized, waiting...');
      await db.waitForInitialization();
    }
  }

  /**
   * Get all conversation IDs for a user
   */
  async getUserConversationIds(userId) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { ConversationParticipant } = models;
      
      if (!ConversationParticipant) {
        logger.error('ConversationParticipant model not found');
        return [];
      }
      
      const conversations = await ConversationParticipant.findAll({
        where: { userId },
        attributes: ['conversationId']
      });
      
      return conversations.map((c) => c.conversationId);
    } catch (error) {
      logger.error('Error getting user conversation IDs', {
        userId,
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Get all conversations for a user with details
   */
  async getUserConversations(userId) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { ConversationParticipant, Conversation, Message, User } = models;
      
      if (!ConversationParticipant || !Conversation || !Message || !User) {
        logger.error('Required models not found');
        return [];
      }
      
      // Get user's conversation participations
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
        order: [[{model: Conversation, as: 'conversation'}, 'lastMessageAt', 'DESC']]
      });
      
      // Get unread counts from Redis
      const unreadCounts = await redisService.getUnreadCounts(userId);
      
      // Format conversations with participant details
      const conversations = await Promise.all(
        participations
          .filter(p => p.conversation)
          .map(async (participation) => {
            const conversation = participation.conversation;
            
            // Get participant details
            const participantIds = conversation.participantIds || [];
            const participantUsers = await User.findAll({
              where: { id: { [Op.in]: participantIds } },
              attributes: ['id', 'name', 'avatar', 'role']
            });
            
            // Get presence info from Redis
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
              participantIds: conversation.participantIds,
              participants,
              unreadCount: unreadCounts[conversation.id] || participation.unreadCount || 0,
              lastMessage: conversation.messages?.[0] || null,
              joinedAt: participation.joinedAt,
              leftAt: participation.leftAt
            };
          })
      );
      
      console.log('DEBUG: About to log conversation info');
      console.log('DEBUG: userId =', userId);
      console.log('DEBUG: conversations length =', conversations.length);
      console.log('DEBUG: first conversation id =', conversations[0]?.id);

    console.log('Socket connected - returning user conversations:', JSON.stringify({
                userId,
                conversationCount: conversations.length,
                conversationIds: conversations.map(c => c.id)
               }, null, 2));

      return conversations;
    } catch (error) {
      logger.error('Error getting user conversations', {
        userId,
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Get a single conversation by ID
   */
  async getConversationById(conversationId, userId) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { Conversation, ConversationParticipant, User, Message } = models;
      
      if (!Conversation || !ConversationParticipant || !User) {
        logger.error('Required models not found');
        return null;
      }
      
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        logger.warn('User is not a participant in this conversation', {
          userId,
          conversationId
        });
        return null;
      }
      
      // Get conversation from cache or database
      let conversation = await redisService.getConversation(conversationId);
      
      if (!conversation) {
        const dbConversation = await Conversation.findByPk(conversationId, {
          include: [{
            model: Message,
            as: 'messages',
            limit: 1,
            order: [['createdAt', 'DESC']]
          }]
        });
        
        if (!dbConversation) {
          return null;
        }
        
        conversation = dbConversation.toJSON();
        await redisService.cacheConversation(conversation);
      }
      
      // Get participant details
      const participantUsers = await User.findAll({
        where: { id: { [Op.in]: conversation.participantIds } },
        attributes: ['id', 'name', 'avatar', 'role', 'isOnline', 'lastSeen']
      });
      
      // Get presence info from Redis
      const presenceMap = await redisService.getUsersPresence(conversation.participantIds);
      
      // Enrich participant data
      const participants = participantUsers.map(user => {
        const presence = presenceMap[user.id];
        return {
          ...user.toJSON(),
          isOnline: presence ? presence.isOnline : user.isOnline,
          lastSeen: presence && presence.lastSeen ? presence.lastSeen : user.lastSeen
        };
      });
      
      return {
        ...conversation,
        participants,
        unreadCount: participation.unreadCount || 0
      };
    } catch (error) {
      logger.error('Error getting conversation by ID', {
        conversationId,
        userId,
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(creatorId, participantIds, jobId = null, jobTitle = null) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { Conversation, ConversationParticipant, User } = models;
      
      if (!Conversation || !ConversationParticipant || !User) {
        logger.error('Required models not found');
        throw new Error('Required models not available');
      }
      
      // Ensure creator is included in participants
      const allParticipantIds = [...new Set([creatorId, ...participantIds])];
      
      // Verify all participants exist
      const existingUsers = await User.findAll({
        where: { id: { [Op.in]: allParticipantIds } },
        attributes: ['id']
      });
      
      const existingUserIds = existingUsers.map(user => user.id);
      const missingUserIds = allParticipantIds.filter(id => !existingUserIds.includes(id));
      
      if (missingUserIds.length > 0) {
        throw new Error(`Users not found: ${missingUserIds.join(', ')}`);
      }
      
      // Create conversation
      const conversationId = uuidv4();
      const conversation = await Conversation.create({
        id: conversationId,
        jobId,
        jobTitle,
        participantIds: allParticipantIds,
        lastMessageAt: new Date()
      });
      
      // Create participant records
      const participantRecords = allParticipantIds.map(pId => ({
        id: uuidv4(),
        conversationId,
        userId: pId,
        unreadCount: pId === creatorId ? 0 : 0, // Start with 0 unread for all
        joinedAt: new Date()
      }));
      
      await ConversationParticipant.bulkCreate(participantRecords);
      
      // Cache the conversation
      await redisService.cacheConversation(conversation.toJSON());
      
      // Get participant details for response
      const participantUsers = await User.findAll({
        where: { id: { [Op.in]: allParticipantIds } },
        attributes: ['id', 'name', 'avatar', 'role']
      });
      
      return {
        ...conversation.toJSON(),
        participants: participantUsers.map(u => u.toJSON())
      };
    } catch (error) {
      logger.error('Error creating conversation', {
        creatorId,
        participantIds,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Add participants to an existing conversation
   */
  async addParticipants(conversationId, userId, newParticipantIds) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { Conversation, ConversationParticipant, User } = models;
      
      if (!Conversation || !ConversationParticipant || !User) {
        logger.error('Required models not found');
        throw new Error('Required models not available');
      }
      
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        throw new Error('Not authorized to add participants');
      }
      
      // Get conversation
      const conversation = await Conversation.findByPk(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      // Verify new participants exist
      const existingUsers = await User.findAll({
        where: { id: { [Op.in]: newParticipantIds } },
        attributes: ['id']
      });
      
      const existingUserIds = existingUsers.map(user => user.id);
      const missingUserIds = newParticipantIds.filter(id => !existingUserIds.includes(id));
      
      if (missingUserIds.length > 0) {
        throw new Error(`Users not found: ${missingUserIds.join(', ')}`);
      }
      
      // Filter out already existing participants
      const actualNewParticipantIds = newParticipantIds.filter(
        id => !conversation.participantIds.includes(id)
      );
      
      if (actualNewParticipantIds.length === 0) {
        throw new Error('All users are already participants');
      }
      
      // Update conversation
      const updatedParticipantIds = [...conversation.participantIds, ...actualNewParticipantIds];
      await conversation.update({ participantIds: updatedParticipantIds });
      
      // Create participant records
      const participantRecords = actualNewParticipantIds.map(pId => ({
        id: uuidv4(),
        conversationId,
        userId: pId,
        unreadCount: 0,
        joinedAt: new Date()
      }));
      
      await ConversationParticipant.bulkCreate(participantRecords);
      
      // Update cache
      await redisService.cacheConversation(conversation.toJSON());
      
      return {
        success: true,
        addedParticipantIds: actualNewParticipantIds,
        totalParticipants: updatedParticipantIds.length
      };
    } catch (error) {
      logger.error('Error adding participants to conversation', {
        conversationId,
        userId,
        newParticipantIds,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Remove a participant from a conversation
   */
  async removeParticipant(conversationId, userId, participantIdToRemove) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { Conversation, ConversationParticipant } = models;
      
      if (!Conversation || !ConversationParticipant) {
        logger.error('Required models not found');
        throw new Error('Required models not available');
      }
      
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        throw new Error('Not authorized to remove participants');
      }
      
      // Get conversation
      const conversation = await Conversation.findByPk(conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }
      
      // Check if participant exists
      if (!conversation.participantIds.includes(participantIdToRemove)) {
        throw new Error('User is not a participant');
      }
      
      // Prevent removing last participant
      if (conversation.participantIds.length <= 1) {
        throw new Error('Cannot remove the last participant');
      }
      
      // Update conversation
      const updatedParticipantIds = conversation.participantIds.filter(
        id => id !== participantIdToRemove
      );
      
      await conversation.update({ participantIds: updatedParticipantIds });
      
      // Update participant record
      await ConversationParticipant.update(
        { leftAt: new Date() },
        { where: { conversationId, userId: participantIdToRemove } }
      );
      
      // Update cache
      await redisService.cacheConversation(conversation.toJSON());
      
      return {
        success: true,
        removedParticipantId: participantIdToRemove,
        remainingParticipants: updatedParticipantIds.length
      };
    } catch (error) {
      logger.error('Error removing participant from conversation', {
        conversationId,
        userId,
        participantIdToRemove,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Mark conversation as read for a user
   */
  async markConversationAsRead(conversationId, userId) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { ConversationParticipant, Message } = models;
      
      if (!ConversationParticipant || !Message) {
        logger.error('Required models not found');
        throw new Error('Required models not available');
      }
      
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        throw new Error('Not a participant in this conversation');
      }
      
      // Reset unread count
      await ConversationParticipant.update(
        { unreadCount: 0 },
        { where: { conversationId, userId } }
      );
      
      // Reset Redis unread count
      await redisService.resetUnreadCount(userId, conversationId);
      
      // Mark all unread messages as read
      const updatedCount = await Message.update(
        { status: 'read' },
        { 
          where: { 
            conversationId, 
            receiverId: userId,
            status: { [Op.ne]: 'read' }
          } 
        }
      );
      
      return {
        success: true,
        messagesMarkedRead: updatedCount[0] || 0
      };
    } catch (error) {
      logger.error('Error marking conversation as read', {
        conversationId,
        userId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get conversation participants with details
   */
  async getConversationParticipants(conversationId, userId) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { ConversationParticipant, User } = models;
      
      if (!ConversationParticipant || !User) {
        logger.error('Required models not found');
        return [];
      }
      
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        logger.warn('User is not a participant in this conversation', {
          userId,
          conversationId
        });
        return [];
      }
      
      // Get all participants with user details
      const participants = await ConversationParticipant.findAll({
        where: { conversationId },
        include: [{
          model: User,
          as: 'user',
          attributes: ['id', 'name', 'avatar', 'role', 'isOnline', 'lastSeen']
        }]
      });
      
      // Get presence data from Redis
      const userIds = participants.map(p => p.userId);
      const presenceMap = await redisService.getUsersPresence(userIds);
      
      // Enrich participant data
      const enrichedParticipants = participants.map(p => {
        const presence = presenceMap[p.userId];
        return {
          ...p.toJSON(),
          user: {
            ...p.user.toJSON(),
            isOnline: presence ? presence.isOnline : p.user.isOnline,
            lastSeen: presence && presence.lastSeen ? presence.lastSeen : p.user.lastSeen
          }
        };
      });
      
      return enrichedParticipants;
    } catch (error) {
      logger.error('Error getting conversation participants', {
        conversationId,
        userId,
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }



  /**
 * Find conversation between two users
 * @param {string} userId1 - First user ID
 * @param {string} userId2 - Second user ID  
 * @param {string} jobId - Optional job ID for job-specific conversation
 * @returns {Object|null} - Conversation object or null
 */

  // services/socket/conversationService.js

async findDirectConversation(userId1, userId2, jobId = null) {
  try {
    await this.ensureDbInitialized();
    
    const models = db.getModels();
    const { Conversation } = models;
    
    if (!Conversation) {
      logger.error('Conversation model not found');
      return null;
    }
    
    // Build WHERE clause
    const whereClause = {
      deleted: false
    };
    
    // Critical: Match jobId exactly (null or specific value)
    if (jobId) {
      whereClause.jobId = jobId;
      whereClause.type = 'job_chat';
    } else {
      whereClause.jobId = null;
      whereClause.type = 'direct_message';
    }
    
    logger.info('Finding conversation:', { whereClause, userId1, userId2 });
    
    // Find ALL conversations matching jobId criteria
    const conversations = await Conversation.findAll({
      where: whereClause,
      order: [['createdAt', 'ASC']] // Oldest first
    });
    
    // Filter for exact participant match
    const exactMatches = conversations.filter(c => {
      const participants = c.participantIds || [];
      return participants.length === 2 &&
             participants.includes(userId1) &&
             participants.includes(userId2);
    });
    
    if (exactMatches.length > 1) {
      logger.error('DUPLICATE CONVERSATIONS FOUND!', {
        jobId,
        userId1,
        userId2,
        conversationIds: exactMatches.map(c => c.id)
      });
      // Return oldest one
      return exactMatches[0];
    }
    
    return exactMatches[0] || null;
    
  } catch (error) {
    logger.error('Error finding direct conversation', {
      userId1,
      userId2,
      jobId,
      error: error.message
    });
    return null;
  }
}

// services/socket/conversationService.js

/**
 * Find or create conversation atomically (prevents duplicates)
 */
async findOrCreateConversation(userId1, userId2, jobId = null, jobTitle = null) {
  try {
    await this.ensureDbInitialized();
    
    const models = db.getModels();
    const { Conversation, ConversationParticipant } = models;
    
    if (!Conversation || !ConversationParticipant) {
      throw new Error('Required models not available');
    }
    
    // Use transaction with serializable isolation
    const transaction = await Conversation.sequelize.transaction({
      isolationLevel: Conversation.sequelize.Transaction.ISOLATION_LEVELS.SERIALIZABLE
    });
    
    try {
      // Step 1: Try to find existing conversation
      const existing = await this.findDirectConversation(userId1, userId2, jobId);
      
      if (existing) {
        await transaction.commit();
        logger.info('Found existing conversation:', existing.id);
        return existing.id;
      }
      
      // Step 2: Create new conversation
      const conversationId = uuidv4();
      const participantIds = [userId1, userId2];
      
      const conversationData = {
        id: conversationId,
        type: jobId ? 'job_chat' : 'direct_message',
        participantIds: participantIds,
        createdBy: userId1,
        status: 'active',
        lastMessageAt: new Date()
      };
      
      if (jobId) {
        conversationData.jobId = jobId;
        if (jobTitle) {
          conversationData.jobTitle = jobTitle;
        }
      }
      
      await Conversation.create(conversationData, { transaction });
      
      // Create participant records
      await ConversationParticipant.bulkCreate([
        { 
          id: uuidv4(), 
          conversationId, 
          userId: userId1, 
          unreadCount: 0, 
          joinedAt: new Date() 
        },
        { 
          id: uuidv4(), 
          conversationId, 
          userId: userId2, 
          unreadCount: 0,
          joinedAt: new Date() 
        }
      ], { transaction });
      
      await transaction.commit();
      
      logger.info('Created new conversation:', {
        conversationId,
        type: conversationData.type,
        jobId,
        participants: participantIds
      });
      
      return conversationId;
      
    } catch (error) {
      await transaction.rollback();
      
      // Fallback: Someone else created it during our transaction
      logger.warn('Transaction failed, checking for race condition:', {
        error: error.message,
        userId1,
        userId2,
        jobId
      });
      
      const fallback = await this.findDirectConversation(userId1, userId2, jobId);
      if (fallback) {
        return fallback.id;
      }
      
      throw error;
    }
    
  } catch (error) {
    logger.error('Error in findOrCreateConversation', {
      userId1,
      userId2,
      jobId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

  /**
   * Check if a direct conversation exists between two users
   */
  /*
  async findDirectConversation(userId1, userId2) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { Conversation } = models;
      
      if (!Conversation) {
        logger.error('Conversation model not found');
        return null;
      }
      
      // Find conversations containing both users
      const conversations = await Conversation.findAll({
        where: {
          participantIds: {
            [Op.contains]: [userId1, userId2]
          }
        }
      });
      
      // Filter for direct conversations (only 2 participants)
      const directConversation = conversations.find(c => 
        c.participantIds.length === 2 &&
        c.participantIds.includes(userId1) &&
        c.participantIds.includes(userId2)
      );
      
      return directConversation || null;
    } catch (error) {
      logger.error('Error finding direct conversation', {
        userId1,
        userId2,
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }
*/
  /**
   * Get conversation messages
   */
  async getConversationMessages(conversationId, userId, options = {}) {
    try {
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const { ConversationParticipant, Message, User } = models;
      
      if (!ConversationParticipant || !Message || !User) {
        logger.error('Required models not found');
        return [];
      }
      
      // Verify user is a participant
      const participation = await ConversationParticipant.findOne({
        where: { conversationId, userId }
      });
      
      if (!participation) {
        logger.warn('User is not a participant in this conversation', {
          userId,
          conversationId
        });
        return [];
      }
      
      const { limit = 50, offset = 0, before, after } = options;
      
      // Build query
      const where = { 
        conversationId,
        deleted: false
      };
      
      if (before) {
        where.createdAt = { ...where.createdAt, [Op.lt]: new Date(before) };
      }
      
      if (after) {
        where.createdAt = { ...where.createdAt, [Op.gt]: new Date(after) };
      }
      
      // Get messages from cache or database
      let messages = await redisService.getConversationMessages(conversationId, limit, offset);
      
      if (!messages || messages.length === 0) {
        // Fetch from database
        messages = await Message.findAll({
          where,
          order: [['createdAt', before ? 'DESC' : 'ASC']],
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
        // Cache messages
        for (const message of messages) {
          await redisService.cacheMessage(message.toJSON());
        }
      }
      
      // Get sender details
      const senderIds = [...new Set(messages.map(m => m.senderId))];
      const senders = await User.findAll({
        where: { id: { [Op.in]: senderIds } },
        attributes: ['id', 'name', 'avatar']
      });
      
      const senderMap = senders.reduce((map, sender) => {
        map[sender.id] = sender.toJSON();
        return map;
      }, {});
      
      // Format messages
      const formattedMessages = messages.map(message => ({
        ...message,
        sender: senderMap[message.senderId] || null
      }));
      
      return formattedMessages;
    } catch (error) {
      logger.error('Error getting conversation messages', {
        conversationId,
        userId,
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }
}

module.exports = new ConversationService();