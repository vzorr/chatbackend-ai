'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Check if table already exists
    const tables = await queryInterface.showAllTables();
    
    if (!tables.includes('media')) {
      await queryInterface.createTable('media', {
        id: {
          type: Sequelize.UUID,
          primaryKey: true,
          allowNull: false
        },
        userId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id'
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
          field: 'user_id'
        },
        conversationId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'conversations',
            key: 'id'
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
          field: 'conversation_id'
        },
        messageId: {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'messages',
            key: 'id'
          },
          onDelete: 'CASCADE',
          onUpdate: 'CASCADE',
          field: 'message_id'
        },
        fileName: {
          type: Sequelize.STRING(255),
          allowNull: false,
          comment: 'Generated filename with UUID',
          field: 'file_name'
        },
        originalName: {
          type: Sequelize.STRING(500),
          allowNull: false,
          comment: 'Original filename from user upload',
          field: 'original_name'
        },
        mimeType: {
          type: Sequelize.STRING(100),
          allowNull: false,
          field: 'mime_type'
        },
        fileSize: {
          type: Sequelize.BIGINT,
          allowNull: false,
          field: 'file_size'
        },
        fileCategory: {
          type: Sequelize.STRING(50),
          allowNull: false,
          comment: 'image, audio, video, document',
          field: 'file_category'
        },
        s3Key: {
          type: Sequelize.STRING(1000),
          allowNull: false,
          unique: true,
          comment: 'Full S3 object key/path',
          field: 's3_key'
        },
        s3Bucket: {
          type: Sequelize.STRING(255),
          allowNull: false,
          field: 's3_bucket'
        },
        s3Region: {
          type: Sequelize.STRING(50),
          allowNull: false,
          field: 's3_region'
        },
        uploadStatus: {
          type: Sequelize.STRING(50),
          defaultValue: 'completed',
          allowNull: false,
          comment: 'pending, completed, failed',
          field: 'upload_status'
        },
        uploadedBy: {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'users',
            key: 'id'
          },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
          field: 'uploaded_by'
        },
        deletedAt: {
          type: Sequelize.DATE,
          allowNull: true,
          field: 'deleted_at'
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
          field: 'created_at'
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
          field: 'updated_at'
        }
      });

      // Create indexes
      await queryInterface.sequelize.query(`
        DO $$ BEGIN
          -- Index for user lookups
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_user_id') THEN
            CREATE INDEX idx_media_user_id ON media(user_id);
          END IF;
          
          -- Index for conversation lookups
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_conversation_id') THEN
            CREATE INDEX idx_media_conversation_id ON media(conversation_id);
          END IF;
          
          -- Index for message lookups
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_message_id') THEN
            CREATE INDEX idx_media_message_id ON media(message_id);
          END IF;
          
          -- Index for S3 key lookups
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_s3_key') THEN
            CREATE INDEX idx_media_s3_key ON media(s3_key);
          END IF;
          
          -- Index for category filtering
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_file_category') THEN
            CREATE INDEX idx_media_file_category ON media(file_category);
          END IF;
          
          -- Index for created_at ordering
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_created_at') THEN
            CREATE INDEX idx_media_created_at ON media(created_at DESC);
          END IF;
          
          -- Partial index for non-deleted media
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_not_deleted') THEN
            CREATE INDEX idx_media_not_deleted ON media(deleted_at) WHERE deleted_at IS NULL;
          END IF;
          
          -- Composite index for user + category queries
          IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_media_user_category') THEN
            CREATE INDEX idx_media_user_category ON media(user_id, file_category) WHERE deleted_at IS NULL;
          END IF;
        END $$;
      `);

      console.log('✅ Media table created successfully with all indexes');
    } else {
      console.log('ℹ️  Media table already exists, skipping creation');
    }
  },

  down: async (queryInterface, Sequelize) => {
    // Drop indexes first
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_media_user_category;
      DROP INDEX IF EXISTS idx_media_not_deleted;
      DROP INDEX IF EXISTS idx_media_created_at;
      DROP INDEX IF EXISTS idx_media_file_category;
      DROP INDEX IF EXISTS idx_media_s3_key;
      DROP INDEX IF EXISTS idx_media_message_id;
      DROP INDEX IF EXISTS idx_media_conversation_id;
      DROP INDEX IF EXISTS idx_media_user_id;
    `);

    // Drop table
    const tables = await queryInterface.showAllTables();
    if (tables.includes('media')) {
      await queryInterface.dropTable('media');
      console.log('✅ Media table dropped successfully');
    }
  }
};