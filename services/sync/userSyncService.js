// services/sync/userSyncService.js
const db = require('../../db/models');
const logger = require('../../utils/logger');
const { validateUUID } = require('../../utils/validation');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class UserSyncService {
  constructor() {
    this.syncQueue = new Map();
    // Define valid roles that match the database enum
    this.validRoles = ['customer', 'usta', 'administrator'];
  }

  // Function to validate and normalize role
  normalizeRole(role) {
    // Check if role is valid (case-insensitive)
    const normalizedRole = typeof role === 'string' ? role.toLowerCase() : null;
    
    // Return the role if it's in the valid list
    if (normalizedRole && this.validRoles.includes(normalizedRole)) {
      return normalizedRole;
    }
    
    // Map legacy roles to new roles for backward compatibility
    if (normalizedRole === 'client') return 'customer';
    if (normalizedRole === 'admin') return 'administrator';
    if (normalizedRole === 'freelancer') return 'customer';
    
    logger.warn(`Invalid role value "${role}" detected, defaulting to "customer"`);
    return 'customer';
  }

  async syncUserFromMainApp(mainAppData, authToken) {
    const operationId = uuidv4();
    logger.info('Starting user sync from main app', {
      operationId,
      externalId: mainAppData.appUserId,
      email: mainAppData.email,
      phone: mainAppData.phone,
      name: mainAppData.name,
      role: mainAppData.role
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

      // Try to find existing user by both id and externalId
      let user = await User.findOne({ 
        where: { 
          [db.Sequelize.Op.or]: [
            { id: mainAppData.appUserId },
            { externalId: mainAppData.appUserId }
          ]
        } 
      });

      // Normalize and validate the role
      const normalizedRole = this.normalizeRole(mainAppData.role);

      const syncData = {
        name: mainAppData.name || mainAppData.fullName || 'User',
        email: mainAppData.email,
        phone: mainAppData.phone || mainAppData.phoneNumber || mainAppData.mobile || '+00000000000',
        avatar: mainAppData.avatar || mainAppData.profileImage,
        role: normalizedRole,
        metaData: {
          lastSyncAt: new Date(),
          syncSource: 'main_app',
          authToken: authToken ? authToken.substring(0, 10) + '...' : null,
          mainAppData: {
            userId: mainAppData.id,
            originalRole: mainAppData.role,
            createdAt: mainAppData.createdAt,
            updatedAt: mainAppData.updatedAt
          }
        }
      };

      let action = 'NONE';
      let wasCreated = false;
      let wasUpdated = false;
      let changes = {};

      if (user) {
        // Check if any fields have actually changed
        changes = this.getChangedFields(user, syncData);
        
        if (Object.keys(changes).length > 0) {
          // Only update if there are actual changes
          await user.update(syncData);
          wasUpdated = true;
          action = 'UPDATE';
          
          logger.info('Updated existing user from main app', {
            operationId,
            userId: user.id,
            externalId: user.externalId,
            role: normalizedRole,
            originalRole: mainAppData.role,
            changes: changes
          });
        } else {
          // No changes detected
          action = 'NO_CHANGE';
          logger.info('User already exists with same data, no update needed', {
            operationId,
            userId: user.id,
            externalId: user.externalId
          });
        }
      } else {
        // Create new user
        try {
          user = await User.create({
            id: mainAppData.appUserId,
            externalId: mainAppData.appUserId,
            ...syncData,
            isOnline: false,
            lastSeen: null
          });
          wasCreated = true;
          action = 'CREATE';
          
          logger.info('Created new user from main app', {
            operationId,
            userId: user.id,
            externalId: user.externalId,
            role: normalizedRole,
            originalRole: mainAppData.role
          });
        } catch (createError) {
          // Handle duplicate key error specifically
          if (createError.name === 'SequelizeUniqueConstraintError') {
            // User was created by another request in the meantime
            user = await User.findOne({ 
              where: { 
                [db.Sequelize.Op.or]: [
                  { id: mainAppData.appUserId },
                  { externalId: mainAppData.appUserId }
                ]
              } 
            });
            
            if (user) {
              action = 'ALREADY_EXISTS';
              logger.info('User already exists (race condition), returning existing user', {
                operationId,
                userId: user.id,
                externalId: user.externalId
              });
            } else {
              throw createError; // Something else went wrong
            }
          } else {
            throw createError;
          }
        }
      }

      // Log the sync operation
      await this.logSyncOperation({
        operationId,
        userId: user.id,
        externalId: user.externalId,
        action: action,
        syncData: wasCreated || wasUpdated ? syncData : null,
        changes: wasUpdated ? changes : null,
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
        action: action,
        wasCreated: wasCreated,
        wasUpdated: wasUpdated,
        changes: wasUpdated ? changes : {},
        operationId
      };

    } catch (error) {
      logger.error('User sync failed', {
        operationId,
        error: error.message,
        errorName: error.name,
        errorStack: error.stack,
        mainAppData
      });

      // Special handling for unique constraint errors
      if (error.name === 'SequelizeUniqueConstraintError') {
        // Try to find and return the existing user
        try {
          const existingUser = await db.User.findOne({ 
            where: { 
              [db.Sequelize.Op.or]: [
                { id: mainAppData.appUserId },
                { externalId: mainAppData.appUserId }
              ]
            } 
          });
          
          if (existingUser) {
            logger.info('Returning existing user after unique constraint error', {
              operationId,
              userId: existingUser.id,
              externalId: existingUser.externalId
            });
            
            return {
              success: true,
              user: {
                id: existingUser.id,
                externalId: existingUser.externalId,
                name: existingUser.name,
                email: existingUser.email,
                phone: existingUser.phone,
                avatar: existingUser.avatar,
                role: existingUser.role
              },
              action: 'ALREADY_EXISTS',
              wasCreated: false,
              wasUpdated: false,
              changes: {},
              operationId
            };
          }
        } catch (findError) {
          logger.error('Failed to find existing user after unique constraint error', {
            operationId,
            error: findError.message
          });
        }
      }

      await this.logSyncOperation({
        operationId,
        externalId: mainAppData.appUserId,
        action: 'FAILED',
        error: {
          message: error.message,
          name: error.name,
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
      // Compare values, handling null/undefined
      const oldValue = oldData[field] || null;
      const newValue = newData[field] || null;
      
      if (oldValue !== newValue) {
        changes[field] = { old: oldValue, new: newValue };
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
        externalId: data.externalId,
        hasChanges: data.changes ? Object.keys(data.changes).length > 0 : false
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