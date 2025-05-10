// config/config.js
require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    logging: false
  },
  test: {
    /* Optional: Add your test DB config here */
  },
  production: {
    /* Optional: Add your production DB config here */
  }
};
