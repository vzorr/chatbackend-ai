//use this seeder to as a way to create new seeder and seed into chat database
'use strict';
require('dotenv').config();

const { v4: uuidv4 } = require('uuid');
const db = require('../../db'); // your connectionManager
const { initializeDatabase } = require('../../bootstrap/initializers/database');
const models = require('../models'); // import the entire object

const notificationTemplates = [
  // ---- CONTRACTS (Customer App) ----
  {
    "appId": "com.myusta.myustacustomer",
    "eventId": "contract.sent",
    "eventName": "Contract Sent",
    "title": "New Contract Sent",
    "body": "{{customerName}} has sent you a contract for \"{{jobTitle}}\".",
    "payload": {
      "type": "contract",
      "contractId": "{{contractId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myustacustomer://contracts/{{contractId}}"
    },
    "priority": "high",
    "category": "contracts",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myustacustomer",
    "eventId": "contract.accepted",
    "eventName": "Contract Accepted",
    "title": "Contract Accepted",
    "body": "{{ustaName}} has accepted your contract for \"{{jobTitle}}\".",
    "payload": {
      "type": "contract",
      "contractId": "{{contractId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myustacustomer://contracts/{{contractId}}"
    },
    "priority": "high",
    "category": "contracts",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myustacustomer",
    "eventId": "contract.rejected",
    "eventName": "Contract Rejected",
    "title": "Contract Rejected",
    "body": "{{ustaName}} has rejected your contract for \"{{jobTitle}}\".",
    "payload": {
      "type": "contract",
      "contractId": "{{contractId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myustacustomer://contracts/{{contractId}}"
    },
    "priority": "high",
    "category": "contracts",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myustacustomer",
    "eventId": "contract.completed",
    "eventName": "Contract Completed",
    "title": "Contract Completed",
    "body": "Congratulations! The contract for \"{{jobTitle}}\" has been completed.",
    "payload": {
      "type": "contract",
      "contractId": "{{contractId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myustacustomer://contracts/{{contractId}}"
    },
    "priority": "high",
    "category": "contracts",
    "defaultEnabled": true
  },

  // ---- CONTRACTS (Usta App) ----
  {
    "appId": "com.myusta.myusta",
    "eventId": "contract.sent",
    "eventName": "Contract Sent",
    "title": "New Contract Sent",
    "body": "{{customerName}} has sent you a contract for \"{{jobTitle}}\".",
    "payload": {
      "type": "contract",
      "contractId": "{{contractId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myusta://contracts/{{contractId}}"
    },
    "priority": "high",
    "category": "contracts",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myusta",
    "eventId": "contract.accepted",
    "eventName": "Contract Accepted",
    "title": "Contract Accepted",
    "body": "You have accepted the contract for \"{{jobTitle}}\".",
    "payload": {
      "type": "contract",
      "contractId": "{{contractId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myusta://contracts/{{contractId}}"
    },
    "priority": "high",
    "category": "contracts",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myusta",
    "eventId": "contract.rejected",
    "eventName": "Contract Rejected",
    "title": "Contract Rejected",
    "body": "You have rejected the contract for \"{{jobTitle}}\".",
    "payload": {
      "type": "contract",
      "contractId": "{{contractId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myusta://contracts/{{contractId}}"
    },
    "priority": "high",
    "category": "contracts",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myusta",
    "eventId": "contract.completed",
    "eventName": "Contract Completed",
    "title": "Contract Completed",
    "body": "Congratulations! You have successfully completed the contract for \"{{jobTitle}}\".",
    "payload": {
      "type": "contract",
      "contractId": "{{contractId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myusta://contracts/{{contractId}}"
    },
    "priority": "high",
    "category": "contracts",
    "defaultEnabled": true
  },

  // ---- JOBS (Both Apps) ----
  {
    "appId": "com.myusta.myustacustomer",
    "eventId": "job.posted",
    "eventName": "Job Posted",
    "title": "New Job Posted",
    "body": "New job posted: \"{{jobTitle}}\"",
    "payload": {
      "type": "job",
      "jobId": "{{jobId}}",
      "deepLink": "myustacustomer://jobs/{{jobId}}"
    },
    "priority": "normal",
    "category": "jobs",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myusta",
    "eventId": "job.applied",
    "eventName": "Job Application Received",
    "title": "Application Received",
    "body": "You have a new application for \"{{jobTitle}}\"",
    "payload": {
      "type": "application",
      "jobId": "{{jobId}}",
      "applicantId": "{{applicantId}}",
      "deepLink": "myusta://jobs/{{jobId}}/applications"
    },
    "priority": "normal",
    "category": "jobs",
    "defaultEnabled": true
  },

  // ---- PAYMENTS ----
  {
    "appId": "com.myusta.myustacustomer",
    "eventId": "payment.initiated",
    "eventName": "Payment Initiated",
    "title": "Payment Initiated",
    "body": "Payment for contract \"{{contractTitle}}\" has been initiated.",
    "payload": {
      "type": "payment",
      "paymentId": "{{paymentId}}",
      "contractId": "{{contractId}}",
      "deepLink": "myustacustomer://payments/{{paymentId}}"
    },
    "priority": "normal",
    "category": "payments",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myustacustomer",
    "eventId": "payment.completed",
    "eventName": "Payment Completed",
    "title": "Payment Completed",
    "body": "Payment for contract \"{{contractTitle}}\" completed successfully.",
    "payload": {
      "type": "payment",
      "paymentId": "{{paymentId}}",
      "contractId": "{{contractId}}",
      "deepLink": "myustacustomer://payments/{{paymentId}}"
    },
    "priority": "normal",
    "category": "payments",
    "defaultEnabled": true
  },

  // ---- MILESTONES ----
  {
    "appId": "com.myusta.myusta",
    "eventId": "milestone.created",
    "eventName": "Milestone Created",
    "title": "New Milestone Created",
    "body": "New milestone \"{{milestoneTitle}}\" created.",
    "payload": {
      "type": "milestone",
      "milestoneId": "{{milestoneId}}",
      "contractId": "{{contractId}}",
      "deepLink": "myusta://contracts/{{contractId}}/milestones"
    },
    "priority": "normal",
    "category": "milestones",
    "defaultEnabled": true
  },
  {
    "appId": "com.myusta.myusta",
    "eventId": "milestone.completed",
    "eventName": "Milestone Completed",
    "title": "Milestone Completed",
    "body": "Milestone \"{{milestoneTitle}}\" has been completed.",
    "payload": {
      "type": "milestone",
      "milestoneId": "{{milestoneId}}",
      "contractId": "{{contractId}}",
      "deepLink": "myusta://contracts/{{contractId}}/milestones"
    },
    "priority": "normal",
    "category": "milestones",
    "defaultEnabled": true
  },

  // ---- RATINGS ----
  {
    "appId": "com.myusta.myusta",
    "eventId": "rating.given",
    "eventName": "Rating Given",
    "title": "New Rating Received",
    "body": "You have received a new rating for \"{{jobTitle}}\"",
    "payload": {
      "type": "rating",
      "ratingId": "{{ratingId}}",
      "jobId": "{{jobId}}",
      "deepLink": "myusta://ratings/{{ratingId}}"
    },
    "priority": "normal",
    "category": "ratings",
    "defaultEnabled": true
  },

  // ---- CHAT ----
  {
    "appId": "com.myusta.myusta",
    "eventId": "chat.new_message",
    "eventName": "New Chat Message",
    "title": "New Message",
    "body": "New message from {{senderName}}: \"{{messagePreview}}\"",
    "payload": {
      "type": "chat",
      "conversationId": "{{conversationId}}",
      "senderId": "{{senderId}}",
      "messageId": "{{messageId}}",
      "deepLink": "myusta://chats/{{conversationId}}"
    },
    "priority": "high",
    "category": "chats",
    "defaultEnabled": true
  },

  // ---- SYSTEM ANNOUNCEMENTS ----
  {
    "appId": "com.myusta.myusta",
    "eventId": "system.announcement",
    "eventName": "System Announcement",
    "title": "Announcement",
    "body": "{{announcementTitle}} - Tap to read more.",
    "payload": {
      "type": "announcement",
      "announcementId": "{{announcementId}}",
      "deepLink": "myusta://announcements/{{announcementId}}"
    },
    "priority": "normal",
    "category": "system",
    "defaultEnabled": true
  }


];


async function seedNotificationTemplates() {
  try {
    console.log('🔧 Initializing database connection...');
    await initializeDatabase(); // 1️⃣ Connect DB

    console.log('🔧 Initializing models...');
    await models.initialize(); // 2️⃣ Correct way to initialize models

    const { NotificationTemplate } = db.getModels(); // 3️⃣ Now models are ready!

    console.log('🧹 Deleting all existing notification templates...');
    await NotificationTemplate.destroy({ where: {}, truncate: true });

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
