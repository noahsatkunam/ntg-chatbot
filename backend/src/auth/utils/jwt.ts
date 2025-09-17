import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient, TokenType } from '@prisma/client';
import { logger } from '../../utils/logger';
import { getRedisClient } from '../../utils/redis';

const redisClient = getRedisClient();

const prisma = new PrismaClient();

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const JWT_ISSUER = process.env.JWT_ISSUER || 'chatbot-platform';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'chatbot-platform-api';

// Validate JWT secret at runtime
function validateJwtSecret(): void {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  if (JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters long');
  }
}

// Call validation on first use
validateJwtSecret();

export interface JWTPayload {
  sub: string; // user id
  email: string;
  role: string;
  tenantId?: string;
  sessionId: string;
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiry: Date;
  refreshTokenExpiry: Date;
}

export interface DecodedToken extends JWTPayload {
  iat: number;
  exp: number;
  iss: string;
  aud: string | string[];
}

/**
 * Generate JWT access token
 */
export function generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'aud'>): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

/**
 * Generate JWT refresh token
 */
export function generateRefreshToken(payload: Omit<JWTPayload, 'iat' | 'exp' | 'iss' | 'aud'>): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

/**
 * Generate token pair (access + refresh)
 */
export async function generateTokenPair(userId: string, email: string, role: string, tenantId?: string): Promise<TokenPair> {
  const sessionId = crypto.randomUUID();
  
  const payload = {
    sub: userId,
    email,
    role,
    tenantId,
    sessionId,
  };
  
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);
  
  // Calculate expiry times
  const accessTokenExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  const refreshTokenExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  // Store refresh token in database
  await prisma.authToken.create({
    data: {
      userId,
      token: await hashToken(refreshToken),
      type: TokenType.REFRESH,
      expiresAt: refreshTokenExpiry,
    },
  });
  
  // Store session in Redis for quick access
  await redisClient.setEx(
    `session:${sessionId}`,
    30 * 24 * 60 * 60, // 30 days in seconds
    JSON.stringify({ userId, email, role, tenantId })
  );
  
  return {
    accessToken,
    refreshToken,
    accessTokenExpiry,
    refreshTokenExpiry,
  };
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): DecodedToken {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
    }) as DecodedToken;
    
    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

/**
 * Decode token without verification (for getting payload from expired tokens)
 */
export function decodeToken(token: string): DecodedToken | null {
  try {
    return jwt.decode(token) as DecodedToken;
  } catch {
    return null;
  }
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  // Verify refresh token
  const decoded = verifyToken(refreshToken);
  
  // Check if refresh token exists in database
  const hashedToken = await hashToken(refreshToken);
  const storedToken = await prisma.authToken.findFirst({
    where: {
      userId: decoded.sub,
      token: hashedToken,
      type: TokenType.REFRESH,
      expiresAt: { gt: new Date() },
      usedAt: null,
    },
  });
  
  if (!storedToken) {
    throw new Error('Invalid refresh token');
  }
  
  // Check if token is blacklisted
  const isBlacklisted = await isTokenBlacklisted(refreshToken);
  if (isBlacklisted) {
    throw new Error('Token has been revoked');
  }
  
  // Get user details
  const user = await prisma.user.findUnique({
    where: { id: decoded.sub },
    select: { id: true, email: true, role: true, tenantId: true },
  });
  
  if (!user) {
    throw new Error('User not found');
  }
  
  // Mark old refresh token as used
  await prisma.authToken.update({
    where: { id: storedToken.id },
    data: { usedAt: new Date() },
  });
  
  // Generate new token pair
  return generateTokenPair(user.id, user.email, user.role, user.tenantId || undefined);
}

/**
 * Blacklist a token
 */
export async function blacklistToken(token: string, type: 'access' | 'refresh' = 'access'): Promise<void> {
  try {
    const decoded = decodeToken(token);
    if (!decoded) return;
    
    // Calculate remaining TTL
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl <= 0) return; // Token already expired
    
    // Add to Redis blacklist
    await redisClient.setex(
      `blacklist:${type}:${token}`,
      ttl,
      '1'
    );
    
    // If refresh token, also invalidate in database
    if (type === 'refresh') {
      const hashedToken = await hashToken(token);
      await prisma.authToken.updateMany({
        where: {
          token: hashedToken,
          type: TokenType.REFRESH,
        },
        data: { usedAt: new Date() },
      });
    }
    
    // Invalidate session
    if (decoded.sessionId) {
      await redisClient.del(`session:${decoded.sessionId}`);
    }
  } catch (error) {
    logger.error('Error blacklisting token', { error });
  }
}

/**
 * Check if token is blacklisted
 */
export async function isTokenBlacklisted(token: string, type: 'access' | 'refresh' = 'access'): Promise<boolean> {
  try {
    const exists = await redisClient.exists(`blacklist:${type}:${token}`);
    return exists === 1;
  } catch (error) {
    logger.error('Error checking token blacklist', { error });
    return false;
  }
}

/**
 * Invalidate all tokens for a user
 */
export async function invalidateAllUserTokens(userId: string): Promise<void> {
  try {
    // Mark all refresh tokens as used
    await prisma.authToken.updateMany({
      where: {
        userId,
        type: TokenType.REFRESH,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    
    // Clear all user sessions from Redis
    const keys = await redisClient.keys(`session:*`);
    for (const key of keys) {
      const session = await redisClient.get(key);
      if (session) {
        const data = JSON.parse(session);
        if (data.userId === userId) {
          await redisClient.del(key);
        }
      }
    }
  } catch (error) {
    logger.error('Error invalidating user tokens', { error, userId });
  }
}

/**
 * Hash token for secure storage
 */
async function hashToken(token: string): Promise<string> {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

/**
 * Generate secure random token
 */
export function generateSecureToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Extract bearer token from authorization header
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}
