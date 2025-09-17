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
import { createServer } from 'http';
import { initializeLocalDevelopment, isLocalDevelopment } from './config/localDevelopment.js';
import path from 'path';
import healthRoutes from './routes/health';

// Load environment variables
dotenv.config();

// Initialize Prisma
const prisma = new PrismaClient();

const app = express();
const httpServer = createServer(app);

const PORT = process.env.PORT || 3001;

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
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  dnsPrefetchControl: true,
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: false,
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: false,
  referrerPolicy: { policy: "no-referrer" },
  xssFilter: true,
}));

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  optionsSuccessStatus: 200,
}));

// Cookie parser
app.use(cookieParser());

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

// Health routes only
app.use('/api', healthRoutes);

// Basic API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'NTG Chatbot Backend',
    version: '1.0.0',
    status: 'running',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

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
    prisma.$disconnect();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    logger.info('HTTP server closed');
    prisma.$disconnect();
    process.exit(0);
  });
});

// Initialize services
async function startServer() {
  try {
    // Initialize local development if needed
    if (isLocalDevelopment()) {
      initializeLocalDevelopment();
      logger.info('Local development environment initialized');
    }

    // Test database connection
    await prisma.$queryRaw`SELECT 1`;
    logger.info('Database connection successful');

    // Initialize Redis (or mock service) only if not in local dev
    if (!isLocalDevelopment()) {
      await initializeRedis();
      logger.info('Redis initialized');
    } else {
      logger.info('Using mock Redis for local development');
    }

    // Start server
    httpServer.listen(PORT, () => {
      logger.info(`🚀 Server is running on port ${PORT} in ${process.env.NODE_ENV} mode`);
      if (isLocalDevelopment()) {
        logger.info('🔧 Running in local development mode with mock services');
      }
      logger.info(`📍 Health check: http://localhost:${PORT}/api/health`);
      logger.info(`📍 API info: http://localhost:${PORT}/api`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

startServer();
