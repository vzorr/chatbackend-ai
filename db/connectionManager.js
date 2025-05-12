// db/connectionManager.js
const { Sequelize, Op } = require('sequelize');
const logger = require('../utils/logger');
const config = require('../config/config');

class ConnectionManager {
  constructor() {
    this.sequelize = null;
    this.pool = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectInterval = 5000; // 5 seconds
  }

  /**
   * Initialize database connection
   */
  async initialize() {
    try {
      logger.info('Initializing database connection...', {
        host: config.database.host,
        database: config.database.name,
        dialect: config.database.dialect
      });

      this.sequelize = new Sequelize(
        config.database.name,
        config.database.user,
        config.database.password,
        {
          host: config.database.host,
          port: config.database.port,
          dialect: config.database.dialect,
          logging: config.database.logging ? 
            (msg) => logger.debug('SQL Query', { query: msg }) : false,
          pool: {
            max: config.database.pool.max,
            min: config.database.pool.min,
            acquire: config.database.pool.acquire,
            idle: config.database.pool.idle,
            evict: 1000,
            validate: (client) => {
              try {
                return client.validate();
              } catch {
                return false;
              }
            }
          },
          retry: {
            match: [
              Sequelize.ConnectionError,
              Sequelize.ConnectionTimedOutError,
              Sequelize.TimeoutError,
              Sequelize.ConnectionRefusedError,
              /Deadlock/i,
              /SequelizeConnectionError/i,
              /SQLITE_BUSY/
            ],
            max: 3
          },
          dialectOptions: {
            supportBigNumbers: true,
            bigNumberStrings: true,
            connectTimeout: 60000, // 60 seconds
            ssl: config.database.ssl ? {
              require: true,
              rejectUnauthorized: false
            } : false
          },
          benchmark: true,
          define: {
            timestamps: true,
            underscored: false,
            freezeTableName: true,
            paranoid: false
          }
        }
      );

      // Test the connection
      await this.testConnection();
      
      // Set up connection event handlers
      this.setupConnectionHandlers();
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      logger.info('Database connection established successfully');
      return this.sequelize;
    } catch (error) {
      logger.error('Failed to initialize database connection', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Test database connection
   */
  async testConnection() {
    try {
      await this.sequelize.authenticate();
      logger.info('Database connection test successful');
      return true;
    } catch (error) {
      logger.error('Database connection test failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Set up connection event handlers
   */
  setupConnectionHandlers() {
    // Handle connection errors
    this.sequelize.connectionManager.pool.on('error', (error) => {
      logger.error('Database pool error', {
        error: error.message,
        code: error.code
      });
      
      if (this.shouldReconnect(error)) {
        this.handleReconnect();
      }
    });

    // Handle connection acquisition
    this.sequelize.connectionManager.pool.on('acquire', (connection) => {
      logger.debug('Database connection acquired', {
        processId: connection.processID || connection.threadId
      });
    });

    // Handle connection release
    this.sequelize.connectionManager.pool.on('release', (connection) => {
      logger.debug('Database connection released', {
        processId: connection.processID || connection.threadId
      });
    });

    // Handle connection removal
    this.sequelize.connectionManager.pool.on('remove', (connection) => {
      logger.debug('Database connection removed from pool', {
        processId: connection.processID || connection.threadId
      });
    });
  }

  /**
   * Determine if reconnection should be attempted
   */
  shouldReconnect(error) {
    const criticalErrors = [
      'EHOSTUNREACH',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ENETUNREACH',
      'ECONNRESET'
    ];
    
    return criticalErrors.includes(error.code) || 
           error.message.includes('Connection lost') ||
           error.message.includes('No connection available');
  }

  /**
   * Handle database reconnection
   */
  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Maximum reconnection attempts reached', {
        attempts: this.reconnectAttempts
      });
      return;
    }

    this.reconnectAttempts++;
    this.isConnected = false;

    logger.warn(`Attempting to reconnect to database (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.testConnection();
        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info('Database reconnection successful');
      } catch (error) {
        logger.error('Database reconnection failed', {
          attempt: this.reconnectAttempts,
          error: error.message
        });
        await this.handleReconnect();
      }
    }, this.reconnectInterval);
  }

  /**
   * Get database connection instance
   */
  getConnection() {
    if (!this.sequelize) {
      throw new Error('Database connection not initialized');
    }
    return this.sequelize;
  }

  /**
   * Check if database is connected
   */
  checkConnection() {
    return this.isConnected;
  }

  /**
   * Get connection statistics
   */
  async getConnectionStats() {
    try {
      const pool = this.sequelize.connectionManager.pool;
      
      return {
        size: pool.size,
        available: pool.available,
        using: pool.using,
        pending: pool.pending,
        max: pool.max,
        min: pool.min
      };
    } catch (error) {
      logger.error('Failed to get connection stats', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Execute raw query with automatic retries
   */
  async executeQuery(query, options = {}) {
    const maxRetries = options.maxRetries || 3;
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        const result = await this.sequelize.query(query, {
          type: options.type || Sequelize.QueryTypes.SELECT,
          replacements: options.replacements,
          logging: options.logging !== undefined ? options.logging : true,
          benchmark: true,
          ...options
        });
        
        return result;
      } catch (error) {
        retries++;
        
        if (retries >= maxRetries) {
          logger.error('Query execution failed after retries', {
            query,
            retries,
            error: error.message
          });
          throw error;
        }
        
        logger.warn(`Query failed, retrying (${retries}/${maxRetries})`, {
          error: error.message
        });
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
  }

  /**
   * Start a database transaction
   */
  async startTransaction(options = {}) {
    try {
      const transaction = await this.sequelize.transaction({
        isolationLevel: options.isolationLevel || Sequelize.Transaction.ISOLATION_LEVELS.READ_COMMITTED,
        type: options.type || Sequelize.Transaction.TYPES.DEFERRED,
        logging: options.logging !== undefined ? options.logging : true
      });
      
      logger.debug('Database transaction started', {
        id: transaction.id
      });
      
      return transaction;
    } catch (error) {
      logger.error('Failed to start transaction', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Run health check on database
   */
  async healthCheck() {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      await this.testConnection();
      
      // Test a simple query
      await this.executeQuery('SELECT 1', {
        logging: false
      });
      
      // Get pool stats
      const stats = await this.getConnectionStats();
      
      const duration = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime: `${duration}ms`,
        connected: this.isConnected,
        pool: stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        responseTime: `${duration}ms`,
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Gracefully close database connection
   */
  async close() {
    try {
      if (this.sequelize) {
        await this.sequelize.close();
        this.isConnected = false;
        this.sequelize = null;
        logger.info('Database connection closed successfully');
      }
    } catch (error) {
      logger.error('Error closing database connection', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Refresh connection pool
   */
  async refreshPool() {
    try {
      logger.info('Refreshing database connection pool...');
      
      // Drain the current pool
      await this.sequelize.connectionManager.pool.drain();
      
      // Clear all connections
      await this.sequelize.connectionManager.pool.clear();
      
      // Reinitialize connections
      await this.testConnection();
      
      logger.info('Database connection pool refreshed successfully');
    } catch (error) {
      logger.error('Failed to refresh connection pool', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new ConnectionManager();