// config/swagger.js
const swaggerJsDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'VortexHive Chat API',
      version: '1.0.0',
      description: 'API documentation for VortexHive Chat Backend',
      contact: {
        name: 'API Support',
        email: 'support@vortexhive.com'
      }
    },
    servers: [
      {
        url: config.server.apiUrl || `http://localhost:${config.server.port}`,
        description: config.server.nodeEnv === 'production' ? 'Production Server' : 'Development Server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authorization token'
        },
        apiKey: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API key for service-to-service communication'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  example: 'ERROR_CODE'
                },
                message: {
                  type: 'string',
                  example: 'Error message'
                },
                timestamp: {
                  type: 'string',
                  format: 'date-time'
                }
              }
            }
          }
        },
        Message: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid'
            },
            conversationId: {
              type: 'string',
              format: 'uuid'
            },
            senderId: {
              type: 'string',
              format: 'uuid'
            },
            content: {
              type: 'object',
              properties: {
                text: {
                  type: 'string'
                },
                images: {
                  type: 'array',
                  items: {
                    type: 'string',
                    format: 'uri'
                  }
                },
                audio: {
                  type: 'string',
                  format: 'uri'
                }
              }
            },
            status: {
              type: 'string',
              enum: ['sent', 'delivered', 'read']
            },
            createdAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization'
      },
      {
        name: 'Users',
        description: 'User management operations'
      },
      {
        name: 'Messages',
        description: 'Message operations'
      },
      {
        name: 'Conversations',
        description: 'Conversation management'
      }
    ]
  },
  apis: [
    './routes/*.js',
    './routes/**/*.js'
  ]
};

class SwaggerConfig {
  constructor() {
    this.swaggerSpec = swaggerJsDoc(swaggerOptions);
  }

  /**
   * Initialize Swagger documentation
   * @param {Express} app - Express application instance
   * @param {string} path - Path to serve documentation (default: /api-docs)
   * @param {Function} authMiddleware - Optional authentication middleware
   */
  initialize(app, path = '/api-docs', authMiddleware = null) {
    // Swagger UI setup options
    const swaggerUiOptions = {
      customCss: this.getCustomCss(),
      customSiteTitle: 'VortexHive Chat API Documentation',
      customfavIcon: '/favicon.ico',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1
      }
    };

    // Set up the route handlers
    const handlers = [
      swaggerUi.serve,
      swaggerUi.setup(this.swaggerSpec, swaggerUiOptions)
    ];

    // Apply authentication middleware if provided
    if (authMiddleware) {
      handlers.unshift(authMiddleware);
    }

    // Serve Swagger UI
    app.use(path, ...handlers);

    // Serve raw OpenAPI spec with optional auth
    if (authMiddleware) {
      app.get(`${path}.json`, authMiddleware, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(this.swaggerSpec);
      });

      app.get(`${path}.yaml`, authMiddleware, (req, res) => {
        const yaml = require('js-yaml');
        res.setHeader('Content-Type', 'application/x-yaml');
        res.send(yaml.dump(this.swaggerSpec));
      });
    } else {
      app.get(`${path}.json`, (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(this.swaggerSpec);
      });

      app.get(`${path}.yaml`, (req, res) => {
        const yaml = require('js-yaml');
        res.setHeader('Content-Type', 'application/x-yaml');
        res.send(yaml.dump(this.swaggerSpec));
      });
    }

    return {
      path,
      spec: this.swaggerSpec,
      authEnabled: !!authMiddleware
    };
  }

  /**
   * Get the OpenAPI specification
   */
  getSpec() {
    return this.swaggerSpec;
  }

  /**
   * Add custom CSS for Swagger UI
   */
  getCustomCss() {
    return `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #3b82f6 }
      .swagger-ui .btn.authorize { background-color: #3b82f6 }
      .swagger-ui .btn.authorize:hover { background-color: #2563eb }
    `;
  }
}

module.exports = new SwaggerConfig();