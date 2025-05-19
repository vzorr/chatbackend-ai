// middleware/authentication.js
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { validateUUID } = require('../utils/validation');
const userSyncService = require('../services/sync/userSyncService');
const UserService = require('../services/userService');

class AuthenticationMiddleware {
  async authenticate(req, res, next) {
    const requestId = req.id;
    const timer = logger.startTimer();

    try {
      const token = this.extractToken(req);
      if (!token) return this.sendUnauthorizedResponse(res, 'Authentication required');

      const decoded = await this.verifyToken(token);

      logger.audit('authentication_attempt', {
        requestId,
        userId: decoded.id || decoded.userId,
        tokenType: decoded.tokenType || 'standard',
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      const user = await this.getOrSyncUser(decoded, token, req);
      if (!user) return this.sendUnauthorizedResponse(res, 'User not found');

      req.user = user;
      req.authToken = token;
      req.tokenData = decoded;

      timer.done('authentication', {
        userId: user.id,
        externalId: user.externalId,
        success: true
      });

      next();
    } catch (error) {
      timer.done('authentication', { success: false, error: error.message });
      this.handleAuthError(error, res, requestId);
    }
  }

  async optionalAuthenticate(req, res, next) {
    try {
      const token = this.extractToken(req);
      if (token) {
        await this.authenticate(req, res, next);
      } else {
        next();
      }
    } catch (error) {
      logger.warn('Optional authentication failed', { error: error.message, requestId: req.id });
      next();
    }
  }

  extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
    if (req.query.token) return req.query.token;
    if (req.cookies?.authToken) return req.cookies.authToken;
    return null;
  }

  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.id && !decoded.userId && !decoded.sub) throw new Error('Invalid token structure');
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') error.code = 'TOKEN_EXPIRED';
      else if (error.name === 'JsonWebTokenError') error.code = 'INVALID_TOKEN';
      throw error;
    }
  }

  async getOrSyncUser(tokenData, token, req) {
    const externalId = tokenData.id || tokenData.userId || tokenData.sub;
    if (!validateUUID(externalId)) throw new Error('Invalid user identifier format');

    let user = await UserService.findByExternalId(externalId);

    // Validate and normalize role if present in tokenData
    if (tokenData.role && !['customer', 'usta', 'administrator'].includes(tokenData.role.toLowerCase())) {
      logger.warn('Invalid role detected in token - will be normalized during sync', {
        role: tokenData.role,
        externalId,
        requestId: req.id
      });
      // Let userSyncService handle role normalization
    }

    if (!user || this.shouldSyncUser(user, tokenData)) {
      const syncData = {
        appUserId: externalId,
        name: tokenData.name || tokenData.displayName,
        email: tokenData.email,
        phone: tokenData.phone,
        avatar: tokenData.avatar || tokenData.picture,
        role: tokenData.role || 'customer', // Default to customer; will be normalized by sync service
        ...tokenData.userData
      };

      try {
        const syncResult = await userSyncService.syncUserFromMainApp(syncData, token);
        user = await UserService.findById(syncResult.user.id);

        logger.info('User synced from main app', { userId: user.id, externalId: user.externalId, requestId: req.id });
      } catch (syncError) {
        logger.error('User sync failed', { error: syncError, externalId, requestId: req.id });
        if (user) {
          logger.warn('Using existing user data after sync failure', { userId: user.id, externalId });
        } else {
          throw new Error('Failed to sync user from main application');
        }
      }
    }

    return user;
  }

  shouldSyncUser(user, tokenData) {
    if (tokenData.forceSync) return true;
    const lastSync = user.metaData?.lastSyncAt;
    if (!lastSync) return true;
    const syncInterval = parseInt(process.env.USER_SYNC_INTERVAL || '3600000');
    return Date.now() - new Date(lastSync).getTime() > syncInterval;
  }

  handleAuthError(error, res, requestId) {
    logger.security('authentication_failed', {
      error: error.message,
      code: error.code,
      requestId,
      ip: res.req.ip
    });

    const statusCode = ['TOKEN_EXPIRED', 'INVALID_TOKEN'].includes(error.code) ? 401 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: error.code || 'AUTH_ERROR',
        message: this.getAuthErrorMessage(error),
        requestId
      }
    });
  }

  getAuthErrorMessage(error) {
    const messages = {
      'TOKEN_EXPIRED': 'Authentication token has expired',
      'INVALID_TOKEN': 'Invalid authentication token',
      'NO_TOKEN': 'No authentication token provided',
      'INVALID_USER': 'User account not found',
      'SYNC_FAILED': 'Failed to sync user data'
    };
    return messages[error.code] || 'Authentication failed';
  }

  sendUnauthorizedResponse(res, message) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message,
        timestamp: new Date().toISOString()
      }
    });
  }

  authorize(...allowedRoles) {
    return (req, res, next) => {
      if (!req.user) return this.sendUnauthorizedResponse(res, 'Authentication required');

      if (!allowedRoles.includes(req.user.role)) {
        logger.security('authorization_failed', {
          userId: req.user.id,
          userRole: req.user.role,
          requiredRoles: allowedRoles,
          requestId: req.id
        });

        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
            timestamp: new Date().toISOString()
          }
        });
      }

      next();
    };
  }

  async authenticateApiKey(req, res, next) {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;
      if (!apiKey) return this.sendUnauthorizedResponse(res, 'API key required');

      const validApiKeys = (process.env.VALID_API_KEYS || '').split(',');
      if (!validApiKeys.includes(apiKey)) {
        logger.security('invalid_api_key', { apiKey: apiKey.substring(0, 8) + '...', ip: req.ip });
        return this.sendUnauthorizedResponse(res, 'Invalid API key');
      }

      req.isServiceRequest = true;
      req.apiKey = apiKey;
      next();
    } catch (error) {
      this.handleAuthError(error, res, req.id);
    }
  }
}

const authMiddleware = new AuthenticationMiddleware();
module.exports = authMiddleware;
module.exports.authenticate = authMiddleware.authenticate.bind(authMiddleware);
module.exports.optionalAuthenticate = authMiddleware.optionalAuthenticate.bind(authMiddleware);
module.exports.authorize = authMiddleware.authorize.bind(authMiddleware);
module.exports.authenticateApiKey = authMiddleware.authenticateApiKey.bind(authMiddleware);