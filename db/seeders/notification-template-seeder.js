// src/db/seeders/notification-template-seeder.js

'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../index'); // Assumes your db has initialize() and getModels()

// Customer and USTA Templates
const notificationTemplates = [
  // Contract Events - Customer App
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
  // Contract Events - USTA App
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
  // Add more templates here (Activity, Reminder, etc.) similarly
];

async function seedNotificationTemplates() {
  try {
    console.log('🔧 Initializing DB...');
    await db.initialize();

    const { NotificationTemplate } = db.getModels();

    console.log('🧹 Deleting existing notification templates...');
    await NotificationTemplate.destroy({ where: {}, truncate: true });

    console.log('🚀 Seeding Notification Templates...');
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

    console.log('🎉 Seeding complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding templates:', err);
    process.exit(1);
  }
}

seedNotificationTemplates();
