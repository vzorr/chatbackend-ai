// services/sync/userSyncService.js
const { User, TokenHistory } = require('../../db/models');
const logger = require('../../utils/logger');
const { validateUUID } = require('../../utils/validation');
const { v4: uuidv4 } = require('uuid');

class UserSyncService {
  constructor() {
    this.syncQueue = new Map();
  }

  /**
   * Sync user from main application database upon login
   */
  async syncUserFromMainApp(mainAppData, authToken) {
    const operationId = uuidv4();
    
    logger.info('Starting user sync from main app', {
      operationId,
      externalId: mainAppData.appUserId,
      email: mainAppData.email
    });

    try {
      // Validate external ID (app user ID)
      if (!validateUUID(mainAppData.appUserId)) {
        throw new Error('Invalid app user ID format');
      }

      // Check if user already exists
      let user = await User.findOne({
        where: { externalId: mainAppData.appUserId }
      });

      const syncData = {
        externalId: mainAppData.appUserId,
        name: mainAppData.name || mainAppData.fullName,
        email: mainAppData.email,
        phone: mainAppData.phone,
        avatar: mainAppData.avatar || mainAppData.profileImage,
        role: mainAppData.role || 'client',
        metaData: {
          lastSyncAt: new Date(),
          syncSource: 'main_app',
          authToken: authToken ? authToken.substring(0, 10) + '...' : null,
          mainAppData: {
            userId: mainAppData.id,
            createdAt: mainAppData.createdAt,
            updatedAt: mainAppData.updatedAt
          }
        }
      };

      if (user) {
        // Update existing user
        await user.update(syncData);
        
        logger.info('Updated existing user from main app', {
          operationId,
          userId: user.id,
          externalId: user.externalId,
          changes: this.getChangedFields(user, syncData)
        });
      } else {
        // Create new user
        user = await User.create({
          id: uuidv4(),
          ...syncData,
          isOnline: false,
          lastSeen: null
        });

        logger.info('Created new user from main app', {
          operationId,
          userId: user.id,
          externalId: user.externalId
        });
      }

      // Store sync operation for audit
      await this.logSyncOperation({
        operationId,
        userId: user.id,
        externalId: user.externalId,
        action: user ? 'UPDATE' : 'CREATE',
        syncData,
        authToken
      });

      return {
        success: true,
        user: {
          id: user.id,
          externalId: user.externalId,
          name: user.name,
          email: user.email,
          phone: user.phone,
          avatar: user.avatar,
          role: user.role
        },
        operationId
      };

    } catch (error) {
      logger.error('User sync failed', {
        operationId,
        error: error.message,
        stack: error.stack,
        mainAppData
      });

      await this.logSyncOperation({
        operationId,
        externalId: mainAppData.appUserId,
        action: 'FAILED',
        error: {
          message: error.message,
          code: error.code,
          stack: error.stack
        },
        authToken
      });

      throw error;
    }
  }

  /**
   * Sync device token from main app
   */
  async syncDeviceToken(userId, tokenData, requestInfo) {
    const operationId = uuidv4();
    
    logger.info('Syncing device token', {
      operationId,
      userId,
      tokenType: tokenData.type,
      deviceId: tokenData.deviceId
    });

    try {
      // Validate user exists
      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check for existing token
      const existingToken = await DeviceToken.findOne({
        where: {
          userId,
          deviceId: tokenData.deviceId
        }
      });

      let action = 'REGISTERED';
      let previousToken = null;

      if (existingToken) {
        if (existingToken.token !== tokenData.token) {
          previousToken = existingToken.token;
          action = 'RENEWED';
          await existingToken.update({
            token: tokenData.token,
            lastUsed: new Date()
          });
        } else {
          await existingToken.update({ lastUsed: new Date() });
        }
      } else {
        await DeviceToken.create({
          id: uuidv4(),
          userId,
          token: tokenData.token,
          deviceType: tokenData.type || 'mobile',
          platform: tokenData.platform,
          deviceId: tokenData.deviceId,
          lastUsed: new Date()
        });
      }

      // Log token history for audit
      await TokenHistory.create({
        userId,
        token: tokenData.token,
        tokenType: tokenData.type === 'ios' ? 'APN' : 'FCM',
        deviceId: tokenData.deviceId,
        deviceModel: tokenData.deviceModel,
        deviceOS: tokenData.deviceOS,
        appVersion: tokenData.appVersion,
        action,
        previousToken,
        ipAddress: requestInfo.ip,
        userAgent: requestInfo.userAgent,
        metadata: {
          operationId,
          source: 'sync',
          ...tokenData.metadata
        }
      });

      logger.info('Device token synced successfully', {
        operationId,
        userId,
        action,
        deviceId: tokenData.deviceId
      });

      return {
        success: true,
        action,
        operationId
      };

    } catch (error) {
      logger.error('Device token sync failed', {
        operationId,
        userId,
        error: error.message,
        tokenData
      });

      // Log failure in history
      await TokenHistory.logTokenFailure({
        userId,
        token: tokenData.token,
        tokenType: tokenData.type === 'ios' ? 'APN' : 'FCM',
        deviceId: tokenData.deviceId,
        error
      });

      throw error;
    }
  }

  /**
   * Batch sync multiple users
   */
  async batchSyncUsers(usersData, authToken) {
    const operationId = uuidv4();
    const results = [];

    logger.info('Starting batch user sync', {
      operationId,
      userCount: usersData.length
    });

    for (const userData of usersData) {
      try {
        const result = await this.syncUserFromMainApp(userData, authToken);
        results.push({
          success: true,
          externalId: userData.appUserId,
          userId: result.user.id,
          ...result
        });
      } catch (error) {
        results.push({
          success: false,
          externalId: userData.appUserId,
          error: error.message
        });
      }
    }

    const summary = {
      operationId,
      total: usersData.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    };

    logger.info('Batch user sync completed', summary);

    return {
      summary,
      results
    };
  }

  /**
   * Get changed fields between old and new data
   */
  getChangedFields(oldData, newData) {
    const changes = {};
    const fields = ['name', 'email', 'phone', 'avatar', 'role'];

    for (const field of fields) {
      if (oldData[field] !== newData[field]) {
        changes[field] = {
          old: oldData[field],
          new: newData[field]
        };
      }
    }

    return changes;
  }

  /**
   * Log sync operation for audit
   */
  async logSyncOperation(data) {
    try {
      // Store in a sync_operations table or use a logging service
      logger.info('Sync operation logged', {
        operationId: data.operationId,
        action: data.action,
        userId: data.userId,
        externalId: data.externalId
      });
    } catch (error) {
      logger.error('Failed to log sync operation', {
        error: error.message,
        data
      });
    }
  }

  /**
   * Validate sync request from main app
   */
  validateSyncRequest(request, signature) {
    // Implement signature validation for security
    // This should verify that the request is coming from the main app
    const expectedSignature = this.generateSignature(request);
    
    if (signature !== expectedSignature) {
      throw new Error('Invalid sync request signature');
    }

    return true;
  }

  /**
   * Generate signature for request validation
   */
  generateSignature(data) {
    // Implement proper signature generation using shared secret
    const crypto = require('crypto');
    const secret = process.env.SYNC_SECRET_KEY;
    
    return crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(data))
      .digest('hex');
  }
}

module.exports = new UserSyncService();