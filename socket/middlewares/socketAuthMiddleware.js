// socket/middlewares/socketAuthMiddleware.js
const jwt = require('jsonwebtoken');
const UserService = require('../../services/userService');
const logger = require('../../utils/logger');
const { validateUUID } = require('../../utils/validation');
const config = require('../../config/config');

const socketAuthMiddleware = async (socket, next) => {
  const clientIp = socket.handshake.address;
  const requestId = socket.id;
  const token = socket.handshake.auth?.token;

  // Enhanced SSL/security detection
  const isSecure = socket.handshake.secure || socket.handshake.headers['x-forwarded-proto'] === 'https';
  const viaProxy = !!(socket.handshake.headers['x-forwarded-proto'] || 
                     socket.handshake.headers['x-real-ip'] || 
                     socket.handshake.headers['x-forwarded-for']);
  const realIp = socket.handshake.headers['x-real-ip'] || 
                 socket.handshake.headers['x-forwarded-for']?.split(',')[0] || 
                 clientIp;

  // Enhanced security logging context
  const securityContext = {
    socketId: socket.id,
    clientIp,
    realIp,
    secure: isSecure,
    viaProxy,
    protocol: socket.handshake.headers['x-forwarded-proto'] || (isSecure ? 'https' : 'http'),
    origin: socket.handshake.headers.origin,
    userAgent: socket.handshake.headers['user-agent']
  };

  if (!token) {
    logger.warn(`🔌 [Socket Auth] No token provided`, securityContext);
    return next(new Error('No token provided'));
  }

  // Enhanced security check for production
  if (config.server.nodeEnv === 'production' && !isSecure) {
    logger.security('insecure_socket_auth_attempt', securityContext);
    return next(new Error('Secure connection required for authentication'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    logger.info(`🔌 [Socket Auth] Token verified successfully`, {
      ...securityContext,
      userId: decoded.id || decoded.userId,
      tokenType: decoded.tokenType || 'standard'
    });

    const externalId = decoded.id || decoded.userId || decoded.sub;
    if (!validateUUID(externalId)) {
      logger.warn(`🔌 [Socket Auth] Invalid user identifier format`, {
        ...securityContext,
        externalId
      });
      return next(new Error('Invalid user identifier format'));
    }

    // Only look for existing users - no syncing
    const user = await UserService.findByExternalId(externalId);

    if (!user) {
      logger.warn(`🔌 [Socket Auth] User not found in chat system`, {
        ...securityContext,
        externalId
      });
      return next(new Error('User not found in chat system'));
    }

    // Set socket user data with enhanced context
    socket.user = user;
    socket.token = token;
    socket.tokenData = decoded;
    socket.securityContext = securityContext;

    // Log successful authentication with security context
    logger.info(`🔌 [Socket Auth] Authentication successful`, {
      ...securityContext,
      userId: user.id,
      userName: user.name,
      userRole: user.role
    });

    // Enhanced audit logging for secure connections
    logger.audit('socket_authentication_success', {
      userId: user.id,
      socketId: socket.id,
      ...securityContext,
      timestamp: new Date().toISOString()
    });

    next();
  } catch (error) {
    // Enhanced error logging with security context
    logger.audit('socket_authentication_failed', {
      error: error.message,
      code: error.code,
      ...securityContext,
      timestamp: new Date().toISOString()
    });

    logger.error(`🔌 [Socket Auth] Authentication error: ${error.message}`, securityContext);

    // Enhanced error messages based on error type
    let errorMessage = error.message;
    if (error.name === 'TokenExpiredError') {
      errorMessage = 'Authentication token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      errorMessage = 'Invalid authentication token';
    }

    next(new Error(errorMessage));
  }
};

module.exports = socketAuthMiddleware;