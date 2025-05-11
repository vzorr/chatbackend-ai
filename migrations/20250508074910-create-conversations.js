'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('conversations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true
      },
      jobId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'jobs', // You may need to create this table separately
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      jobTitle: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      participantIds: {
        type: Sequelize.ARRAY(Sequelize.UUID),
        allowNull: false
      },
      lastMessageAt: {
        type: Sequelize.DATE,
        allowNull: true
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

    await queryInterface.createTable('conversation_participants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        allowNull: false,
        primaryKey: true
      },
      conversationId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'conversations',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      userId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      unreadCount: {
        type: Sequelize.INTEGER,
        defaultValue: 0
      },
      isBlocked: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      joinedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      leftAt: {
        type: Sequelize.DATE,
        allowNull: true
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

    // Add index for conversation participants
    await queryInterface.addIndex('conversation_participants', ['conversationId', 'userId'], {
      unique: true,
      name: 'idx_conversation_participants_unique'
    });

    // Add conversation reference to messages table
    await queryInterface.addColumn('messages', 'conversationId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: {
        model: 'conversations',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    // Add indexes for faster queries
    await queryInterface.addIndex('conversations', ['lastMessageAt'], {
      name: 'idx_conversations_last_message_at'
    });
    
    await queryInterface.addIndex('messages', ['conversationId', 'createdAt'], {
      name: 'idx_messages_conversation_created'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('messages', 'idx_messages_conversation_created');
    await queryInterface.removeIndex('conversations', 'idx_conversations_last_message_at');
    await queryInterface.removeIndex('conversation_participants', 'idx_conversation_participants_unique');
    
    await queryInterface.removeColumn('messages', 'conversationId');
    await queryInterface.dropTable('conversation_participants');
    await queryInterface.dropTable('conversations');
  }
};
