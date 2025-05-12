// migrations/20250513000000-create-token-history.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Create ENUM type for token types
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_token_history_tokenType') THEN
          CREATE TYPE "enum_token_history_tokenType" AS ENUM ('FCM', 'APN', 'WEB_PUSH');
        END IF;
      END $$;
    `);

    // Create ENUM type for actions
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_token_history_action') THEN
          CREATE TYPE "enum_token_history_action" AS ENUM ('REGISTERED', 'RENEWED', 'EXPIRED', 'REVOKED', 'FAILED', 'USED');
        END IF;
      END $$;
    `);

    // Create token_history table
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

    // Add indexes
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_token_history_user_created') THEN
          CREATE INDEX idx_token_history_user_created ON "token_history"("userId", "createdAt");
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_token_history_token') THEN
          CREATE INDEX idx_token_history_token ON "token_history"("token");
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_token_history_device_user') THEN
          CREATE INDEX idx_token_history_device_user ON "token_history"("deviceId", "userId");
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_token_history_action_created') THEN
          CREATE INDEX idx_token_history_action_created ON "token_history"("action", "createdAt");
        END IF;
      END $$;
    `);

    // Create trigger to update updatedAt
    await queryInterface.sequelize.query(`
      CREATE TRIGGER update_token_history_modtime
      BEFORE UPDATE ON "token_history"
      FOR EACH ROW
      EXECUTE PROCEDURE update_modified_column();
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop trigger
    await queryInterface.sequelize.query('DROP TRIGGER IF EXISTS update_token_history_modtime ON "token_history";');
    
    // Drop table
    await queryInterface.dropTable('token_history');
    
    // Drop ENUM types
    await queryInterface.sequelize.query(`
      DROP TYPE IF EXISTS "enum_token_history_action";
      DROP TYPE IF EXISTS "enum_token_history_tokenType";
    `);
  }
};