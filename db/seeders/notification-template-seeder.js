'use strict';
require('dotenv').config(); // ✅ load .env for standalone script
// ✅ Load environment variables manually
require('dotenv').config();

const { v4: uuidv4 } = require('uuid');
const db = require('../../db'); // ✅ your db/index.js
const { initializeDatabase } = require('../../bootstrap/initializers/database'); // ✅ proper database initializer

const notificationTemplates = [
  // Customer App Templates
  {
    appId: 'com.myusta.myustacustomer',
    eventId: 'contract.sent',
    eventName: 'Contract Sent',
    title: 'New Contract Sent',
    body: '{{customerName}} has sent you a contract for "{{jobTitle}}".',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      jobId: '{{jobId}}',
      deepLink: 'myustacustomer://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  },
  {
    appId: 'com.myusta.myustacustomer',
    eventId: 'contract.accepted',
    eventName: 'Contract Accepted',
    title: 'Contract Accepted',
    body: '{{ustaName}} has accepted your contract for "{{jobTitle}}".',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      jobId: '{{jobId}}',
      deepLink: 'myustacustomer://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  },
  {
    appId: 'com.myusta.myustacustomer',
    eventId: 'contract.rejected',
    eventName: 'Contract Rejected',
    title: 'Contract Rejected',
    body: '{{ustaName}} has rejected your contract for "{{jobTitle}}".',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      jobId: '{{jobId}}',
      deepLink: 'myustacustomer://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  },
  {
    appId: 'com.myusta.myustacustomer',
    eventId: 'contract.completed',
    eventName: 'Contract Completed',
    title: 'Contract Completed',
    body: 'Congratulations! The contract for "{{jobTitle}}" has been completed.',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      jobId: '{{jobId}}',
      deepLink: 'myustacustomer://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  },
  // Usta App Templates
  {
    appId: 'com.myusta.myusta',
    eventId: 'contract.sent',
    eventName: 'Contract Sent',
    title: 'New Contract Sent',
    body: '{{customerName}} has sent you a contract for "{{jobTitle}}".',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      jobId: '{{jobId}}',
      deepLink: 'myusta://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  },
  {
    appId: 'com.myusta.myusta',
    eventId: 'contract.accepted',
    eventName: 'Contract Accepted',
    title: 'Contract Accepted',
    body: 'You have accepted the contract for "{{jobTitle}}".',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      jobId: '{{jobId}}',
      deepLink: 'myusta://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  },
  {
    appId: 'com.myusta.myusta',
    eventId: 'contract.rejected',
    eventName: 'Contract Rejected',
    title: 'Contract Rejected',
    body: 'You have rejected the contract for "{{jobTitle}}".',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      jobId: '{{jobId}}',
      deepLink: 'myusta://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  },
  {
    appId: 'com.myusta.myusta',
    eventId: 'contract.completed',
    eventName: 'Contract Completed',
    title: 'Contract Completed',
    body: 'Congratulations! You have successfully completed the contract for "{{jobTitle}}".',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      jobId: '{{jobId}}',
      deepLink: 'myusta://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  }
  // Extend more if needed...
];

async function seedNotificationTemplates() {
  try {
    console.log('🔧 Initializing database connection...');
    await initializeDatabase(); // 1️⃣ DB connection
    await db.initializeModels(); // 2️⃣ Load Sequelize models after DB connection

    const { NotificationTemplate } = db.getModels(); // 3️⃣ Now models will be ready!

    console.log('🧹 Deleting all existing notification templates...');
    await NotificationTemplate.destroy({ where: {}, truncate: true });

    console.log('🚀 Seeding templates...');
    for (const template of notificationTemplates) {
      const [record, created] = await NotificationTemplate.findOrCreate({
        where: {
          appId: template.appId,
          eventId: template.eventId
        },
        defaults: {
          id: uuidv4(),
          eventName: template.eventName,
          title: template.title,
          body: template.body,
          payload: template.payload,
          priority: template.priority,
          category: template.category,
          defaultEnabled: template.defaultEnabled,
          platforms: ['ios', 'android'],
          metaData: null
        }
      });

      if (created) {
        console.log(`✅ Created: [${template.appId}] ${template.eventId}`);
      } else {
        console.log(`⚠️ Skipped (already exists): [${template.appId}] ${template.eventId}`);
      }
    }

    console.log('🎉 Notification templates seeding complete.');
    process.exit(0); // Exit successfully
  } catch (err) {
    console.error('❌ Error seeding notification templates:', err);
    process.exit(1); // Exit with error
  }
}

seedNotificationTemplates();
