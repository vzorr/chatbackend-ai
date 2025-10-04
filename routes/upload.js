const express = require('express');
const router = express.Router();
const path = require('path');
const { authenticate } = require('../middleware/authentication');
const { asyncHandler, createOperationalError } = require('../middleware/exceptionHandler');
const upload = require('../middleware/upload');
const logger = require('../utils/logger');

// Single image upload
router.post('/image',
  authenticate,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createOperationalError('No image file provided', 400, 'NO_FILE');
    }

    const fileUrl = `/uploads/images/${req.file.filename}`;
    
    logger.info('Image uploaded', {
      userId: req.user.id,
      filename: req.file.filename,
      size: req.file.size,
      url: fileUrl
    });

    res.status(201).json({
      success: true,
      file: {
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        type: 'image'
      }
    });
  })
);

// Single audio upload
router.post('/audio',
  authenticate,
  upload.single('audio'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createOperationalError('No audio file provided', 400, 'NO_FILE');
    }

    const fileUrl = `/uploads/audio/${req.file.filename}`;
    
    logger.info('Audio uploaded', {
      userId: req.user.id,
      filename: req.file.filename,
      size: req.file.size,
      url: fileUrl
    });

    res.status(201).json({
      success: true,
      file: {
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        type: 'audio'
      }
    });
  })
);

// Single document upload
router.post('/document',
  authenticate,
  upload.single('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createOperationalError('No document file provided', 400, 'NO_FILE');
    }

    const fileUrl = `/uploads/documents/${req.file.filename}`;
    
    logger.info('Document uploaded', {
      userId: req.user.id,
      filename: req.file.filename,
      size: req.file.size,
      url: fileUrl
    });

    res.status(201).json({
      success: true,
      file: {
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        type: 'document'
      }
    });
  })
);

// Batch upload (multiple files)
router.post('/batch',
  authenticate,
  upload.array('files', 5),
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      throw createOperationalError('No files provided', 400, 'NO_FILES');
    }

    const uploadedFiles = req.files.map(file => {
      const folder = file.destination.split('/').pop();
      return {
        url: `/uploads/${folder}/${file.filename}`,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        type: folder.slice(0, -1) // Remove 's' from folder name
      };
    });

    logger.info('Batch upload completed', {
      userId: req.user.id,
      fileCount: uploadedFiles.length,
      totalSize: req.files.reduce((sum, f) => sum + f.size, 0)
    });

    res.status(201).json({
      success: true,
      files: uploadedFiles,
      count: uploadedFiles.length
    });
  })
);

// Error handling for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'File size exceeds 10MB limit'
        }
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TOO_MANY_FILES',
          message: 'Maximum 5 files allowed in batch upload'
        }
      });
    }
  }
  
  if (error.message && error.message.includes('File type not allowed')) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE_TYPE',
        message: error.message
      }
    });
  }
  
  next(error);
});

module.exports = router;