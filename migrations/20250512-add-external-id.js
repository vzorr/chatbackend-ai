'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Add externalId column to track users from the main app
    await queryInterface.addColumn('users', 'externalId', {
      type: Sequelize.UUID,
      allowNull: true,
      unique: true
    });
    
    // Add email column for alternative identification
    await queryInterface.addColumn('users', 'email', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true
    });
    
    // Make phone optional since we might identify by externalId or email
    await queryInterface.changeColumn('users', 'phone', {
      type: Sequelize.STRING,
      allowNull: true,
      unique: true
    });
    
    // Add index for efficient querying
    await queryInterface.addIndex('users', ['externalId'], {
      name: 'idx_users_external_id'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex('users', 'idx_users_external_id');
    await queryInterface.removeColumn('users', 'externalId');
    await queryInterface.removeColumn('users', 'email');
    
    // Restore phone as required
    await queryInterface.changeColumn('users', 'phone', {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true
    });
  }
};