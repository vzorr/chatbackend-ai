'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Use describeTable to check if the column already exists
    try {
      const tableInfo = await queryInterface.describeTable('users');
      if (!tableInfo.externalId) {
        console.log('Adding column externalId to users...');
        await queryInterface.addColumn('users', 'externalId', {
          type: Sequelize.UUID,
          allowNull: false,
          unique: true,
          comment: 'UUID of the user from the main React Native application',
        });
        console.log('✅ Column externalId added successfully.');
      } else {
        console.log('⚠ Column externalId already exists. Skipping...');
      }
    } catch (error) {
      console.error('❌ Error while checking or adding externalId:', error.message);
      throw error;
    }
  },

  down: async (queryInterface) => {
    try {
      console.log('Removing column externalId from users...');
      await queryInterface.removeColumn('users', 'externalId');
      console.log('✅ Column externalId removed successfully.');
    } catch (error) {
      console.error('❌ Error while removing externalId:', error.message);
      throw error;
    }
  }
};
