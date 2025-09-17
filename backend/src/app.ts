import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';

// Route imports
import { authRoutes } from './auth/routes/authRoutes';
import { userRoutes } from './auth/routes/userRoutes';
import { tenantRoutes } from './auth/routes/tenantRoutes';
import { chatRoutes } from './chat/routes/chatRoutes';
import { ragChatRoutes } from './chat/routes/ragChatRoutes';
import { aiRoutes } from './ai/routes/aiRoutes';
import { knowledgeRoutes } from './knowledge/routes/knowledgeRoutes';
import { ragIntegrationRoutes } from './knowledge/routes/ragIntegrationRoutes';
import { fileRoutes } from './files/routes/fileRoutes';
import { workflowRoutes } from './workflows/routes/workflowRoutes';
import { executionRoutes } from './workflows/routes/executionRoutes';
import { templateRoutes } from './workflows/routes/templateRoutes';
import { webhookRoutes } from './workflows/routes/webhookRoutes';
import integrationsRoutes from './integrations/routes/integrationRoutes';

// WebSocket server
import { WebSocketServer } from './websocket/websocketServer';

// Middleware
import { errorHandler } from './common/middleware/errorHandler';
import { requestLogger } from './common/middleware/requestLogger';

const app = express();
const server = createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(server);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Request logging
app.use(requestLogger);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tenants', tenantRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/chat/rag', ragChatRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/knowledge/rag', ragIntegrationRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/executions', executionRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/integrations', integrationsRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket server initialized`);
  console.log(`🔗 API available at http://localhost:${PORT}`);
  console.log(`🏥 Health check at http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

export default app;
