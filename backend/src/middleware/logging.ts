import { Request, Response, NextFunction } from 'express';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

// Configure Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ntg-chatbot-api' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Request logging middleware
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const requestId = uuidv4();
  const startTime = Date.now();

  // Add request ID to request object
  (req as any).requestId = requestId;

  // Log request start
  logger.info('Request started', {
    requestId,
    method: req.method,
    url: req.url,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
    userId: (req as any).user?.id
  });

  // Override res.json to log response
  const originalJson = res.json;
  res.json = function(body: any) {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userId: (req as any).user?.id
    });

    return originalJson.call(this, body);
  };

  next();
};

// Error logging middleware
export const errorLogger = (error: Error, req: Request, _res: Response, next: NextFunction) => {
  const requestId = (req as any).requestId;

  logger.error('Request error', {
    requestId,
    method: req.method,
    url: req.url,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack
    },
    userId: (req as any).user?.id
  });

  next(error);
};

// Security event logger
export const logSecurityEvent = (event: string, details: any, req?: Request) => {
  logger.warn('Security event', {
    event,
    details,
    requestId: req ? (req as any).requestId : undefined,
    ip: req?.ip,
    userAgent: req?.get('User-Agent'),
    userId: req ? (req as any).user?.id : undefined,
    timestamp: new Date().toISOString()
  });
};

// Performance logger
export const logPerformance = (operation: string, duration: number, metadata?: any) => {
  logger.info('Performance metric', {
    operation,
    duration,
    metadata,
    timestamp: new Date().toISOString()
  });
};

// Business event logger
export const logBusinessEvent = (event: string, data: any, userId?: string) => {
  logger.info('Business event', {
    event,
    data,
    userId,
    timestamp: new Date().toISOString()
  });
};

export { logger };
export default logger;
