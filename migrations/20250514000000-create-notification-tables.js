// migrations/[date]-create-notification-tables.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create notification_templates table
    await queryInterface.createTable('notification_templates', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true
      },

appId: {
    type: Sequelize.STRING,
    allowNull: false
  },
  eventId: {
    type: Sequelize.STRING,
    allowNull: false
  },
  eventName: {
    type: Sequelize.STRING,
    allowNull: false
  },
  title: {
    type: Sequelize.STRING,
    allowNull: false
  },
  body: {
    type: Sequelize.TEXT,
    allowNull: false
  },
  payload: {
    type: Sequelize.JSON,
    allowNull: true
  },
  priority: {
    type: Sequelize.ENUM('normal', 'high'),
    defaultValue: 'high'
  },
  category: {
    type: Sequelize.STRING,
    allowNull: true
  },
  description: {
    type: Sequelize.TEXT,
    allowNull: true
  },
  defaultEnabled: {
    type: Sequelize.BOOLEAN,
    defaultValue: true
  },
  platforms: {
    type: Sequelize.ARRAY(Sequelize.STRING),
    allowNull: false,
    defaultValue: ['ios', 'android']
  },
  metaData: {
    type: Sequelize.JSON,
    allowNull: true
  },
  createdAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updatedAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  }
});

// Create index for notification_templates
await queryInterface.addIndex('notification_templates', ['appId', 'eventId'], {
  unique: true,
  name: 'idx_notification_templates_app_event'
});

await queryInterface.addIndex('notification_templates', ['category'], {
  name: 'idx_notification_templates_category'
});

// Create notification_preferences table
await queryInterface.createTable('notification_preferences', {
  id: {
    type: Sequelize.UUID,
    defaultValue: Sequelize.literal('gen_random_uuid()'),
    primaryKey: true
  },
  userId: {
    type: Sequelize.UUID,
    allowNull: false
  },
  eventId: {
    type: Sequelize.STRING,
    allowNull: false
  },
  appId: {
    type: Sequelize.STRING,
    allowNull: false
  },
  enabled: {
    type: Sequelize.BOOLEAN,
    defaultValue: true
  },
  channels: {
    type: Sequelize.ARRAY(Sequelize.STRING),
    defaultValue: ['push', 'email']
  },
  updatedBy: {
    type: Sequelize.STRING,
    allowNull: true
  },
  createdAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updatedAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  }
});

// Create index for notification_preferences
await queryInterface.addIndex('notification_preferences', ['userId', 'eventId', 'appId'], {
  unique: true,
  name: 'idx_notification_preferences_user_event_app'
});

// Create notification_logs table
await queryInterface.createTable('notification_logs', {
  id: {
    type: Sequelize.UUID,
    defaultValue: Sequelize.literal('gen_random_uuid()'),
    primaryKey: true
  },
  userId: {
    type: Sequelize.UUID,
    allowNull: false
  },
  deviceToken: {
    type: Sequelize.TEXT,
    allowNull: true
  },
  eventId: {
    type: Sequelize.STRING,
    allowNull: false
  },
  appId: {
    type: Sequelize.STRING,
    allowNull: false
  },
  title: {
    type: Sequelize.STRING,
    allowNull: false
  },
  body: {
    type: Sequelize.TEXT,
    allowNull: false
  },
  payload: {
    type: Sequelize.JSON,
    allowNull: true
  },
  status: {
    type: Sequelize.ENUM('queued', 'sent', 'delivered', 'failed'),
    defaultValue: 'queued'
  },
  channel: {
    type: Sequelize.STRING,
    allowNull: false,
    defaultValue: 'push'
  },
  platform: {
    type: Sequelize.STRING,
    allowNull: true
  },
  errorDetails: {
    type: Sequelize.JSON,
    allowNull: true
  },
  sentAt: {
    type: Sequelize.DATE,
    allowNull: true
  },
  deliveredAt: {
    type: Sequelize.DATE,
    allowNull: true
  },
  readAt: {
    type: Sequelize.DATE,
    allowNull: true
  },
  createdAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  },
  updatedAt: {
    type: Sequelize.DATE,
    allowNull: false,
    defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
  }
});

// Create indexes for notification_logs
await queryInterface.addIndex('notification_logs', ['userId', 'createdAt'], {
  name: 'idx_notification_logs_user_created'
});

await queryInterface.addIndex('notification_logs', ['eventId'], {
  name: 'idx_notification_logs_event'
});

await queryInterface.addIndex('notification_logs', ['status'], {
  name: 'idx_notification_logs_status'
});
},

down: async (queryInterface, Sequelize) => {
// Drop tables and indexes in reverse order
await queryInterface.dropTable('notification_logs');
await queryInterface.dropTable('notification_preferences');
await queryInterface.dropTable('notification_templates');

// Drop ENUMs
await queryInterface.sequelize.query(`
  DROP TYPE IF EXISTS "enum_notification_logs_status";
  DROP TYPE IF EXISTS "enum_notification_templates_priority";
`);
}
};