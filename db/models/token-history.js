// db/models/token-history.js
'use strict';

module.exports = (sequelize, DataTypes) => {
  const TokenHistory = sequelize.define('TokenHistory', {
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
      allowNull: false
    },
    tokenType: {
      type: DataTypes.ENUM('FCM', 'APN', 'WEB_PUSH'),
      allowNull: false
    },
    deviceId: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Unique device identifier'
    },
    deviceModel: {
      type: DataTypes.STRING,
      allowNull: true
    },
    deviceOS: {
      type: DataTypes.STRING,
      allowNull: true
    },
    appVersion: {
      type: DataTypes.STRING,
      allowNull: true
    },
    action: {
      type: DataTypes.ENUM('REGISTERED', 'RENEWED', 'EXPIRED', 'REVOKED', 'FAILED'),
      allowNull: false
    },
    previousToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Previous token if this is a renewal'
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Additional metadata for audit'
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: true
    },
    userAgent: {
      type: DataTypes.STRING,
      allowNull: true
    },
    errorDetails: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Error details if action is FAILED'
    }
  }, {
    tableName: 'token_history',
    timestamps: true,
    indexes: [
      {
        fields: ['userId', 'createdAt']
      },
      {
        fields: ['token'],
        unique: false
      },
      {
        fields: ['deviceId', 'userId']
      },
      {
        fields: ['action', 'createdAt']
      }
    ]
  });

  TokenHistory.associate = function(models) {
    TokenHistory.belongsTo(models.User, {
      foreignKey: 'userId',
      as: 'user'
    });
  };

  // Static methods for audit logging
  TokenHistory.logTokenRegistration = async function(tokenData) {
    const { 
      userId, 
      token, 
      tokenType, 
      deviceId, 
      deviceModel, 
      deviceOS, 
      appVersion,
      ipAddress,
      userAgent 
    } = tokenData;

    return this.create({
      userId,
      token,
      tokenType,
      deviceId,
      deviceModel,
      deviceOS,
      appVersion,
      action: 'REGISTERED',
      ipAddress,
      userAgent,
      metadata: {
        registeredAt: new Date(),
        source: 'API'
      }
    });
  };

  TokenHistory.logTokenRenewal = async function(tokenData) {
    const { 
      userId, 
      token, 
      previousToken,
      tokenType, 
      deviceId, 
      reason 
    } = tokenData;

    return this.create({
      userId,
      token,
      tokenType,
      deviceId,
      action: 'RENEWED',
      previousToken,
      metadata: {
        renewalReason: reason,
        renewedAt: new Date()
      }
    });
  };

  TokenHistory.logTokenRevocation = async function(tokenData) {
    const { 
      userId, 
      token, 
      tokenType, 
      reason,
      revokedBy 
    } = tokenData;

    return this.create({
      userId,
      token,
      tokenType,
      action: 'REVOKED',
      metadata: {
        revocationReason: reason,
        revokedBy,
        revokedAt: new Date()
      }
    });
  };

  TokenHistory.logTokenFailure = async function(tokenData) {
    const { 
      userId, 
      token, 
      tokenType, 
      error,
      deviceId 
    } = tokenData;

    return this.create({
      userId,
      token,
      tokenType,
      deviceId,
      action: 'FAILED',
      errorDetails: {
        message: error.message,
        code: error.code,
        stack: error.stack,
        failedAt: new Date()
      }
    });
  };

  // Get active token history for a user
  TokenHistory.getUserActiveTokens = async function(userId, tokenType = null) {
    const where = {
      userId,
      action: ['REGISTERED', 'RENEWED'],
      createdAt: {
        [Op.gte]: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) // Last 90 days
      }
    };

    if (tokenType) {
      where.tokenType = tokenType;
    }

    return this.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 10
    });
  };

  // Get token audit trail
  TokenHistory.getTokenAuditTrail = async function(token) {
    return this.findAll({
      where: { token },
      order: [['createdAt', 'DESC']],
      include: [
        {
          model: sequelize.models.User,
          as: 'user',
          attributes: ['id', 'name', 'externalId']
        }
      ]
    });
  };

  return TokenHistory;
};