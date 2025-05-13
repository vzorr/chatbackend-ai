// middleware/swaggerAuth.js
const basicAuth = require('express-basic-auth');

/**
 * Middleware to protect Swagger documentation in production
 */
const swaggerAuth = () => {
  if (process.env.NODE_ENV === 'production') {
    return basicAuth({
      users: {
        [process.env.SWAGGER_USER || 'admin']: process.env.SWAGGER_PASSWORD || 'changeme'
      },
      challenge: true,
      unauthorizedResponse: 'Unauthorized access to API documentation'
    });
  }
  
  // No auth in development
  return (req, res, next) => next();
};

module.exports = swaggerAuth;