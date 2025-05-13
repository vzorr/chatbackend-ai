// scripts/migrate-undo.js
require('dotenv').config();
const { Sequelize } = require('sequelize');
const fs = require('fs').promises;
const path = require('path');

async function undoLastMigration() {
  console.log('Undoing last migration...\n');

  const sequelize = new Sequelize(
    process.env.DB_NAME || 'myusta_chatapp',
    process.env.DB_USER || 'postgres',
    process.env.DB_PASS,
    {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: false
    }
  );

  try {
    await sequelize.authenticate();
    
    // Get the last completed migration
    const [completedMigrations] = await sequelize.query(
      'SELECT name FROM "SequelizeMeta" ORDER BY name DESC LIMIT 1'
    );
    
    if (completedMigrations.length === 0) {
      console.log('No migrations to undo.');
      await sequelize.close();
      return;
    }

    const lastMigration = completedMigrations[0].name;
    console.log(`🔄 Undoing: ${lastMigration}`);

    const migrationPath = path.join(__dirname, '..', 'migrations', lastMigration);
    const migration = require(migrationPath);
    
    try {
      await migration.down(sequelize.getQueryInterface(), Sequelize);
      
      // Remove from completed migrations
      await sequelize.query(
        'DELETE FROM "SequelizeMeta" WHERE name = $1',
        { 
          bind: [lastMigration],
          type: sequelize.QueryTypes.DELETE
        }
      );
      
      console.log(`✅ Successfully undid: ${lastMigration}`);
    } catch (error) {
      console.error(`❌ Failed to undo: ${lastMigration}`);
      console.error(error.message);
      throw error;
    }

    await sequelize.close();
  } catch (error) {
    console.error('Error undoing migration:', error.message);
    await sequelize.close();
    process.exit(1);
  }
}

undoLastMigration();