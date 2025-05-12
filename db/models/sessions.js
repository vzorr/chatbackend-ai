'use strict';

module.exports = (sequelize, DataTypes) => {
  const Session = sequelize.define('Session', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    socketId: {
      type: DataTypes.STRING,
      allowNull: false
    },
    deviceType: {
      type: DataTypes.ENUM('web', 'ios', 'android', 'desktop', 'unknown'),
      defaultValue: 'unknown'
    },
    deviceName: {
      type: DataTypes.STRING,
      allowNull: true
    },
    deviceFingerprint: {
      type: DataTypes.STRING,
      allowNull: true
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    },
    location: {
      type: DataTypes.JSON,
      allowNull: true
    },
    authToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    connectedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    lastActivityAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    disconnectedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    pushToken: {
      type: DataTypes.STRING,
      allowNull: true
    },
    appVersion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    platformVersion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    logoutReason: {
      type: DataTypes.STRING,
      allowNull: true
    }
  }, {
    tableName: 'sessions',
    timestamps: true
  });

  Session.associate = function(models) {
    Session.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return Session;
};
