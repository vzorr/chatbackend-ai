// scripts/run-migrations.js
require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

async function runMigrations() {
  console.log('Running migrations with custom runner...\n');

  // Safely encode password to handle special characters
  const dbPassword = process.env.DB_PASS ? encodeURIComponent(process.env.DB_PASS) : '';
  
  // Create connection (with encoded password)
  const sequelize = new Sequelize(
    process.env.DB_NAME || 'myusta_chatapp',
    process.env.DB_USER || 'postgres',
    dbPassword,
    {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      dialect: 'postgres',
      logging: false,
      dialectOptions: {
        ssl: process.env.DB_SSL === 'true' ? {
          require: true,
          rejectUnauthorized: false
        } : false
      }
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
    let errorCount = 0;
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
        console.error(`Error: ${error.message}`);
        console.error(`Stack: ${error.stack}`);
        errorCount++;
        
        // Decide whether to continue with next migrations
        if (process.env.CONTINUE_ON_ERROR !== 'true') {
          console.error('Stopping migration process due to error. Set CONTINUE_ON_ERROR=true to force continue.');
          throw error;
        } else {
          console.warn('⚠️ Continuing to next migration despite error due to CONTINUE_ON_ERROR=true setting');
        }
      }
    }

    console.log(`\n✨ Migration process completed!`);
    console.log(`Results: ${ranCount} migrations ran successfully, ${errorCount} failed.`);
    
    // Close database connection
    await sequelize.close();
    
    // Exit with error code if any migrations failed
    if (errorCount > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Migration process failed:', error.message);
    await sequelize.close();
    process.exit(1);
  }
}

// Run with error handling
runMigrations().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});