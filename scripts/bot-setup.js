// scripts/setup-bot.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sequelize = require('../db');
const { User } = require('../db/models');
const logger = require('../utils/logger');

// Path to knowledge base directory
const KNOWLEDGE_BASE_DIR = path.join(__dirname, '..', 'knowledge');

// Sample knowledge base documents
const SAMPLE_DOCS = [
  {
    filename: 'about-vortexhive.txt',
    content: `About VortexHive
    
VortexHive is a cutting-edge AI platform that connects freelancers and clients through intelligent matching algorithms. Our system uses natural language processing to understand job requirements and find the perfect talent match.

Founded in 2024, we aim to revolutionize how people find work and how businesses find talent. Our chatbot assistant helps both sides communicate effectively and get their questions answered quickly.

Key Features:
- AI-powered job matching
- Real-time communication platform
- Secure payment processing
- Portfolio showcasing
- Skill verification
- Rating system
`
  },
  {
    filename: 'faq.txt',
    content: `Frequently Asked Questions

Q: How do I sign up for VortexHive?
A: You can sign up by downloading our mobile app or visiting our website. You'll need to provide a valid phone number for verification.

Q: Is VortexHive free to use?
A: Basic accounts are free. VortexHive charges a 5% service fee on completed jobs.

Q: How do payments work?
A: Clients fund projects upfront. Funds are held in escrow and released to freelancers when milestones are completed and approved.

Q: Can I use VortexHive on my computer?
A: Yes, VortexHive has both web and mobile applications.

Q: What happens if there's a dispute?
A: Our dispute resolution team will review the case and make a fair determination based on the evidence provided by both parties.
`
  },
  {
    filename: 'chatbot-help.txt',
    content: `Chatbot Help Guide

The VortexHive chatbot can help you with:

1. Answering questions about the platform
2. Finding relevant jobs or talents
3. Explaining how features work
4. Providing status updates on your projects
5. Helping with common issues

To talk to the chatbot, simply start a new conversation with "VortexHive Bot" in your contacts list or use the "Ask Bot" button in any screen.

Use clear, simple language when asking questions. For example:
- "How do I withdraw my earnings?"
- "What's the status of my current project?"
- "Can you help me find web developers?"

The chatbot will respond with relevant information and can connect you with human support if needed.
`
  }
];

// Initialize the bot and knowledge base
const setupBot = async () => {
  try {
    // Connect to database
    await sequelize.authenticate();
    logger.info('Database connection established');
    
    // Create bot user if not exists
    const [botUser, created] = await User.findOrCreate({
      where: { phone: '+bot' },
      defaults: {
        id: uuidv4(),
        name: 'VortexHive Bot',
        phone: '+bot',
        role: 'admin',
        avatar: '/uploads/bot-avatar.png',
        isOnline: true
      }
    });
    
    if (created) {
      logger.info('Bot user created in database');
    } else {
      logger.info('Bot user already exists in database');
    }
    
    // Create knowledge base directory if not exists
    if (!fs.existsSync(KNOWLEDGE_BASE_DIR)) {
      fs.mkdirSync(KNOWLEDGE_BASE_DIR, { recursive: true });
      logger.info('Knowledge base directory created');
    }
    
    // Create sample documents
    for (const doc of SAMPLE_DOCS) {
      const filePath = path.join(KNOWLEDGE_BASE_DIR, doc.filename);
      
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, doc.content);
        logger.info(`Created knowledge base file: ${doc.filename}`);
      } else {
        logger.info(`Knowledge base file already exists: ${doc.filename}`);
      }
    }
    
    logger.info('Bot and knowledge base setup completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error(`Error setting up bot: ${error}`);
    process.exit(1);
  }
};

// Run the setup
//setupBot();