'use strict';

module.exports = (sequelize, DataTypes) => {
  const DeviceToken = sequelize.define('DeviceToken', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    token: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true
    },
    deviceType: {
      type: DataTypes.ENUM('mobile', 'web'),
      defaultValue: 'mobile'
    },
    platform: {
      type: DataTypes.STRING,
      allowNull: true
    },
    deviceId: {
      type: DataTypes.STRING,
      allowNull: true
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lastUsed: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'device_tokens',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['token']
      },
      {
        fields: ['userId']
      },
      {
        fields: ['deviceId']
      }
    ]
  });

  DeviceToken.associate = function(models) {
    DeviceToken.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
  };

  return DeviceToken;
};