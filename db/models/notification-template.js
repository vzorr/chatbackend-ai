module.exports = (sequelize, DataTypes) => {
    const NotificationTemplate = sequelize.define('NotificationTemplate', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
      },
      appId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Identifier for the application using this template'
      },
      eventId: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Unique identifier for this notification event'
      },
      eventName: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Human-readable name for this notification event'
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Title template with placeholders'
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Body template with placeholders'
      },
      payload: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: 'Additional data payload with placeholders'
      },
      priority: {
        type: DataTypes.ENUM('normal', 'high'),
        defaultValue: 'high'
      },
      category: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Category for grouping notifications'
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Description of when this notification is used'
      },
      defaultEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: 'Whether this notification is enabled by default'
      },
      platforms: {
        type: DataTypes.ARRAY(DataTypes.STRING),
        allowNull: false,
        defaultValue: ['ios', 'android'],
        comment: 'Which platforms this notification is for'
      },
      metaData: {
        type: DataTypes.JSON,
        allowNull: true
      }
    }, {
      tableName: 'notification_templates',
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ['appId', 'eventId']
        },
        {
          fields: ['category']
        }
      ]
    });
  
    return NotificationTemplate;
  };
  