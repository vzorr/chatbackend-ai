// db/models/notification-log.js
module.exports = (sequelize, DataTypes) => {
    const NotificationLog = sequelize.define('NotificationLog', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false
      },
      deviceToken: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      eventId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      appId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM('queued', 'sent', 'delivered', 'failed'),
        defaultValue: 'queued'
      },
      channel: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'push'
      },
      platform: {
        type: DataTypes.STRING,
        allowNull: true
      },
      errorDetails: {
        type: DataTypes.JSON,
        allowNull: true
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      deliveredAt: {
        type: DataTypes.DATE,
        allowNull: true
      },
      readAt: {
        type: DataTypes.DATE,
        allowNull: true
      }
    }, {
      tableName: 'notification_logs',
      timestamps: true,
      indexes: [
        {
          fields: ['userId', 'createdAt']
        },
        {
          fields: ['eventId']
        },
        {
          fields: ['status']
        }
      ]
    });
  
    return NotificationLog;
  };