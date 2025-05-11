'use strict';

module.exports = (sequelize, DataTypes) => {
  const ConversationParticipant = sequelize.define('ConversationParticipant', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    unreadCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    isBlocked: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    joinedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    leftAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'conversation_participants',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['conversationId', 'userId']
      }
    ]
  });

  ConversationParticipant.associate = function(models) {
    ConversationParticipant.belongsTo(models.Conversation, {
      foreignKey: 'conversationId',
      as: 'conversation'
    });
    
    ConversationParticipant.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
  };

  // Instance methods
  ConversationParticipant.prototype.markAsRead = async function() {
    this.unreadCount = 0;
    return this.save();
  };

  // Static methods
  ConversationParticipant.getUnreadCountsByUserId = async function(userId) {
    const { Op } = require('sequelize');
    const participants = await ConversationParticipant.findAll({
      where: {
        userId,
        unreadCount: {
          [Op.gt]: 0
        }
      }
    });
    
    const result = {};
    participants.forEach(p => {
      result[p.conversationId] = p.unreadCount;
    });
    
    return result;
  };

  return ConversationParticipant;
};
