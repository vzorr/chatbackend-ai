// utils/redisDebugHelper.js
// Add this helper to debug Redis service issues
const logger = require('./logger');

class RedisDebugHelper {
  static async verifyRedisService(redisService) {
    logger.info('[REDIS DEBUG] Starting Redis service verification...');
    
    try {
      // Check if redisService is defined
      if (!redisService) {
        logger.error('[REDIS DEBUG] ❌ redisService is undefined');
        return false;
      }

      // List all available methods
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(redisService))
        .concat(Object.keys(redisService))
        .filter(key => typeof redisService[key] === 'function');
      
      logger.info('[REDIS DEBUG] Available Redis methods:', {
        count: methods.length,
        methods: methods.sort()
      });

      // Check for specific methods
      const requiredMethods = [
        'getOnlineUsers',
        'getUsersPresence',
        'getUnreadCounts',
        'setUserTyping',
        'removeUserTyping',
        'getUsersTyping'
      ];

      const missingMethods = [];
      const availableMethods = [];

      for (const method of requiredMethods) {
        if (typeof redisService[method] === 'function') {
          availableMethods.push(method);
          logger.info(`[REDIS DEBUG] ✅ Method '${method}' is available`);
        } else {
          missingMethods.push(method);
          logger.error(`[REDIS DEBUG] ❌ Method '${method}' is MISSING`);
        }
      }

      // Test getOnlineUsers if available
      if (typeof redisService.getOnlineUsers === 'function') {
        try {
          logger.info('[REDIS DEBUG] Testing getOnlineUsers method...');
          const startTime = Date.now();
          const result = await redisService.getOnlineUsers();
          const duration = Date.now() - startTime;
          
          logger.info('[REDIS DEBUG] ✅ getOnlineUsers test successful', {
            duration: `${duration}ms`,
            resultType: typeof result,
            isArray: Array.isArray(result),
            count: result?.length || 0,
            sample: result?.slice(0, 3)
          });
        } catch (error) {
          logger.error('[REDIS DEBUG] ❌ getOnlineUsers test failed', {
            error: error.message,
            stack: error.stack
          });
        }
      }

      // Summary
      logger.info('[REDIS DEBUG] Verification summary', {
        totalMethods: methods.length,
        requiredMethodsFound: availableMethods.length,
        missingMethods: missingMethods.length > 0 ? missingMethods : 'none',
        status: missingMethods.length === 0 ? 'PASS' : 'FAIL'
      });

      return missingMethods.length === 0;
      
    } catch (error) {
      logger.error('[REDIS DEBUG] Verification failed with error', {
        error: error.message,
        stack: error.stack
      });
      return false;
    }
  }

  static createRedisLogger(redisService) {
    if (!redisService) return redisService;

    return new Proxy(redisService, {
      get(target, prop) {
        const value = target[prop];
        
        if (typeof value === 'function') {
          return async function(...args) {
            const callId = `${prop}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
            
            logger.debug(`[REDIS CALL] ⬇️ Method called: ${prop}`, {
              callId,
              args: args.length > 0 ? args : 'no args',
              timestamp: new Date().toISOString()
            });
            
            try {
              const startTime = Date.now();
              const result = await value.apply(target, args);
              const duration = Date.now() - startTime;
              
              logger.debug(`[REDIS CALL] ⬆️ Method completed: ${prop}`, {
                callId,
                duration: `${duration}ms`,
                resultType: typeof result,
                resultPreview: Array.isArray(result) 
                  ? `Array(${result.length})` 
                  : JSON.stringify(result).substring(0, 100),
                timestamp: new Date().toISOString()
              });
              
              return result;
            } catch (error) {
              const duration = Date.now() - startTime;
              
              logger.error(`[REDIS CALL] ❌ Method failed: ${prop}`, {
                callId,
                duration: `${duration}ms`,
                error: error.message,
                stack: error.stack,
                timestamp: new Date().toISOString()
              });
              
              throw error;
            }
          };
        }
        
        return value;
      }
    });
  }
}

module.exports = RedisDebugHelper;