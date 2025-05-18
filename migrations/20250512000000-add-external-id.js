// migrations/20250512000000-add-external-id.js
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    console.log('Running externalId column NOT NULL constraint migration...');
    
    // First check if we have any NULL values
    const [results] = await queryInterface.sequelize.query(`
      SELECT COUNT(*) as count FROM users WHERE "externalId" IS NULL
    `);
    
    const nullCount = parseInt(results[0].count);
    if (nullCount > 0) {
      console.log(`Found ${nullCount} users with NULL externalId. Please update these records.`);
      return Promise.reject(new Error(`Cannot make externalId NOT NULL - found ${nullCount} users with NULL values`));
    }

    // Add NOT NULL constraint in a separate ALTER COLUMN statement
    // PostgreSQL doesn't allow combining NOT NULL with other constraints in a single statement
    try {
      // First just update the NOT NULL constraint
      await queryInterface.sequelize.query(`
        ALTER TABLE users 
        ALTER COLUMN "externalId" SET NOT NULL
      `);
      
      console.log('✅ Successfully added NOT NULL constraint to externalId column');
      return Promise.resolve();
    } catch (error) {
      console.error('❌ Error updating externalId column:', error.message);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('Removing NOT NULL constraint from externalId column...');
      
      // Use raw SQL to remove just the NOT NULL constraint
      await queryInterface.sequelize.query(`
        ALTER TABLE users
        ALTER COLUMN "externalId" DROP NOT NULL
      `);
      
      console.log('✅ NOT NULL constraint removed from externalId column');
    } catch (error) {
      console.error('❌ Error while modifying externalId:', error.message);
      throw error;
    }
  }
};