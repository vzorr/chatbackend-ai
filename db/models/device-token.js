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
      allowNull: false,
      field: 'user_id'
    },
    token: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: false // ✅ CHANGED: Removed uniqueness to allow same token on multiple devices
    },
    deviceType: {
      type: DataTypes.ENUM('mobile', 'web'),
      defaultValue: 'mobile',
      field: 'device_type'
    },
    platform: {
      type: DataTypes.STRING,
      allowNull: true
    },
    deviceId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'device_id'
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lastUsed: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'last_used'
    }
  }, {
    tableName: 'device_tokens',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        // ✅ CHANGED: Non-unique index on token for performance
        unique: false,
        fields: ['token'],
        name: 'idx_device_tokens_token_non_unique'
      },
      {
        // ✅ ADDED: Composite unique constraint for proper device management
        unique: true,
        fields: ['user_id', 'device_id'],
        name: 'unique_user_device'
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['device_id']
      },
      {
        fields: ['user_id', 'platform']
      },
      {
        fields: ['active']
      }
    ]
  });

  DeviceToken.associate = function(models) {
    DeviceToken.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
    
    DeviceToken.hasMany(models.NotificationLog, {
      foreignKey: 'deviceToken',
      sourceKey: 'token',
      as: 'notifications'
    });
  };



  return DeviceToken;
};