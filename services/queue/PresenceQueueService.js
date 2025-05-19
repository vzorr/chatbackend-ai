// services/queue/PresenceQueueService.js
const { v4: uuidv4 } = require('uuid');
const db = require('../../db');
const logger = require('../../utils/logger');
const redisService = require('../redis');
const queueService = require('./queueService');

class PresenceQueueService {
  constructor() {
    this.isProcessing = false;
    this.processingInterval = null;
    this.initialized = false;
    this.batchSize = 10; // Process 10 presence updates at a time
  }

  async ensureDbInitialized() {
    if (!db.isInitialized()) {
      logger.info('PresenceQueueService: Database not initialized, waiting...');
      await db.waitForInitialization();
    }
  }

  async initialize() {
    if (this.initialized) {
      return true;
    }

    try {
      await this.ensureDbInitialized();
      this.initialized = true;
      
      const config = require('../../config/config');
      this.batchSize = config.performance?.presenceBatchSize || 10;
      
      logger.info('PresenceQueueService initialized successfully', {
        batchSize: this.batchSize
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize PresenceQueueService', {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  async start() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (this.processingInterval) {
      logger.warn('PresenceQueueService already running');
      return;
    }

    const config = require('../../config/config');
    const interval = config.queue?.presenceProcessInterval || 1000; // Default to 1 second

    logger.info('Starting PresenceQueueService', { interval });

    this.processingInterval = setInterval(async () => {
      try {
        await this.processPresenceQueue();
      } catch (error) {
        logger.error('Error in PresenceQueueService processing interval', {
          error: error.message,
          stack: error.stack
        });
      }
    }, interval);

    return true;
  }

  async stop() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.info('PresenceQueueService stopped');
    }
  }

  async processPresenceQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    
    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      const { User, Session } = models;
      
      // Process a batch of presence updates
      let processedCount = 0;
      const updateBatch = [];
      
      for (let i = 0; i < this.batchSize; i++) {
        const update = await queueService.redisClient.lpop(queueService.QUEUES.PRESENCE);
        if (!update) {
          break; // No more updates in queue
        }
        
        try {
          const data = JSON.parse(update);
          const { userId, isOnline, socketId, timestamp } = data;
          
          if (!userId) {
            logger.warn('Invalid presence update data - missing userId', { data });
            continue;
          }
          
          logger.debug('Processing presence update from queue', {
            userId,
            isOnline,
            socketId: socketId ? socketId.substring(0, 8) + '...' : 'none'
          });
          
          // Add to batch for processing
          updateBatch.push({
            userId,
            isOnline,
            socketId,
            timestamp,
            lastSeen: isOnline ? null : new Date()
          });
          
          processedCount++;
        } catch (error) {
          logger.error(`Error processing presence update: ${error.message}`, {
            stack: error.stack,
            update
          });
          // Don't requeue presence updates as they could be outdated
        }
      }
      
      // Process batch updates to the database
      if (updateBatch.length > 0) {
        // Group by online/offline status for batch update
        const onlineUsers = updateBatch.filter(u => u.isOnline).map(u => u.userId);
        const offlineUsers = updateBatch.filter(u => !u.isOnline).map(u => u.userId);
        
        // Update online users
        if (onlineUsers.length > 0) {
          await User.update(
            { 
              isOnline: true,
              lastSeen: null
            },
            { where: { id: onlineUsers } }
          );
          
          // Update socket IDs individually (can't batch these)
          for (const update of updateBatch.filter(u => u.isOnline)) {
            if (update.socketId) {
              await User.update(
                { socketId: update.socketId },
                { where: { id: update.userId } }
              );
            }
          }
          
          logger.info(`Updated ${onlineUsers.length} users to online status`);
        }
        
        // Update offline users
        if (offlineUsers.length > 0) {
          await User.update(
            { 
              isOnline: false,
              lastSeen: new Date(),
              socketId: null
            },
            { where: { id: offlineUsers } }
          );
          
          logger.info(`Updated ${offlineUsers.length} users to offline status`);
        }
        
        // Update sessions if available
        if (Session) {
          // Mark sessions as active/inactive
          for (const update of updateBatch) {
            if (update.socketId) {
              if (update.isOnline) {
                // Set session as active
                await Session.update(
                  { 
                    isActive: true,
                    lastActivityAt: new Date() 
                  },
                  { where: { socketId: update.socketId } }
                );
              } else {
                // Set session as inactive
                await Session.update(
                  { 
                    isActive: false,
                    disconnectedAt: new Date() 
                  },
                  { where: { socketId: update.socketId } }
                );
              }
            }
          }
        }
        
        // Update Redis presence cache
        for (const update of updateBatch) {
          await redisService.updateUserPresence(
            update.userId,
            update.isOnline,
            update.socketId
          );
        }
      }
      
      if (processedCount > 0) {
        logger.info(`Processed ${processedCount} presence updates from queue`);
      }
      
    } catch (error) {
      logger.error('Error in processPresenceQueue', {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing = false;
    }
  }

  // Method to process invisible mode settings
  async processInvisibleModeSettings(userId, enabled) {
    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      const { User } = models;
      
      const user = await User.findByPk(userId);
      
      if (!user) {
        logger.warn('User not found for invisible mode update', { userId });
        return false;
      }
      
      // Update user metadata
      const metaData = user.metaData || {};
      metaData.invisibleMode = enabled;
      
      await user.update({ metaData });
      
      // If invisible mode is enabled, appear offline to others
      if (enabled) {
        // Set online in Redis but with invisible flag
        const userPresence = await redisService.getUserPresence(userId);
        if (userPresence) {
          const updatedPresence = {
            ...userPresence,
            invisibleMode: true,
            publicStatus: 'offline'
          };
          
          await redisService.setUserPresence(userId, updatedPresence);
        }
      } else {
        // If disabling invisible mode, update to real status
        const isActuallyOnline = !!user.socketId;
        await redisService.updateUserPresence(userId, isActuallyOnline, user.socketId);
      }
      
      logger.info(`Processed invisible mode setting for user ${userId}`, {
        enabled,
        hasSocketId: !!user.socketId
      });
      
      return true;
    } catch (error) {
      logger.error('Error processing invisible mode setting', {
        error: error.message,
        stack: error.stack,
        userId,
        enabled
      });
      return false;
    }
  }

  // Method to cleanup stale presence data
  async cleanupStalePresenceData() {
    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      const { User, Session } = models;
      
      const threshold = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
      
      // Find users marked as online with old lastActivityAt
      const staleUsers = await User.findAll({
        where: {
          isOnline: true,
          lastSeen: {
            [Op.lt]: threshold
          }
        }
      });
      
      if (staleUsers.length > 0) {
        // Mark them as offline
        await User.update(
          {
            isOnline: false,
            lastSeen: new Date(),
            socketId: null
          },
          {
            where: {
              id: staleUsers.map(u => u.id)
            }
          }
        );
        
        // Update Redis presence
        for (const user of staleUsers) {
          await redisService.updateUserPresence(user.id, false, null);
        }
        
        logger.info(`Cleaned up ${staleUsers.length} stale user presence records`);
      }
      
      // If sessions are available, also clean those up
      if (Session) {
        const staleSessions = await Session.findAll({
          where: {
            isActive: true,
            lastActivityAt: {
              [Op.lt]: threshold
            }
          }
        });
        
        if (staleSessions.length > 0) {
          await Session.update(
            {
              isActive: false,
              disconnectedAt: new Date(),
              logoutReason: 'inactivity_timeout'
            },
            {
              where: {
                id: staleSessions.map(s => s.id)
              }
            }
          );
          
          logger.info(`Cleaned up ${staleSessions.length} stale session records`);
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Error cleaning up stale presence data', {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }
}

module.exports = new PresenceQueueService();