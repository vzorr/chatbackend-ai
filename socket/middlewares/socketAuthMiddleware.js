// socket/middlewares/socketAuthMiddleware.js
const jwt = require('jsonwebtoken');
const UserService = require('../../services/userService');
const userSyncService = require('../../services/sync/userSyncService');
const logger = require('../../utils/logger');
const { validateUUID } = require('../../utils/validation');

const socketAuthMiddleware = async (socket, next) => {
  const clientIp = socket.handshake.address;
  const requestId = socket.id;
  const token = socket.handshake.auth?.token;

  if (!token) {
    logger.warn(`[Socket ID: ${socket.id}] No token provided`, { clientIp });
    return next(new Error('No token provided'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    logger.info(`[Socket ID: ${socket.id}] Token verified successfully`, { userId: decoded.id || decoded.userId, clientIp });

    const externalId = decoded.id || decoded.userId || decoded.sub;
    if (!validateUUID(externalId)) {
      logger.warn(`[Socket ID: ${socket.id}] Invalid user identifier format`, { externalId });
      return next(new Error('Invalid user identifier format'));
    }

    let user = await UserService.findByExternalId(externalId);

    if (!user) {
      logger.warn(`[Socket ID: ${socket.id}] User not found, attempting sync`, { externalId });

      const syncData = {
        appUserId: externalId,
        name: decoded.name || decoded.displayName,
        email: decoded.email,
        phone: decoded.phone,
        avatar: decoded.avatar || decoded.picture,
        role: decoded.role || 'client',
        ...decoded.userData
      };

      try {
        const syncResult = await userSyncService.syncUserFromMainApp(syncData, token);
        user = await UserService.findById(syncResult.user.id);
        logger.info(`[Socket ID: ${socket.id}] User synced successfully`, { userId: user.id, externalId });
      } catch (syncError) {
        logger.error(`[Socket ID: ${socket.id}] User sync failed`, { error: syncError, externalId });
        return next(new Error('Failed to sync user'));
      }
    }

    socket.user = user;
    socket.token = token;
    socket.tokenData = decoded;

    logger.info(`[Socket ID: ${socket.id}] Socket authentication successful`, { userId: user.id, clientIp });

    next();
  } catch (error) {
    logger.audit('socket_authentication_failed', {
      error: error.message,
      code: error.code,
      clientIp,
      socketId: socket.id
    });
    logger.error(`[Socket ID: ${socket.id}] Socket authentication error: ${error.message}`, { clientIp });
    next(new Error(error.message));
  }
};

module.exports = socketAuthMiddleware;
