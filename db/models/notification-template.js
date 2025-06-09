module.exports = (sequelize, DataTypes) => {
  const NotificationTemplate = sequelize.define('NotificationTemplate', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    eventId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'event_id'
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
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    priority: {
      type: DataTypes.ENUM('low', 'normal', 'high'),
      defaultValue: 'normal'
    },
    defaultEnabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'default_enabled'
    },
   platforms: {
  type: DataTypes.JSON,
  allowNull: false,
  defaultValue: ['ios', 'android']
},
    metaData: {
      type: DataTypes.JSON,
      allowNull: true,
      field: 'meta_data'
    }
  }, {
    tableName: 'notification_templates',
    timestamps: true,
    underscored: true,
    indexes: [
      {
        unique: true,
        fields: ['event_id', 'app_id'],
        name: 'unique_event_app_template'
      },
      {
        fields: ['event_id']
      },
      {
        fields: ['app_id']
      }
    ]
  });

  NotificationTemplate.associate = function(models) {
    NotificationTemplate.belongsTo(models.NotificationEvent, {
      foreignKey: 'eventId',
      as: 'event'
    });
    NotificationTemplate.hasMany(models.NotificationLog, {
      foreignKey: 'templateId',
      as: 'notifications'
    });
  };

  return NotificationTemplate;
};