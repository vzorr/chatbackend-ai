'use strict';

const { v4: uuidv4 } = require('uuid');

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

module.exports = {
  async up(queryInterface, Sequelize) {
    console.log('🔧 Starting notification templates seeder...');
    
    // Clear existing notification templates
    console.log('🧹 Clearing existing notification templates...');
    await queryInterface.bulkDelete('notification_templates', null, {});
    
    // Insert templates one by one to handle JSON/Array types properly
    console.log(`📝 Inserting ${notificationTemplates.length} notification templates...`);
    
    for (const template of notificationTemplates) {
      await queryInterface.bulkInsert('notification_templates', [{
        id: uuidv4(),
        appId: template.appId,
        eventId: template.eventId,
        eventName: template.eventName,
        title: template.title,
        body: template.body,
        payload: JSON.stringify(template.payload),
        priority: template.priority,
        category: template.category,
        defaultEnabled: template.defaultEnabled,
        platforms: `{${['ios', 'android'].join(',')}}`,
        metaData: null,
        createdAt: new Date(),
        updatedAt: new Date()
      }]);
    }
    
    console.log('✅ Notification templates seeder completed successfully!');
  },

  async down(queryInterface, Sequelize) {
    console.log('🔄 Rolling back notification templates seeder...');
    
    // Remove all notification templates
    await queryInterface.bulkDelete('notification_templates', null, {});
    
    console.log('✅ Notification templates rollback completed!');
  }
};