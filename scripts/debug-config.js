// scripts/debug-config.js
require('dotenv').config();
const config = require('../config/config');
const databaseConfig = require('../config/database');

console.log('Environment Variables:');
console.log('DB_HOST:', process.env.DB_HOST);
console.log('DB_PORT:', process.env.DB_PORT);
console.log('DB_NAME:', process.env.DB_NAME);
console.log('DB_USER:', process.env.DB_USER);
console.log('DB_PASS:', process.env.DB_PASS ? '[SET]' : '[NOT SET]');

console.log('\nMain Config - Database Section:');
console.log('Host:', config.database.host);
console.log('Port:', config.database.port);
console.log('Name:', config.database.name);
console.log('User:', config.database.user);
console.log('Password:', config.database.password ? '[SET]' : '[NOT SET]');

console.log('\nDatabase Config for CLI:');
console.log('Development:');
console.log('Username:', databaseConfig.development.username);
console.log('Password:', databaseConfig.development.password ? '[SET]' : '[NOT SET]');
console.log('Database:', databaseConfig.development.database);
console.log('Host:', databaseConfig.development.host);