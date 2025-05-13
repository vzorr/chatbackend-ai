// /socket/middlewares/socketAuthMiddleware.js
const logger = require('../../utils/logger');
const authMiddleware = require('../../middleware/authentication');

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

    const authToken = socket.handshake.auth.token ||
      socket.handshake.headers.authorization?.replace('Bearer ', '') ||
      socket.handshake.query.token;

    if (!authToken) {
      logger.warn(`[Socket ID: ${socketId}] Authentication required but no token provided.`);
      return next(new Error('Authentication required'));
    }

    // ✅ Use cleaned verifyToken
    const decoded = await authMiddleware.verifyToken(authToken);

    // ✅ Use cleaned getOrSyncUser
    const user = await authMiddleware.getOrSyncUser(decoded, authToken, socket.request);

    if (!user) {
      logger.warn(`[Socket ID: ${socketId}] User not found after sync attempt.`);
      return next(new Error('User not found'));
    }

    socket.user = user;
    logger.info(`User ${user.id} authenticated for socket ${socket.id}`);
    next();
  } catch (error) {
    logger.error(`[Socket ID: ${socketId}] Socket authentication error: ${error.message}`, { stack: error.stack });
    next(new Error('Authentication failed'));
  }
};
