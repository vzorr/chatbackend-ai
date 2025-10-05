// services/fileUpload.js
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('../utils/logger');

// Create upload directory if it doesn't exist
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Initialize S3 client if credentials are available
let s3Client = null;
const useS3 = process.env.AWS_ACCESS_KEY_ID && 
             process.env.AWS_SECRET_ACCESS_KEY && 
             process.env.AWS_REGION && 
             process.env.S3_BUCKET_NAME;

if (useS3) {
  s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });
  
  logger.info('S3 client initialized for file uploads');
}

// Configure local storage
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueFilename = `${Date.now()}_${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueFilename);
  }
});

// Configure S3 storage
const s3Storage = useS3 ? multerS3({
  s3: s3Client,
  bucket: process.env.S3_BUCKET_NAME,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: (req, file, cb) => {
    const uniqueFilename = `${Date.now()}_${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueFilename);
  },
  metadata: (req, file, cb) => {
    cb(null, { originalName: file.originalname });
  }
}) : null;

// File filter for allowed file types
const fileFilter = (req, file, cb) => {
  // Define allowed file types
  const allowedFileTypes = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/gif': ['.gif'],
    'image/webp': ['.webp'],
    'audio/mpeg': ['.mp3'],
    'audio/wav': ['.wav'],
    'audio/ogg': ['.ogg'],
    'application/pdf': ['.pdf'],
    'application/msword': ['.doc'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    'application/vnd.ms-excel': ['.xls'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    'application/zip': ['.zip'],
    'text/plain': ['.txt'],
    'text/csv': ['.csv']
  };
  
  // Check if file type is allowed
  const fileExtension = path.extname(file.originalname).toLowerCase();
  const mimeTypeAllowed = Object.keys(allowedFileTypes).includes(file.mimetype);
  const extensionAllowed = mimeTypeAllowed && 
                          allowedFileTypes[file.mimetype].includes(fileExtension);
  
  if (mimeTypeAllowed && extensionAllowed) {
    return cb(null, true);
  }
  
  const error = new Error('File type not allowed');
  error.code = 'INVALID_FILE_TYPE';
  return cb(error);
};

// Create multer upload with size limits
const createUploadMiddleware = (options = {}) => {
  const storage = useS3 ? s3Storage : diskStorage;
  const limits = {
    fileSize: options.maxSize || 5 * 1024 * 1024, // 5MB default
    files: options.maxFiles || 10
  };
  
  return multer({
    storage,
    limits,
    fileFilter
  });
};

// Generate presigned URL for direct uploads
const getPresignedUrl = async (fileName, fileType, expiresIn = 300) => {
  if (!useS3) {
    throw new Error('S3 configuration not available');
  }
  
  const fileExtension = path.extname(fileName);
  const uniqueFilename = `${Date.now()}_${uuidv4()}${fileExtension}`;
  
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME,
    Key: uniqueFilename,
    ContentType: fileType
  });
  
  try {
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return {
      uploadUrl: url,
      fileKey: uniqueFilename,
      fileUrl: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueFilename}`
    };
  } catch (error) {
    logger.error(`Error generating presigned URL: ${error}`);
    throw error;
  }
};

// Get file URL based on storage type
const getFileUrl = (req, fileName) => {
  if (useS3) {
    return `https://${process.env.S3_BUCKET_NAME}.s3.amazonaws.com/${fileName}`;
  } else {
    return `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
  }
};

module.exports = {
  createUploadMiddleware,
  getPresignedUrl,
  getFileUrl,
  useS3,
  s3Client
};
