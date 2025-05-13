'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const tableInfo = await queryInterface.describeTable('users');

    if (!tableInfo.externalId) {
      console.log('Adding column externalId to users...');
      await queryInterface.addColumn('users', 'externalId', {
        type: Sequelize.UUID,
        allowNull: true,
        unique: true,
        comment: 'UUID of the user from the main app'
      });
      console.log('✅ Column externalId added.');
    } else {
      console.log('⚠ Column externalId already exists. Skipping...');
    }

    if (!tableInfo.email) {
      console.log('Adding column email to users...');
      await queryInterface.addColumn('users', 'email', {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true
      });
      console.log('✅ Column email added.');
    } else {
      console.log('⚠ Column email already exists. Skipping...');
    }

    // Always attempt to change column safely
    try {
      console.log('Updating phone column to allow NULL and be unique...');
      await queryInterface.changeColumn('users', 'phone', {
        type: Sequelize.STRING,
        allowNull: true,
        unique: true
      });
      console.log('✅ Phone column updated.');
    } catch (error) {
      console.error('❌ Error updating phone column:', error.message);
      throw error;
    }

    // Check if index already exists before adding
    const [results] = await queryInterface.sequelize.query(`
      SELECT to_regclass('public.idx_users_external_id') as index_exists;
    `);
    if (!results[0].index_exists) {
      console.log('Adding index idx_users_external_id...');
      await queryInterface.addIndex('users', ['externalId'], {
        name: 'idx_users_external_id'
      });
      console.log('✅ Index idx_users_external_id added.');
    } else {
      console.log('⚠ Index idx_users_external_id already exists. Skipping...');
    }
  },

  down: async (queryInterface, Sequelize) => {
    console.log('Removing index and columns...');
    await queryInterface.removeIndex('users', 'idx_users_external_id');
    await queryInterface.removeColumn('users', 'externalId');
    await queryInterface.removeColumn('users', 'email');

    // Restore phone as required
    await queryInterface.changeColumn('users', 'phone', {
      type: Sequelize.STRING,
      allowNull: false,
      unique: true
    });
    console.log('✅ All reverted.');
  }
};
