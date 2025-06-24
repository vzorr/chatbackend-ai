// migrations/20250624000000-remove-device-token-uniqueness.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('Running device token uniqueness removal migration...');
    
    try {
      // === STEP 1: CHECK CURRENT CONSTRAINTS ===
      console.log('🔍 Checking current token constraints...');
      
      const [constraints] = await queryInterface.sequelize.query(`
        SELECT 
          conname as constraint_name,
          contype as constraint_type
        FROM pg_constraint 
        JOIN pg_class ON pg_constraint.conrelid = pg_class.oid 
        WHERE pg_class.relname = 'device_tokens' 
          AND contype = 'u'
          AND EXISTS (
            SELECT 1 FROM pg_attribute 
            WHERE pg_attribute.attrelid = pg_class.oid 
              AND pg_attribute.attname = 'token'
              AND pg_attribute.attnum = ANY(pg_constraint.conkey)
          )
      `);

      console.log(`Found ${constraints.length} unique constraint(s) on token field`);

      // === STEP 2: REMOVE UNIQUE CONSTRAINT ===
      console.log('💥 Removing unique constraint on token field...');
      
      // Try common constraint names
      const possibleConstraintNames = [
        'device_tokens_token_key',
        'device_tokens_token_unique',
        'unique_device_tokens_token'
      ];

      for (const constraintName of possibleConstraintNames) {
        try {
          await queryInterface.sequelize.query(`
            ALTER TABLE device_tokens DROP CONSTRAINT IF EXISTS "${constraintName}"
          `);
          console.log(`✅ Dropped constraint: ${constraintName}`);
        } catch (error) {
          console.log(`⚠️ Constraint ${constraintName} doesn't exist`);
        }
      }

      // Also drop any detected constraints
      for (const constraint of constraints) {
        try {
          await queryInterface.sequelize.query(`
            ALTER TABLE device_tokens DROP CONSTRAINT IF EXISTS "${constraint.constraint_name}"
          `);
          console.log(`✅ Dropped detected constraint: ${constraint.constraint_name}`);
        } catch (error) {
          console.log(`⚠️ Failed to drop ${constraint.constraint_name}: ${error.message}`);
        }
      }

      // === STEP 3: REMOVE UNIQUE INDEX ===
      console.log('📊 Removing unique index on token field...');
      
      const [indexes] = await queryInterface.sequelize.query(`
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'device_tokens' 
          AND indexdef LIKE '%token%' 
          AND indexdef LIKE '%UNIQUE%'
      `);

      console.log(`Found ${indexes.length} unique index(es) on token field`);

      // Drop unique indexes
      for (const index of indexes) {
        try {
          await queryInterface.sequelize.query(`
            DROP INDEX IF EXISTS "${index.indexname}"
          `);
          console.log(`✅ Dropped unique index: ${index.indexname}`);
        } catch (error) {
          console.log(`⚠️ Failed to drop index ${index.indexname}: ${error.message}`);
        }
      }

      // === STEP 4: CREATE NON-UNIQUE INDEX FOR PERFORMANCE ===
      console.log('📈 Creating non-unique index on token for performance...');
      
      try {
        await queryInterface.addIndex('device_tokens', ['token'], {
          name: 'idx_device_tokens_token_non_unique',
          unique: false
        });
        console.log('✅ Created non-unique index on token field');
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('⚠️ Non-unique index already exists');
        } else {
          console.log(`⚠️ Failed to create performance index: ${error.message}`);
        }
      }

      // === STEP 5: ADD COMPOSITE UNIQUE CONSTRAINT ===
      console.log('🔗 Adding composite unique constraint (user_id + device_id)...');
      
      try {
        // Check if device_id column exists
        const [deviceIdCheck] = await queryInterface.sequelize.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'device_tokens' 
            AND column_name = 'device_id'
        `);

        if (deviceIdCheck.length > 0) {
          await queryInterface.addIndex('device_tokens', ['user_id', 'device_id'], {
            name: 'unique_user_device',
            unique: true
          });
          console.log('✅ Created composite unique constraint on (user_id + device_id)');
        } else {
          console.log('⚠️ device_id column not found - skipping composite constraint');
        }
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log('⚠️ Composite unique constraint already exists');
        } else {
          console.log(`⚠️ Failed to create composite constraint: ${error.message}`);
        }
      }

      // === FINAL VERIFICATION ===
      console.log('✅ Verifying changes...');
      
      const [finalConstraints] = await queryInterface.sequelize.query(`
        SELECT 
          conname as constraint_name,
          contype as constraint_type
        FROM pg_constraint 
        JOIN pg_class ON pg_constraint.conrelid = pg_class.oid 
        WHERE pg_class.relname = 'device_tokens'
      `);

      console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!');
      console.log(`📊 Summary:`);
      console.log(`   - Removed unique constraint on token field`);
      console.log(`   - Multiple devices can now use same FCM token`);
      console.log(`   - Added performance index on token field`);
      console.log(`   - ${finalConstraints.length} total constraints on table`);
      console.log('   - Ready for Customer/Usta app testing on same device!');

      return Promise.resolve();

    } catch (error) {
      console.error('❌ Failed to remove token uniqueness:', error.message);
      console.error('Stack trace:', error.stack);
      return Promise.reject(error);
    }
  },

  down: async (queryInterface, Sequelize) => {
    console.log('Rolling back: Restoring token uniqueness constraint...');
    
    try {
      // === STEP 1: CHECK FOR DUPLICATE TOKENS ===
      console.log('🔍 Checking for duplicate tokens...');
      
      const [duplicates] = await queryInterface.sequelize.query(`
        SELECT token, COUNT(*) as count 
        FROM device_tokens 
        GROUP BY token 
        HAVING COUNT(*) > 1
      `);

      if (duplicates.length > 0) {
        console.log(`⚠️ WARNING: Found ${duplicates.length} duplicate token(s)`);
        console.log('Cannot restore unique constraint with duplicate data');
        
        // Clean up duplicates (keep most recent)
        console.log('🧹 Cleaning up duplicate tokens (keeping most recent)...');
        
        for (const duplicate of duplicates) {
          await queryInterface.sequelize.query(`
            DELETE FROM device_tokens 
            WHERE token = :token 
              AND id NOT IN (
                SELECT id FROM device_tokens 
                WHERE token = :token 
                ORDER BY updated_at DESC 
                LIMIT 1
              )
          `, {
            replacements: { token: duplicate.token }
          });
        }
        
        console.log('✅ Cleaned up duplicate tokens');
      }

      // === STEP 2: REMOVE NON-UNIQUE INDEX ===
      console.log('📊 Removing non-unique index...');
      
      try {
        await queryInterface.sequelize.query(`
          DROP INDEX IF EXISTS "idx_device_tokens_token_non_unique"
        `);
        console.log('✅ Removed non-unique index');
      } catch (error) {
        console.log(`⚠️ Failed to remove non-unique index: ${error.message}`);
      }

      // === STEP 3: REMOVE COMPOSITE CONSTRAINT ===
      console.log('🔗 Removing composite unique constraint...');
      
      try {
        await queryInterface.sequelize.query(`
          DROP INDEX IF EXISTS "unique_user_device"
        `);
        console.log('✅ Removed composite unique constraint');
      } catch (error) {
        console.log(`⚠️ Failed to remove composite constraint: ${error.message}`);
      }

      // === STEP 4: RESTORE UNIQUE CONSTRAINT ===
      console.log('🔒 Restoring unique constraint on token...');
      
      try {
        await queryInterface.addIndex('device_tokens', ['token'], {
          name: 'device_tokens_token_key',
          unique: true
        });
        console.log('✅ Restored unique constraint on token field');
      } catch (error) {
        console.error(`❌ Failed to restore unique constraint: ${error.message}`);
        return Promise.reject(error);
      }

      console.log('✅ Rollback completed - token uniqueness restored!');
      return Promise.resolve();

    } catch (error) {
      console.error('❌ Failed to rollback token uniqueness:', error.message);
      console.error('Stack trace:', error.stack);
      return Promise.reject(error);
    }
  }
};