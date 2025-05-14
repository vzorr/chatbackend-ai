// /services/socket/conversationService.js
const db = require('../../db');
const logger = require('../../utils/logger');

class ConversationService {
  async ensureDbInitialized() {
    if (!db.isInitialized()) {
      logger.info('Database not initialized, waiting...');
      await db.waitForInitialization();
    }
  }

  async getUserConversationIds(userId) {
    try {
      // Ensure DB is initialized
      await this.ensureDbInitialized();
      
      const models = db.getModels();
      const ConversationParticipant = models.ConversationParticipant;
      
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
}

module.exports = new ConversationService();