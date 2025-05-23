// db/seeders/20250123000000-chat-conversations-seed.js
'use strict';

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

// Target user ID that already exists
const TARGET_USER_ID = '81f74e18-62ec-426d-92fe-4152d707dbcf';

// Generate random phone numbers
const generatePhoneNumber = (index) => {
  const countryCode = '+92'; // Pakistan
  const areaCode = Math.floor(Math.random() * 900) + 100;
  const number = Math.floor(Math.random() * 9000000) + 1000000;
  return `${countryCode}${areaCode}${number}`;
};

// Generate realistic message content
const messageTemplates = {
  greetings: [
    "Hi! How are you?",
    "Hello there!",
    "Hey, what's up?",
    "Good morning!",
    "Good evening!",
    "Salam! Kya haal hai?"
  ],
  
  serviceRequests: [
    "I need help with plumbing in my kitchen",
    "Can you fix my AC? It's not cooling properly",
    "I'm looking for an electrician for some wiring work",
    "Need a carpenter to fix my door",
    "My laptop needs repair, can you help?",
    "Looking for a painter for my living room"
  ],
  
  responses: [
    "Sure, I can help you with that",
    "When would be a good time for you?",
    "I'll be available tomorrow afternoon",
    "What's your budget for this work?",
    "Can you share some photos of the issue?",
    "I have 5 years of experience in this field"
  ],
  
  followUps: [
    "Thanks for the quick response!",
    "That sounds perfect",
    "Let me check and get back to you",
    "What's your rate?",
    "How long will it take?",
    "Can we schedule for this weekend?"
  ],
  
  closings: [
    "Great! See you then",
    "Thanks for your help",
    "Looking forward to working with you",
    "I'll send you the location",
    "Please bring your tools",
    "Call me when you reach"
  ]
};

// Generate conversation flow
const generateConversationMessages = (conversationId, user1Id, user2Id, messageCount = 10) => {
  const messages = [];
  const startTime = new Date();
  startTime.setDate(startTime.getDate() - 7); // Start 7 days ago
  
  for (let i = 0; i < messageCount; i++) {
    const isFromUser1 = i % 2 === 0;
    const senderId = isFromUser1 ? user1Id : user2Id;
    const receiverId = isFromUser1 ? user2Id : user1Id;
    
    // Determine message type based on conversation flow
    let messageText;
    if (i === 0) {
      messageText = messageTemplates.greetings[Math.floor(Math.random() * messageTemplates.greetings.length)];
    } else if (i === 1) {
      messageText = messageTemplates.serviceRequests[Math.floor(Math.random() * messageTemplates.serviceRequests.length)];
    } else if (i < messageCount - 2) {
      const templates = Math.random() > 0.5 ? messageTemplates.responses : messageTemplates.followUps;
      messageText = templates[Math.floor(Math.random() * templates.length)];
    } else {
      messageText = messageTemplates.closings[Math.floor(Math.random() * messageTemplates.closings.length)];
    }
    
    // Add some variety with images occasionally
    const hasImage = Math.random() > 0.85;
    const messageType = hasImage ? 'image' : 'text';
    
    // Calculate message time (messages spread over the conversation period)
    const messageTime = new Date(startTime.getTime() + (i * (7 * 24 * 60 * 60 * 1000) / messageCount));
    
    // Determine message status based on time and sender
    let status = 'read';
    const hoursAgo = (new Date() - messageTime) / (1000 * 60 * 60);
    if (senderId === TARGET_USER_ID && hoursAgo < 24) {
      status = hoursAgo < 1 ? 'sent' : (hoursAgo < 6 ? 'delivered' : 'read');
    }
    
    messages.push({
      id: uuidv4(),
      conversationId,
      jobId: null,
      senderId,
      receiverId,
      type: messageType,
      content: {
        text: messageText,
        images: hasImage ? ['https://picsum.photos/400/300?random=' + i] : [],
        audio: null,
        replyTo: null,
        attachments: []
      },
      status,
      deleted: false,
      clientTempId: null,
      isSystemMessage: false,
      createdAt: messageTime,
      updatedAt: messageTime
    });
  }
  
  return messages;
};

module.exports = {
  up: async (queryInterface, Sequelize) => {
    try {
      console.log('🌱 Starting chat conversation seeder...\n');
      
      // Check if target user exists
      const [targetUser] = await queryInterface.sequelize.query(
        `SELECT * FROM users WHERE id = :userId`,
        {
          replacements: { userId: TARGET_USER_ID },
          type: queryInterface.sequelize.QueryTypes.SELECT
        }
      );
      
      if (!targetUser) {
        console.error(`❌ Target user ${TARGET_USER_ID} not found in database!`);
        throw new Error('Target user not found');
      }
      
      console.log(`✅ Found target user: ${targetUser.name || 'User'}\n`);
      
      // Create dummy users
      const dummyUsers = [
        {
          id: uuidv4(),
          externalId: uuidv4(),
          name: 'Ahmed Hassan',
          email: `ahmed.hassan.${uuidv4().slice(0, 6)}@example.com`,
          phone: generatePhoneNumber(1),
          role: 'usta',
          avatar: 'https://ui-avatars.com/api/?name=Ahmed+Hassan&background=2ECC71&color=fff',
          isOnline: false,
          lastSeen: new Date(),
          socketId: null,
          metaData: {
            skills: ['Plumbing', 'AC Repair'],
            rating: 4.8,
            completedJobs: 156
          }
        },
        {
          id: uuidv4(),
          externalId: uuidv4(),
          name: 'Sarah Khan',
          email: `sarah.khan+${uuidv4().slice(0, 6)}@example.com`,
          phone: generatePhoneNumber(2),
          role: 'customer',
          avatar: 'https://ui-avatars.com/api/?name=Sarah+Khan&background=E74C3C&color=fff',
          isOnline: true,
          lastSeen: null,
          socketId: null,
          metaData: {
            location: 'Lahore',
            memberSince: '2023'
          }
        },
        {
          id: uuidv4(),
          externalId: uuidv4(),
          name: 'Mohammad Ali',
          email: `Mohammad.Ali+${uuidv4().slice(0, 6)}@example.com`,
          phone: generatePhoneNumber(3),
          role: 'usta',
          avatar: 'https://ui-avatars.com/api/?name=Mohammad+Ali&background=3498DB&color=fff',
          isOnline: false,
          lastSeen: new Date(Date.now() - 3600000), // 1 hour ago
          socketId: null,
          metaData: {
            skills: ['Electrician', 'Home Automation'],
            rating: 4.9,
            completedJobs: 234
          }
        },
        {
          id: uuidv4(),
          externalId: uuidv4(),
          name: 'Fatima Ahmed',
          email: `Fatima.Ahmed+${uuidv4().slice(0, 6)}@example.com`,
          phone: generatePhoneNumber(4),
          role: 'customer',
          avatar: 'https://ui-avatars.com/api/?name=Fatima+Ahmed&background=9B59B6&color=fff',
          isOnline: false,
          lastSeen: new Date(Date.now() - 7200000), // 2 hours ago
          socketId: null,
          metaData: {
            location: 'Karachi',
            preferredLanguage: 'Urdu'
          }
        },
        {
          id: uuidv4(),
          externalId: uuidv4(),
          name: 'Usman Malik',
          email: `Usman.Malik+${uuidv4().slice(0, 6)}@example.com`,
          phone: generatePhoneNumber(5),
          role: 'usta',
          avatar: 'https://ui-avatars.com/api/?name=Usman+Malik&background=F39C12&color=fff',
          isOnline: true,
          lastSeen: null,
          socketId: null,
          metaData: {
            skills: ['Carpentry', 'Furniture Repair'],
            rating: 4.7,
            completedJobs: 89
          }
        }
      ];
      
      // Add timestamps
        const usersToInsert = dummyUsers.map(user => ({
        ...user,
        metaData: user.metaData ? JSON.stringify(user.metaData) : null,
        createdAt: new Date(),
        updatedAt: new Date()
        }));

      // Insert dummy users
      console.log('📝 Creating dummy users...');
      await queryInterface.bulkInsert('users', usersToInsert);
      console.log(`✅ Created ${dummyUsers.length} dummy users\n`);
      
      // Create conversations
      const conversations = [];
      const conversationParticipants = [];
      const messages = [];
      
      console.log('💬 Creating conversations and messages...');
      
      // Create a conversation with each dummy user
      for (let i = 0; i < dummyUsers.length; i++) {
        const dummyUser = dummyUsers[i];
        const conversationId = uuidv4();
        const isServiceConversation = dummyUser.role === 'usta';
        
        // Create conversation
        const conversation = {
          id: conversationId,
          jobId: isServiceConversation ? uuidv4() : null,
          jobTitle: isServiceConversation ? `${dummyUser.metaData.skills[0]} Service Request` : null,
          participantIds: Sequelize.literal(
            `ARRAY['${TARGET_USER_ID}', '${dummyUser.id}']::uuid[]`
          ),
          lastMessageAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };
        conversations.push(conversation);
        
        // Create participants
        const targetParticipant = {
          id: uuidv4(),
          conversationId,
          userId: TARGET_USER_ID,
          unreadCount: Math.floor(Math.random() * 3), // Random 0-2 unread messages
          isBlocked: false,
          joinedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
          leftAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        const dummyParticipant = {
          id: uuidv4(),
          conversationId,
          userId: dummyUser.id,
          unreadCount: 0,
          isBlocked: false,
          joinedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
          leftAt: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        conversationParticipants.push(targetParticipant, dummyParticipant);
        
        // Generate messages for this conversation
        const messageCount = 5 + Math.floor(Math.random() * 15); // 5-20 messages per conversation
        const conversationMessages = generateConversationMessages(
          conversationId,
          TARGET_USER_ID,
          dummyUser.id,
          messageCount
        );
        messages.push(...conversationMessages);

        
        
        // Update conversation's last message time
        if (conversationMessages.length > 0) {
          conversation.lastMessageAt = conversationMessages[conversationMessages.length - 1].createdAt;
        }
      }
      
      // Create one group conversation
    
      
      
      // Insert conversations
      await queryInterface.bulkInsert('conversations', conversations);
      console.log(`✅ Created ${conversations.length} conversations`);
      
      // Insert participants
      await queryInterface.bulkInsert('conversation_participants', conversationParticipants);
      console.log(`✅ Created ${conversationParticipants.length} conversation participants`);
      
      // Insert messages
      //await queryInterface.bulkInsert('messages', messages);

      const messagesToInsert = messages.map(msg => ({
        ...msg,
        content: JSON.stringify(msg.content) // ✅ stringify content field
        }));

        await queryInterface.bulkInsert('messages', messagesToInsert);


      console.log(`✅ Created ${messages.length} messages`);
      
      // Add some device tokens for push notifications
      const deviceTokens = [];
      const tokenHistory = [];
      
      // Add device token for target user
      const targetUserToken = {
        id: uuidv4(),
        userId: TARGET_USER_ID,
        token: `fcm_token_${TARGET_USER_ID.substring(0, 8)}`,
        deviceType: 'mobile',
        platform: 'android',
        deviceId: `device_${TARGET_USER_ID.substring(0, 8)}`,
        active: true,
        lastUsed: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      deviceTokens.push(targetUserToken);
      
      // Add token history
      tokenHistory.push({
        id: uuidv4(),
        userId: TARGET_USER_ID,
        token: targetUserToken.token,
        tokenType: 'FCM',
        deviceId: targetUserToken.deviceId,
        deviceModel: 'Samsung Galaxy S21',
        deviceOS: 'Android 12',
        appVersion: '1.0.0',
        action: 'REGISTERED',
        previousToken: null,
        expiresAt: null,
        metadata: JSON.stringify({ source: 'seeder' }), 
        ipAddress: '192.168.1.100',
        userAgent: 'VortexHive/1.0.0 (Android)',
        errorDetails: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      // Add tokens for some dummy users
      dummyUsers.slice(0, 3).forEach(user => {
        const token = {
          id: uuidv4(),
          userId: user.id,
          token: `fcm_token_${user.id.substring(0, 8)}`,
          deviceType: 'mobile',
          platform: Math.random() > 0.5 ? 'ios' : 'android',
          deviceId: `device_${user.id.substring(0, 8)}`,
          active: true,
          lastUsed: new Date(),
          createdAt: new Date(),
          updatedAt: new Date()
        };
        deviceTokens.push(token);
      });
      
      // Insert device tokens
      if (deviceTokens.length > 0) {
        await queryInterface.bulkInsert('device_tokens', deviceTokens);
        console.log(`✅ Created ${deviceTokens.length} device tokens`);
      }
      
      // Insert token history
      if (tokenHistory.length > 0) {
        await queryInterface.bulkInsert('token_history', tokenHistory);
        console.log(`✅ Created ${tokenHistory.length} token history records`);
      }
      
      console.log('\n🎉 Seeding completed successfully!');
      console.log(`\nSummary:`);
      console.log(`- Users created: ${dummyUsers.length}`);
      console.log(`- Conversations created: ${conversations.length} (${conversations.length - 1} direct, 1 group)`);
      console.log(`- Messages created: ${messages.length}`);
      console.log(`- Device tokens created: ${deviceTokens.length}`);
      console.log(`\nTarget user ${TARGET_USER_ID} now has ${conversations.length} active conversations!`);
      
    } catch (error) {
      console.error('❌ Seeding failed:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    try {
      console.log('🧹 Cleaning up seeded data...\n');
      
      // Get all seeded user IDs (excluding target user)
      const seededUsers = await queryInterface.sequelize.query(
        `SELECT id FROM users WHERE id != :targetUserId AND email LIKE '%@example.com'`,
        {
          replacements: { targetUserId: TARGET_USER_ID },
          type: queryInterface.sequelize.QueryTypes.SELECT
        }
      );
      
      const userIds = seededUsers.map(u => u.id);
      
      if (userIds.length > 0) {
        // Delete in correct order to respect foreign key constraints
        
        // Delete token history
        await queryInterface.bulkDelete('token_history', {
          userId: { [Sequelize.Op.in]: userIds }
        });
        console.log('✅ Deleted token history');
        
        // Delete device tokens
        await queryInterface.bulkDelete('device_tokens', {
          userId: { [Sequelize.Op.in]: userIds }
        });
        console.log('✅ Deleted device tokens');
        
        // Delete messages where seeded users are involved
        await queryInterface.bulkDelete('messages', {
          [Sequelize.Op.or]: [
            { senderId: { [Sequelize.Op.in]: userIds } },
            { receiverId: { [Sequelize.Op.in]: userIds } }
          ]
        });
        console.log('✅ Deleted messages');
        
        // Delete conversation participants
        await queryInterface.bulkDelete('conversation_participants', {
          userId: { [Sequelize.Op.in]: userIds }
        });
        console.log('✅ Deleted conversation participants');
        
        // Get conversations to delete
        const conversations = await queryInterface.sequelize.query(
          `SELECT id FROM conversations WHERE participant_ids && ARRAY[:userIds]::uuid[]`,
          {
            replacements: { userIds },
            type: queryInterface.sequelize.QueryTypes.SELECT
          }
        );
        
        const conversationIds = conversations.map(c => c.id);
        
        if (conversationIds.length > 0) {
          // Delete remaining participants and messages for these conversations
          await queryInterface.bulkDelete('conversation_participants', {
            conversationId: { [Sequelize.Op.in]: conversationIds }
          });
          
          await queryInterface.bulkDelete('messages', {
            conversationId: { [Sequelize.Op.in]: conversationIds }
          });
          
          // Delete conversations
          await queryInterface.bulkDelete('conversations', {
            id: { [Sequelize.Op.in]: conversationIds }
          });
          console.log('✅ Deleted conversations');
        }
        
        // Delete users
        await queryInterface.bulkDelete('users', {
          id: { [Sequelize.Op.in]: userIds }
        });
        console.log('✅ Deleted seeded users');
      }
      
      console.log('\n🎉 Cleanup completed successfully!');
      
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
      throw error;
    }
  }
};