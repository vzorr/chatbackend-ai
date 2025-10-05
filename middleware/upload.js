const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure upload directories exist (including videos)
const uploadDirs = [
  'uploads/images', 
  'uploads/audio', 
  'uploads/videos',  // ADDED
  'uploads/documents',
  'uploads/files'    // ADDED for generic files
];

uploadDirs.forEach(dir => {
  const fullPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
    console.log(`[UPLOAD] Created directory: ${dir}`);
  }
});

// File type validation
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

// Storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const mimetype = file.mimetype;
    let folder = 'uploads/documents';
    
    if (mimetype.startsWith('image/')) {
      folder = 'uploads/images';
    } else if (mimetype.startsWith('audio/')) {
      folder = 'uploads/audio';
    } else if (mimetype.startsWith('video/')) {
      folder = 'uploads/videos';
    } else {
      folder = 'uploads/documents';
    }
    
    const fullPath = path.join(process.cwd(), folder);
    cb(null, fullPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// Multer instance with limits
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB (increased from 10MB)
  }
});

module.exports = upload;