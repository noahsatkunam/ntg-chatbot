import { Router } from 'express';
import { AdvancedMessageController } from '../controllers/advancedMessageController';
import { authMiddleware } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { validateRequest } from '../../middleware/validation';
import {
  reactionValidation,
  replyMessageValidation,
  editMessageValidation,
  bulkOperationsValidation,
  exportConversationValidation,
  messageIdValidation,
  conversationIdValidation,
} from '../validators/advancedMessageValidators';

const router = Router();
const advancedMessageController = new AdvancedMessageController();

// Apply middleware to all routes
router.use(authMiddleware);
router.use(tenantMiddleware);

// Message reaction routes
router.post(
  '/:messageId/react',
  validateRequest(messageIdValidation, 'params'),
  validateRequest(reactionValidation),
  advancedMessageController.addReaction
);

router.delete(
  '/:messageId/react',
  validateRequest(messageIdValidation, 'params'),
  validateRequest(reactionValidation),
  advancedMessageController.removeReaction
);

// Message reply routes
router.post(
  '/:messageId/reply',
  validateRequest(messageIdValidation, 'params'),
  validateRequest(replyMessageValidation),
  advancedMessageController.replyToMessage
);

router.get(
  '/:messageId/thread',
  validateRequest(messageIdValidation, 'params'),
  advancedMessageController.getMessageThread
);

// Message editing
router.put(
  '/:messageId/edit',
  validateRequest(messageIdValidation, 'params'),
  validateRequest(editMessageValidation),
  advancedMessageController.editMessage
);

// Bulk operations
router.post(
  '/bulk',
  validateRequest(bulkOperationsValidation),
  advancedMessageController.bulkOperations
);

// Conversation export
router.get(
  '/conversations/:conversationId/export',
  validateRequest(conversationIdValidation, 'params'),
  validateRequest(exportConversationValidation, 'query'),
  advancedMessageController.exportConversation
);

export default router;
