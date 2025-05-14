// services/UserService.js
const db = require('../db');
const logger = require('../utils/logger');

class UserService {
  /**
   * Always safely get the User model.
   */
  getModel() {
    return db.User;
  }

  /**
   * Find user by external ID.
   */
  async findByExternalId(externalId) {
    try {
      logger.info('UserService: Finding user by externalId', { externalId });
      const User = this.getModel();
      const user = await User.findOne({ where: { externalId } });
      if (user) {
        logger.info('UserService: User found', { userId: user.id });
      } else {
        logger.warn('UserService: User not found by externalId', { externalId });
      }
      return user;
    } catch (error) {
      logger.error('UserService: Error finding user by externalId', { externalId, error: error.message });
      throw error;
    }
  }

  /**
   * Find user by primary key.
   */
  async findById(id) {
    try {
      logger.info('UserService: Finding user by ID', { id });
      const User = this.getModel();
      const user = await User.findByPk(id);
      if (user) {
        logger.info('UserService: User found by ID', { userId: user.id });
      } else {
        logger.warn('UserService: User not found by ID', { id });
      }
      return user;
    } catch (error) {
      logger.error('UserService: Error finding user by ID', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Find or create user using token data.
   */
  async findOrCreateFromToken(tokenData) {
    try {
      logger.info('UserService: Finding or creating user from token data', { tokenData });
      const User = this.getModel();
      return await User.findOrCreateFromToken(tokenData);
    } catch (error) {
      logger.error('UserService: Error in findOrCreateFromToken', { error: error.message });
      throw error;
    }
  }
}

module.exports = new UserService();
