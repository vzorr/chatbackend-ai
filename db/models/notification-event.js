module.exports = (sequelize, DataTypes) => {
  const NotificationEvent = sequelize.define('NotificationEvent', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    categoryId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'category_id'
    },
    eventKey: {
      type: DataTypes.STRING(100),
      unique: true,
      allowNull: false,
      field: 'event_key'
    },
    eventName: {
      type: DataTypes.STRING(200),
      allowNull: false,
      field: 'event_name'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    defaultPriority: {
      type: DataTypes.STRING(20),
      defaultValue: 'normal',
      field: 'default_priority'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    }
  }, {
    tableName: 'notification_events',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['event_key']
      },
      {
        fields: ['category_id']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['category_id', 'is_active']
      }
    ]
  });

  NotificationEvent.associate = function(models) {
    NotificationEvent.belongsTo(models.NotificationCategory, {
      foreignKey: 'categoryId',
      as: 'category'
    });
    NotificationEvent.hasMany(models.NotificationTemplate, {
      foreignKey: 'eventId',
      as: 'templates'
    });
    NotificationEvent.hasMany(models.NotificationLog, {
      foreignKey: 'eventId',
      as: 'notifications'
    });
  };

  return NotificationEvent;
};