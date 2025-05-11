// utils/client-sdk.js (new file)
/**
 * Generate client SDK configuration for various platforms
 */
const generateClientConfig = (req) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    return {
      apiUrl: baseUrl,
      socketUrl: baseUrl,
      socketPath: process.env.SOCKET_PATH || '/socket.io',
      apiVersion: 'v1',
      endpoints: {
        auth: {
          login: '/api/v1/auth/login',
          register: '/api/v1/auth/register',
          verifyToken: '/api/v1/auth/verify-token',
          refreshToken: '/api/v1/auth/refresh-token',
          profile: '/api/v1/auth/profile'
        },
        users: {
          list: '/api/v1/users',
          getById: '/api/v1/users/:id',
          status: '/api/v1/users/status'
        },
        conversations: {
          list: '/api/v1/conversations',
          getById: '/api/v1/conversations/:id',
          create: '/api/v1/conversations',
          addParticipants: '/api/v1/conversations/:id/participants',
          removeParticipant: '/api/v1/conversations/:id/participants/:participantId',
          markAsRead: '/api/v1/conversations/:id/read'
        },
        messages: {
          list: '/api/v1/messages/conversation/:conversationId',
          send: '/api/v1/messages',
          update: '/api/v1/messages/:id',
          delete: '/api/v1/messages/:id',
          markAsRead: '/api/v1/messages/read',
          markAsDelivered: '/api/v1/messages/deliver'
        },
        uploads: {
          file: '/upload',
          getPresignedUrl: '/api/v1/uploads/presigned-url'
        }
      },
      socketEvents: {
        connection: 'connection_established',
        messages: {
          new: 'new_message',
          updated: 'message_updated',
          deleted: 'message_deleted',
          read: 'messages_read_by_recipient',
          delivered: 'messages_delivered'
        },
        typing: {
          start: 'typing',
          users: 'typing_users',
          notification: 'user_typing'
        },
        presence: {
          statusChange: 'user_status_change',
          getStatus: 'get_online_status',
          statusResponse: 'online_status'
        },
        conversations: {
          created: 'conversation_created',
          userAdded: 'users_added_to_conversation',
          userLeft: 'user_left_conversation',
          addedTo: 'added_to_conversation'
        },
        errors: 'error'
      }
    };
  };
  
  module.exports = {
    generateClientConfig
  };