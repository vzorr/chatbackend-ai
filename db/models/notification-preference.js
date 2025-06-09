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
      allowNull: false,
      field: 'user_id'
    },
    eventId: {
      type: DataTypes.UUID, // ✅ CHANGED: Was STRING, now UUID
      allowNull: false,
      field: 'event_id'
    },
    appId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'app_id'
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
      field: 'updated_by',
      comment: 'Who updated this preference (user or system)'
    }
  }, {
    tableName: 'notification_preferences',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['user_id', 'event_id', 'app_id']
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['event_id']
      },
      {
        fields: ['app_id']
      }
    ]
  });

  NotificationPreference.associate = function(models) {
    NotificationPreference.belongsTo(models.NotificationEvent, {
      foreignKey: 'eventId',
      as: 'event'
    });
  };

  return NotificationPreference;
};