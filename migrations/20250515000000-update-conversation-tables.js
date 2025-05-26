// migrations/20250115000000-update-conversation-tables.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Create ENUM types
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_conversations_type') THEN
          CREATE TYPE "enum_conversations_type" AS ENUM ('job_chat', 'direct_message');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_conversations_status') THEN
          CREATE TYPE "enum_conversations_status" AS ENUM ('active', 'closed', 'archived');
        END IF;
      END $$;
    `);

    // 2. Add new columns to conversations table
    const conversationTableInfo = await queryInterface.describeTable('conversations');
    
    // Add type column
    if (!conversationTableInfo.type) {
      await queryInterface.addColumn('conversations', 'type', {
        type: Sequelize.ENUM('job_chat', 'direct_message'),
        defaultValue: 'direct_message',
        allowNull: false
      });
    }

    // Add status column
    if (!conversationTableInfo.status) {
      await queryInterface.addColumn('conversations', 'status', {
        type: Sequelize.ENUM('active', 'closed', 'archived'),
        defaultValue: 'active',
        allowNull: false
      });
    }

    // Add createdBy column
    if (!conversationTableInfo.createdBy) {
      await queryInterface.addColumn('conversations', 'createdBy', {
        type: Sequelize.UUID,
        allowNull: true, // Nullable for existing records
        references: {
          model: 'users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    }

    // Add closedAt column
    if (!conversationTableInfo.closedAt) {
      await queryInterface.addColumn('conversations', 'closedAt', {
        type: Sequelize.DATE,
        allowNull: true
      });
    }

    // Add deleted column if not exists
    if (!conversationTableInfo.deleted) {
      await queryInterface.addColumn('conversations', 'deleted', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }

    // Add deletedAt column if not exists
    if (!conversationTableInfo.deletedAt) {
      await queryInterface.addColumn('conversations', 'deletedAt', {
        type: Sequelize.DATE,
        allowNull: true
      });
    }

    // 3. Update existing conversations
    // Set type based on jobId presence
    await queryInterface.sequelize.query(`
      UPDATE conversations 
      SET type = CASE 
        WHEN "jobId" IS NOT NULL THEN 'job_chat'::enum_conversations_type
        ELSE 'direct_message'::enum_conversations_type
      END
      WHERE type IS NULL;
    `);

    // Set createdBy to first participant for existing records
    await queryInterface.sequelize.query(`
      UPDATE conversations 
      SET "createdBy" = "participantIds"[1]
      WHERE "createdBy" IS NULL AND "participantIds" IS NOT NULL AND array_length("participantIds", 1) > 0;
    `);

    // 4. Add new columns to conversation_participants table
    const participantTableInfo = await queryInterface.describeTable('conversation_participants');

    // Add isMuted column
    if (!participantTableInfo.isMuted) {
      await queryInterface.addColumn('conversation_participants', 'isMuted', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }

    // Add isPinned column
    if (!participantTableInfo.isPinned) {
      await queryInterface.addColumn('conversation_participants', 'isPinned', {
        type: Sequelize.BOOLEAN,
        defaultValue: false,
        allowNull: false
      });
    }

    // Add notificationEnabled column
    if (!participantTableInfo.notificationEnabled) {
      await queryInterface.addColumn('conversation_participants', 'notificationEnabled', {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false
      });
    }

    // Add lastReadAt column
    if (!participantTableInfo.lastReadAt) {
      await queryInterface.addColumn('conversation_participants', 'lastReadAt', {
        type: Sequelize.DATE,
        allowNull: true
      });
    }

    // 5. Create indexes for better performance
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        -- Conversations indexes
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversations_type') THEN
          CREATE INDEX idx_conversations_type ON conversations(type);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversations_status') THEN
          CREATE INDEX idx_conversations_status ON conversations(status);
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversations_created_by') THEN
          CREATE INDEX idx_conversations_created_by ON conversations("createdBy");
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversations_job_id') THEN
          CREATE INDEX idx_conversations_job_id ON conversations("jobId");
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversations_deleted') THEN
          CREATE INDEX idx_conversations_deleted ON conversations(deleted);
        END IF;
        
        -- Conversation participants indexes
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_participants_user_pinned') THEN
          CREATE INDEX idx_participants_user_pinned ON conversation_participants("userId", "isPinned");
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_participants_user_muted') THEN
          CREATE INDEX idx_participants_user_muted ON conversation_participants("userId", "isMuted");
        END IF;
        
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_participants_user_unread') THEN
          CREATE INDEX idx_participants_user_unread ON conversation_participants("userId", "unreadCount");
        END IF;
      END $$;
    `);

    // 6. Create compound index for job chat lookups
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_conversations_job_participants') THEN
          CREATE INDEX idx_conversations_job_participants ON conversations("jobId", "participantIds") 
          WHERE type = 'job_chat' AND status != 'archived';
        END IF;
      END $$;
    `);

    // 7. Update trigger for conversations if needed
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'update_conversations_modtime'
        ) THEN
          CREATE TRIGGER update_conversations_modtime
          BEFORE UPDATE ON conversations
          FOR EACH ROW
          EXECUTE PROCEDURE update_modified_column();
        END IF;
      END $$;
    `);

    // 8. Add constraint to ensure job_chat has jobId
    await queryInterface.sequelize.query(`
      ALTER TABLE conversations 
      ADD CONSTRAINT check_job_chat_has_job_id 
      CHECK (type != 'job_chat' OR "jobId" IS NOT NULL);
    `);

  },

  down: async (queryInterface, Sequelize) => {
    // Remove constraint
    await queryInterface.sequelize.query(`
      ALTER TABLE conversations DROP CONSTRAINT IF EXISTS check_job_chat_has_job_id;
    `);

    // Drop indexes
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_conversations_job_participants;
      DROP INDEX IF EXISTS idx_participants_user_unread;
      DROP INDEX IF EXISTS idx_participants_user_muted;
      DROP INDEX IF EXISTS idx_participants_user_pinned;
      DROP INDEX IF EXISTS idx_conversations_deleted;
      DROP INDEX IF EXISTS idx_conversations_job_id;
      DROP INDEX IF EXISTS idx_conversations_created_by;
      DROP INDEX IF EXISTS idx_conversations_status;
      DROP INDEX IF EXISTS idx_conversations_type;
    `);

    // Remove columns from conversation_participants
    const participantTableInfo = await queryInterface.describeTable('conversation_participants');
    
    if (participantTableInfo.lastReadAt) {
      await queryInterface.removeColumn('conversation_participants', 'lastReadAt');
    }
    if (participantTableInfo.notificationEnabled) {
      await queryInterface.removeColumn('conversation_participants', 'notificationEnabled');
    }
    if (participantTableInfo.isPinned) {
      await queryInterface.removeColumn('conversation_participants', 'isPinned');
    }
    if (participantTableInfo.isMuted) {
      await queryInterface.removeColumn('conversation_participants', 'isMuted');
    }

    // Remove columns from conversations
    const conversationTableInfo = await queryInterface.describeTable('conversations');
    
    if (conversationTableInfo.deletedAt) {
      await queryInterface.removeColumn('conversations', 'deletedAt');
    }
    if (conversationTableInfo.deleted) {
      await queryInterface.removeColumn('conversations', 'deleted');
    }
    if (conversationTableInfo.closedAt) {
      await queryInterface.removeColumn('conversations', 'closedAt');
    }
    if (conversationTableInfo.createdBy) {
      await queryInterface.removeColumn('conversations', 'createdBy');
    }
    if (conversationTableInfo.status) {
      await queryInterface.removeColumn('conversations', 'status');
    }
    if (conversationTableInfo.type) {
      await queryInterface.removeColumn('conversations', 'type');
    }

    // Drop ENUM types
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_conversations_status";
      DROP TYPE IF EXISTS "enum_conversations_type";
    `);
  }
};