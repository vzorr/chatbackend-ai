// /socket/handlers/messageHandlers.js
const logger = require('../../utils/logger');
const messageService = require('../../services/socket/messageService');
const conversationService = require('../../services/socket/conversationService');
const presenceService = require('../../services/socket/presenceService');
const notificationService = require('../../services/notifications/notificationService');
const userService = require('../../services/socket/userService');

module.exports = (io, socket) => {
  const userId = socket.user.id;

  socket.on('send_message', async (messagePayload) => {
    try {
      const result = await messageService.handleSendMessage(io, socket, messagePayload);
      if (result.notifyRecipients && result.participants) {
        await notificationService.sendMessageNotification(result.message, result.participants);
      }
    } catch (error) {
      logger.error(`Error handling send_message: ${error}`);
      socket.emit('error', { code: 'MESSAGE_FAILED', message: 'Failed to process message' });
    }
  });

  socket.on('mark_read', async ({ messageIds, conversationId }) => {
    try {
      await messageService.handleMarkRead(io, socket, { messageIds, conversationId });
    } catch (error) {
      logger.error(`Error handling mark_read: ${error}`);
      socket.emit('error', { code: 'READ_FAILED', message: 'Failed to mark messages as read' });
    }
  });

  socket.on('update_message', async ({ messageId, newContent }) => {
    try {
      await messageService.handleUpdateMessage(io, socket, { messageId, newContent });
    } catch (error) {
      logger.error(`Error handling update_message: ${error}`);
      socket.emit('error', { code: 'UPDATE_FAILED', message: 'Failed to update message' });
    }
  });

  socket.on('delete_message', async ({ messageId }) => {
    try {
      await messageService.handleDeleteMessage(io, socket, { messageId });
    } catch (error) {
      logger.error(`Error handling delete_message: ${error}`);
      socket.emit('error', { code: 'DELETE_FAILED', message: 'Failed to delete message' });
    }
  });
};
