// test-db.js - Create this file to test database connection
require('dotenv').config();
const { Sequelize } = require('sequelize');

async function testDatabaseConnection() {
  console.log('🔍 Testing database connection...');
  console.log('Database config:', {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASS ? '***SET***' : '***NOT SET***'
  });

  const sequelize = new Sequelize({
    dialect: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'myusta_chatapp',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'd8P@ssw0rd2025',
    logging: console.log,
    
    pool: {
      max: 5,
      min: 1,
      acquire: 10000,
      idle: 5000
    },
    
    dialectOptions: {
      connectTimeout: 10000,
      acquireTimeout: 10000,
      timeout: 10000
    }
  });

  try {
    console.log('🔄 Attempting connection...');
    
    // Test with timeout
    await Promise.race([
      sequelize.authenticate(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000)
      )
    ]);
    
    console.log('✅ Database connection successful!');
    
    // Test a simple query
    const [results] = await sequelize.query('SELECT version()');
    console.log('✅ Database version:', results[0].version);
    
  } catch (error) {
    console.error('❌ Database connection failed:');
    console.error('Error message:', error.message);
    console.error('Error code:', error.code);
    console.error('Error stack:', error.stack);
    
    // Common error diagnostics
    if (error.message.includes('ECONNREFUSED')) {
      console.error('💡 Suggestion: Check if PostgreSQL is running and accessible');
    } else if (error.message.includes('ENOTFOUND')) {
      console.error('💡 Suggestion: Check DB_HOST setting');
    } else if (error.message.includes('authentication failed')) {
      console.error('💡 Suggestion: Check DB_USER and DB_PASS settings');
    } else if (error.message.includes('database') && error.message.includes('does not exist')) {
      console.error('💡 Suggestion: Check DB_NAME setting or create the database');
    }
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

testDatabaseConnection();