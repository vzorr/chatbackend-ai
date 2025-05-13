// scripts/run-migrations.js
require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

async function runMigrations() {
  console.log('Running migrations with custom runner...\n');

  // Create connection (proven to work from your debug test)
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
    // Test connection
    await sequelize.authenticate();
    console.log('✓ Database connected successfully\n');

    // Create migrations table if it doesn't exist
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS "SequelizeMeta" (
        name VARCHAR(255) NOT NULL PRIMARY KEY
      );
    `);

    // Get completed migrations
    const [completedMigrations] = await sequelize.query(
      'SELECT name FROM "SequelizeMeta"'
    );
    const completedNames = completedMigrations.map(m => m.name);
    console.log(`Found ${completedNames.length} completed migrations`);

    // Get migration files
    const migrationsPath = path.join(__dirname, '..', 'migrations');
    const files = await fs.readdir(migrationsPath);
    const migrationFiles = files
      .filter(f => f.endsWith('.js'))
      .sort();

    console.log(`Found ${migrationFiles.length} migration files\n`);

    // Run pending migrations
    let ranCount = 0;
    for (const file of migrationFiles) {
      if (completedNames.includes(file)) {
        console.log(`⏭️  Skipping: ${file} (already run)`);
        continue;
      }

      console.log(`🔄 Running: ${file}`);
      const migration = require(path.join(migrationsPath, file));
      
      try {
        await migration.up(sequelize.getQueryInterface(), Sequelize);
        
        // Mark as completed
        await sequelize.query(
          'INSERT INTO "SequelizeMeta" (name) VALUES ($1)',
          { 
            bind: [file],
            type: sequelize.QueryTypes.INSERT
          }
        );
        
        console.log(`✅ Completed: ${file}\n`);
        ranCount++;
      } catch (error) {
        console.error(`❌ Failed: ${file}`);
        console.error(error.message);
        throw error;
      }
    }

    console.log(`\n✨ Migration complete! Ran ${ranCount} migrations.`);
    await sequelize.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    await sequelize.close();
    process.exit(1);
  }
}

// Run with error handling
runMigrations().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});