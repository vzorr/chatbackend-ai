'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Initialize DB models
    const db = require('../models');
    await db.initialize();

    const {
      NotificationCategory,
      NotificationEvent,
      NotificationTemplate,
      NotificationLog,
      User
    } = db;

    // Import constants and helpers
    const {
      NOTIFICATION_EVENTS,
      NOTIFICATION_CATEGORIES,
      APP_IDS
    } = require('../../config/notifiction-constants');
    
    const {
      getEventCategory,
      getEventPriority,
      formatEventName
    } = require('../../utils/notificationHelper');

    console.log('🧹 Clearing existing notification data...');

    // Clear existing data in order (respecting foreign key constraints)
    await queryInterface.sequelize.query('DELETE FROM notification_logs;');
    console.log('  ✅ Cleared notification logs');
    
    await queryInterface.sequelize.query('DELETE FROM notification_templates;');
    console.log('  ✅ Cleared notification templates');
    
    await queryInterface.sequelize.query('DELETE FROM notification_events;');
    console.log('  ✅ Cleared notification events');
    
    await queryInterface.sequelize.query('DELETE FROM notification_categories;');
    console.log('  ✅ Cleared notification categories');

    console.log('✅ Cleared all existing notification data');

    // Create notification categories
    console.log('📂 Creating notification categories...');
    const categoryData = [
      {
        categoryKey: 'activity',
        name: 'Activity',
        description: 'Job activities, proposals, applications, and ratings',
        icon: 'activity',
        color: '#3B82F6',
        displayOrder: 1,
        isActive: true
      },
      {
        categoryKey: 'contracts',
        name: 'Contracts',
        description: 'Contract lifecycle, work submissions, payments, and milestones',
        icon: 'document-text',
        color: '#10B981',
        displayOrder: 2,
        isActive: true
      },
      {
        categoryKey: 'reminders',
        name: 'Reminders',
        description: 'Deadlines, payment reminders, and system notifications',
        icon: 'bell',
        color: '#F59E0B',
        displayOrder: 3,
        isActive: true
      },
      {
        categoryKey: 'chat',
        name: 'Messages',
        description: 'Chat messages and communication',
        icon: 'chat-bubble-left',
        color: '#8B5CF6',
        displayOrder: 4,
        isActive: true
      }
    ];

    const categories = await NotificationCategory.bulkCreate(categoryData, {
      returning: true
    });

    console.log(`✅ Created ${categories.length} categories`);

    // Create notification events
    console.log('🎯 Creating notification events...');
    
    const eventData = [];
    
    // Get all event values from NOTIFICATION_EVENTS
    const allEvents = Object.values(NOTIFICATION_EVENTS);
    
    for (const eventKey of allEvents) {
      const categoryKey = getEventCategory(eventKey);
      const category = categories.find(c => c.categoryKey === categoryKey);
      
      if (category) {
        // Convert event key to readable name using helper
        const eventName = formatEventName(eventKey);
        
        eventData.push({
          categoryId: category.id,
          eventKey: eventKey,
          eventName: eventName,
          description: `Notification event for ${eventName.toLowerCase()}`,
          defaultPriority: getEventPriority(eventKey),
          isActive: true
        });
      }
    }

    const events = await NotificationEvent.bulkCreate(eventData, {
      returning: true
    });

    console.log(`✅ Created ${events.length} events`);

    // Create notification templates
    console.log('📋 Creating notification templates...');

    const templateData = [];

    // Define which events are relevant for which apps
    const appSpecificEvents = {
      // Events only for CUSTOMER_APP
      [APP_IDS.CUSTOMER_APP]: [
        'job.proposals_received',
        'job.proposal_received', 
        'job.application_received',
        'work.submitted',
        'contract.payment_due',
        'payment.due_reminder',
        'milestone.created',
        'milestone.completed'
      ],
      
      // Events only for USTA_APP  
      [APP_IDS.USTA_APP]: [
        'job.posted',
        'job.updated',
        'job.application_sent',
        'job.application_accepted',
        'job.application_rejected',
        'job.contractor_selected',
        'work.approved',
        'work.rejected',
        'work.revision_requested',
        'payment.received',
        'payment.completed',
        'deadline.reminder',
        'work.deadline_approaching',
        'proposal.accepted',
        'proposal.rejected'
      ],
      
      // Events for BOTH apps
      both: [
        'contract.created',
        'contract.sent',
        'contract.accepted',
        'contract.rejected',
        'contract.signed',
        'contract.completed',
        'chat.new_message',
        'chat.message_received',
        'user.account_verified',
        'user.profile_verified',
        'system.announcement',
        'system.maintenance',
        'rating.given',
        'rating.received'
      ]
    };

    // Template definitions for key events
    const templateDefinitions = {
      // Job events
      'job.posted': {
        [APP_IDS.USTA_APP]: {
          title: 'New Job Available',
          body: 'A new job has been posted in your area'
        }
      },
      'job.proposals_received': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'Proposals Received',
          body: 'You have received new proposals for your job'
        }
      },
      'job.application_received': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'New Application Received',
          body: 'You have received a new application for your job'
        }
      },
      'job.application_sent': {
        [APP_IDS.USTA_APP]: {
          title: 'Application Sent',
          body: 'Your job application has been submitted successfully'
        }
      },
      'job.application_accepted': {
        [APP_IDS.USTA_APP]: {
          title: 'Application Accepted',
          body: 'Congratulations! Your application has been accepted'
        }
      },
      'job.application_rejected': {
        [APP_IDS.USTA_APP]: {
          title: 'Application Update',
          body: 'Thank you for your interest. The position has been filled'
        }
      },

      // Contract events (both apps but different messages)
      'contract.created': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'Contract Created',
          body: 'A new contract has been created for your job'
        },
        [APP_IDS.USTA_APP]: {
          title: 'Contract Created',
          body: 'A new contract has been created for you'
        }
      },
      'contract.accepted': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'Contract Accepted',
          body: 'Your contract has been accepted by the usta'
        },
        [APP_IDS.USTA_APP]: {
          title: 'Contract Accepted',
          body: 'You have accepted the contract'
        }
      },
      'contract.signed': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'Contract Signed',
          body: 'Your contract has been signed and is now active'
        },
        [APP_IDS.USTA_APP]: {
          title: 'Contract Signed',
          body: 'The contract has been signed and is now active'
        }
      },

      // Work events
      'work.submitted': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'Work Submitted',
          body: 'Work has been submitted for your review'
        }
      },
      'work.approved': {
        [APP_IDS.USTA_APP]: {
          title: 'Work Approved',
          body: 'Your submitted work has been approved'
        }
      },
      'work.rejected': {
        [APP_IDS.USTA_APP]: {
          title: 'Work Needs Revision',
          body: 'Your submitted work needs some revisions'
        }
      },

      // Payment events
      'payment.received': {
        [APP_IDS.USTA_APP]: {
          title: 'Payment Received',
          body: 'You have received payment for your work'
        }
      },
      'payment.due_reminder': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'Payment Reminder',
          body: 'You have a payment due soon'
        }
      },

      // Chat events (both apps, same message)
      'chat.new_message': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'New Message',
          body: 'You have a new message'
        },
        [APP_IDS.USTA_APP]: {
          title: 'New Message',
          body: 'You have a new message'
        }
      },

      // System events (both apps, same message)
      'user.account_verified': {
        [APP_IDS.CUSTOMER_APP]: {
          title: 'Account Verified',
          body: 'Your account has been successfully verified'
        },
        [APP_IDS.USTA_APP]: {
          title: 'Account Verified',
          body: 'Your account has been successfully verified'
        }
      }
    };

    // Generate templates based on app-specific logic
    for (const event of events) {
      const eventKey = event.eventKey;
      
      // Check if event has specific templates defined
      const eventTemplates = templateDefinitions[eventKey];
      
      if (eventTemplates) {
        // Use specific template definitions
        for (const [appId, template] of Object.entries(eventTemplates)) {
          let priority = event.defaultPriority;
          if (priority === 'urgent') {
            priority = 'high';
          }
          
          templateData.push({
            eventId: event.id,
            appId: appId,
            title: template.title,
            body: template.body,
            priority: priority,
            defaultEnabled: true,
            platforms: ['ios', 'android']
          });
        }
      } else {
        // Generate based on app-specific rules
        const appsForEvent = [];
        
        if (appSpecificEvents[APP_IDS.CUSTOMER_APP].includes(eventKey)) {
          appsForEvent.push(APP_IDS.CUSTOMER_APP);
        }
        if (appSpecificEvents[APP_IDS.USTA_APP].includes(eventKey)) {
          appsForEvent.push(APP_IDS.USTA_APP);
        }
        if (appSpecificEvents.both.includes(eventKey)) {
          appsForEvent.push(APP_IDS.CUSTOMER_APP, APP_IDS.USTA_APP);
        }
        
        // If not in any specific list, add to both (fallback)
        if (appsForEvent.length === 0) {
          appsForEvent.push(APP_IDS.CUSTOMER_APP, APP_IDS.USTA_APP);
        }
        
        // Create templates for relevant apps
        for (const appId of appsForEvent) {
          let priority = event.defaultPriority;
          if (priority === 'urgent') {
            priority = 'high';
          }
          
          templateData.push({
            eventId: event.id,
            appId: appId,
            title: event.eventName,
            body: `${event.eventName} notification`,
            priority: priority,
            defaultEnabled: true,
            platforms: ['ios', 'android']
          });
        }
      }
    }

    const templates = await NotificationTemplate.bulkCreate(templateData, {
      returning: true
    });

    console.log(`✅ Created ${templates.length} templates`);

    // Display summary
    console.log('\n📊 SUMMARY:');
    console.log(`📂 Categories: ${categories.length}`);
    console.log(`🎯 Events: ${events.length}`);
    console.log(`📋 Templates: ${templates.length}`);

    console.log('\n📋 Template-Category Relationship:');
    for (const template of templates) {
      const event = events.find(e => e.id === template.eventId);
      const category = categories.find(c => c.id === event?.categoryId);
      console.log(`  📱 ${category?.categoryKey}.${event?.eventKey} -> ${template.appId}`);
    }

    // Create some sample notifications for testing
    console.log('\n🔔 Creating sample notifications...');
    
    const sampleUserIds = [
      '81f74e18-62ec-426d-92fe-4152d707dbcf', // Amir Sohail (customer)
      '1309fa30-fe8a-4999-865b-adf0646da815'  // Babar Khan (usta)
    ];

    const sampleNotifications = [];
    
    // Sample contract accepted notification
    const contractAcceptedEvent = events.find(e => e.eventKey === 'contract.accepted');
    const contractTemplate = templates.find(t => 
      t.eventId === contractAcceptedEvent?.id && t.appId === APP_IDS.CUSTOMER_APP
    );
    
    if (contractTemplate && contractAcceptedEvent) {
      sampleNotifications.push({
        recipientId: sampleUserIds[0],
        eventId: contractAcceptedEvent.id,
        templateId: contractTemplate.id,
        categoryId: contractAcceptedEvent.categoryId,
        appId: APP_IDS.CUSTOMER_APP,
        title: contractTemplate.title,
        body: contractTemplate.body,
        status: 'delivered',
        channel: 'push'
      });
    }

    // Sample payment received notification
    const paymentEvent = events.find(e => e.eventKey === 'payment.received');
    const paymentTemplate = templates.find(t => 
      t.eventId === paymentEvent?.id && t.appId === APP_IDS.USTA_APP
    );
    
    if (paymentTemplate && paymentEvent) {
      sampleNotifications.push({
        recipientId: sampleUserIds[1],
        eventId: paymentEvent.id,
        templateId: paymentTemplate.id,
        categoryId: paymentEvent.categoryId,
        appId: APP_IDS.USTA_APP,
        title: paymentTemplate.title,
        body: paymentTemplate.body,
        status: 'delivered',
        channel: 'push'
      });
    }

    // Sample chat notification
    const chatEvent = events.find(e => e.eventKey === 'chat.new_message');
    const chatTemplate = templates.find(t => 
      t.eventId === chatEvent?.id && t.appId === APP_IDS.CUSTOMER_APP
    );
    
    if (chatTemplate && chatEvent) {
      sampleNotifications.push({
        recipientId: sampleUserIds[0],
        eventId: chatEvent.id,
        templateId: chatTemplate.id,
        categoryId: chatEvent.categoryId,
        appId: APP_IDS.CUSTOMER_APP,
        title: chatTemplate.title,
        body: 'You have a new message from your usta',
        status: 'delivered',
        channel: 'push'
      });
    }

    if (sampleNotifications.length > 0) {
      const notifications = await NotificationLog.bulkCreate(sampleNotifications, {
        returning: true
      });
      console.log(`✅ Created ${notifications.length} sample notifications`);
    }

    console.log('\n🎉 Notification seeder completed successfully!');
  },

  async down(queryInterface, Sequelize) {
    console.log('🧹 Rolling back notification seeder...');
    
    // Clear all data in reverse order
    await queryInterface.sequelize.query('DELETE FROM notification_logs;');
    await queryInterface.sequelize.query('DELETE FROM notification_templates;');
    await queryInterface.sequelize.query('DELETE FROM notification_events;');
    await queryInterface.sequelize.query('DELETE FROM notification_categories;');

    console.log('✅ Notification seeder rollback completed');
  }
};