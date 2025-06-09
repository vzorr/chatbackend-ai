'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    console.log('🔄 Creating bulletproof notification system with UUID consistency (FIXED)...');
    
    try {
      // === STEP 1: NUCLEAR OPTION - DROP EVERYTHING ===
      console.log('\n💥 STEP 1: Nuclear cleanup - dropping all tables...');
      
      // Disable foreign key checks
      await queryInterface.sequelize.query('SET session_replication_role = replica;').catch(() => {
        return queryInterface.sequelize.query('SET foreign_key_checks = 0;');
      });

      const tablesToDrop = [
        'notification_logs',
        'notification_preferences', 
        'notification_templates',
        'device_tokens',
        'notification_events',
        'notification_categories'
      ];

      for (const tableName of tablesToDrop) {
        try {
          await queryInterface.dropTable(tableName, { cascade: true });
          console.log(`✅ Dropped table: ${tableName}`);
        } catch (error) {
          console.log(`⚠️ Table ${tableName} doesn't exist or error: ${error.message}`);
        }
      }

      // Drop ENUMs
      const enumsToDelete = [
        'enum_notification_logs_status',
        'enum_notification_templates_priority',
        'enum_device_tokens_device_type',
        'enum_notification_preferences_frequency'
      ];

      for (const enumName of enumsToDelete) {
        try {
          await queryInterface.sequelize.query(`DROP TYPE IF EXISTS "${enumName}" CASCADE;`);
          console.log(`✅ Dropped ENUM: ${enumName}`);
        } catch (enumError) {
          console.log(`⚠️ ENUM ${enumName} doesn't exist`);
        }
      }

      // Re-enable foreign key checks
      await queryInterface.sequelize.query('SET session_replication_role = DEFAULT;').catch(() => {
        return queryInterface.sequelize.query('SET foreign_key_checks = 1;');
      });

      console.log('✅ Nuclear cleanup completed');

      // === STEP 2: CREATE TABLES WITH PROPER UUID GENERATION ===
      console.log('\n📊 STEP 2: Creating notification_categories...');
      await queryInterface.createTable('notification_categories', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        category_key: {
          type: Sequelize.STRING(50),
          unique: true,
          allowNull: false
        },
        name: {
          type: Sequelize.STRING(100),
          allowNull: false
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true
        },
        icon: {
          type: Sequelize.STRING(50),
          allowNull: true
        },
        color: {
          type: Sequelize.STRING(7),
          allowNull: true
        },
        display_order: {
          type: Sequelize.INTEGER,
          defaultValue: 0
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      });

      await queryInterface.addIndex('notification_categories', ['category_key'], { unique: true });
      console.log('✅ notification_categories created');

      console.log('\n📊 STEP 3: Creating notification_events...');
      await queryInterface.createTable('notification_events', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        category_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'notification_categories',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        event_key: {
          type: Sequelize.STRING(100),
          unique: true,
          allowNull: false
        },
        event_name: {
          type: Sequelize.STRING(200),
          allowNull: false
        },
        description: {
          type: Sequelize.TEXT,
          allowNull: true
        },
        default_priority: {
          type: Sequelize.STRING(20),
          defaultValue: 'normal'
        },
        is_active: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      });

      await queryInterface.addIndex('notification_events', ['event_key'], { unique: true });
      await queryInterface.addIndex('notification_events', ['category_id']);
      console.log('✅ notification_events created');

      console.log('\n📊 STEP 4: Creating notification_templates...');
      await queryInterface.createTable('notification_templates', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        event_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'notification_events',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        app_id: {
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
        description: {
          type: Sequelize.TEXT,
          allowNull: true
        },
        priority: {
          type: Sequelize.ENUM('low', 'normal', 'high'),
          defaultValue: 'normal'
        },
        default_enabled: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        platforms: {
          type: Sequelize.JSON,
          allowNull: false,
          defaultValue: JSON.stringify(['ios', 'android'])
        },
        meta_data: {
          type: Sequelize.JSON,
          allowNull: true
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      });

      await queryInterface.addIndex('notification_templates', ['event_id', 'app_id'], { 
        unique: true, 
        name: 'unique_event_app_template' 
      });
      console.log('✅ notification_templates created');

      console.log('\n📊 STEP 5: Creating device_tokens...');
      await queryInterface.createTable('device_tokens', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        user_id: {
          type: Sequelize.UUID,
          allowNull: false
        },
        token: {
          type: Sequelize.TEXT,
          allowNull: false,
          unique: true
        },
        device_type: {
          type: Sequelize.ENUM('mobile', 'web'),
          defaultValue: 'mobile'
        },
        platform: {
          type: Sequelize.STRING,
          allowNull: true
        },
        device_id: {
          type: Sequelize.STRING,
          allowNull: true
        },
        active: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        last_used: {
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      });

      await queryInterface.addIndex('device_tokens', ['token'], { unique: true });
      await queryInterface.addIndex('device_tokens', ['user_id']);
      console.log('✅ device_tokens created');

      console.log('\n📊 STEP 6: Creating notification_preferences...');
      await queryInterface.createTable('notification_preferences', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        user_id: {
          type: Sequelize.UUID,
          allowNull: false
        },
        event_id: {
          type: Sequelize.UUID,
          allowNull: false,
          references: {
            model: 'notification_events',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE'
        },
        app_id: {
          type: Sequelize.STRING,
          allowNull: false
        },
        enabled: {
          type: Sequelize.BOOLEAN,
          defaultValue: true
        },
        channels: {
          type: Sequelize.JSON,
          defaultValue: JSON.stringify(['push', 'email'])
        },
        updated_by: {
          type: Sequelize.STRING,
          allowNull: true
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      });

      await queryInterface.addIndex('notification_preferences', ['user_id', 'event_id', 'app_id'], { 
        unique: true, 
        name: 'unique_user_event_app_preference' 
      });
      console.log('✅ notification_preferences created');

      console.log('\n📊 STEP 7: Creating notification_logs...');
      await queryInterface.createTable('notification_logs', {
        id: {
          type: Sequelize.UUID,
          defaultValue: Sequelize.UUIDV4,
          primaryKey: true
        },
        recipient_id: {
          type: Sequelize.UUID,
          allowNull: false
        },
        triggered_by: {
          type: Sequelize.UUID,
          allowNull: true
        },
        event_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'notification_events',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        template_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'notification_templates',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        category_id: {
          type: Sequelize.UUID,
          allowNull: true,
          references: {
            model: 'notification_categories',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'SET NULL'
        },
        business_entity_type: {
          type: Sequelize.STRING(50),
          allowNull: true
        },
        business_entity_id: {
          type: Sequelize.STRING(255),
          allowNull: true
        },
        device_token: {
          type: Sequelize.TEXT,
          allowNull: true
        },
        app_id: {
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
          type: Sequelize.ENUM('queued', 'processing', 'sent', 'delivered', 'failed'),
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
        error_details: {
          type: Sequelize.JSON,
          allowNull: true
        },
        sent_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        delivered_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        read_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      });
      
      await queryInterface.addIndex('notification_logs', ['recipient_id', 'created_at']);
      await queryInterface.addIndex('notification_logs', ['event_id']);
      await queryInterface.addIndex('notification_logs', ['category_id']);
      await queryInterface.addIndex('notification_logs', ['status']);
      console.log('✅ notification_logs created');

      // === STEP 8: SEED DATA WITH PROPER UUID GENERATION ===
      console.log('\n📋 STEP 8: Creating notification categories (generating UUIDs properly)...');
      
      // First, ensure UUID extension is available
      await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
      
      // Insert categories with explicit UUID generation
      const categoryInserts = await queryInterface.sequelize.query(`
        INSERT INTO notification_categories (id, category_key, name, description, icon, color, display_order, created_at, updated_at)
        VALUES 
        (uuid_generate_v4(), 'jobs', 'Jobs & Contracts', 'Notifications related to job postings, contracts, and work assignments', 'briefcase', '#3B82F6', 1, NOW(), NOW()),
        (uuid_generate_v4(), 'payments', 'Payments & Billing', 'Payment confirmations, due reminders, and billing notifications', 'credit-card', '#10B981', 2, NOW(), NOW()),
        (uuid_generate_v4(), 'chat', 'Messages & Communication', 'Chat messages, communication updates, and collaboration notifications', 'message-circle', '#8B5CF6', 3, NOW(), NOW()),
        (uuid_generate_v4(), 'system', 'System Updates', 'App updates, system maintenance, and general announcements', 'settings', '#6B7280', 4, NOW(), NOW())
        RETURNING id, category_key;
      `);

      const categories = categoryInserts[0];
      console.log(`✅ Created ${categories.length} notification categories`);

      // Get category IDs for events
      const categoryMap = {};
      categories.forEach(cat => {
        categoryMap[cat.category_key] = cat.id;
      });

      console.log('\n🎯 STEP 9: Creating notification events...');
      
      const eventQueries = [
        // Jobs
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.jobs}', 'contract.accepted', 'Contract Accepted', 'When an usta accepts a customer contract', NOW(), NOW())`,
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.jobs}', 'contract.rejected', 'Contract Rejected', 'When an usta rejects a customer contract', NOW(), NOW())`,
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.jobs}', 'work.submitted', 'Work Submitted', 'When usta submits completed work for approval', NOW(), NOW())`,
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.jobs}', 'work.approved', 'Work Approved', 'When customer approves submitted work', NOW(), NOW())`,
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.jobs}', 'proposal.received', 'Proposal Received', 'When customer receives a new proposal from usta', NOW(), NOW())`,
        
        // Payments
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.payments}', 'payment.received', 'Payment Received', 'When payment is successfully processed', NOW(), NOW())`,
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.payments}', 'payment.due_reminder', 'Payment Due Reminder', 'Reminder for upcoming payment due date', NOW(), NOW())`,
        
        // Chat
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.chat}', 'chat.new_message', 'New Message', 'When a new chat message is received', NOW(), NOW())`,
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.chat}', 'review.received', 'Review Received', 'When user receives a new review or rating', NOW(), NOW())`,
        
        // System
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.system}', 'system.announcement', 'System Announcement', 'Important system-wide announcements', NOW(), NOW())`,
        `INSERT INTO notification_events (id, category_id, event_key, event_name, description, created_at, updated_at) VALUES (uuid_generate_v4(), '${categoryMap.system}', 'account.verified', 'Account Verified', 'When user account gets verified', NOW(), NOW())`
      ];

      for (const query of eventQueries) {
        await queryInterface.sequelize.query(query);
      }

      console.log(`✅ Created ${eventQueries.length} notification events`);

      // === FINAL VERIFICATION ===
      console.log('\n✅ FINAL: Verifying setup...');
      
      const [categoryCount] = await queryInterface.sequelize.query('SELECT COUNT(*) as count FROM notification_categories');
      const [eventCount] = await queryInterface.sequelize.query('SELECT COUNT(*) as count FROM notification_events');
      
      console.log('\n🎉 BULLETPROOF NOTIFICATION SYSTEM COMPLETED!');
      console.log(`📊 Summary:`);
      console.log(`   - ${categoryCount[0].count} categories with UUID primary keys`);
      console.log(`   - ${eventCount[0].count} events with UUID foreign keys`);
      console.log(`   - All tables use UUID consistently`);
      console.log(`   - Ready for production!`);

    } catch (error) {
      console.error('❌ Failed to setup notification system:', error.message);
      console.error('Stack trace:', error.stack);
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    console.log('🔄 Rolling back notification system...');
    
    const tablesToDrop = [
      'notification_logs',
      'notification_preferences', 
      'notification_templates',
      'device_tokens',
      'notification_events',
      'notification_categories'
    ];
    
    for (const tableName of tablesToDrop) {
      try {
        await queryInterface.dropTable(tableName, { cascade: true });
        console.log(`✅ Dropped ${tableName}`);
      } catch (error) {
        console.log(`⚠️ Error dropping ${tableName}: ${error.message}`);
      }
    }
    
    console.log('✅ Rollback completed!');
  }
};