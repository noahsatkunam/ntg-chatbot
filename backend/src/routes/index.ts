import { Router } from 'express';
import authRoutes from '../auth/routes/authRoutes';
import tenantRoutes from '../tenant/routes/tenantRoutes';
import chatbotRoutes from './chatbots.routes';
import conversationRoutes from './conversations.routes';

const router = Router();

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
router.use('/auth', authRoutes);
router.use('/tenants', tenantRoutes);
router.use('/chatbots', chatbotRoutes);
router.use('/conversations', conversationRoutes);

export default router;
