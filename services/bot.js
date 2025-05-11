// services/bot.js
const { v4: uuidv4 } = require('uuid');
const { Message, Conversation, ConversationParticipant } = require('../db/models');
const ragService = require('./rag');
const { getBotUser } = require('./botUser');
const redisService = require('./redis');
const logger = require('../utils/logger');

// Handle a user message directed to the bot
const handleUserMessage = async (userMessage, userId, conversationId = null) => {
  try {
    // Get bot user from database
    const bot = await getBotUser();
    
    // Get or create a conversation between user and bot
    let targetConversationId = conversationId;
    
    if (!targetConversationId) {
      // Check if a conversation already exists
      const existingConversation = await Conversation.findOne({
        where: {
          participantIds: [userId, bot.id]
        }
      });
      
      if (existingConversation) {
        targetConversationId = existingConversation.id;
      } else {
        // Create new conversation
        const newConversation = await Conversation.create({
          id: uuidv4(),
          participantIds: [userId, bot.id],
          lastMessageAt: new Date()
        });
        
        // Create participants
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
            userId: bot.id,
            unreadCount: 0,
            joinedAt: new Date()
          }
        ]);
        
        targetConversationId = newConversation.id;
      }
    }
    
    // Process user message
    const { message: botResponse, sources } = await ragService.generateRagResponse(
      userMessage.content.text,
      userId,
      targetConversationId
    );
    
    // Save bot response
    const messageId = uuidv4();
    
    const responseMessage = await Message.create({
      id: messageId,
      conversationId: targetConversationId,
      senderId: bot.id,
      receiverId: userId,
      type: 'text',
      content: {
        text: botResponse,
        sources: sources
      },
      status: 'sent'
    });
    
    // Update conversation last message time
    await Conversation.update(
      { lastMessageAt: new Date() },
      { where: { id: targetConversationId } }
    );
    
    // Cache message for socket delivery
    await redisService.cacheMessage(responseMessage);
    
    // Return response for socket event
    return {
      messageId,
      conversationId: targetConversationId,
      botMessage: botResponse,
      sources
    };
    
  } catch (error) {
    logger.error(`Error handling bot message: ${error}`);
    throw error;
  }
};

// Initialize bot user in the database
const initializeBot = async () => {
  try {
    const [botUser, created] = await User.findOrCreate({
      where: { phone: '+bot' },
      defaults: {
        id: uuidv4(),
        name: 'VortexHive Bot',
        phone: '+bot',
        role: 'admin',
        avatar: '/uploads/bot-avatar.png',
        isOnline: true
      }
    });
    
    if (created) {
      logger.info('Bot user created in database');
    } else {
      logger.info('Bot user already exists in database');
    }
    
    return botUser;
  } catch (error) {
    logger.error(`Error initializing bot: ${error}`);
    throw error;
  }
};

module.exports = {
  handleUserMessage,
  initializeBot
};