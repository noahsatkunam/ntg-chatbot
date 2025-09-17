import { Router } from 'express';
import { SearchController } from '../controllers/searchController';
import { authMiddleware } from '../../middleware/auth';
import { tenantMiddleware } from '../../middleware/tenant';
import { validateRequest } from '../../middleware/validation';
import {
  messageSearchValidation,
  conversationSearchValidation,
  searchSuggestionsValidation,
  messageIdValidation,
} from '../validators/searchValidators';

const router = Router();
const searchController = new SearchController();

// Apply middleware to all routes
router.use(authMiddleware);
router.use(tenantMiddleware);

// Search routes
router.get(
  '/messages',
  validateRequest(messageSearchValidation, 'query'),
  searchController.searchMessages
);

router.get(
  '/conversations',
  validateRequest(conversationSearchValidation, 'query'),
  searchController.searchConversations
);

router.get(
  '/suggestions',
  validateRequest(searchSuggestionsValidation, 'query'),
  searchController.getSearchSuggestions
);

// Indexing routes
router.post(
  '/reindex',
  searchController.reindexContent
);

router.post(
  '/index/:messageId',
  validateRequest(messageIdValidation, 'params'),
  searchController.indexMessage
);

export default router;
