// /services/socket/userService.js
const { User } = require('../../db/models');

class UserService {
  async findById(userId) {
    return User.findByPk(userId);
  }
}

module.exports = new UserService();
