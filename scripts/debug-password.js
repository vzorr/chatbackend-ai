// scripts/debug-password.js
require('dotenv').config();
const config = require('../config/config');
const databaseConfig = require('../config/database');

console.log('Password Debug Information:');
console.log('=========================');

// Check the raw environment variable
const rawPassword = process.env.DB_PASS;
console.log('Raw password type:', typeof rawPassword);
console.log('Raw password length:', rawPassword ? rawPassword.length : 'undefined');
console.log('Is null?:', rawPassword === null);
console.log('Is undefined?:', rawPassword === undefined);
console.log('Is empty string?:', rawPassword === '');

// Check for invisible characters
if (rawPassword) {
  console.log('Password char codes:', Array.from(rawPassword).map(c => c.charCodeAt(0)));
  console.log('Starts with space?:', rawPassword.startsWith(' '));
  console.log('Ends with space?:', rawPassword.endsWith(' '));
  console.log('Contains quotes?:', rawPassword.includes('"') || rawPassword.includes("'"));
}

// Check config.js password
const configPassword = config.database.password;
console.log('\nConfig.js password:');
console.log('Type:', typeof configPassword);
console.log('Length:', configPassword ? configPassword.length : 'undefined');

// Check database.js password
const dbConfigPassword = databaseConfig.development.password;
console.log('\nDatabase.js password:');
console.log('Type:', typeof dbConfigPassword);
console.log('Length:', dbConfigPassword ? dbConfigPassword.length : 'undefined');

// Test PostgreSQL connection with different methods
console.log('\nConnection String Test:');
const { Client } = require('pg');

async function testConnections() {
  // Method 1: Individual parameters
  console.log('\nTesting with individual parameters...');
  const client1 = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: process.env.DB_PASS,
    database: 'postgres'
  });

  try {
    await client1.connect();
    console.log('✓ Individual parameters: Connected successfully');
    await client1.end();
  } catch (error) {
    console.log('✗ Individual parameters failed:', error.message);
  }

  // Method 2: Connection string
  console.log('\nTesting with connection string...');
  const connectionString = `postgresql://postgres:${encodeURIComponent(process.env.DB_PASS)}@localhost:5432/postgres`;
  const client2 = new Client({ connectionString });

  try {
    await client2.connect();
    console.log('✓ Connection string: Connected successfully');
    await client2.end();
  } catch (error) {
    console.log('✗ Connection string failed:', error.message);
  }

  // Method 3: Empty password
  console.log('\nTesting with empty password...');
  const client3 = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '',
    database: 'postgres'
  });

  try {
    await client3.connect();
    console.log('✓ Empty password: Connected successfully');
    await client3.end();
  } catch (error) {
    console.log('✗ Empty password failed:', error.message);
  }
}

testConnections().catch(console.error);