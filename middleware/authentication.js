// middleware/authentication.js - Enhanced with SSL support
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const { validateUUID } = require('../utils/validation');
const UserService = require('../services/userService');
const config = require('../config/config');

class AuthenticationMiddleware {
  async authenticate(req, res, next) {
    const requestId = req.id;
    const timer = logger.startTimer();

    try {
      // Enhanced security check for production
      if (config.server.nodeEnv === 'production' && !req.isSecure) {
        logger.security('insecure_auth_attempt', {
          requestId,
          ip: req.ip,
          protocol: req.protocol,
          userAgent: req.get('user-agent')
        });
        return this.sendUnauthorizedResponse(res, 'HTTPS required for authentication');
      }

      const token = this.extractToken(req);
      if (!token) return this.sendUnauthorizedResponse(res, 'Authentication required');

      const decoded = await this.verifyToken(token);

      logger.audit('authentication_attempt', {
        requestId,
        userId: decoded.id || decoded.userId,
        tokenType: decoded.tokenType || 'standard',
        ip: req.ip,
        userAgent: req.get('user-agent'),
        secure: req.isSecure,
        protocol: req.protocol,
        // Enhanced proxy context
        realIp: req.get('x-real-ip'),
        forwardedFor: req.get('x-forwarded-for'),
        viaProxy: !!req.get('x-forwarded-proto')
      });

      const user = await this.getUser(decoded, req);
      if (!user) return this.sendUnauthorizedResponse(res, 'User not found in chat system');

      req.user = user;
      req.authToken = token;
      req.tokenData = decoded;

      // Set secure cookie attributes if connection is secure
      if (req.isSecure && res.cookie) {
        res.cookie('authToken', token, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        });
      }

      timer.done('authentication', {
        userId: user.id,
        externalId: user.externalId,
        success: true,
        secure: req.isSecure
      });

      next();
    } catch (error) {
      timer.done('authentication', { 
        success: false, 
        error: error.message,
        secure: req.isSecure 
      });
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
      logger.warn('Optional authentication failed', { 
        error: error.message, 
        requestId: req.id,
        secure: req.isSecure,
        protocol: req.protocol
      });
      next();
    }
  }

  extractToken(req) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);
    if (req.query.token) return req.query.token;
    
    // Enhanced cookie extraction with security checks
    if (req.cookies?.authToken) {
      // In production, only accept cookies over HTTPS
      if (config.server.nodeEnv === 'production' && !req.isSecure) {
        logger.warn('Cookie token rejected over insecure connection', {
          ip: req.ip,
          protocol: req.protocol
        });
        return null;
      }
      return req.cookies.authToken;
    }
    
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

  async getUser(tokenData, req) {
    const externalId = tokenData.id || tokenData.userId || tokenData.sub;
    if (!validateUUID(externalId)) throw new Error('Invalid user identifier format');

    // Only look for existing users - no syncing
    let user = await UserService.findByExternalId(externalId);

    // If not found by externalId, try by ID
    if (!user) {
      user = await UserService.findById(externalId);
    }

    if (!user) {
      logger.warn('User not found in chat system during authentication', {
        externalId,
        requestId: req.id,
        secure: req.isSecure
      });
      return null;
    }

    logger.debug('User found for authentication', {
      userId: user.id,
      externalId: user.externalId,
      requestId: req.id,
      secure: req.isSecure
    });

    return user;
  }

  handleAuthError(error, res, requestId) {
    logger.security('authentication_failed', {
      error: error.message,
      code: error.code,
      requestId,
      ip: res.req.ip,
      secure: res.req.isSecure,
      protocol: res.req.protocol,
      userAgent: res.req.get('user-agent')
    });

    const statusCode = ['TOKEN_EXPIRED', 'INVALID_TOKEN'].includes(error.code) ? 401 : 500;

    res.status(statusCode).json({
      success: false,
      error: {
        code: error.code || 'AUTH_ERROR',
        message: this.getAuthErrorMessage(error),
        requestId,
        secure: res.req.isSecure
      }
    });
  }

  getAuthErrorMessage(error) {
    const messages = {
      'TOKEN_EXPIRED': 'Authentication token has expired',
      'INVALID_TOKEN': 'Invalid authentication token',
      'NO_TOKEN': 'No authentication token provided',
      'INVALID_USER': 'User account not found',
      'USER_NOT_FOUND': 'User not found in chat system',
      'HTTPS_REQUIRED': 'HTTPS connection required for secure authentication'
    };
    return messages[error.code] || 'Authentication failed';
  }

  sendUnauthorizedResponse(res, message) {
    res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message,
        timestamp: new Date().toISOString(),
        secure: res.req?.isSecure || false
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
          requestId: req.id,
          secure: req.isSecure,
          ip: req.ip
        });

        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Insufficient permissions',
            timestamp: new Date().toISOString(),
            secure: req.isSecure
          }
        });
      }

      next();
    };
  }

  async authenticateApiKey(req, res, next) {
    try {
      // Enhanced security check for API keys in production
      if (config.server.nodeEnv === 'production' && !req.isSecure) {
        logger.security('insecure_api_key_attempt', {
          ip: req.ip,
          protocol: req.protocol,
          userAgent: req.get('user-agent')
        });
        return this.sendUnauthorizedResponse(res, 'HTTPS required for API key authentication');
      }

      const apiKey = req.headers['x-api-key'] || req.query.apiKey;
      if (!apiKey) return this.sendUnauthorizedResponse(res, 'API key required');

      const validApiKeys = (process.env.VALID_API_KEYS || '').split(',');
      if (!validApiKeys.includes(apiKey)) {
        logger.security('invalid_api_key', { 
          apiKey: apiKey.substring(0, 8) + '...', 
          ip: req.ip,
          secure: req.isSecure,
          realIp: req.get('x-real-ip')
        });
        return this.sendUnauthorizedResponse(res, 'Invalid API key');
      }

      req.isServiceRequest = true;
      req.apiKey = apiKey;
      
      logger.info('API key authentication successful', {
        ip: req.ip,
        secure: req.isSecure,
        requestId: req.id
      });
      
      next();
    } catch (error) {
      this.handleAuthError(error, res, req.id);
    }
  }

  // New method: Require HTTPS for sensitive operations
  requireSecure() {
    return (req, res, next) => {
      if (config.server.nodeEnv === 'production' && !req.isSecure) {
        logger.security('insecure_sensitive_operation', {
          path: req.path,
          method: req.method,
          ip: req.ip,
          protocol: req.protocol
        });
        
        return res.status(403).json({
          success: false,
          error: {
            code: 'HTTPS_REQUIRED',
            message: 'HTTPS connection required for this operation',
            timestamp: new Date().toISOString()
          }
        });
      }
      next();
    };
  }
}

const authMiddleware = new AuthenticationMiddleware();
module.exports = authMiddleware;
module.exports.authenticate = authMiddleware.authenticate.bind(authMiddleware);
module.exports.optionalAuthenticate = authMiddleware.optionalAuthenticate.bind(authMiddleware);
module.exports.authorize = authMiddleware.authorize.bind(authMiddleware);
module.exports.authenticateApiKey = authMiddleware.authenticateApiKey.bind(authMiddleware);
module.exports.requireSecure = authMiddleware.requireSecure.bind(authMiddleware);