const AWS = require('aws-sdk');
const config = require('../config/config');
const logger = require('../utils/logger');
const mime = require('mime-types');

class S3Service {
  constructor() {
    this.defaultBucket = config.fileUpload.s3.bucket;
    this.defaultRegion = config.fileUpload.s3.region || 'us-east-1';
    
    const s3Config = {
      accessKeyId: config.fileUpload.s3.accessKeyId,
      secretAccessKey: config.fileUpload.s3.secretAccessKey,
      region: this.defaultRegion,
      signatureVersion: 'v4'
    };

    // Support for S3-compatible services (MinIO, DigitalOcean Spaces, etc.)
    if (config.fileUpload.s3.endpoint) {
      s3Config.endpoint = config.fileUpload.s3.endpoint;
      s3Config.s3ForcePathStyle = config.fileUpload.s3.forcePathStyle || false;
    }

    this.s3 = new AWS.S3(s3Config);

    logger.info('S3 Service initialized', {
      bucket: this.defaultBucket,
      region: this.defaultRegion,
      endpoint: config.fileUpload.s3.endpoint || 'AWS S3'
    });
  }

  /**
   * Upload file to S3 with retry logic
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} s3Key - S3 object key/path
   * @param {Object} options - Upload options
   * @returns {Promise<Object>}
   */
  async uploadFile(fileBuffer, s3Key, options = {}) {
    const {
      contentType,
      metadata = {},
      bucket = this.defaultBucket,
      retries = 3
    } = options;

    const params = {
      Bucket: bucket,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType || this.getContentType(s3Key),
      Metadata: metadata
    };

    // Retry logic with exponential backoff
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this.s3.upload(params).promise();

        logger.info('File uploaded to S3', {
          bucket: params.Bucket,
          key: s3Key,
          size: fileBuffer.length,
          attempt
        });

        return {
          success: true,
          location: result.Location,
          etag: result.ETag,
          key: result.Key,
          bucket: params.Bucket
        };
      } catch (error) {
        logger.error(`S3 upload attempt ${attempt} failed`, {
          error: error.message,
          key: s3Key,
          attempt
        });

        if (attempt === retries) {
          throw error;
        }

        // Exponential backoff: 2s, 4s, 8s
        await this.sleep(Math.pow(2, attempt) * 1000);
      }
    }
  }

  /**
   * Generate presigned URL for download with original filename
   * @param {string} s3Key - S3 object key
   * @param {string} originalFileName - Original filename for download
   * @param {number} expirySeconds - URL expiry in seconds
   * @param {string} bucket - S3 bucket name
   * @returns {Promise<string>}
   */
  async getSignedDownloadUrl(s3Key, originalFileName, expirySeconds = 3600, bucket = this.defaultBucket) {
    try {
      const params = {
        Bucket: bucket,
        Key: s3Key,
        Expires: expirySeconds,
        ResponseContentDisposition: `attachment; filename="${encodeURIComponent(originalFileName)}"`
      };

      const signedUrl = await this.s3.getSignedUrlPromise('getObject', params);

      logger.debug('Generated presigned download URL', {
        key: s3Key,
        originalFileName,
        expirySeconds
      });

      return signedUrl;
    } catch (error) {
      logger.error('Error generating presigned URL', {
        error: error.message,
        key: s3Key
      });
      throw error;
    }
  }

  /**
   * Generate presigned URL for upload
   * @param {string} s3Key - S3 object key
   * @param {string} contentType - File MIME type
   * @param {number} expirySeconds - URL expiry in seconds
   * @param {string} bucket - S3 bucket name
   * @returns {Promise<string>}
   */
  async getSignedUploadUrl(s3Key, contentType, expirySeconds = 3600, bucket = this.defaultBucket) {
    try {
      const params = {
        Bucket: bucket,
        Key: s3Key,
        Expires: expirySeconds,
        ContentType: contentType
      };

      const signedUrl = await this.s3.getSignedUrlPromise('putObject', params);

      logger.debug('Generated presigned upload URL', {
        key: s3Key,
        contentType,
        expirySeconds
      });

      return signedUrl;
    } catch (error) {
      logger.error('Error generating presigned upload URL', {
        error: error.message,
        key: s3Key
      });
      throw error;
    }
  }

  /**
   * Delete file from S3
   * @param {string} s3Key - S3 object key
   * @param {string} bucket - S3 bucket name
   * @returns {Promise<Object>}
   */
  async deleteFile(s3Key, bucket = this.defaultBucket) {
    try {
      await this.s3.deleteObject({
        Bucket: bucket,
        Key: s3Key
      }).promise();

      logger.info('File deleted from S3', {
        bucket,
        key: s3Key
      });

      return { success: true };
    } catch (error) {
      logger.error('Error deleting file from S3', {
        error: error.message,
        key: s3Key
      });
      throw error;
    }
  }

  /**
   * Check if file exists in S3
   * @param {string} s3Key - S3 object key
   * @param {string} bucket - S3 bucket name
   * @returns {Promise<boolean>}
   */
  async fileExists(s3Key, bucket = this.defaultBucket) {
    try {
      await this.s3.headObject({
        Bucket: bucket,
        Key: s3Key
      }).promise();
      return true;
    } catch (error) {
      if (error.code === 'NotFound' || error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get file metadata from S3
   * @param {string} s3Key - S3 object key
   * @param {string} bucket - S3 bucket name
   * @returns {Promise<Object>}
   */
  async getFileMetadata(s3Key, bucket = this.defaultBucket) {
    try {
      const result = await this.s3.headObject({
        Bucket: bucket,
        Key: s3Key
      }).promise();

      return {
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        lastModified: result.LastModified,
        etag: result.ETag,
        metadata: result.Metadata
      };
    } catch (error) {
      logger.error('Error getting file metadata', {
        error: error.message,
        key: s3Key
      });
      throw error;
    }
  }

  /**
   * Get content type from file extension
   * @param {string} fileName - File name or path
   * @returns {string}
   */
  getContentType(fileName) {
    return mime.lookup(fileName) || 'application/octet-stream';
  }

  /**
   * Sleep utility for retry backoff
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new S3Service();