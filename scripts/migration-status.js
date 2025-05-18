// scripts/migration-status.js
require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');
const fs = require('fs').promises;
const path = require('path');

async function checkMigrationStatus() {
  console.log('Checking migration status...\n');

  // Safely handle DB credentials
  const dbPassword = process.env.DB_PASS ? encodeURIComponent(process.env.DB_PASS) : '';
  
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
    await sequelize.authenticate();
    console.log('✅ Database connection successful\n');
    
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

    // Check for model-migration consistency
    console.log('\nChecking model-migration consistency:');
    console.log('===================================\n');

    try {
      // Check ENUM types
      console.log('Checking ENUM types...');
      const [enumTypes] = await sequelize.query(`
        SELECT typname, array_agg(enumlabel) as values 
        FROM pg_enum 
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
        GROUP BY typname
      `);
      
      // Compare with expected enum values
      const expectedEnums = {
        'enum_users_role': ['customer', 'usta', 'administrator'],
        'enum_messages_status': ['sent', 'delivered', 'read'],
        'enum_messages_type': ['text', 'image', 'file', 'emoji', 'audio', 'system'],
        'enum_device_tokens_deviceType': ['mobile', 'web']
      };
      
      for (const enumType of enumTypes) {
        if (expectedEnums[enumType.typname]) {
          const typValues = enumType.values;
          const expectedValues = expectedEnums[enumType.typname];
          
          // Check if values match
          const allMatch = expectedValues.every(val => typValues.includes(val)) && 
                          typValues.length === expectedValues.length;
          
          if (allMatch) {
            console.log(`✅ ENUM ${enumType.typname} values match expected: ${typValues.join(', ')}`);
          } else {
            console.log(`❌ ENUM ${enumType.typname} values mismatch!`);
            console.log(`   Database has: ${typValues.join(', ')}`);
            console.log(`   Expected: ${expectedValues.join(', ')}`);
          }
        }
      }
      
      // Check for missing ENUMs
      const missingEnums = Object.keys(expectedEnums).filter(
        enumName => !enumTypes.some(e => e.typname === enumName)
      );
      
      if (missingEnums.length > 0) {
        console.log(`\n❌ Missing ENUM types: ${missingEnums.join(', ')}`);
      }
      
      // Check externalId consistency
      console.log('\nChecking externalId field...');
      const [userTableInfo] = await sequelize.query(`
        SELECT column_name, is_nullable, data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'externalId'
      `);
      
      if (userTableInfo.length === 0) {
        console.log('❌ externalId column does not exist in users table');
      } else {
        const colInfo = userTableInfo[0];
        console.log(`✅ externalId exists with type ${colInfo.data_type} (${colInfo.udt_name})`);
        console.log(`✅ Nullable: ${colInfo.is_nullable === 'YES' ? 'Yes' : 'No'}`);
      }
      
    } catch (error) {
      console.error('Error checking model consistency:', error.message);
    }

    await sequelize.close();
  } catch (error) {
    console.error('Error checking migration status:', error.message);
    await sequelize.close();
    process.exit(1);
  }
}

checkMigrationStatus();