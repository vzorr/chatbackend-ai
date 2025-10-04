const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure upload directories exist
const uploadDirs = ['uploads/images', 'uploads/audio', 'uploads/documents'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// File type validation
const fileFilter = (req, file, cb) => {
  const allowedImageTypes = /jpeg|jpg|png|gif|webp/;
  const allowedAudioTypes = /mp3|wav|ogg|m4a|aac/;
  const allowedDocTypes = /pdf|doc|docx|txt|zip|rar/;
  
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  const mimetype = file.mimetype;
  
  let isValid = false;
  
  if (allowedImageTypes.test(ext) && mimetype.startsWith('image/')) {
    isValid = true;
  } else if (allowedAudioTypes.test(ext) && mimetype.startsWith('audio/')) {
    isValid = true;
  } else if (allowedDocTypes.test(ext)) {
    isValid = true;
  }
  
  if (isValid) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${ext}`), false);
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
    }
    
    cb(null, folder);
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
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

module.exports = upload;