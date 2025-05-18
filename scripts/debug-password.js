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
  console.log('URL encoded password:', encodeURIComponent(rawPassword));
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
  // Method 1: Individual parameters with URL encoding
  console.log('\nTesting with individual parameters (URL-encoded password)...');
  const client1 = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: process.env.DB_PASS ? encodeURIComponent(process.env.DB_PASS) : '',
    database: 'postgres'
  });

  try {
    // scripts/debug-password.js (continued)
    await client1.connect();
    console.log('✓ Individual parameters with URL-encoded password: Connected successfully');
    await client1.end();
  } catch (error) {
    console.log('✗ Individual parameters with URL-encoded password failed:', error.message);
  }

  // Method 2: Individual parameters with raw password
  console.log('\nTesting with individual parameters (raw password)...');
  const client2 = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: process.env.DB_PASS || '',
    database: 'postgres'
  });

  try {
    await client2.connect();
    console.log('✓ Individual parameters with raw password: Connected successfully');
    await client2.end();
  } catch (error) {
    console.log('✗ Individual parameters with raw password failed:', error.message);
  }

  // Method 3: Connection string with URL encoding
  console.log('\nTesting with connection string (URL-encoded password)...');
  const encodedPassword = encodeURIComponent(process.env.DB_PASS || '');
  const connectionString = `postgresql://postgres:${encodedPassword}@localhost:5432/postgres`;
  const client3 = new Client({ connectionString });

  try {
    await client3.connect();
    console.log('✓ Connection string with URL-encoded password: Connected successfully');
    await client3.end();
  } catch (error) {
    console.log('✗ Connection string with URL-encoded password failed:', error.message);
  }

  // Method 4: Connection string with raw password
  console.log('\nTesting with connection string (raw password)...');
  const rawConnectionString = `postgresql://postgres:${process.env.DB_PASS || ''}@localhost:5432/postgres`;
  const client4 = new Client({ connectionString: rawConnectionString });

  try {
    await client4.connect();
    console.log('✓ Connection string with raw password: Connected successfully');
    await client4.end();
  } catch (error) {
    console.log('✗ Connection string with raw password failed:', error.message);
  }

  // Method 5: Empty password
  console.log('\nTesting with empty password...');
  const client5 = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '',
    database: 'postgres'
  });

  try {
    await client5.connect();
    console.log('✓ Empty password: Connected successfully');
    await client5.end();
  } catch (error) {
    console.log('✗ Empty password failed:', error.message);
  }

  console.log('\nConnection test complete. Check if any method succeeded.');
}

testConnections().catch(console.error);