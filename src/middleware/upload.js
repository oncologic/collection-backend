import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Create temp directory if it doesn't exist
const tempDir = './temp-uploads';
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Use disk storage for better memory management
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

// Memory storage only for small files (under 5MB)
const memoryStorage = multer.memoryStorage();

// Custom storage based on file size
const conditionalStorage = multer({
  storage: storage, // Default to disk storage
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/',
      'text/csv',
      'text/tab-separated-values',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // Add PowerPoint MIME types
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // Add video MIME types
      'video/mp4',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',
      'video/mpeg',
    ];

    const isAllowedFile = allowedMimeTypes.some((type) =>
      type.endsWith('/')
        ? file.mimetype.startsWith(type)
        : file.mimetype === type
    );

    if (isAllowedFile) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Please upload an image, video, CSV, TSV, PDF, PowerPoint, or Word file.'
        ),
        false
      );
    }
  },
});

// Memory-only storage for small files (legacy support)
const memoryUpload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit for memory storage
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/',
      'text/csv',
      'text/tab-separated-values',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ];

    const isAllowedFile = allowedMimeTypes.some((type) =>
      type.endsWith('/')
        ? file.mimetype.startsWith(type)
        : file.mimetype === type
    );

    if (isAllowedFile) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file type. Please upload an image, CSV, TSV, PDF, PowerPoint, or Word file.'
        ),
        false
      );
    }
  },
});

export default conditionalStorage;
export { memoryUpload };
