#!/usr/bin/env node

const { v4: uuidv4 } = require('uuid');
const { program } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const db = require('../index');
const logger = require('../../utils/logger');

// CLI Configuration
program
  .name('message-history-seeder')
  .description('Seed message history for testing and development')
  .version('1.0.0')
  .option('-u, --user-id <id>', 'Target user ID', '81f74e18-62ec-426d-92fe-4152d707dbcf')
  .option('-e, --external-id <id>', 'Target user external ID', '81f74e18-62ec-426d-92fe-4152d707dbcf')
  .option('-c, --conversations <number>', 'Number of conversations to create', parseInt, 5)
  .option('-m, --messages <range>', 'Message count range per conversation (min-max)', '10-30')
  .option('-d, --days <number>', 'Spread messages over N days', parseInt, 7)
  .option('--clear', 'Clear existing data before seeding')
  .option('--dry-run', 'Show what would be created without actually creating')
  .parse(process.argv);

const options = program.opts();
const [minMessages, maxMessages] = options.messages.split('-').map(Number);
const TARGET_USER_ID = options.userId;
const TARGET_USER_EXTERNAL_ID = options.externalId;

const sampleUsers = [
  {
    id: uuidv4(),
    externalId: uuidv4(),
    name: 'Sarah Johnson',
    email: 'sarah.johnson@example.com',
    phone: '+12125551234',
    role: 'customer',
    avatar: 'https://ui-avatars.com/api/?name=Sarah+Johnson&background=0D8ABC&color=fff',
    isOnline: true
  },
  {
    id: uuidv4(),
    externalId: uuidv4(),
    name: 'Ahmed Hassan',
    email: 'ahmed.hassan@example.com',
    phone: '+12125551235',
    role: 'usta',
    avatar: 'https://ui-avatars.com/api/?name=Ahmed+Hassan&background=2ECC71&color=fff',
    isOnline: false
  },
  {
    id: uuidv4(),
    externalId: uuidv4(),
    name: 'Maria Garcia',
    email: 'maria.garcia@example.com',
    phone: '+12125551236',
    role: 'customer',
    avatar: 'https://ui-avatars.com/api/?name=Maria+Garcia&background=E74C3C&color=fff',
    isOnline: true
  },
  {
    id: uuidv4(),
    externalId: uuidv4(),
    name: 'John Smith',
    email: 'john.smith@example.com',
    phone: '+12125551237',
    role: 'usta',
    avatar: 'https://ui-avatars.com/api/?name=John+Smith&background=9B59B6&color=fff',
    isOnline: false
  }
];

const messageTemplates = [
  "Hi, I need help with plumbing in my kitchen.",
  "Thanks for the quick response!",
  "Can you come tomorrow afternoon?",
  "Sure, 2 PM works for me.",
  "Here's a photo of the issue:",
  "Let me know your availability.",
  "Great work!",
  "How much will it cost?",
  "Please send me the estimate.",
  "Thank you for your help!"
];

const sampleImages = [
  'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=300'
];

function getRandomMessageText() {
  return messageTemplates[Math.floor(Math.random() * messageTemplates.length)];
}

function calculateMessageStatus(senderId, receiverId, hoursAgo, targetUserId) {
  if (senderId === targetUserId) {
    if (hoursAgo < 2) return 'sent';
    if (hoursAgo < 12) return Math.random() > 0.5 ? 'delivered' : 'read';
    return 'read';
  } else {
    if (hoursAgo < 24) return Math.random() > 0.7 ? 'delivered' : 'read';
    return 'read';
  }
}

async function clearExistingData(models) {
  const spinner = ora('Clearing existing data...').start();
  try {
    const { Message, ConversationParticipant, Conversation } = models;
    await Message.destroy({ where: {} });
    await ConversationParticipant.destroy({ where: {} });
    await Conversation.destroy({ where: {} });
    spinner.succeed(chalk.green('Existing data cleared'));
  } catch (err) {
    spinner.fail(chalk.red('Error clearing data'));
    throw err;
  }
}

async function createTargetUser(models) {
  const { User } = models;
  const user = await User.findByPk(TARGET_USER_ID);
  if (user) return user;

  return await User.create({
    id: TARGET_USER_ID,
    externalId: TARGET_USER_EXTERNAL_ID,
    name: 'Test User',
    email: 'testuser@example.com',
    phone: '+12125550000',
    role: 'customer',
    avatar: 'https://ui-avatars.com/api/?name=Test+User&background=3498DB&color=fff',
    isOnline: true
  });
}

async function createConversations(models, targetUser) {
  const { Conversation, ConversationParticipant, Message } = models;
  const spinner = ora('Creating conversations...').start();

  let totalMessages = 0;
  for (const otherUser of sampleUsers.slice(0, options.conversations)) {
    const conversationId = uuidv4();
    const conversation = await Conversation.create({
      id: conversationId,
      participantIds: [targetUser.id, otherUser.id],
      lastMessageAt: new Date()
    });

    await ConversationParticipant.bulkCreate([
      { id: uuidv4(), conversationId, userId: targetUser.id, joinedAt: new Date() },
      { id: uuidv4(), conversationId, userId: otherUser.id, joinedAt: new Date() }
    ]);

    const messageCount = minMessages + Math.floor(Math.random() * (maxMessages - minMessages + 1));
    const messages = [];

    for (let j = 0; j < messageCount; j++) {
      const isFromTarget = Math.random() > 0.5;
      const senderId = isFromTarget ? targetUser.id : otherUser.id;
      const receiverId = isFromTarget ? otherUser.id : targetUser.id;

      const hoursAgo = Math.floor(Math.random() * (options.days * 24));
      const messageTime = new Date(Date.now() - hoursAgo * 3600000);
      const hasImage = Math.random() > 0.85;

      messages.push({
        id: uuidv4(),
        conversationId,
        senderId,
        receiverId,
        type: hasImage ? 'image' : 'text',
        content: {
          text: getRandomMessageText(),
          images: hasImage ? [sampleImages[0]] : [],
          audio: null,
          replyTo: null,
          attachments: []
        },
        status: calculateMessageStatus(senderId, receiverId, hoursAgo, targetUser.id),
        deleted: false,
        createdAt: messageTime,
        updatedAt: messageTime
      });
    }

    await Message.bulkCreate(messages.sort((a, b) => a.createdAt - b.createdAt));
    await conversation.update({ lastMessageAt: messages[messages.length - 1].createdAt });
    totalMessages += messages.length;
  }

  spinner.succeed(chalk.green(`Created ${options.conversations} conversations with ${totalMessages} messages`));
}

async function runSeeder() {
  try {
    console.log(chalk.bold.blue('\n🚀 Running Message History Seeder\n'));

    await db.initialize();
    const models = db.getModels();

    if (options.clear) await clearExistingData(models);

    const targetUser = await createTargetUser(models);
    await createConversations(models, targetUser);

    console.log(chalk.bold.green('\n🎉 Seeding completed successfully!\n'));
    process.exit(0);
  } catch (err) {
    console.error(chalk.red('❌ Seeder failed:'), err);
    process.exit(1);
  }
}

runSeeder();
