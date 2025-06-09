module.exports = (sequelize, DataTypes) => {
  const NotificationLog = sequelize.define('NotificationLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    recipientId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'recipient_id'
    },
    triggeredBy: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'triggered_by'
    },
    eventId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'event_id'
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'template_id'
    },
    categoryId: {
      type: DataTypes.UUID, // ✅ CHANGED: Was INTEGER, now UUID
      allowNull: true,
      field: 'category_id'
    },
    businessEntityType: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: 'business_entity_type'
    },
    businessEntityId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'business_entity_id'
    },
    deviceToken: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'device_token'
    },
    appId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'app_id'
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
      type: DataTypes.ENUM('queued', 'processing', 'sent', 'delivered', 'failed'),
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
      allowNull: true,
      field: 'error_details'
    },
    sentAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'sent_at'
    },
    deliveredAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'delivered_at'
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'read_at'
    }
  }, {
    tableName: 'notification_logs',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['recipient_id', 'created_at']
      },
      {
        fields: ['recipient_id', 'category_id']
      },
      {
        fields: ['event_id']
      },
      {
        fields: ['template_id']
      },
      {
        fields: ['triggered_by']
      },
      {
        fields: ['business_entity_type', 'business_entity_id']
      },
      {
        fields: ['recipient_id', 'read_at']
      },
      {
        fields: ['status']
      },
      {
        fields: ['app_id']
      }
    ]
  });

  NotificationLog.associate = function(models) {
    NotificationLog.belongsTo(models.NotificationEvent, {
      foreignKey: 'eventId',
      as: 'event'
    });
    NotificationLog.belongsTo(models.NotificationTemplate, {
      foreignKey: 'templateId',
      as: 'template'
    });
    NotificationLog.belongsTo(models.NotificationCategory, {
      foreignKey: 'categoryId',
      as: 'category'
    });
  };

  return NotificationLog;
};