import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (error instanceof AppError) {
    logger.error({
      error: error.message,
      statusCode: error.statusCode,
      path: req.path,
      method: req.method,
    });

    return res.status(error.statusCode).json({
      error: error.message,
      statusCode: error.statusCode,
    });
  }

  // Unexpected errors
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    error: 'Internal server error',
    statusCode: 500,
  });
};
