// db/models/notification-preference.js
module.exports = (sequelize, DataTypes) => {
    const NotificationPreference = sequelize.define('NotificationPreference', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false
      },
      eventId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      appId: {
        type: DataTypes.STRING,
        allowNull: false
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
      },
      channels: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        defaultValue: ['push', 'email'],
        comment: 'Which channels this notification is enabled for'
      },
      updatedBy: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Who updated this preference (user or system)'
      }
    }, {
      tableName: 'notification_preferences',
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ['userId', 'eventId', 'appId']
        }
      ]
    });
  
    return NotificationPreference;
  };