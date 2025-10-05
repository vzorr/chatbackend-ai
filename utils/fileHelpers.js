const path = require('path');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');

class FileHelpers {
  /**
   * Generate S3 key/path for file
   * @param {Object} options - Generation options
   * @returns {string} S3 key
   */
  generateS3Key(options) {
    const {
      userId,
      conversationId,
      fileCategory,
      originalName
    } = options;

    const timestamp = Date.now();
    const uuid = uuidv4();
    const extension = this.extractExtension(originalName);
    const fileName = `${timestamp}-${uuid}.${extension}`;

    // Different paths based on context
    if (conversationId) {
      // Message attachment
      return `message-attachments/${fileCategory}/${conversationId}/${fileName}`;
    } else {
      // Profile picture or user upload
      return `profile-pictures/${userId}/${fileName}`;
    }
  }

  /**
   * Extract file extension from filename
   * @param {string} fileName - Original filename
   * @returns {string} Extension without dot
   */
  extractExtension(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return ext.startsWith('.') ? ext.substring(1) : ext;
  }

  /**
   * Extract filename from S3 key
   * @param {string} s3Key - S3 object key
   * @returns {string} Filename
   */
  extractFileName(s3Key) {
    return path.basename(s3Key);
  }

  /**
   * Detect file category from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} Category
   */
  detectFileCategory(mimeType) {
    if (!mimeType) return 'document';

    if (mimeType.startsWith('image/')) {
      return 'image';
    } else if (mimeType.startsWith('audio/')) {
      return 'audio';
    } else if (mimeType.startsWith('video/')) {
      return 'video';
    } else {
      return 'document';
    }
  }

  /**
   * Get MIME type from extension
   * @param {string} extension - File extension
   * @returns {string} MIME type
   */
  getMimeType(extension) {
    return mime.lookup(extension) || 'application/octet-stream';
  }

  /**
   * Validate file size
   * @param {number} size - File size in bytes
   * @param {number} maxSize - Max size in bytes
   * @returns {boolean}
   */
  isValidSize(size, maxSize) {
    return size > 0 && size <= maxSize;
  }

  /**
   * Format file size for display
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Sanitize filename for safe storage
   * @param {string} fileName - Original filename
   * @returns {string} Sanitized filename
   */
  sanitizeFileName(fileName) {
    return fileName
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .substring(0, 255);
  }

  /**
   * Build Content-Disposition header
   * @param {string} originalName - Original filename
   * @returns {string} Header value
   */
  buildContentDisposition(originalName) {
    const sanitized = this.sanitizeFileName(originalName);
    return `attachment; filename="${encodeURIComponent(sanitized)}"`;
  }
}

module.exports = new FileHelpers();