
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create ENUM type if not exists (PostgreSQL only)
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_messages_status') THEN
          CREATE TYPE "enum_messages_status" AS ENUM ('sent', 'delivered', 'read');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_messages_type') THEN
          CREATE TYPE "enum_messages_type" AS ENUM ('text', 'image', 'file', 'emoji', 'audio');
        END IF;
      END $$;
    `);

    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      phone: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      socketId: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      isOnline: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      lastSeen: {
        type: Sequelize.DATE,
        allowNull: true
      }
    });

    await queryInterface.addIndex('users', ['phone'], {
      name: 'idx_users_phone'
    });

    await queryInterface.createTable('messages', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true
      },
      jobId: {
        type: Sequelize.UUID,
        allowNull: true
      },
      senderId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      receiverId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      type: {
        type: Sequelize.ENUM('text', 'image', 'file', 'emoji', 'audio'),
        defaultValue: 'text'
      },
      content: {
        type: Sequelize.JSON,
        allowNull: true
      },
      status: {
        type: Sequelize.ENUM('sent', 'delivered', 'read'),
        defaultValue: 'sent'
      },
      deleted: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false
      }
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('messages');
    await queryInterface.dropTable('users');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_messages_status", "enum_messages_type";');
  }
};
