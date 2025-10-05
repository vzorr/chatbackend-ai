const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');

class FileValidator {
  /**
   * Validate file type against allowed types
   * @param {Object} file - Multer file object
   * @param {Array} allowedExtensions - Allowed file extensions
   * @param {Array} allowedMimeTypes - Allowed MIME types
   * @returns {Object} Validation result
   */
  validateFileType(file, allowedExtensions = null, allowedMimeTypes = null) {
    const extension = path.extname(file.originalname).toLowerCase().slice(1);
    const mimeType = file.mimetype;

    // Use config if not provided
    const extensions = allowedExtensions || this.getAllAllowedExtensions();
    const mimeTypes = allowedMimeTypes || config.fileUpload.allowedMimeTypes;

    const isValidExtension = extensions.includes(extension);
    const isValidMimeType = mimeTypes.includes(mimeType);

    if (!isValidExtension || !isValidMimeType) {
      return {
        valid: false,
        error: `Invalid file type. Extension: ${extension}, MIME: ${mimeType}`
      };
    }

    return { valid: true };
  }

  /**
   * Validate file size
   * @param {number} fileSize - File size in bytes
   * @param {number} maxSize - Maximum allowed size
   * @returns {Object} Validation result
   */
  validateFileSize(fileSize, maxSize = null) {
    const limit = maxSize || config.fileUpload.maxFileSize;

    if (fileSize > limit) {
      return {
        valid: false,
        error: `File too large. Size: ${fileSize} bytes, Max: ${limit} bytes`
      };
    }

    return { valid: true };
  }

  /**
   * Validate file by category
   * @param {Object} file - Multer file object
   * @param {string} category - File category (image, audio, video, document)
   * @returns {Object} Validation result
   */
  validateByCategory(file, category) {
    const categoryValidators = {
      image: () => this.validateImage(file),
      audio: () => this.validateAudio(file),
      video: () => this.validateVideo(file),
      document: () => this.validateDocument(file)
    };

    const validator = categoryValidators[category];
    if (!validator) {
      return {
        valid: false,
        error: `Unknown category: ${category}`
      };
    }

    return validator();
  }

  /**
   * Validate image file
   * @param {Object} file - Multer file object
   * @returns {Object} Validation result
   */
  validateImage(file) {
    const allowedExtensions = config.fileUpload.allowedTypes.images;
    const allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp'
    ];

    const typeValidation = this.validateFileType(file, allowedExtensions, allowedMimeTypes);
    if (!typeValidation.valid) {
      return typeValidation;
    }

    return this.validateFileSize(file.size);
  }

  /**
   * Validate audio file
   * @param {Object} file - Multer file object
   * @returns {Object} Validation result
   */
  validateAudio(file) {
    const allowedExtensions = config.fileUpload.allowedTypes.audio;
    const allowedMimeTypes = [
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/mp4',
      'audio/aac',
      'audio/webm'
    ];

    const typeValidation = this.validateFileType(file, allowedExtensions, allowedMimeTypes);
    if (!typeValidation.valid) {
      return typeValidation;
    }

    return this.validateFileSize(file.size);
  }

  /**
   * Validate video file
   * @param {Object} file - Multer file object
   * @returns {Object} Validation result
   */
  validateVideo(file) {
    const allowedExtensions = ['mp4', 'mov', 'avi', 'webm'];
    const allowedMimeTypes = [
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm'
    ];

    const typeValidation = this.validateFileType(file, allowedExtensions, allowedMimeTypes);
    if (!typeValidation.valid) {
      return typeValidation;
    }

    return this.validateFileSize(file.size);
  }

  /**
   * Validate document file
   * @param {Object} file - Multer file object
   * @returns {Object} Validation result
   */
  validateDocument(file) {
    const allowedExtensions = config.fileUpload.allowedTypes.documents;
    const allowedMimeTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/zip',
      'application/x-rar-compressed'
    ];

    const typeValidation = this.validateFileType(file, allowedExtensions, allowedMimeTypes);
    if (!typeValidation.valid) {
      return typeValidation;
    }

    return this.validateFileSize(file.size);
  }

  /**
   * Get all allowed extensions from config
   * @returns {Array} Combined array of all allowed extensions
   */
  getAllAllowedExtensions() {
    const { images, audio, documents } = config.fileUpload.allowedTypes;
    const videoExtensions = ['mp4', 'mov', 'avi', 'webm'];
    
    return [
      ...images,
      ...audio,
      ...documents,
      ...videoExtensions
    ];
  }

  /**
   * Validate filename
   * @param {string} filename - Original filename
   * @returns {Object} Validation result
   */
  validateFileName(filename) {
    if (!filename || filename.trim().length === 0) {
      return {
        valid: false,
        error: 'Filename cannot be empty'
      };
    }

    if (filename.length > 500) {
      return {
        valid: false,
        error: 'Filename too long (max 500 characters)'
      };
    }

    // Check for malicious patterns
    const dangerousPatterns = [
      /\.\./,           // Directory traversal
      /[<>:"|?*]/,      // Invalid filename characters
      /^\.+$/,          // Only dots
      /\x00/            // Null bytes
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(filename)) {
        return {
          valid: false,
          error: 'Filename contains invalid characters'
        };
      }
    }

    return { valid: true };
  }

  /**
   * Middleware: Validate single file upload
   * @param {string} category - File category
   * @returns {Function} Express middleware
   */
  validateSingleFile(category) {
    return (req, res, next) => {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILE',
            message: 'No file provided'
          }
        });
      }

      const validation = this.validateByCategory(req.file, category);
      
      if (!validation.valid) {
        logger.warn('[FILE_VALIDATION] File validation failed', {
          userId: req.user?.id,
          error: validation.error,
          filename: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        });

        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_FILE',
            message: validation.error
          }
        });
      }

      logger.debug('[FILE_VALIDATION] File validated successfully', {
        userId: req.user?.id,
        filename: req.file.originalname,
        category
      });

      next();
    };
  }

  /**
   * Middleware: Validate multiple file uploads
   * @returns {Function} Express middleware
   */
  validateMultipleFiles() {
    return (req, res, next) => {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NO_FILES',
            message: 'No files provided'
          }
        });
      }

      const maxFiles = config.fileUpload.maxBatchFiles || 5;
      if (req.files.length > maxFiles) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'TOO_MANY_FILES',
            message: `Maximum ${maxFiles} files allowed`
          }
        });
      }

      // Validate each file
      for (const file of req.files) {
        const mimeType = file.mimetype;
        let category;

        if (mimeType.startsWith('image/')) category = 'image';
        else if (mimeType.startsWith('audio/')) category = 'audio';
        else if (mimeType.startsWith('video/')) category = 'video';
        else category = 'document';

        const validation = this.validateByCategory(file, category);
        
        if (!validation.valid) {
          logger.warn('[FILE_VALIDATION] Batch file validation failed', {
            userId: req.user?.id,
            error: validation.error,
            filename: file.originalname
          });

          return res.status(400).json({
            success: false,
            error: {
              code: 'INVALID_FILE',
              message: `File "${file.originalname}": ${validation.error}`
            }
          });
        }
      }

      logger.debug('[FILE_VALIDATION] Batch files validated successfully', {
        userId: req.user?.id,
        fileCount: req.files.length
      });

      next();
    };
  }
}

module.exports = new FileValidator();