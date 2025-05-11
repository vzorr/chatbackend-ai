'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create extension for UUID generation if not exists
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    
    // Create ENUM types if not exists
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_role') THEN
          CREATE TYPE "enum_users_role" AS ENUM ('client', 'freelancer', 'admin');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_messages_status') THEN
          CREATE TYPE "enum_messages_status" AS ENUM ('sent', 'delivered', 'read');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_messages_type') THEN
          CREATE TYPE "enum_messages_type" AS ENUM ('text', 'image', 'file', 'emoji', 'audio', 'system');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_device_tokens_deviceType') THEN
          CREATE TYPE "enum_device_tokens_deviceType" AS ENUM ('mobile', 'web');
        END IF;
      END $$;
    `);

    // Create Users table
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
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
      role: {
        type: Sequelize.ENUM('client', 'freelancer', 'admin'),
        defaultValue: 'freelancer',
        allowNull: false
      },
      socketId: {
        type: Sequelize.STRING(255),
        allowNull: true
      },
      isOnline: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      lastSeen: {
        type: Sequelize.DATE,
        allowNull: true
      },
      avatar: {
        type: Sequelize.STRING(255),
        allowNull: true
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

    // Create Conversations table
    await queryInterface.createTable('conversations', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true
      },
      jobId: {
        type: Sequelize.UUID,
        allowNull: true
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
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Create Conversation Participants table
    await queryInterface.createTable('conversation_participants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
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
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      leftAt: {
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

    // Create Messages table
    await queryInterface.createTable('messages', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true
      },
      conversationId: {
        type: Sequelize.UUID,
        allowNull: true,
        references: {
          model: 'conversations',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
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
        allowNull: true,
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      type: {
        type: Sequelize.ENUM('text', 'image', 'file', 'emoji', 'audio', 'system'),
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
      clientTempId: {
        type: Sequelize.STRING,
        allowNull: true
      },
      isSystemMessage: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
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

    // Create Message Versions table
    await queryInterface.createTable('message_versions', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true
      },
      messageId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'messages',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      versionContent: {
        type: Sequelize.JSON,
        allowNull: false
      },
      editedAt: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // Create Device Tokens table
    await queryInterface.createTable('device_tokens', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true
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
      token: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
      },
      deviceType: {
        type: Sequelize.ENUM('mobile', 'web'),
        defaultValue: 'mobile'
      },
      platform: {
        type: Sequelize.STRING,
        allowNull: true
      },
      lastUsed: {
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
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

    // Add indexes
    await queryInterface.sequelize.query(`-- Idempotent Index Creation
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_phone') THEN
        CREATE UNIQUE INDEX idx_users_phone ON "users"("phone");
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversation_participants_unique') THEN
        CREATE UNIQUE INDEX idx_conversation_participants_unique ON "conversation_participants"("conversationId", "userId");
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversations_last_message_at') THEN
        CREATE INDEX idx_conversations_last_message_at ON "conversations"("lastMessageAt");
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_messages_conversation_created') THEN
        CREATE INDEX idx_messages_conversation_created ON "messages"("conversationId", "createdAt");
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_messages_sender_receiver_created') THEN
        CREATE INDEX idx_messages_sender_receiver_created ON "messages"("senderId", "receiverId", "createdAt");
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_tokens_token') THEN
        CREATE UNIQUE INDEX idx_device_tokens_token ON "device_tokens"("token");
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_device_tokens_user_id') THEN
        CREATE INDEX idx_device_tokens_user_id ON "device_tokens"("userId");
      END IF;
    END $$;`);
    
    // Create a trigger function to update updatedAt timestamp
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION update_modified_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW."updatedAt" = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    
    // Create triggers for all tables to automatically update updatedAt
    const tables = ['users', 'conversations', 'conversation_participants', 'messages', 'device_tokens'];
    for (const table of tables) {
      await queryInterface.sequelize.query(`
        CREATE TRIGGER update_${table}_modtime
        BEFORE UPDATE ON "${table}"
        FOR EACH ROW
        EXECUTE PROCEDURE update_modified_column();
      `);
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Drop triggers
    const tables = ['users', 'conversations', 'conversation_participants', 'messages', 'device_tokens'];
    for (const table of tables) {
      await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS update_${table}_modtime ON "${table}";`);
    }
    
    // Drop trigger function
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS update_modified_column();');
    
    // Drop tables in reverse order of creation to handle dependencies
    await queryInterface.dropTable('device_tokens');
    await queryInterface.dropTable('message_versions');
    await queryInterface.dropTable('messages');
    await queryInterface.dropTable('conversation_participants');
    await queryInterface.dropTable('conversations');
    await queryInterface.dropTable('users');
    
    // Drop ENUM types
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_device_tokens_deviceType";
      DROP TYPE IF EXISTS "enum_messages_type";
      DROP TYPE IF EXISTS "enum_messages_status";
      DROP TYPE IF EXISTS "enum_users_role";
    `);
    
    // Drop extension
    await queryInterface.sequelize.query('DROP EXTENSION IF EXISTS "pgcrypto";');
  }
};