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
      allowNull: false,
      references: {
        model: 'users',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    },
    socketId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
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
      allowNull: true,
      comment: 'Unique device identifier for tracking'
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isIP: true
      }
    },
    location: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Geolocation data if available'
    },
    authToken: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Hashed authentication token'
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
      allowNull: true,
      defaultValue: DataTypes.NOW
    },
    disconnectedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    pushToken: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Token for push notifications'
    },
    appVersion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    platformVersion: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'iOS/Android version'
    },
    logoutReason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    connectionQuality: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {},
      comment: 'Metrics about connection quality'
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    sessionDuration: {
      type: DataTypes.VIRTUAL,
      get() {
        if (this.connectedAt && this.disconnectedAt) {
          return this.disconnectedAt - this.connectedAt;
        } else if (this.connectedAt && this.isActive) {
          return new Date() - this.connectedAt;
        }
        return 0;
      }
    }
  }, {
    tableName: 'sessions',
    timestamps: true,
    paranoid: false,
    indexes: [
      {
        fields: ['userId', 'isActive']
      },
      {
        fields: ['socketId']
      },
      {
        fields: ['deviceFingerprint']
      },
      {
        fields: ['connectedAt']
      },
      {
        fields: ['isActive', 'lastActivityAt']
      }
    ],
    hooks: {
      beforeCreate: (session) => {
        if (!session.connectedAt) {
          session.connectedAt = new Date();
        }
        if (!session.lastActivityAt) {
          session.lastActivityAt = new Date();
        }
      },
      beforeUpdate: (session) => {
        if (session.changed('isActive') && !session.isActive) {
          session.disconnectedAt = new Date();
        }
      }
    }
  });

  Session.associate = function(models) {
    Session.belongsTo(models.User, { 
      foreignKey: 'userId', 
      as: 'user' 
    });
  };

  // Instance methods
  Session.prototype.updateActivity = async function() {
    this.lastActivityAt = new Date();
    return this.save();
  };

  Session.prototype.disconnect = async function(reason = null) {
    this.isActive = false;
    this.disconnectedAt = new Date();
    if (reason) {
      this.logoutReason = reason;
    }
    return this.save();
  };

  Session.prototype.updateConnectionQuality = async function(metrics) {
    this.connectionQuality = {
      ...this.connectionQuality,
      ...metrics,
      timestamp: new Date()
    };
    return this.save();
  };

  // Static methods
  Session.getActiveSessions = async function(userId = null) {
    const where = { isActive: true };
    if (userId) {
      where.userId = userId;
    }
    
    return Session.findAll({
      where,
      include: [{
        model: sequelize.models.User,
        as: 'user',
        attributes: ['id', 'name', 'email', 'avatar']
      }],
      order: [['connectedAt', 'DESC']]
    });
  };

  Session.getSessionBySocketId = async function(socketId) {
    return Session.findOne({
      where: { socketId },
      include: [{
        model: sequelize.models.User,
        as: 'user',
        attributes: ['id', 'name', 'email', 'avatar']
      }]
    });
  };

  Session.getRecentSessions = async function(userId, limit = 10) {
    return Session.findAll({
      where: { userId },
      order: [['connectedAt', 'DESC']],
      limit
    });
  };

  Session.cleanupInactiveSessions = async function(inactiveMinutes = 30) {
    const cutoffTime = new Date(Date.now() - inactiveMinutes * 60 * 1000);
    
    const updated = await Session.update(
      { 
        isActive: false,
        disconnectedAt: new Date(),
        logoutReason: 'inactivity_timeout'
      },
      {
        where: {
          isActive: true,
          lastActivityAt: {
            [DataTypes.Op.lt]: cutoffTime
          }
        }
      }
    );
    
    return updated[0]; // number of rows updated
  };

  Session.getUserDevices = async function(userId) {
    const { Op } = require('sequelize');
    
    return Session.findAll({
      where: {
        userId,
        deviceFingerprint: {
          [Op.ne]: null
        }
      },
      attributes: [
        'deviceFingerprint',
        'deviceType',
        'deviceName',
        'platformVersion',
        'appVersion',
        [sequelize.fn('MAX', sequelize.col('lastActivityAt')), 'lastSeen'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'sessionCount']
      ],
      group: ['deviceFingerprint', 'deviceType', 'deviceName', 'platformVersion', 'appVersion'],
      order: [[sequelize.fn('MAX', sequelize.col('lastActivityAt')), 'DESC']]
    });
  };

  Session.getSessionMetrics = async function(userId = null, timeRange = '24h') {
    const { Op } = require('sequelize');
    
    // Calculate time range
    const ranges = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    const cutoffTime = new Date(Date.now() - (ranges[timeRange] || ranges['24h']));
    
    const where = {
      connectedAt: {
        [Op.gte]: cutoffTime
      }
    };
    
    if (userId) {
      where.userId = userId;
    }
    
    const sessions = await Session.findAll({
      where,
      attributes: [
        'deviceType',
        'isActive',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        [sequelize.fn('AVG', sequelize.literal('EXTRACT(EPOCH FROM ("disconnectedAt" - "connectedAt"))')), 'avgDuration']
      ],
      group: ['deviceType', 'isActive']
    });
    
    return sessions;
  };

  return Session;
};