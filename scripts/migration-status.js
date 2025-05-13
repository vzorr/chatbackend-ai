// scripts/migration-status.js
require('dotenv').config();
const { Sequelize } = require('sequelize');
const fs = require('fs').promises;
const path = require('path');

async function checkMigrationStatus() {
  console.log('Checking migration status...\n');

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
    
    // Check if migrations table exists
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'SequelizeMeta'
    `);

    if (tables.length === 0) {
      console.log('⚠️  Migrations table does not exist. No migrations have been run.');
      await sequelize.close();
      return;
    }

    // Get completed migrations
    const [completedMigrations] = await sequelize.query(
      'SELECT name FROM "SequelizeMeta" ORDER BY name'
    );
    
    // Get migration files
    const migrationsPath = path.join(__dirname, '..', 'migrations');
    const files = await fs.readdir(migrationsPath);
    const migrationFiles = files
      .filter(f => f.endsWith('.js'))
      .sort();

    console.log('Migration Status:');
    console.log('=================\n');

    const completedNames = completedMigrations.map(m => m.name);
    
    for (const file of migrationFiles) {
      const status = completedNames.includes(file) ? '✅ Completed' : '❌ Pending';
      console.log(`${status}: ${file}`);
    }

    console.log(`\nSummary:`);
    console.log(`Total migrations: ${migrationFiles.length}`);
    console.log(`Completed: ${completedNames.length}`);
    console.log(`Pending: ${migrationFiles.length - completedNames.length}`);

    await sequelize.close();
  } catch (error) {
    console.error('Error checking migration status:', error.message);
    await sequelize.close();
    process.exit(1);
  }
}

checkMigrationStatus();