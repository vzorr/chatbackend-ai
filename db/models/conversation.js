// Updated conversation.js model
'use strict';

module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define('Conversation', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    type: {
      type: DataTypes.ENUM('job_chat', 'direct_message'),
      defaultValue: 'direct_message',
      allowNull: false
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
    status: {
      type: DataTypes.ENUM('active', 'closed', 'archived'),
      defaultValue: 'active',
      allowNull: false
    },
    createdBy: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    closedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastMessageAt: {
      type: DataTypes.DATE
    },
    deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'conversations',
    timestamps: true,
    paranoid: false,
    indexes: [
      {
        fields: ['type']
      },
      {
        fields: ['status']
      },
      {
        fields: ['createdBy']
      },
      {
        fields: ['jobId']
      }
    ]
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
    
    Conversation.belongsTo(models.User, {
      foreignKey: 'createdBy',
      as: 'creator'
    });
  };

  // Instance methods
  Conversation.prototype.getFormattedData = async function(userId) {
    const participants = await this.getParticipants({
      include: [{
        model: sequelize.models.User,
        as: 'user',
        attributes: ['id', 'name', 'avatar', 'role']
      }]
    });
    
    const userParticipation = participants.find(p => p.userId === userId);
    
    // Get last message
    const lastMessage = await sequelize.models.Message.findOne({
      where: { 
        conversationId: this.id,
        deleted: false 
      },
      order: [['createdAt', 'DESC']],
      include: [{
        model: sequelize.models.User,
        as: 'sender',
        attributes: ['id', 'name', 'avatar']
      }]
    });
    
    return {
      id: this.id,
      type: this.type,
      participants: participants.map(p => ({
        userId: p.userId,
        role: p.user.role,
        joinedAt: p.joinedAt,
        isActive: !p.leftAt
      })),
      metadata: {
        jobId: this.jobId,
        jobTitle: this.jobTitle,
        status: this.status,
        createdBy: this.createdBy,
        closedAt: this.closedAt
      },
      settings: userParticipation ? {
        isMuted: userParticipation.isMuted,
        isPinned: userParticipation.isPinned,
        notificationEnabled: userParticipation.notificationEnabled
      } : null,
      lastMessage: lastMessage,
      unreadCount: userParticipation ? userParticipation.unreadCount : 0,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  };

  // Static methods
  Conversation.findByParticipants = async function(userIds) {
    const { Op } = require('sequelize');
    return Conversation.findAll({
      where: {
        participantIds: {
          [Op.contains]: userIds
        },
        deleted: false
      }
    });
  };

  return Conversation;
};

