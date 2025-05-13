// config/database.js
require('dotenv').config();  // ✅ Ensure .env is loaded
const config = require('./config');

// Transform your app's config format to Sequelize CLI's expected format
module.exports = {
  development: {

    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'myusta_chatapp',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'd8P@ssw0rd2025',
    dialect: 'postgres',
    logging: process.env.DB_LOGGING === 'true',
    
  },
  test: {
    username: config.database.user,
    password: config.database.password,
    database: `${config.database.name}_test`,
    host: config.database.host,
    port: config.database.port,
    dialect: config.database.dialect,
    logging: false
  },
  production: {
    username: config.database.user,
    password: config.database.password,
    database: config.database.name,
    host: config.database.host,
    port: config.database.port,
    dialect: config.database.dialect,
    logging: false,
    pool: config.database.pool
  }
};