import { Router } from 'express';
import { multiTenantMiddleware } from '../tenant/middleware/tenantMiddleware';

const router = Router();

// Apply tenant middleware to ALL conversation routes
router.use(multiTenantMiddleware);

// Placeholder for conversation routes
router.get('/', (_req, res) => {
  res.json({ message: 'Conversation routes not implemented yet' });
});

export default router;
