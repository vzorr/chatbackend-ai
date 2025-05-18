'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create extension for UUID generation if not exists
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');
    
    // Create ENUM types if not exists
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_users_role') THEN
          CREATE TYPE "enum_users_role" AS ENUM ('customer', 'usta', 'administrator');
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
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_token_history_tokenType') THEN
          CREATE TYPE "enum_token_history_tokenType" AS ENUM ('FCM', 'APN', 'WEB_PUSH');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_token_history_action') THEN
          CREATE TYPE "enum_token_history_action" AS ENUM ('REGISTERED', 'RENEWED', 'EXPIRED', 'REVOKED', 'FAILED', 'USED');
        END IF;
      END $$;
    `);

    // ==== Create Users table ====
    const tableInfo = await queryInterface.describeTable('users').catch(() => null);
    if (!tableInfo) {
      console.log('Creating users table...');
      await queryInterface.createTable('users', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.literal('gen_random_uuid()'),
          primaryKey: true
        },
        externalId: {
          type: Sequelize.UUID,
          allowNull: false,
          unique: true,
          comment: 'UUID of the user from the main React Native application'
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
        email: {
          type: Sequelize.STRING(255),
          allowNull: true,
          unique: true
        },
        role: {
          type: Sequelize.ENUM('customer', 'usta', 'administrator'),
          defaultValue: 'customer',
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
      
      // Add indexes for users table
      await queryInterface.addIndex('users', ['phone'], {
        name: 'idx_users_phone',
        unique: true
      });
      
      await queryInterface.addIndex('users', ['externalId'], {
        name: 'idx_users_external_id',
        unique: true
      });
      
      await queryInterface.addIndex('users', ['email'], {
        name: 'idx_users_email',
        unique: true
      });
      
      console.log('✅ Users table created successfully.');
    } else {
      console.log('Users table already exists, checking for columns...');
      
      // Check and add externalId column if not exists
      if (!tableInfo.externalId) {
        await queryInterface.addColumn('users', 'externalId', {
          type: Sequelize.UUID,
          allowNull: true,
          unique: true,
          comment: 'UUID of the user from the main React Native application'
        });
        console.log('✅ Added externalId column to users table.');
        
        // Add index for externalId
        await queryInterface.addIndex('users', ['externalId'], {
          name: 'idx_users_external_id',
          unique: true
        });
      }
      
      // Check and add email column if not exists
      if (!tableInfo.email) {
        await queryInterface.addColumn('users', 'email', {
          type: Sequelize.STRING(255),
          allowNull: true,
          unique: true
        });
        console.log('✅ Added email column to users table.');
        
        // Add index for email
        await queryInterface.addIndex('users', ['email'], {
          name: 'idx_users_email',
          unique: true
        });
      }
    }

    // ==== Create Conversations table ====
    try {
      await queryInterface.describeTable('conversations');
      console.log('Conversations table already exists.');
    } catch (error) {
      console.log('Creating conversations table...');
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
      
      // Add indexes for conversations table
      await queryInterface.addIndex('conversations', ['lastMessageAt'], {
        name: 'idx_conversations_last_message_at'
      });
      
      console.log('✅ Conversations table created successfully.');
    }

    // ==== Create Conversation Participants table ====
    try {
      await queryInterface.describeTable('conversation_participants');
      console.log('ConversationParticipants table already exists.');
    } catch (error) {
      console.log('Creating conversation_participants table...');
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
      
      // Add unique index for conversation_participants
      await queryInterface.addIndex('conversation_participants', ['conversationId', 'userId'], {
        name: 'idx_conversation_participants_unique',
        unique: true
      });
      
      console.log('✅ ConversationParticipants table created successfully.');
    }

    // ==== Create Messages table ====
    try {
      await queryInterface.describeTable('messages');
      console.log('Messages table already exists.');
    } catch (error) {
      console.log('Creating messages table...');
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
          allowNull: false,
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
      
      // Add indexes for messages table
      await queryInterface.addIndex('messages', ['conversationId', 'createdAt'], {
        name: 'idx_messages_conversation_created'
      });
      
      await queryInterface.addIndex('messages', ['senderId', 'receiverId', 'createdAt'], {
        name: 'idx_messages_sender_receiver_created'
      });
      
      await queryInterface.addIndex('messages', ['status'], {
        name: 'idx_messages_status'
      });
      
      console.log('✅ Messages table created successfully.');
    }

    // ==== Create Message Versions table ====
    try {
      await queryInterface.describeTable('message_versions');
      console.log('MessageVersions table already exists.');
    } catch (error) {
      console.log('Creating message_versions table...');
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
      
      // Add index for message_versions
      await queryInterface.addIndex('message_versions', ['messageId'], {
        name: 'idx_message_versions_message_id'
      });
      
      console.log('✅ MessageVersions table created successfully.');
    }

    // ==== Create Device Tokens table ====
    try {
      await queryInterface.describeTable('device_tokens');
      console.log('DeviceTokens table already exists.');
    } catch (error) {
      console.log('Creating device_tokens table...');
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
        deviceId: {
          type: Sequelize.STRING,
          allowNull: true
        },
        active: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
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
      
      // Add indexes for device_tokens table
      await queryInterface.addIndex('device_tokens', ['token'], {
        name: 'idx_device_tokens_token',
        unique: true
      });
      
      await queryInterface.addIndex('device_tokens', ['userId'], {
        name: 'idx_device_tokens_user_id'
      });
      
      await queryInterface.addIndex('device_tokens', ['deviceId'], {
        name: 'idx_device_tokens_device_id'
      });
      
      console.log('✅ DeviceTokens table created successfully.');
    }

    // ==== Create Token History table ====
    try {
      await queryInterface.describeTable('token_history');
      console.log('TokenHistory table already exists.');
    } catch (error) {
      console.log('Creating token_history table...');
      await queryInterface.createTable('token_history', {
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
          type: Sequelize.TEXT,
          allowNull: false
        },
        tokenType: {
          type: Sequelize.ENUM('FCM', 'APN', 'WEB_PUSH'),
          allowNull: false
        },
        deviceId: {
          type: Sequelize.STRING,
          allowNull: true,
          comment: 'Unique device identifier'
        },
        deviceModel: {
          type: Sequelize.STRING,
          allowNull: true
        },
        deviceOS: {
          type: Sequelize.STRING,
          allowNull: true
        },
        appVersion: {
          type: Sequelize.STRING,
          allowNull: true
        },
        action: {
          type: Sequelize.ENUM('REGISTERED', 'RENEWED', 'EXPIRED', 'REVOKED', 'FAILED', 'USED'),
          allowNull: false
        },
        previousToken: {
          type: Sequelize.TEXT,
          allowNull: true,
          comment: 'Previous token if this is a renewal'
        },
        expiresAt: {
          type: Sequelize.DATE,
          allowNull: true
        },
        metadata: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: 'Additional metadata for audit'
        },
        ipAddress: {
          type: Sequelize.STRING,
          allowNull: true
        },
        userAgent: {
          type: Sequelize.STRING,
          allowNull: true
        },
        errorDetails: {
          type: Sequelize.JSON,
          allowNull: true,
          comment: 'Error details if action is FAILED'
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
      
      // Add indexes for token_history
      await queryInterface.addIndex('token_history', ['userId', 'createdAt'], {
        name: 'idx_token_history_user_created'
      });
      
      await queryInterface.addIndex('token_history', ['token'], {
        name: 'idx_token_history_token'
      });
      
      await queryInterface.addIndex('token_history', ['deviceId', 'userId'], {
        name: 'idx_token_history_device_user'
      });
      
      await queryInterface.addIndex('token_history', ['action', 'createdAt'], {
        name: 'idx_token_history_action_created'
      });
      
      console.log('✅ TokenHistory table created successfully.');
    }

    // ==== Create Sessions table ====
    try {
      await queryInterface.describeTable('sessions');
      console.log('Sessions table already exists.');
    } catch (error) {
      console.log('Creating sessions table...');
      await queryInterface.createTable('sessions', {
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
        socketId: {
          type: Sequelize.STRING,
          allowNull: false,
          unique: true
        },
        deviceType: {
          type: Sequelize.ENUM('web', 'ios', 'android', 'desktop', 'unknown'),
          defaultValue: 'unknown'
        },
        deviceName: {
          type: Sequelize.STRING,
          allowNull: true
        },
        deviceFingerprint: {
          type: Sequelize.STRING,
          allowNull: true,
          comment: 'Unique device identifier for tracking'
        },
        ipAddress: {
          type: Sequelize.STRING,
          allowNull: true
        },
        location: {
          type: Sequelize.JSON,
          allowNull: true,
          defaultValue: {},
          comment: 'Geolocation data if available'
        },
        authToken: {
          type: Sequelize.STRING,
          allowNull: true,
          comment: 'Hashed authentication token'
        },
        isActive: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        connectedAt: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        lastActivityAt: {
          type: Sequelize.DATE,
          allowNull: true,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        disconnectedAt: {
          type: Sequelize.DATE,
          allowNull: true
        },
        pushToken: {
          type: Sequelize.STRING,
          allowNull: true,
          comment: 'Token for push notifications'
        },
        appVersion: {
          type: Sequelize.STRING,
          allowNull: true
        },
        platformVersion: {
          type: Sequelize.STRING,
          allowNull: true,
          comment: 'iOS/Android version'
        },
        logoutReason: {
          type: Sequelize.STRING,
          allowNull: true
        },
        connectionQuality: {
          type: Sequelize.JSON,
          allowNull: true,
          defaultValue: {},
          comment: 'Metrics about connection quality'
        },
        userAgent: {
          type: Sequelize.TEXT,
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
      
      // Add indexes for sessions table
      await queryInterface.addIndex('sessions', ['userId', 'isActive'], {
        name: 'idx_sessions_user_active'
      });
      
      await queryInterface.addIndex('sessions', ['socketId'], {
        name: 'idx_sessions_socket_id',
        unique: true
      });
      
      await queryInterface.addIndex('sessions', ['deviceFingerprint'], {
        name: 'idx_sessions_device_fingerprint'
      });
      
      await queryInterface.addIndex('sessions', ['isActive', 'lastActivityAt'], {
        name: 'idx_sessions_active_last_activity'
      });
      
      console.log('✅ Sessions table created successfully.');
    }

    // Create trigger function to update updatedAt timestamp
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION update_modified_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW."updatedAt" = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
    
    // Set up triggers for all tables
    const tables = [
      'users', 
      'conversations', 
      'conversation_participants', 
      'messages', 
      'device_tokens',
      'token_history',
      'sessions'
    ];
    
    for (const table of tables) {
      // Check if trigger exists
      const [triggerExists] = await queryInterface.sequelize.query(`
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'update_${table}_modtime'
        LIMIT 1;
      `);
      
      if (triggerExists.length === 0) {
        await queryInterface.sequelize.query(`
          CREATE TRIGGER update_${table}_modtime
          BEFORE UPDATE ON "${table}"
          FOR EACH ROW
          EXECUTE PROCEDURE update_modified_column();
        `);
        console.log(`✅ Created updatedAt trigger for ${table}`);
      } else {
        console.log(`Trigger for ${table} already exists.`);
      }
    }
    
    console.log('✅ Migration completed successfully!');
  },

  down: async (queryInterface, Sequelize) => {
    // This is a very destructive migration to revert, as it removes all the tables
    // Consider removing the triggers first, then the tables in reverse dependency order
    
    // Drop triggers
    const tables = [
      'users', 
      'conversations', 
      'conversation_participants', 
      'messages', 
      'device_tokens',
      'token_history',
      'sessions'
    ];
    
    for (const table of tables) {
      try {
        await queryInterface.sequelize.query(`
          DROP TRIGGER IF EXISTS update_${table}_modtime ON "${table}";
        `);
        console.log(`✅ Dropped trigger for ${table}`);
      } catch (error) {
        console.error(`Error dropping trigger for ${table}:`, error.message);
      }
    }
    
    // Drop trigger function
    await queryInterface.sequelize.query('DROP FUNCTION IF EXISTS update_modified_column();');
    
    // Drop tables in reverse dependency order
    try { await queryInterface.dropTable('token_history'); } catch (error) { console.error('Error dropping token_history:', error.message); }
    try { await queryInterface.dropTable('sessions'); } catch (error) { console.error('Error dropping sessions:', error.message); }
    try { await queryInterface.dropTable('message_versions'); } catch (error) { console.error('Error dropping message_versions:', error.message); }
    try { await queryInterface.dropTable('device_tokens'); } catch (error) { console.error('Error dropping device_tokens:', error.message); }
    try { await queryInterface.dropTable('messages'); } catch (error) { console.error('Error dropping messages:', error.message); }
    try { await queryInterface.dropTable('conversation_participants'); } catch (error) { console.error('Error dropping conversation_participants:', error.message); }
    try { await queryInterface.dropTable('conversations'); } catch (error) { console.error('Error dropping conversations:', error.message); }
    try { await queryInterface.dropTable('users'); } catch (error) { console.error('Error dropping users:', error.message); }
    
    // Drop ENUM types
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_token_history_action";
      DROP TYPE IF EXISTS "enum_token_history_tokenType";
      DROP TYPE IF EXISTS "enum_device_tokens_deviceType";
      DROP TYPE IF EXISTS "enum_messages_type";
      DROP TYPE IF EXISTS "enum_messages_status";
      DROP TYPE IF EXISTS "enum_users_role";
    `);
  }
};