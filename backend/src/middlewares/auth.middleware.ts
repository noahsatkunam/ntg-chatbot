import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient, User } from '@prisma/client';
import { AppError } from './errorHandler';

const prisma = new PrismaClient();

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: User;
      tenantId?: string;
      token?: string;
    }
  }
}

interface JWTPayload {
  sub: string;
  email: string;
  role: string;
  tenantId?: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string;
}

/**
 * Authenticate JWT token
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token from Authorization header or cookies
    let token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw new AppError('Authentication required', 401);
    }

    // Verify token
    const payload = jwt.verify(token, process.env.JWT_SECRET!, {
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    }) as JWTPayload;

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    });

    if (!user) {
      throw new AppError('User not found', 401);
    }

    // Check if user is active
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('Account is locked', 423);
    }

    // Attach user to request
    req.user = user;
    req.tenantId = user.tenantId || undefined;
    req.token = token;

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Token expired', 401));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Invalid token', 401));
    } else {
      next(error);
    }
  }
};

/**
 * Check if user has required role
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('Insufficient permissions', 403));
    }

    next();
  };
};

/**
 * Check if user belongs to the specified tenant
 */
export const validateTenantAccess = (req: Request, res: Response, next: NextFunction) => {
  const requestedTenantId = req.params.tenantId || req.body.tenantId || req.query.tenantId;

  if (!requestedTenantId) {
    return next();
  }

  // Super admins can access any tenant
  if (req.user?.role === 'SUPER_ADMIN') {
    return next();
  }

  // Check if user belongs to the requested tenant
  if (req.user?.tenantId !== requestedTenantId) {
    return next(new AppError('Access denied to this tenant', 403));
  }

  next();
};

/**
 * Check if user's email is verified
 */
export const requireVerifiedEmail = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.emailVerified) {
    return next(new AppError('Email verification required', 403));
  }

  next();
};

/**
 * Optional authentication - doesn't fail if no token provided
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract token
    let token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    
    if (!token && req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      return next();
    }

    // Verify token
    const payload = jwt.verify(token, process.env.JWT_SECRET!, {
      issuer: process.env.JWT_ISSUER,
      audience: process.env.JWT_AUDIENCE,
    }) as JWTPayload;

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: true },
    });

    if (user && (!user.lockedUntil || user.lockedUntil < new Date())) {
      req.user = user;
      req.tenantId = user.tenantId || undefined;
      req.token = token;
    }
  } catch {
    // Ignore errors for optional auth
  }

  next();
};
