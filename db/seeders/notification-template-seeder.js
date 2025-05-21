// src/db/seeders/notification-template-seeder.js
const { v4: uuidv4 } = require('uuid');
const db = require('../index'); // Uses db.initialize() and db.getModels()

const businessEventTemplates = [
  {
    appId: 'vortexhive-main',
    eventId: 'job_application_submitted',
    eventName: 'Job Application Submitted',
    title: 'New Application Received',
    body: 'A new application has been received for {{jobTitle}}',
    payload: {
      type: 'job_application',
      jobId: '{{jobId}}',
      applicantId: '{{applicantId}}',
      deepLink: 'vortexhive://jobs/applications/{{jobId}}'
    },
    priority: 'high',
    category: 'jobs',
    defaultEnabled: true
  },
  {
    appId: 'vortexhive-main',
    eventId: 'contract_created',
    eventName: 'Contract Created',
    title: 'New Contract',
    body: 'A new contract has been created for {{projectName}}',
    payload: {
      type: 'contract',
      contractId: '{{contractId}}',
      deepLink: 'vortexhive://contracts/{{contractId}}'
    },
    priority: 'high',
    category: 'contracts',
    defaultEnabled: true
  },
  {
    appId: 'vortexhive-main',
    eventId: 'milestone_created',
    eventName: 'Milestone Created',
    title: 'New Milestone',
    body: 'A new milestone has been created for {{projectName}}: {{milestoneName}}',
    payload: {
      type: 'milestone',
      milestoneId: '{{milestoneId}}',
      projectId: '{{projectId}}',
      deepLink: 'vortexhive://projects/{{projectId}}/milestones/{{milestoneId}}'
    },
    priority: 'normal',
    category: 'milestones',
    defaultEnabled: true
  }
];

async function seedNotificationTemplates() {
  try {
    console.log('🔧 Initializing DB...');
    await db.initialize();

    const { NotificationTemplate } = db.getModels();

    console.log('🚀 Seeding Notification Templates...');
    for (const template of businessEventTemplates) {
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
        console.log(`✅ Created: ${template.eventId}`);
      } else {
        console.log(`⚠️ Skipped (already exists): ${template.eventId}`);
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
