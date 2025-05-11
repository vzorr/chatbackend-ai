// middleware/authenticate.js
const jwt = require('jsonwebtoken');
const { User } = require('../db/models');
const logger = require('../utils/logger');

/**
 * Authentication middleware to protect routes
 * Verifies JWT token and attaches user to request
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
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Find user
      const user = await User.findByPk(decoded.id);
      
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      
      // Attach user to request
      req.user = user;
      
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
