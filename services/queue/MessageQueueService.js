const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const db = require('../../db');
const logger = require('../../utils/logger');
const redisService = require('../redis');
const queueService = require('./queueService');
const notificationService = require('../notifications/notificationService');

class MessageQueueService {
  constructor() {
    this.isProcessing = false;
    this.processingInterval = null;
    this.initialized = false;
    this.messagesBatchSize = 10; // Process 10 messages at a time
  }

  async ensureDbInitialized() {
    if (!db.isInitialized()) {
      logger.info('MessageQueueService: Database not initialized, waiting...');
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
      this.messagesBatchSize = config.performance?.messageBatchSize || 10;
      
      logger.info('MessageQueueService initialized successfully', {
        messagesBatchSize: this.messagesBatchSize
      });
      
      return true;
    } catch (error) {
      logger.error('Failed to initialize MessageQueueService', {
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
      logger.warn('MessageQueueService already running');
      return;
    }

    const config = require('../../config/config');
    const interval = config.queue?.messageProcessInterval || 500; // Default to 500ms

    logger.info('Starting MessageQueueService', { interval });

    this.processingInterval = setInterval(async () => {
      try {
        await this.processMessageQueue();
        await this.processDeliveryReceiptsQueue();
        await this.processReadReceiptsQueue();
      } catch (error) {
        logger.error('Error in MessageQueueService processing interval', {
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
      logger.info('MessageQueueService stopped');
    }
  }

  async processMessageQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    
    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      const { Message, Conversation, ConversationParticipant, User } = models;
      
      // Process a batch of messages
      let processedCount = 0;
      
      for (let i = 0; i < this.messagesBatchSize; i++) {
        const message = await queueService.redisClient.lpop(queueService.QUEUES.MESSAGES);
        if (!message) {
          break; // No more messages in queue
        }
        
        try {
          const messageData = JSON.parse(message);
          logger.debug('Processing message from queue', {
            messageId: messageData.id,
            conversationId: messageData.conversationId
          });
          
          // Create message in database
          await Message.create(messageData);
          
          // Update conversation last message time if applicable
          if (messageData.conversationId) {
            await Conversation.update(
              { lastMessageAt: new Date() },
              { where: { id: messageData.conversationId } }
            );
            
            // Increment unread count for all participants except sender
            await ConversationParticipant.increment(
              'unreadCount',
              {
                where: {
                  conversationId: messageData.conversationId,
                  userId: { [Op.ne]: messageData.senderId }
                }
              }
            );
            
            // Update Redis unread counts
            const conversation = await Conversation.findByPk(messageData.conversationId);
            if (conversation) {
              const otherParticipants = conversation.participantIds.filter(id => id !== messageData.senderId);
              
              for (const participantId of otherParticipants) {
                // Check if user is online
                const isOnline = await redisService.isUserStillOnline(participantId);
                
                if (!isOnline) {
                  // Store message for offline user
                  await queueService.storeOfflineMessage(participantId, messageData);
                }
                
                // Increment unread count in Redis
                await redisService.incrementUnreadCount(participantId, messageData.conversationId);
              }
            }
          }
          
          // Cache the message in Redis for quick access
          await redisService.cacheMessage(messageData);
          
          // Notify recipients if configured
          if (messageData.senderId && messageData.conversationId) {
            // Get sender details for notification
            const sender = await User.findByPk(messageData.senderId, {
              attributes: ['id', 'name']
            });
            
            // Get other participants to send notifications to
            const otherParticipants = await ConversationParticipant.findAll({
              where: {
                conversationId: messageData.conversationId,
                userId: { [Op.ne]: messageData.senderId }
              },
              attributes: ['userId']
            });
            
            const recipientIds = otherParticipants.map(p => p.userId);
            
            if (recipientIds.length > 0 && sender) {
              await notificationManager.sendMessageNotification(
                messageData,
                recipientIds
              );
            }
          }
          
          processedCount++;
          logger.info(`Message ${messageData.id} processed successfully`);
        } catch (error) {
          logger.error(`Error processing message: ${error.message}`, {
            stack: error.stack,
            message
          });
          
          // Re-queue with a delay to avoid infinite loop on permanent errors
          setTimeout(async () => {
            await queueService.redisClient.rpush(queueService.QUEUES.MESSAGES, message);
            logger.info('Re-queued failed message for retry');
          }, 5000);
        }
      }
      
      if (processedCount > 0) {
        logger.info(`Processed ${processedCount} messages from queue`);
      }
      
    } catch (error) {
      logger.error('Error in processMessageQueue', {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing = false;
    }
  }

  async processDeliveryReceiptsQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    
    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      const { Message } = models;
      
      // Process a batch of delivery receipts
      let processedCount = 0;
      
      for (let i = 0; i < this.messagesBatchSize; i++) {
        const receipt = await queueService.redisClient.lpop(queueService.QUEUES.DELIVERY_RECEIPTS);
        if (!receipt) {
          break; // No more receipts in queue
        }
        
        try {
          const data = JSON.parse(receipt);
          const { userId, messageIds } = data;
          
          if (!userId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
            logger.warn('Invalid delivery receipt data', { data });
            continue;
          }
          
          // Update message status to delivered
          const result = await Message.update(
            { status: 'delivered' },
            { 
              where: { 
                id: messageIds,
                receiverId: userId,
                status: 'sent'
              } 
            }
          );
          
          // Get updated messages to emit socket events
          const updatedMessages = await Message.findAll({
            where: { id: messageIds }
          });
          
          // Group by sender for notifications
          const messagesBySender = {};
          updatedMessages.forEach(msg => {
            if (!messagesBySender[msg.senderId]) {
              messagesBySender[msg.senderId] = [];
            }
            messagesBySender[msg.senderId].push(msg.id);
          });
          
          // This would be handled through socket notifications
          // We'd need access to the socket.io instance to emit events
          
          processedCount += messageIds.length;
          logger.info(`Delivery receipts for ${messageIds.length} messages processed`, {
            userId,
            updatedCount: result[0]
          });
        } catch (error) {
          logger.error(`Error processing delivery receipt: ${error.message}`, {
            stack: error.stack,
            receipt
          });
          
          // Re-queue with a delay on temporary errors
          setTimeout(async () => {
            await queueService.redisClient.rpush(queueService.QUEUES.DELIVERY_RECEIPTS, receipt);
            logger.info('Re-queued failed delivery receipt for retry');
          }, 5000);
        }
      }
      
      if (processedCount > 0) {
        logger.info(`Processed delivery receipts for ${processedCount} messages`);
      }
      
    } catch (error) {
      logger.error('Error in processDeliveryReceiptsQueue', {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing = false;
    }
  }

  async processReadReceiptsQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    
    try {
      await this.ensureDbInitialized();
      const models = db.getModels();
      const { Message, ConversationParticipant } = models;
      
      // Process a batch of read receipts
      let processedCount = 0;
      
      for (let i = 0; i < this.messagesBatchSize; i++) {
        const receipt = await queueService.redisClient.lpop(queueService.QUEUES.READ_RECEIPTS);
        if (!receipt) {
          break; // No more receipts in queue
        }
        
        try {
          const data = JSON.parse(receipt);
          const { userId, messageIds, conversationId } = data;
          
          if (!userId) {
            logger.warn('Invalid read receipt data - missing userId', { data });
            continue;
          }
          
          let updatedCount = 0;
          
          // For specific messages
          if (messageIds && messageIds.length > 0) {
            const result = await Message.update(
              { status: 'read' },
              { 
                where: { 
                  id: messageIds,
                  receiverId: userId,
                  status: { [Op.ne]: 'read' }
                } 
              }
            );
            updatedCount += result[0];
          }
          
          // For entire conversation
          if (conversationId) {
            const result = await Message.update(
              { status: 'read' },
              {
                where: {
                  conversationId,
                  receiverId: userId,
                  status: { [Op.ne]: 'read' }
                }
              }
            );
            updatedCount += result[0];
            
            // Reset unread count in participant record
            await ConversationParticipant.update(
              { unreadCount: 0 },
              { where: { conversationId, userId } }
            );
            
            // Reset Redis unread count
            await redisService.resetUnreadCount(userId, conversationId);
          }
          
          processedCount += updatedCount;
          logger.info(`Read receipts processed for user ${userId}`, {
            conversationId,
            messageIds: messageIds?.length,
            updatedCount
          });
          
          // Group by sender for notifications
          if (messageIds && messageIds.length > 0) {
            const messages = await Message.findAll({
              where: { id: messageIds },
              attributes: ['id', 'senderId', 'conversationId']
            });
            
            const messagesBySender = {};
            const conversationIds = new Set();
            
            messages.forEach(msg => {
              conversationIds.add(msg.conversationId);
              
              if (!messagesBySender[msg.senderId]) {
                messagesBySender[msg.senderId] = [];
              }
              messagesBySender[msg.senderId].push(msg.id);
            });
            
            // This would be handled through socket notifications
            // We'd need access to the socket.io instance to emit events
          }
          
        } catch (error) {
          logger.error(`Error processing read receipt: ${error.message}`, {
            stack: error.stack,
            receipt
          });
          
          // Re-queue with a delay on temporary errors
          setTimeout(async () => {
            await queueService.redisClient.rpush(queueService.QUEUES.READ_RECEIPTS, receipt);
            logger.info('Re-queued failed read receipt for retry');
          }, 5000);
        }
      }
      
      if (processedCount > 0) {
        logger.info(`Processed read receipts affecting ${processedCount} messages`);
      }
      
    } catch (error) {
      logger.error('Error in processReadReceiptsQueue', {
        error: error.message,
        stack: error.stack
      });
    } finally {
      this.isProcessing = false;
    }
  }
}

module.exports = new MessageQueueService();