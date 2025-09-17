import { Router } from 'express';
import integrationRoutes from './integrationRoutes';
import apiRoutes from './apiRoutes';

const router = Router();

// Mount integration routes
router.use('/integrations', integrationRoutes);
router.use('/api', apiRoutes);

export default router;
