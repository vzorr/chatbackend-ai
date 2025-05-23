// scripts/run-seeder.js

require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(50));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(50) + '\n');
}

async function runSeeder() {
  try {
    logSection('🌱 VortexHive Chat Seeder');
    
    // Check if .env file exists
    if (!fs.existsSync('.env')) {
      log('❌ Error: .env file not found!', colors.red);
      log('Please create a .env file with your database configuration.', colors.yellow);
      process.exit(1);
    }
    
    // Check required environment variables
    const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_NAME'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      log(`❌ Error: Missing required environment variables: ${missingVars.join(', ')}`, colors.red);
      process.exit(1);
    }
    
    log('📋 Database Configuration:', colors.blue);
    log(`   Host: ${process.env.DB_HOST}`);
    log(`   Port: ${process.env.DB_PORT || 5432}`);
    log(`   Database: ${process.env.DB_NAME}`);
    log(`   User: ${process.env.DB_USER}`);
    console.log('');
    
    // Check if the seeder file exists
    const seederPath = path.join(__dirname, '..', 'db', 'seeders', '20250123000000-chat-conversations-seed.js');
    if (!fs.existsSync(seederPath)) {
      log('❌ Error: Seeder file not found!', colors.red);
      log(`Expected location: ${seederPath}`, colors.yellow);
      process.exit(1);
    }
    
    // Run the seeder using Sequelize CLI
    log('🚀 Running database seeder...', colors.green);
    console.log('');
    
    try {
      execSync('npx sequelize-cli db:seed --seed 20250123000000-chat-conversations-seed.js', {
        stdio: 'inherit',
        cwd: process.cwd()
      });
      
      console.log('');
      log('✅ Seeding completed successfully!', colors.green);
      
      // Display helpful information
      logSection('📌 Next Steps');
      log('1. Start your server: npm start', colors.cyan);
      log('2. The target user ID is: 81f74e18-62ec-426d-92fe-4152d707dbcf', colors.cyan);
      log('3. Check the database for newly created conversations and messages', colors.cyan);
      log('4. Test the chat functionality with the seeded data', colors.cyan);
      
    } catch (error) {
      console.log('');
      log('❌ Seeding failed!', colors.red);
      log('Please check the error messages above.', colors.yellow);
      process.exit(1);
    }
    
  } catch (error) {
    log(`❌ Unexpected error: ${error.message}`, colors.red);
    process.exit(1);
  }
}

// Run the seeder
runSeeder();