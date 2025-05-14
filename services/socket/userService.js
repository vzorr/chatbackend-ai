// /services/socket/userService.js
const db = require('../../db');
const logger = require('../../utils/logger');

class UserService {
  async findById(userId) {
    try {
      const models = db.getModels();
      const User = models.User;
      
      if (!User) {
        logger.error('User model not found in database models');
        throw new Error('User model not available');
      }
      
      return User.findByPk(userId);
    } catch (error) {
      logger.error(`Error finding user by ID: ${error.message}`, {
        userId,
        error: error.stack
      });
      throw error;
    }
  }
}

module.exports = new UserService();