
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('users', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      name: { type: Sequelize.STRING },
      phone: { type: Sequelize.STRING, allowNull: false, unique: true },
      role: { type: Sequelize.ENUM("client", "freelancer", "admin"), allowNull: false, defaultValue: "freelancer" },
      isOnline: { type: Sequelize.BOOLEAN, defaultValue: false },
      lastSeen: { type: Sequelize.DATE },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.createTable('messages', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      jobId: { type: Sequelize.UUID, allowNull: false },
      senderId: { type: Sequelize.UUID, allowNull: false },
      receiverId: { type: Sequelize.UUID, allowNull: false },
      content: { type: Sequelize.JSON },
      type: { type: Sequelize.ENUM("text", "image", "file", "emoji", "audio"), defaultValue: "text" },
      status: { type: Sequelize.ENUM("sent", "delivered", "read"), defaultValue: "sent" },
      deleted: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.createTable('message_versions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      messageId: { type: Sequelize.UUID, allowNull: false },
      versionContent: { type: Sequelize.JSON },
      editedAt: { type: Sequelize.DATE, defaultValue: Sequelize.NOW }
    });

    await queryInterface.createTable('message_reports', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      messageId: { type: Sequelize.UUID, allowNull: false },
      reportedBy: { type: Sequelize.UUID, allowNull: false },
      reason: { type: Sequelize.STRING },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.createTable('device_tokens', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
      userId: { type: Sequelize.UUID, allowNull: false },
      token: { type: Sequelize.STRING, allowNull: false },
      deviceType: { type: Sequelize.ENUM("mobile", "web"), defaultValue: "mobile" },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('device_tokens');
    await queryInterface.dropTable('message_reports');
    await queryInterface.dropTable('message_versions');
    await queryInterface.dropTable('messages');
    await queryInterface.dropTable('users');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_role", "enum_messages_type", "enum_messages_status", "enum_device_tokens_deviceType";');
  }
};
