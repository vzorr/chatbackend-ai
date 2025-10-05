const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/authentication');
const { asyncHandler, createOperationalError } = require('../middleware/exceptionHandler');
const { single, array, handleMulterError } = require('../middleware/upload');
const fileValidator = require('../middleware/fileValidator');
const mediaUploadService = require('../services/mediaUpload.service');
const logger = require('../utils/logger');

// Single image upload
router.post('/image',
  authenticate,
  single('image'),
  fileValidator.validateSingleFile('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createOperationalError('No image file provided', 400, 'NO_FILE');
    }

    const result = await mediaUploadService.uploadFile(
      req.user,
      req.file,
      {
        fileCategory: 'image',
        conversationId: req.body.conversationId,
        messageId: req.body.messageId
      }
    );

    logger.info('Image uploaded to S3', {
      userId: req.user.id,
      mediaId: result.media.id,
      originalName: req.file.originalname,
      size: req.file.size
    });

    res.status(201).json({
      success: true,
      file: {
        id: result.media.id,
        url: result.media.url,
        fileName: result.media.fileName,
        originalName: result.media.originalName,
        size: result.media.fileSize,
        mimeType: result.media.mimeType,
        type: 'image'
      }
    });
  })
);

// Single video upload
router.post('/video',
  authenticate,
  single('video'),
  fileValidator.validateSingleFile('video'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createOperationalError('No video file provided', 400, 'NO_FILE');
    }

    const result = await mediaUploadService.uploadFile(
      req.user,
      req.file,
      {
        fileCategory: 'video',
        conversationId: req.body.conversationId,
        messageId: req.body.messageId
      }
    );

    logger.info('Video uploaded to S3', {
      userId: req.user.id,
      mediaId: result.media.id,
      originalName: req.file.originalname,
      size: req.file.size
    });

    res.status(201).json({
      success: true,
      file: {
        id: result.media.id,
        url: result.media.url,
        fileName: result.media.fileName,
        originalName: result.media.originalName,
        size: result.media.fileSize,
        mimeType: result.media.mimeType,
        type: 'video'
      }
    });
  })
);

// Single audio upload
router.post('/audio',
  authenticate,
  single('audio'),
  fileValidator.validateSingleFile('audio'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createOperationalError('No audio file provided', 400, 'NO_FILE');
    }

    const result = await mediaUploadService.uploadFile(
      req.user,
      req.file,
      {
        fileCategory: 'audio',
        conversationId: req.body.conversationId,
        messageId: req.body.messageId
      }
    );

    logger.info('Audio uploaded to S3', {
      userId: req.user.id,
      mediaId: result.media.id,
      originalName: req.file.originalname,
      size: req.file.size
    });

    res.status(201).json({
      success: true,
      file: {
        id: result.media.id,
        url: result.media.url,
        fileName: result.media.fileName,
        originalName: result.media.originalName,
        size: result.media.fileSize,
        mimeType: result.media.mimeType,
        type: 'audio'
      }
    });
  })
);

// Single document upload
router.post('/document',
  authenticate,
  single('document'),
  fileValidator.validateSingleFile('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createOperationalError('No document file provided', 400, 'NO_FILE');
    }

    const result = await mediaUploadService.uploadFile(
      req.user,
      req.file,
      {
        fileCategory: 'document',
        conversationId: req.body.conversationId,
        messageId: req.body.messageId
      }
    );

    logger.info('Document uploaded to S3', {
      userId: req.user.id,
      mediaId: result.media.id,
      originalName: req.file.originalname,
      size: req.file.size
    });

    res.status(201).json({
      success: true,
      file: {
        id: result.media.id,
        url: result.media.url,
        fileName: result.media.fileName,
        originalName: result.media.originalName,
        size: result.media.fileSize,
        mimeType: result.media.mimeType,
        type: 'document'
      }
    });
  })
);

// Generic file upload (fallback)
router.post('/file',
  authenticate,
  single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createOperationalError('No file provided', 400, 'NO_FILE');
    }

    // Auto-detect category
    const mimeType = req.file.mimetype;
    let category = 'document';
    
    if (mimeType.startsWith('image/')) category = 'image';
    else if (mimeType.startsWith('audio/')) category = 'audio';
    else if (mimeType.startsWith('video/')) category = 'video';

    const result = await mediaUploadService.uploadFile(
      req.user,
      req.file,
      {
        fileCategory: category,
        conversationId: req.body.conversationId,
        messageId: req.body.messageId
      }
    );

    logger.info('File uploaded to S3', {
      userId: req.user.id,
      mediaId: result.media.id,
      originalName: req.file.originalname,
      size: req.file.size,
      category
    });

    res.status(201).json({
      success: true,
      file: {
        id: result.media.id,
        url: result.media.url,
        fileName: result.media.fileName,
        originalName: result.media.originalName,
        size: result.media.fileSize,
        mimeType: result.media.mimeType,
        type: category
      }
    });
  })
);

// Batch upload (multiple files)
router.post('/batch',
  authenticate,
  array('files', 5),
  fileValidator.validateMultipleFiles(),
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      throw createOperationalError('No files provided', 400, 'NO_FILES');
    }

    const result = await mediaUploadService.uploadMultipleFiles(
      req.user,
      req.files,
      {
        conversationId: req.body.conversationId,
        messageId: req.body.messageId
      }
    );

    logger.info('Batch upload completed', {
      userId: req.user.id,
      fileCount: result.media.length,
      totalSize: req.files.reduce((sum, f) => sum + f.size, 0)
    });

    const uploadedFiles = result.media.map(media => ({
      id: media.id,
      url: media.url,
      fileName: media.fileName,
      originalName: media.originalName,
      size: media.fileSize,
      mimeType: media.mimeType,
      type: media.fileCategory
    }));

    res.status(201).json({
      success: true,
      files: uploadedFiles,
      count: uploadedFiles.length
    });
  })
);

// Get presigned download URL
router.get('/download/:mediaId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { mediaId } = req.params;
    const { expirySeconds = 3600 } = req.query;

    const downloadUrl = await mediaUploadService.getDownloadUrl(
      mediaId,
      req.user.id,
      parseInt(expirySeconds)
    );

    res.json({
      success: true,
      downloadUrl,
      expiresIn: parseInt(expirySeconds)
    });
  })
);

// Get media metadata
router.get('/media/:mediaId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { mediaId } = req.params;

    const media = await mediaUploadService.getMedia(mediaId, req.user.id);

    res.json({
      success: true,
      media: {
        id: media.id,
        fileName: media.fileName,
        originalName: media.originalName,
        mimeType: media.mimeType,
        fileSize: media.fileSize,
        fileCategory: media.fileCategory,
        uploadStatus: media.uploadStatus,
        createdAt: media.createdAt
      }
    });
  })
);

// Delete media (soft delete)
router.delete('/:mediaId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { mediaId } = req.params;

    await mediaUploadService.deleteMedia(mediaId, req.user.id);

    logger.info('Media deleted', {
      userId: req.user.id,
      mediaId
    });

    res.json({
      success: true,
      message: 'Media deleted successfully'
    });
  })
);

// Get conversation media
router.get('/conversation/:conversationId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { conversationId } = req.params;
    const { category, limit = 50, offset = 0 } = req.query;

    const db = require('../db/models');
    const { Media, ConversationParticipant } = db;

    // Verify user is participant
    const participant = await ConversationParticipant.findOne({
      where: {
        conversationId,
        userId: req.user.id
      }
    });

    if (!participant) {
      throw createOperationalError('Not a participant in this conversation', 403, 'NOT_PARTICIPANT');
    }

    const where = {
      conversationId,
      deletedAt: null
    };

    if (category) {
      where.fileCategory = category;
    }

    const media = await Media.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      media: media.map(m => ({
        id: m.id,
        fileName: m.fileName,
        originalName: m.originalName,
        mimeType: m.mimeType,
        fileSize: m.fileSize,
        fileCategory: m.fileCategory,
        createdAt: m.createdAt
      })),
      count: media.length
    });
  })
);

// Get user's uploads
router.get('/user/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const { category, limit = 50, offset = 0 } = req.query;

    const db = require('../db/models');
    const { Media } = db;

    const where = {
      userId: req.user.id,
      deletedAt: null
    };

    if (category) {
      where.fileCategory = category;
    }

    const media = await Media.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.json({
      success: true,
      media: media.map(m => ({
        id: m.id,
        fileName: m.fileName,
        originalName: m.originalName,
        mimeType: m.mimeType,
        fileSize: m.fileSize,
        fileCategory: m.fileCategory,
        createdAt: m.createdAt
      })),
      count: media.length
    });
  })
);

// Error handling for multer
router.use(handleMulterError);

module.exports = router;