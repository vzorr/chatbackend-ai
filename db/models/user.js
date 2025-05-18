'use strict';

const { v4: uuidv4 } = require('uuid');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
    },
    externalId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
      comment: 'UUID of the user from the main React Native application'
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true
    },
    role: {
      type: DataTypes.ENUM("customer", "usta", "administrator"),
      defaultValue: "customer",
      allowNull: false,
      validate: {
        isIn: {
          args: [["customer", "usta", "administrator"]],
          msg: "Role must be one of: customer, usta, administrator"
        }
      }
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
      },
      {
        unique: true,
        fields: ['externalId']
      }
    ]
  });

  User.associate = function(models) {
    User.hasMany(models.Message, { foreignKey: "senderId", as: "sentMessages" });
    User.hasMany(models.Message, { foreignKey: "receiverId", as: "receivedMessages" });
    User.hasMany(models.ConversationParticipant, { foreignKey: 'userId', as: 'conversationParticipations' });
    User.hasMany(models.DeviceToken, { foreignKey: 'userId', as: 'deviceTokens' });
  };

  // Add method to find or create user from token data
  User.findOrCreateFromToken = async function(tokenData) {
    try {
      // Check if the externalId is a valid UUID
      const isValidUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const externalId = tokenData.id || tokenData.userId || tokenData.sub;
      
      if (!externalId || !isValidUUID.test(externalId)) {
        throw new Error('Invalid external user ID. Must be a valid UUID');
      }
      
      // First try to find by externalId
      let user = await this.findOne({ where: { externalId } });

      // Validate role using isIn validator
      let role = tokenData.role || 'customer';
      if (!['customer', 'usta', 'administrator'].includes(role.toLowerCase())) {
        console.warn(`Invalid role value "${role}" detected, defaulting to "customer"`);
        role = 'customer';
      } else {
        role = role.toLowerCase();
      }

      if (!user) {
        // Generate UUID manually for id
        user = await this.create({
          id: uuidv4(),   // ✅ Correct and explicit UUID generation
          externalId,
          name: tokenData.name || 'User',
          phone: tokenData.phone || 'unknown',  // Ensure phone is present due to allowNull: false
          email: tokenData.email || null,
          role: role,
          isOnline: true
        });
      }

      return user;
    } catch (error) {
      console.error("Error in findOrCreateFromToken:", error);
      throw error;
    }
  };

  return User;
};