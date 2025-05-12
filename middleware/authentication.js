// middleware/authentication.js
const jwt = require('jsonwebtoken');
const { User } = require('../db/models');
const logger = require('../utils/logger');
const { validateUUID } = require('../utils/validation');
const userSyncService = require('../services/sync/userSyncService');
const exceptionHandler = require('./exceptionHandler');

class AuthenticationMiddleware {
  /**
   * Main authentication middleware
   */
  async authenticate(req, res, next) {
    const requestId = req.id;
    const timer = logger.startTimer();

    try {
      // Extract token
      const token = this.extractToken(req);
      
      if (!token) {
        return this.sendUnauthorizedResponse(res, 'Authentication required');
      }

      // Verify token
      const decoded = await this.verifyToken(token);
      
      // Log authentication attempt
      logger.audit('authentication_attempt', {
        requestId,
        userId: decoded.id || decoded.userId,
        tokenType: decoded.tokenType || 'standard',
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      // Get or sync user
      const user = await this.getOrSyncUser(decoded, token, req);
      
      if (!user) {
        return this.sendUnauthorizedResponse(res, 'User not found');
      }

      // Attach user to request
      req.user = user;
      req.authToken = token;
      req.tokenData = decoded;

      // Log successful authentication
      timer.done('authentication', {
        userId: user.id,
        externalId: user.externalId,
        success: true
      });

      next();
    } catch (error) {
      timer.done('authentication', {
        success: false,
        error: error.message
      });

      this.handleAuthError(error, res, requestId);
    }
  }

  /**
   * Optional authentication (for public endpoints that benefit from auth)
   */
  async optionalAuthenticate(req, res, next) {
    try {
      const token = this.extractToken(req);
      
      if (token) {
        await this.authenticate(req, res, next);
      } else {
        next();
      }
    } catch (error) {
      // Log error but continue without auth
      logger.warn('Optional authentication failed', {
        error: error.message,
        requestId: req.id
      });
      next();
    }
  }

  /**
   * Extract token from request
   */
  extractToken(req) {
    // Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check query parameter (for WebSocket connections)
    if (req.query.token) {
      return req.query.token;
    }

    // Check cookies (if enabled)
    if (req.cookies && req.cookies.authToken) {
      return req.cookies.authToken;
    }

    return null;
  }

  /**
   * Verify JWT token
   */
  async verifyToken(token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Validate token structure
      if (!decoded.id && !decoded.userId && !decoded.sub) {
        throw new Error('Invalid token structure');
      }

      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        error.code = 'TOKEN_EXPIRED';
      } else if (error.name === 'JsonWebTokenError') {
        error.code = 'INVALID_TOKEN';
      }
      throw error;
    }
  }

  /**
   * Get or sync user from main app
   */
  async getOrSyncUser(tokenData, token, req) {
    const externalId = tokenData.id || tokenData.userId || tokenData.sub;
    
    // Validate external ID
    if (!validateUUID(externalId)) {
      throw new Error('Invalid user identifier format');
    }

    // Try to find existing user
    let user = await User.findOne({
      where: { externalId }
    });

    // If user doesn't exist or needs sync
    if (!user || this.shouldSyncUser(user, tokenData)) {
      const syncData = {
        appUserId: externalId,
        name: tokenData.name || tokenData.displayName,
        email: tokenData.email,
        phone: tokenData.phone,
        avatar: tokenData.avatar || tokenData.picture,
        role: tokenData.role || 'client',
        ...tokenData.userData // Additional user data from token
      };

      try {
        const syncResult = await userSyncService.syncUserFromMainApp(
          syncData, 
          token
        );
        user = await User.findByPk(syncResult.user.id);
        
        logger.info('User synced from main app', {
          userId: user.id,
          externalId: user.externalId,
          requestId: req.id
        });
      } catch (syncError) {
        logger.error('User sync failed', {
          error: syncError,
          externalId,
          requestId: req.id
        });
        
        // If sync fails but user exists, use existing data
        if (user) {
          logger.warn('Using existing user data after sync failure', {
            userId: user.id,
            externalId
          });
        } else {
          throw new Error('Failed to sync user from main application');
        }
      }
    }

    return user;
  }

  /**
   * Determine if user should be synced
   */
  shouldSyncUser(user, tokenData) {
    // Always sync if requested
    if (tokenData.forceSync) {
      return true;
    }

    // Sync if user data is outdated
    const lastSync = user.metaData?.lastSyncAt;
    if (!lastSync) {
      return true;
    }

    const syncInterval = parseInt(process.env.USER_SYNC_INTERVAL || '3600000'); // 1 hour default
    const timeSinceLastSync = Date.now() - new Date(lastSync).getTime();
    
    return timeSinceLastSync > syncInterval;
  }

  /**
   * Handle authentication errors
   */
  handleAuthError(error, res, requestId) {
    logger.security('authentication_failed', {
      error: error.message,
      code: error.code,
      requestId,
      ip: res.req.ip
    });

    const statusCode = error.code === 'TOKEN_EXPIRED' ? 401 : 
                      error.code === 'INVALID_TOKEN' ? 401 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: error.code || 'AUTH_ERROR',
        message: this.getAuthErrorMessage(error),
        requestId
      }
    });
  }

  /**
   * Get user-friendly auth error message
   */
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

  /**
   * Send unauthorized response
   */
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

  /**
   * Role-based authorization middleware
   */
  authorize(...allowedRoles) {
    return (req, res, next) => {
      if (!req.user) {
        return this.sendUnauthorizedResponse(res, 'Authentication required');
      }

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

  /**
   * API key authentication for services
   */
  async authenticateApiKey(req, res, next) {
    try {
      const apiKey = req.headers['x-api-key'] || req.query.apiKey;
      
      if (!apiKey) {
        return this.sendUnauthorizedResponse(res, 'API key required');
      }

      // Validate API key
      const validApiKeys = (process.env.VALID_API_KEYS || '').split(',');
      
      if (!validApiKeys.includes(apiKey)) {
        logger.security('invalid_api_key', {
          apiKey: apiKey.substring(0, 8) + '...',
          ip: req.ip
        });
        
        return this.sendUnauthorizedResponse(res, 'Invalid API key');
      }

      // Set service context
      req.isServiceRequest = true;
      req.apiKey = apiKey;
      
      next();
    } catch (error) {
      this.handleAuthError(error, res, req.id);
    }
  }
}

module.exports = new AuthenticationMiddleware();