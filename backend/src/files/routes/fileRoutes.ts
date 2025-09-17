import { Router } from 'express';
import multer from 'multer';
import { FileController } from '../controllers/fileController';
import { authMiddleware } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { validateRequest } from '../../middleware/validation';
import {
  fileUploadValidation,
  thumbnailValidation,
  fileQueryValidation,
  fileIdValidation,
  conversationIdValidation,
} from '../validators/fileValidators';

const router = Router();
const fileController = new FileController();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max file size
    files: 10, // Max 10 files per upload
  },
});

// Apply middleware to all routes
router.use(authMiddleware);
router.use(tenantMiddleware);

// File upload routes
router.post(
  '/upload',
  upload.array('files', 10),
  validateRequest(fileUploadValidation),
  fileController.uploadFiles
);

// File management routes
router.get(
  '/:fileId',
  validateRequest(fileIdValidation, 'params'),
  fileController.getFile
);

router.delete(
  '/:fileId',
  validateRequest(fileIdValidation, 'params'),
  fileController.deleteFile
);

// File serving route (public access with auth)
router.get(
  '/serve/:filePath',
  fileController.serveFile
);

// Conversation files
router.get(
  '/conversation/:conversationId',
  validateRequest(conversationIdValidation, 'params'),
  validateRequest(fileQueryValidation, 'query'),
  fileController.getConversationFiles
);

// Thumbnail generation
router.post(
  '/:fileId/thumbnail',
  validateRequest(fileIdValidation, 'params'),
  validateRequest(thumbnailValidation),
  fileController.generateThumbnail
);

// Upload progress (for large files)
router.get(
  '/upload/:uploadId/progress',
  fileController.getUploadProgress
);

// Storage usage
router.get(
  '/usage/storage',
  fileController.getStorageUsage
);

export default router;
