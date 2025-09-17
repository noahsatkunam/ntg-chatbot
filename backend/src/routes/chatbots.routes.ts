import { Router } from 'express';
import { multiTenantMiddleware } from '../tenant/middleware/tenantMiddleware';

const router = Router();

// Apply tenant middleware to ALL chatbot routes
router.use(multiTenantMiddleware);

// Placeholder for chatbot routes
router.get('/', (_req, res) => {
  res.json({ message: 'Chatbot routes not implemented yet' });
});

export default router;
