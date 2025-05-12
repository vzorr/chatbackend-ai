// /services/socket/conversationService.js
const { ConversationParticipant } = require('../../db/models');

class ConversationService {
  async getUserConversationIds(userId) {
    const conversations = await ConversationParticipant.findAll({
      where: { userId },
      attributes: ['conversationId']
    });
    return conversations.map((c) => c.conversationId);
  }
}

module.exports = new ConversationService();
