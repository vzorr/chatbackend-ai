// /socket/middlewares/socketAuthMiddleware.js
const jwt = require('jsonwebtoken');
const logger = require('../../utils/logger');
const { User } = require('../../db/models');

module.exports = async (socket, next) => {
  const socketId = socket.id;
  const clientIp = socket.handshake.address;

  try {
    logger.info(`[Socket ID: ${socketId}] Attempting authentication...`, {
      clientIp,
      headers: socket.handshake.headers,
      auth: socket.handshake.auth,
      query: socket.handshake.query,
    });

    let userId = null;
    const authToken = socket.handshake.auth.token ||
      socket.handshake.headers.authorization?.replace('Bearer ', '') ||
      socket.handshake.query.token;
    const directUserId = socket.handshake.auth.userId ||
      socket.handshake.query.userId;

    if (directUserId) {
      userId = directUserId;
      logger.info(`[Socket ID: ${socketId}] Authentication attempt with direct User ID: ${userId}`);
    } else if (authToken) {
      try {
        logger.info(`[Socket ID: ${socketId}] Authentication attempt with token.`);
        const decoded = jwt.verify(authToken, process.env.JWT_SECRET);
        userId = decoded.id || decoded.userId || decoded.sub;
        logger.info(`[Socket ID: ${socketId}] Token decoded successfully for User ID: ${userId}`);
      } catch (err) {
        logger.warn(`[Socket ID: ${socketId}] Invalid authentication token: ${err.message}`, { token: authToken });
        return next(new Error('Invalid authentication token'));
      }
    }

    if (!userId) {
      logger.warn(`[Socket ID: ${socketId}] Authentication required but no User ID or token provided.`);
      return next(new Error('Authentication required'));
    }

    const user = await User.findByPk(userId);
    if (!user) {
      logger.warn(`[Socket ID: ${socketId}] Authenticated User ID ${userId} not found in database.`);
      return next(new Error('User not found'));
    }

    socket.user = user;
    logger.info(`User ${userId} authenticated for socket ${socket.id}`);
    next();
  } catch (error) {
    logger.error(`[Socket ID: ${socketId}] Socket authentication error: ${error.message}`, { stack: error.stack });
    next(new Error('Authentication failed'));
  }
};
