const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const { AppError } = require('../middleware/errorMiddleware');
const { verifyToken, requireAdminOrManager } = require('../middleware/authMiddleware');

const router = express.Router();

// All file routes require authentication
router.use(verifyToken);

// Ensure uploads directory exists
const ensureUploadDir = async () => {
  const uploadDir = process.env.UPLOAD_DIR || 'uploads';
  try {
    await fs.access(uploadDir);
  } catch (error) {
    await fs.mkdir(uploadDir, { recursive: true });
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await ensureUploadDir();
    cb(null, process.env.UPLOAD_DIR || 'uploads');
  },
  filename: (req, file, cb) => {
    // Generate unique filename with original extension
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'image/jpeg,image/png,image/gif,application/pdf').split(',');
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(`File type ${file.mimetype} is not allowed`, 400, 'INVALID_FILE_TYPE'), false);
  }
};

// Configure multer
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024, // 5MB default
    files: 1 // Only allow single file upload
  }
});

// POST /api/files/upload - Upload file (admin/manager only)
router.post('/upload', requireAdminOrManager, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400, 'NO_FILE_UPLOADED');
    }

    const fileInfo = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      url: `/uploads/${req.file.filename}`,
      uploadedBy: req.user.id,
      uploadedAt: new Date().toISOString()
    };

    res.status(201).json({
      success: true,
      message: 'File uploaded successfully',
      data: fileInfo
    });
  } catch (error) {
    // Clean up uploaded file if there was an error
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }
    next(error);
  }
});

// DELETE /api/files/:filename - Delete file (admin/manager only)
router.delete('/:filename', requireAdminOrManager, async (req, res, next) => {
  try {
    const { filename } = req.params;
    
    // Validate filename (security check)
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new AppError('Invalid filename', 400, 'INVALID_FILENAME');
    }

    const filePath = path.join(process.env.UPLOAD_DIR || 'uploads', filename);

    try {
      // Check if file exists
      await fs.access(filePath);
      
      // Delete file
      await fs.unlink(filePath);
      
      res.json({
        success: true,
        message: 'File deleted successfully'
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AppError('File not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/files/:filename - Get file info (admin/manager only)
router.get('/:filename', requireAdminOrManager, async (req, res, next) => {
  try {
    const { filename } = req.params;
    
    // Validate filename (security check)
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new AppError('Invalid filename', 400, 'INVALID_FILENAME');
    }

    const filePath = path.join(process.env.UPLOAD_DIR || 'uploads', filename);

    try {
      // Get file stats
      const stats = await fs.stat(filePath);
      
      const fileInfo = {
        filename,
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        url: `/uploads/${filename}`
      };

      res.json({
        success: true,
        data: fileInfo
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AppError('File not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/files/view/:filename - View file (public access for authenticated file viewing)
router.get('/view/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;

    // Validate filename (security check)
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new AppError('Invalid filename', 400, 'INVALID_FILENAME');
    }

    const filePath = path.join(process.env.UPLOAD_DIR || 'uploads', filename);

    try {
      // Check if file exists
      await fs.access(filePath);

      // Get file stats to determine content type
      const stats = await fs.stat(filePath);
      const ext = path.extname(filename).toLowerCase();

      // Set appropriate content type
      let contentType = 'application/octet-stream';
      switch (ext) {
        case '.pdf':
          contentType = 'application/pdf';
          break;
        case '.jpg':
        case '.jpeg':
          contentType = 'image/jpeg';
          break;
        case '.png':
          contentType = 'image/png';
          break;
        case '.gif':
          contentType = 'image/gif';
          break;
      }

      // Set headers for file serving
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

      // Headers to allow iframe embedding
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'self' http://localhost:8083");

      // CORS headers for cross-origin requests
      res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8083');
      res.setHeader('Access-Control-Allow-Credentials', 'true');

      // Stream the file
      const fileStream = require('fs').createReadStream(filePath);
      fileStream.pipe(res);

    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new AppError('File not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// GET /api/files - List uploaded files (admin/manager only)
router.get('/', requireAdminOrManager, async (req, res, next) => {
  try {
    const uploadDir = process.env.UPLOAD_DIR || 'uploads';

    try {
      const files = await fs.readdir(uploadDir);

      const fileInfos = await Promise.all(
        files.map(async (filename) => {
          try {
            const filePath = path.join(uploadDir, filename);
            const stats = await fs.stat(filePath);

            return {
              filename,
              size: stats.size,
              created: stats.birthtime,
              modified: stats.mtime,
              url: `/uploads/${filename}`
            };
          } catch (error) {
            return null; // Skip files that can't be read
          }
        })
      );

      // Filter out null entries
      const validFiles = fileInfos.filter(file => file !== null);

      res.json({
        success: true,
        data: validFiles,
        count: validFiles.length
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Upload directory doesn't exist yet
        res.json({
          success: true,
          data: [],
          count: 0
        });
      } else {
        throw error;
      }
    }
  } catch (error) {
    next(error);
  }
});

module.exports = router;
