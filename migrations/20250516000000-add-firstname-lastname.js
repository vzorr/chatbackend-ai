'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Get current table structure to check if columns already exist
    const userTableInfo = await queryInterface.describeTable('users');
    
    // Add firstName column if it doesn't exist
    if (!userTableInfo.firstName) {
      await queryInterface.addColumn('users', 'firstName', {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'User\'s first name'
      });
    }

    // Add lastName column if it doesn't exist
    if (!userTableInfo.lastName) {
      await queryInterface.addColumn('users', 'lastName', {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'User\'s last name'
      });
    }

    // Optional: Migrate existing 'name' data to firstName/lastName
    // This tries to split existing names on the first space
    await queryInterface.sequelize.query(`
      UPDATE users 
      SET 
        "firstName" = CASE 
          WHEN name IS NOT NULL AND name != '' THEN 
            TRIM(SPLIT_PART(name, ' ', 1))
          ELSE NULL 
        END,
        "lastName" = CASE 
          WHEN name IS NOT NULL AND name != '' AND POSITION(' ' IN name) > 0 THEN 
            TRIM(SUBSTRING(name FROM POSITION(' ' IN name) + 1))
          ELSE NULL 
        END
      WHERE name IS NOT NULL AND name != ''
        AND ("firstName" IS NULL OR "lastName" IS NULL);
    `);

    // Add indexes for better performance on name searches
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        -- Index for firstName searches
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_first_name') THEN
          CREATE INDEX idx_users_first_name ON users("firstName");
        END IF;
        
        -- Index for lastName searches
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_last_name') THEN
          CREATE INDEX idx_users_last_name ON users("lastName");
        END IF;
        
        -- Composite index for full name searches
        IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_full_name') THEN
          CREATE INDEX idx_users_full_name ON users("firstName", "lastName");
        END IF;
      END $$;
    `);
  },

  down: async (queryInterface, Sequelize) => {
    // Drop indexes first
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS idx_users_full_name;
      DROP INDEX IF EXISTS idx_users_last_name;
      DROP INDEX IF EXISTS idx_users_first_name;
    `);

    // Get current table structure
    const userTableInfo = await queryInterface.describeTable('users');
    
    // Remove lastName column if it exists
    if (userTableInfo.lastName) {
      await queryInterface.removeColumn('users', 'lastName');
    }

    // Remove firstName column if it exists
    if (userTableInfo.firstName) {
      await queryInterface.removeColumn('users', 'firstName');
    }
  }
};