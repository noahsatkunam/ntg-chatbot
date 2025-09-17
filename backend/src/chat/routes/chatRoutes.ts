import { Router } from 'express';
import { chatController } from '../controllers/chatController';
import { authenticate } from '../../auth/middleware/authMiddleware';
import { validateRequest } from '../../middlewares/validation.middleware';
import { chatValidators } from '../validators/chatValidators';
import { multiTenantMiddleware } from '../../tenant/middleware/tenantMiddleware';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueFilename = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueFilename);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Allowed file types
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'video/mp4',
      'video/webm',
      'audio/mpeg',
      'audio/wav',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  },
});

// Apply authentication and multi-tenant middleware to all routes
router.use(authenticate);
router.use(multiTenantMiddleware);

// Conversation routes
router.post(
  '/conversations',
  validateRequest(chatValidators.createConversation),
  chatController.createConversation
);

router.get(
  '/conversations',
  chatController.getConversations
);

router.get(
  '/conversations/:conversationId',
  chatController.getConversation
);

// Message routes
router.get(
  '/conversations/:conversationId/messages',
  validateRequest(chatValidators.getMessages, 'query'),
  chatController.getMessages
);

router.post(
  '/conversations/:conversationId/messages',
  validateRequest(chatValidators.sendMessage),
  chatController.sendMessage
);

router.get(
  '/conversations/:conversationId/messages/search',
  validateRequest(chatValidators.searchMessages, 'query'),
  chatController.searchMessages
);

router.put(
  '/conversations/:conversationId/messages/read',
  validateRequest(chatValidators.markAsRead),
  chatController.markAsRead
);

router.delete(
  '/messages/:messageId',
  chatController.deleteMessage
);

// File upload route
router.post(
  '/upload',
  upload.array('files', 5), // Max 5 files at once
  chatController.uploadFiles
);

// WebSocket connection info route (for frontend)
router.get('/ws-info', (req, res) => {
  const protocol = req.protocol === 'https' ? 'wss' : 'ws';
  const host = req.get('host');
  
  res.json({
    success: true,
    data: {
      url: `${protocol}://${host}/ws`,
      transports: ['websocket', 'polling'],
    },
  });
});

export default router;
