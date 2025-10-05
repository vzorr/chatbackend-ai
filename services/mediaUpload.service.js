const { v4: uuidv4 } = require('uuid');
const s3Service = require('./s3.service');
const fileHelpers = require('../utils/fileHelpers');
const logger = require('../utils/logger');
const config = require('../config/config');
const db = require('../db/models');

class MediaUploadService {
  /**
   * Upload single file to S3 and create media record
   * @param {Object} user - Authenticated user
   * @param {Object} file - Multer file object
   * @param {Object} context - Upload context (conversationId, messageId, etc.)
   * @returns {Promise<Object>}
   */
  async uploadFile(user, file, context = {}) {
    const uploadId = uuidv4();
    
    try {
      logger.info('[MEDIA_UPLOAD] Starting file upload', {
        uploadId,
        userId: user.id,
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype
      });

      // Detect file category
      const fileCategory = context.fileCategory || fileHelpers.detectFileCategory(file.mimetype);

      // Generate S3 key
      const s3Key = fileHelpers.generateS3Key({
        userId: user.id,
        conversationId: context.conversationId,
        fileCategory,
        originalName: file.originalname
      });

      // Generate unique filename
      const fileName = fileHelpers.extractFileName(s3Key);

      // Upload to S3
      const s3Result = await s3Service.uploadFile(
        file.buffer,
        s3Key,
        {
          contentType: file.mimetype,
          metadata: {
            originalName: file.originalname,
            uploadedBy: user.id,
            uploadId
          }
        }
      );

      // Create media record
      const Media = db.Media;
      const media = await Media.create({
        id: uuidv4(),
        userId: user.id,
        conversationId: context.conversationId || null,
        messageId: context.messageId || null,
        fileName,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileCategory,
        s3Key,
        s3Bucket: config.fileUpload.s3.bucket,
        s3Region: config.fileUpload.s3.region,
        uploadStatus: 'completed',
        uploadedBy: user.id
      });

      logger.info('[MEDIA_UPLOAD] Upload completed successfully', {
        uploadId,
        mediaId: media.id,
        s3Key,
        size: file.size
      });

      return {
        success: true,
        media: media.toPublicJSON()
      };

    } catch (error) {
      logger.error('[MEDIA_UPLOAD] Upload failed', {
        uploadId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Upload multiple files
   * @param {Object} user - Authenticated user
   * @param {Array} files - Array of multer file objects
   * @param {Object} context - Upload context
   * @returns {Promise<Object>}
   */
  async uploadMultipleFiles(user, files, context = {}) {
    const batchId = uuidv4();

    try {
      logger.info('[MEDIA_BATCH_UPLOAD] Starting batch upload', {
        batchId,
        userId: user.id,
        fileCount: files.length
      });

      const uploadPromises = files.map(file => 
        this.uploadFile(user, file, context)
      );

      const results = await Promise.allSettled(uploadPromises);

      const successful = results
        .filter(r => r.status === 'fulfilled')
        .map(r => r.value.media);

      const failed = results
        .filter(r => r.status === 'rejected')
        .map(r => ({ error: r.reason.message }));

      logger.info('[MEDIA_BATCH_UPLOAD] Batch upload completed', {
        batchId,
        total: files.length,
        successful: successful.length,
        failed: failed.length
      });

      return {
        success: true,
        media: successful,
        count: successful.length,
        failed: failed.length > 0 ? failed : undefined
      };

    } catch (error) {
      logger.error('[MEDIA_BATCH_UPLOAD] Batch upload failed', {
        batchId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get media by ID
   * @param {string} mediaId - Media ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>}
   */
  async getMedia(mediaId, userId) {
    try {
      const Media = db.Media;
      const media = await Media.findOne({
        where: {
          id: mediaId,
          deletedAt: null
        }
      });

      if (!media) {
        throw new Error('Media not found');
      }

      // Authorization check
      if (media.userId !== userId && media.uploadedBy !== userId) {
        // Check if user is in the conversation
        if (media.conversationId) {
          const ConversationParticipant = db.ConversationParticipant;
          const participant = await ConversationParticipant.findOne({
            where: {
              conversationId: media.conversationId,
              userId
            }
          });

          if (!participant) {
            throw new Error('Not authorized to access this media');
          }
        } else {
          throw new Error('Not authorized to access this media');
        }
      }

      return media;
    } catch (error) {
      logger.error('[GET_MEDIA] Error retrieving media', {
        mediaId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Delete media (soft delete)
   * @param {string} mediaId - Media ID
   * @param {string} userId - User ID
   * @returns {Promise<Object>}
   */
  async deleteMedia(mediaId, userId) {
    try {
      const media = await this.getMedia(mediaId, userId);

      // Only uploader can delete
      if (media.uploadedBy !== userId) {
        throw new Error('Only the uploader can delete this media');
      }

      // Soft delete
      await media.softDelete();

      // Optionally delete from S3 (uncomment if you want hard delete)
      // await s3Service.deleteFile(media.s3Key, media.s3Bucket);

      logger.info('[DELETE_MEDIA] Media deleted', {
        mediaId,
        userId
      });

      return { success: true };
    } catch (error) {
      logger.error('[DELETE_MEDIA] Error deleting media', {
        mediaId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get presigned download URL
   * @param {string} mediaId - Media ID
   * @param {string} userId - User ID
   * @param {number} expirySeconds - URL expiry
   * @returns {Promise<string>}
   */
  async getDownloadUrl(mediaId, userId, expirySeconds = 3600) {
    try {
      const media = await this.getMedia(mediaId, userId);

      const downloadUrl = await s3Service.getSignedDownloadUrl(
        media.s3Key,
        media.originalName,
        expirySeconds,
        media.s3Bucket
      );

      logger.info('[DOWNLOAD_URL] Generated download URL', {
        mediaId,
        originalName: media.originalName
      });

      return downloadUrl;
    } catch (error) {
      logger.error('[DOWNLOAD_URL] Error generating download URL', {
        mediaId,
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new MediaUploadService();