// middleware/auth-middleware.js
const jwt = require('jsonwebtoken');
const { User } = require('../db/models');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { validateUUID } = require('../utils/validation');

/**
 * Authentication middleware to protect routes
 * Verifies JWT token and attaches user to request
 * Supports pass-through authentication from React Native app
 */
module.exports = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify token
    try {
      // Verify the token using the same secret as your React Native app
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Ensure externalId is a valid UUID
      const externalId = decoded.id || decoded.userId || decoded.sub;
      
      if (!externalId || !validateUUID(externalId)) {
        return res.status(401).json({ 
          error: 'Invalid user identifier', 
          details: 'The user ID must be a valid UUID'
        });
      }
      
      // Find or create user based on token data
      const user = await User.findOrCreateFromToken(decoded);
      
      if (!user) {
        return res.status(401).json({ error: 'User not found and could not be created' });
      }
      
      // Attach user to request
      req.user = user;
      req.tokenData = decoded; // Keep the original token data
      
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      } else if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
      } else {
        logger.error(`Authentication error: ${err}`);
        return res.status(401).json({ error: 'Authentication failed' });
      }
    }
  } catch (error) {
    logger.error(`Authentication middleware error: ${error}`);
    next(error);
  }
};