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
      field: 'user_id' // ✅ ADDED: Consistent with underscored naming
    },
    token: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true
    },
    deviceType: {
      type: DataTypes.ENUM('mobile', 'web'),
      defaultValue: 'mobile',
      field: 'device_type' // ✅ ADDED: Consistent with underscored naming
    },
    platform: {
      type: DataTypes.STRING,
      allowNull: true
    },
    deviceId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'device_id' // ✅ ADDED: Consistent with underscored naming
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lastUsed: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'last_used' // ✅ ADDED: Consistent with underscored naming
    }
  }, {
    tableName: 'device_tokens',
    timestamps: true,
    underscored: true, // ✅ ADDED: Ensures all fields use snake_case
    indexes: [
      {
        unique: true,
        fields: ['token']
      },
      {
        fields: ['user_id'] // ✅ UPDATED: Use underscored field name
      },
      {
        fields: ['device_id'] // ✅ UPDATED: Use underscored field name
      },
      {
        fields: ['user_id', 'platform'] // ✅ ADDED: Useful for finding user's tokens by platform
      },
      {
        fields: ['active'] // ✅ ADDED: For filtering active tokens
      }
    ]
  });

  DeviceToken.associate = function(models) {
    DeviceToken.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
    // ✅ ADDED: Association with notification logs for tracking which device received notifications
    DeviceToken.hasMany(models.NotificationLog, {
      foreignKey: 'deviceToken',
      sourceKey: 'token',
      as: 'notifications'
    });
  };

  return DeviceToken;
};