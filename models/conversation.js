'use strict';

module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define('Conversation', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    jobId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    jobTitle: {
      type: DataTypes.STRING,
      allowNull: true
    },
    participantIds: {
      type: DataTypes.ARRAY(DataTypes.UUID),
      allowNull: false
    },
    lastMessageAt: {
      type: DataTypes.DATE
    }
  }, {
    tableName: 'conversations',
    timestamps: true
  });

  Conversation.associate = function(models) {
    Conversation.hasMany(models.Message, {
      foreignKey: 'conversationId',
      as: 'messages'
    });
    
    Conversation.hasMany(models.ConversationParticipant, {
      foreignKey: 'conversationId',
      as: 'participants'
    });
  };

  // Instance methods
  Conversation.prototype.getParticipantIds = async function() {
    const participants = await this.getParticipants();
    return participants.map(p => p.userId);
  };

  // Static methods
  Conversation.findByParticipants = async function(userIds) {
    const { Op } = require('sequelize');
    return Conversation.findAll({
      where: {
        participantIds: {
          [Op.contains]: userIds
        }
      }
    });
  };

  return Conversation;
};
