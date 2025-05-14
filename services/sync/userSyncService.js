// services/sync/userSyncService.js
const db = require('../../db/models');
const logger = require('../../utils/logger');
const { validateUUID } = require('../../utils/validation');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class UserSyncService {
  constructor() {
    this.syncQueue = new Map();
  }

  async syncUserFromMainApp(mainAppData, authToken) {
    const operationId = uuidv4();
    logger.info('Starting user sync from main app', {
      operationId,
      externalId: mainAppData.appUserId,
      email: mainAppData.email,
      phone: mainAppData.phone,
      name: mainAppData.name
    });

    try {
      // Access User model directly from db
      const { User } = db;
      
      if (!User) {
        logger.error('User model not found in db', { availableModels: Object.keys(db) });
        throw new Error('User model not initialized');
      }

      if (!validateUUID(mainAppData.appUserId)) {
        throw new Error('Invalid app user ID format');
      }

      logger.info('Received mainAppData', { mainAppData });

      let user = await User.findOne({ where: { externalId: mainAppData.appUserId } });

      const syncData = {
        id: mainAppData.appUserId,
        externalId: mainAppData.appUserId,
        name: mainAppData.name || mainAppData.fullName || 'User',
        email: mainAppData.email,
        phone: mainAppData.phone || mainAppData.phoneNumber || mainAppData.mobile || '+00000000000', // Default phone if not provided
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
        await user.update(syncData);
        logger.info('Updated existing user from main app', {
          operationId,
          userId: user.id,
          externalId: user.externalId,
          changes: this.getChangedFields(user, syncData)
        });
      } else {
        user = await User.create({
          //id: uuidv4(),
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

  async syncDeviceToken(userId, tokenData, requestInfo) {
    const operationId = uuidv4();
    logger.info('Syncing device token', {
      operationId,
      userId,
      tokenType: tokenData.type,
      deviceId: tokenData.deviceId
    });

    try {
      const { User, DeviceToken, TokenHistory } = db;
      
      if (!User || !DeviceToken || !TokenHistory) {
        throw new Error('Required models not initialized');
      }

      const user = await User.findByPk(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const existingToken = await DeviceToken.findOne({
        where: { userId, deviceId: tokenData.deviceId }
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

      const { TokenHistory } = db;
      if (TokenHistory && TokenHistory.logTokenFailure) {
        await TokenHistory.logTokenFailure({
          userId,
          token: tokenData.token,
          tokenType: tokenData.type === 'ios' ? 'APN' : 'FCM',
          deviceId: tokenData.deviceId,
          error
        });
      }

      throw error;
    }
  }

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

    return { summary, results };
  }

  getChangedFields(oldData, newData) {
    const changes = {};
    const fields = ['name', 'email', 'phone', 'avatar', 'role'];

    for (const field of fields) {
      if (oldData[field] !== newData[field]) {
        changes[field] = { old: oldData[field], new: newData[field] };
      }
    }

    return changes;
  }

  async logSyncOperation(data) {
    try {
      logger.info('Sync operation logged', {
        operationId: data.operationId,
        action: data.action,
        userId: data.userId,
        externalId: data.externalId
      });
    } catch (error) {
      logger.error('Failed to log sync operation', { error: error.message, data });
    }
  }

  validateSyncRequest(request, signature) {
    const expectedSignature = this.generateSignature(request);

    if (signature !== expectedSignature) {
      throw new Error('Invalid sync request signature');
    }

    return true;
  }

  generateSignature(data) {
    const secret = process.env.SYNC_SECRET_KEY || 'default-sync-secret';
    return crypto.createHmac('sha256', secret)
      .update(JSON.stringify(data))
      .digest('hex');
  }
}

module.exports = new UserSyncService();