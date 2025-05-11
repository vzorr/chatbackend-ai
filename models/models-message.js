'use strict';

module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    conversationId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    jobId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    senderId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    receiverId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM("text", "image", "file", "emoji", "audio", "system"),
      defaultValue: "text",
    },
    content: {
      type: DataTypes.JSON, // Stores text, images, audio, replyTo, attachments
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("sent", "delivered", "read"),
      defaultValue: "sent",
    },
    deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    clientTempId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isSystemMessage: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    }
  }, {
    tableName: "messages",
    timestamps: true,
    indexes: [
      {
        fields: ['conversationId', 'createdAt']
      },
      {
        fields: ['senderId', 'receiverId', 'createdAt']
      },
      {
        fields: ['status']
      }
    ]
  });

  Message.associate = function(models) {
    Message.belongsTo(models.User, { foreignKey: "senderId", as: "sender" });
    Message.belongsTo(models.User, { foreignKey: "receiverId", as: "receiver" });
    Message.belongsTo(models.Conversation, { foreignKey: "conversationId", as: "conversation" });
    Message.hasMany(models.MessageVersion, { foreignKey: "messageId", as: "versions" });
  };

  // Instance methods
  Message.prototype.markAsRead = async function() {
    this.status = 'read';
    return this.save();
  };

  Message.prototype.markAsDelivered = async function() {
    if (this.status === 'sent') {
      this.status = 'delivered';
      return this.save();
    }
    return this;
  };

  // Static methods
  Message.getLatestInConversation = async function(conversationId, limit = 50) {
    return Message.findAll({
      where: { conversationId, deleted: false },
      order: [['createdAt', 'DESC']],
      limit
    });
  };

  return Message;
};
