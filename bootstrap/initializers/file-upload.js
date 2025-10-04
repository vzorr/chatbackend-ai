// bootstrap/initializers/file-upload.js
const path = require('path');
const fs = require('fs');
const { logger } = require('../../utils/logger');
const config = require('../../config/config');

async function initializeFileUpload() {
  const startTime = Date.now();
  logger.info('📁 [FileUpload] Initializing file upload system...');

  try {
    // Create upload directories
    await createUploadDirectories();
    
    // Verify write permissions
    await verifyPermissions();
    
    const duration = Date.now() - startTime;
    logger.info('✅ [FileUpload] File upload system initialized', {
      duration: `${duration}ms`,
      directories: ['uploads/images', 'uploads/audio', 'uploads/documents'],
      maxFileSize: '10MB',
      allowedTypes: ['images', 'audio', 'documents']
    });

    return {
      initialized: true,
      uploadPath: path.join(process.cwd(), 'uploads')
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('❌ [FileUpload] File upload initialization failed', {
      error: error.message,
      stack: error.stack,
      duration: `${duration}ms`
    });
    throw error;
  }
}

async function createUploadDirectories() {
  logger.info('📂 [FileUpload] Creating upload directories...');
  
  const uploadDirs = [
    'uploads',
    'uploads/images',
    'uploads/audio',
    'uploads/documents'
  ];

  for (const dir of uploadDirs) {
    const dirPath = path.join(process.cwd(), dir);
    
    if (!fs.existsSync(dirPath)) {
      try {
        fs.mkdirSync(dirPath, { recursive: true });
        logger.info(`✅ [FileUpload] Created directory: ${dir}`);
      } catch (error) {
        logger.error(`❌ [FileUpload] Failed to create directory: ${dir}`, {
          error: error.message
        });
        throw error;
      }
    } else {
      logger.info(`✓ [FileUpload] Directory exists: ${dir}`);
    }
  }

  logger.info('✅ [FileUpload] All upload directories ready');
}

async function verifyPermissions() {
  logger.info('🔒 [FileUpload] Verifying directory permissions...');
  
  const testDir = path.join(process.cwd(), 'uploads');
  
  try {
    // Test write permission
    fs.accessSync(testDir, fs.constants.W_OK | fs.constants.R_OK);
    logger.info('✅ [FileUpload] Directory permissions verified');
  } catch (error) {
    logger.error('❌ [FileUpload] Insufficient directory permissions', {
      directory: testDir,
      error: error.message
    });
    throw new Error(`Insufficient permissions for uploads directory: ${error.message}`);
  }
}

async function setupFileRoutes(app) {
  logger.info('🔧 [FileUpload] Setting up file upload routes...');
  
  try {
    const authMiddleware = require('../../middleware/authentication');
    const uploadRoutes = require('../../routes/upload');
    
    // Authenticated file serving
    app.get('/uploads/:type/:filename', 
      authMiddleware.authenticate.bind(authMiddleware),
      (req, res) => {
        const { type, filename } = req.params;
        
        // Validate type
        const allowedTypes = ['images', 'audio', 'documents'];
        if (!allowedTypes.includes(type)) {
          logger.warn('⚠️ [FileUpload] Invalid file type requested', {
            type,
            userId: req.user?.id,
            correlationId: req.correlationId
          });
          
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_TYPE',
              message: 'Invalid file type'
            }
          });
        }
        
        // Validate filename (prevent directory traversal)
        if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
          logger.warn('⚠️ [FileUpload] Directory traversal attempt detected', {
            filename,
            userId: req.user?.id,
            correlationId: req.correlationId,
            ip: req.ip
          });
          
          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_FILENAME',
              message: 'Invalid filename'
            }
          });
        }
        
        const filePath = path.join(process.cwd(), 'uploads', type, filename);
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
          logger.warn('⚠️ [FileUpload] File not found', {
            type,
            filename,
            userId: req.user?.id,
            correlationId: req.correlationId
          });
          
          return res.status(404).json({
            success: false,
            error: {
              code: 'FILE_NOT_FOUND',
              message: 'File not found'
            }
          });
        }
        
        logger.info('✅ [FileUpload] File accessed', {
          userId: req.user.id,
          type,
          filename,
          correlationId: req.correlationId
        });
        
        // Send file
        res.sendFile(filePath);
      }
    );
    
    // Mount upload routes
    app.use('/api/v1/upload', uploadRoutes);
    
    logger.info('✅ [FileUpload] File routes configured', {
      endpoints: [
        'GET /uploads/:type/:filename (authenticated)',
        'POST /api/v1/upload/image',
        'POST /api/v1/upload/audio',
        'POST /api/v1/upload/document',
        'POST /api/v1/upload/batch'
      ]
    });
    
  } catch (error) {
    logger.error('❌ [FileUpload] Failed to setup file routes', {
      error: error.message,
      stack: error.stack
    });
    
    // Setup fallback routes
    app.get('/uploads/:type/:filename', (req, res) => {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'File serving is not configured'
        }
      });
    });
    
    app.use('/api/v1/upload', (req, res) => {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'File upload service is not configured'
        }
      });
    });
  }
}

module.exports = { 
  initializeFileUpload,
  setupFileRoutes
};