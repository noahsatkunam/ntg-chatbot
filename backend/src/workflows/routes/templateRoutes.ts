import { Router } from 'express';
import { TemplateController } from '../controllers/templateController';
import { authMiddleware } from '../../auth/middleware/authMiddleware';
import { tenantMiddleware } from '../../auth/middleware/tenantMiddleware';
import { validateRequest } from '../../common/middleware/validateRequest';
import { templateValidators } from '../validators/templateValidators';

const router = Router();
const templateController = new TemplateController();

// Apply authentication and tenant middleware to all routes
router.use(authMiddleware);
router.use(tenantMiddleware);

// Template Management Routes
router.get(
  '/',
  validateRequest(templateValidators.listTemplates),
  templateController.listTemplates.bind(templateController)
);

router.get(
  '/:templateId',
  validateRequest(templateValidators.getTemplate),
  templateController.getTemplate.bind(templateController)
);

router.post(
  '/',
  validateRequest(templateValidators.createTemplate),
  templateController.createTemplate.bind(templateController)
);

router.put(
  '/:templateId',
  validateRequest(templateValidators.updateTemplate),
  templateController.updateTemplate.bind(templateController)
);

router.delete(
  '/:templateId',
  validateRequest(templateValidators.deleteTemplate),
  templateController.deleteTemplate.bind(templateController)
);

// Template Usage Routes
router.post(
  '/:templateId/install',
  validateRequest(templateValidators.installTemplate),
  templateController.installTemplate.bind(templateController)
);

router.post(
  '/:templateId/create-workflow',
  validateRequest(templateValidators.createFromTemplate),
  templateController.createFromTemplate.bind(templateController)
);

// Template Discovery Routes
router.get(
  '/popular/list',
  templateController.getPopularTemplates.bind(templateController)
);

router.get(
  '/categories/overview',
  templateController.getTemplatesByCategory.bind(templateController)
);

router.get(
  '/categories',
  templateController.getCategories.bind(templateController)
);

// User Template Management
router.get(
  '/my/templates',
  templateController.getMyTemplates.bind(templateController)
);

router.get(
  '/favorites',
  templateController.getFavoriteTemplates.bind(templateController)
);

router.post(
  '/:templateId/favorite',
  validateRequest(templateValidators.toggleFavorite),
  templateController.toggleFavorite.bind(templateController)
);

router.post(
  '/:templateId/rate',
  validateRequest(templateValidators.rateTemplate),
  templateController.rateTemplate.bind(templateController)
);

// Template Analytics
router.get(
  '/:templateId/analytics',
  validateRequest(templateValidators.getTemplateAnalytics),
  templateController.getTemplateAnalytics.bind(templateController)
);

export { router as templateRoutes };
