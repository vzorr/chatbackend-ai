'use strict';

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    role: {
      type: DataTypes.ENUM("client", "freelancer", "admin"),
      defaultValue: "freelancer",
      allowNull: false
    },
    socketId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isOnline: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    lastSeen: {
      type: DataTypes.DATE,
      allowNull: true
    },
    avatar: {
      type: DataTypes.STRING,
      allowNull: true
    },
    metaData: {
      type: DataTypes.JSON,
      allowNull: true
    }
  }, {
    tableName: "users",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['phone']
      }
    ]
  });

  User.associate = function(models) {
    User.hasMany(models.Message, { foreignKey: "senderId", as: "sentMessages" });
    User.hasMany(models.Message, { foreignKey: "receiverId", as: "receivedMessages" });
    User.hasMany(models.ConversationParticipant, { foreignKey: 'userId', as: 'conversationParticipations' });
    User.hasMany(models.DeviceToken, { foreignKey: 'userId', as: 'deviceTokens' });
  };

  // Instance methods
  User.prototype.getConversations = async function() {
    const { models } = sequelize;
    
    const participations = await models.ConversationParticipant.findAll({
      where: { userId: this.id },
      include: [{
        model: models.Conversation,
        as: 'conversation',
        include: [{
          model: models.Message,
          as: 'messages',
          limit: 1,
          order: [['createdAt', 'DESC']]
        }]
      }],
      order: [[sequelize.literal('"conversation.lastMessageAt"'), 'DESC']]
    });
    
    return participations.map(p => p.conversation);
  };

  User.prototype.getActiveDeviceTokens = async function() {
    const { models } = sequelize;
    
    return models.DeviceToken.findAll({
      where: { userId: this.id }
    });
  };

  return User;
};
