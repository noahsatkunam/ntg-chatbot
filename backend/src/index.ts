import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { pinoHttp } from 'pino-http';
import { errorHandler } from './middlewares/errorHandler';
import { rateLimiter } from './middlewares/rateLimiter';
import { securityHeaders } from './middlewares/security';
import { logger } from './utils/logger';
import { PrismaClient } from '@prisma/client';
import { initializeRedis } from './utils/redis';
import { startCSRFCleanup } from './middlewares/csrf';
import { createServer } from 'http';
import { WebSocketServer } from './websocket/websocketServer';
import path from 'path';
import authRoutes from './auth/routes/authRoutes';
import chatRoutes from './chat/routes/chatRoutes';
import conversationsRoutes from './routes/conversations.routes';
import aiRoutes from './ai/routes/aiRoutes';
import fileRoutes from './files/routes/fileRoutes';
import searchRoutes from './search/routes/searchRoutes';
import advancedMessageRoutes from './chat/routes/advancedMessageRoutes';
import knowledgeRoutes from './knowledge/routes/knowledgeRoutes';
import ragRoutes from './knowledge/routes/ragRoutes';

// Load environment variables
dotenv.config();

// Initialize Prisma
const prisma = new PrismaClient();

const app = express();
const httpServer = createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(httpServer);

const PORT = process.env.PORT || 5000;

// Security middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: true,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: false,
  referrerPolicy: { policy: "no-referrer" },
  xssFilter: true,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200,
}));

// Cookie parser
app.use(cookieParser(process.env.COOKIE_SECRET));

// Additional security headers
app.use(securityHeaders);

// Rate limiting
app.use('/api/', rateLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression middleware
app.use(compression());

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Logging
app.use(pinoHttp({ logger }));

// Health check
app.get('/health', async (_req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      services: {
        api: 'healthy',
        websocket: 'healthy',
        database: 'healthy',
      }
    });
  } catch (error) {
    res.status(503).json({ 
      status: 'error', 
      timestamp: new Date().toISOString(),
      message: 'Service unavailable',
    });
  }
});

// Register routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
// WebSocket routes are handled by the WebSocket server, not Express routes
app.use('/api/ai', aiRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/messages', advancedMessageRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/rag', ragRoutes);
app.use('/api/conversations', conversationsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Error handling
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    wsServer.stop();
    prisma.$disconnect();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    wsServer.stop();
    prisma.$disconnect();
    process.exit(0);
  });
});

// Initialize services
async function startServer() {
  try {
    // Initialize Redis
    await initializeRedis();
    logger.info('Redis initialized');

    // Start CSRF token cleanup
    startCSRFCleanup();

    // Start server
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

startServer();
