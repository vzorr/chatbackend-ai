const multer = require('multer');
const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

// MEMORY STORAGE - Files stay in memory for direct S3 upload
const storage = multer.memoryStorage();

// File filter validation
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
  const allowedAudioTypes = /mp3|wav|ogg|m4a|aac|webm/;
  const allowedVideoTypes = /mp4|mov|avi|webm/;
  const allowedDocTypes = /pdf|doc|docx|xls|xlsx|txt|zip|rar/;
  
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  const mimetype = file.mimetype;
  
  let isValid = false;
  
  if (allowedImageTypes.test(ext) && mimetype.startsWith('image/')) {
    isValid = true;
  } else if (allowedAudioTypes.test(ext) && mimetype.startsWith('audio/')) {
    isValid = true;
  } else if (allowedVideoTypes.test(ext) && mimetype.startsWith('video/')) {
    isValid = true;
  } else if (allowedDocTypes.test(ext)) {
    isValid = true;
  }
  
  if (isValid) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${ext} (${mimetype})`), false);
  }
};

// Multer instance with memory storage and limits
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.fileUpload.maxFileSize || 50 * 1024 * 1024, // 50MB default
    files: config.fileUpload.maxBatchFiles || 5
  }
});

// Multer error handler middleware
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    logger.error('[MULTER_ERROR]', {
      code: err.code,
      field: err.field,
      message: err.message,
      userId: req.user?.id
    });

    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxSizeMB = (config.fileUpload.maxFileSize || 50 * 1024 * 1024) / (1024 * 1024);
      return res.status(413).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: `File size exceeds ${maxSizeMB}MB limit`
        }
      });
    }
    
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(413).json({
        success: false,
        error: {
          code: 'TOO_MANY_FILES',
          message: `Maximum ${config.fileUpload.maxBatchFiles || 5} files allowed in batch upload`
        }
      });
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UNEXPECTED_FILE',
          message: `Unexpected field: ${err.field}`
        }
      });
    }

    return res.status(400).json({
      success: false,
      error: {
        code: 'UPLOAD_ERROR',
        message: err.message
      }
    });
  }
  
  if (err && err.message && err.message.includes('File type not allowed')) {
    logger.warn('[FILE_TYPE_ERROR]', {
      message: err.message,
      userId: req.user?.id
    });

    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE_TYPE',
        message: err.message
      }
    });
  }
  
  next(err);
};

// CLEANER EXPORT PATTERN
module.exports = {
  single: upload.single.bind(upload),
  array: upload.array.bind(upload),
  fields: upload.fields.bind(upload),
  handleMulterError,
  upload // Export the instance itself if needed
};