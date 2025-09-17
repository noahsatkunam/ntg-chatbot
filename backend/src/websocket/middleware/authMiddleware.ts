import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { logger } from '../../utils/logger';

interface JWTPayload {
  sub: string;
  email: string;
  role: string;
  tenantId: string;
  sessionId: string;
  iat?: number;
  exp?: number;
}

export async function verifySocketToken(token: string): Promise<JWTPayload | null> {
  try {
    if (!token) {
      logger.warn('No token provided for WebSocket authentication');
      return null;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;

    // Additional validation
    if (!decoded.sub || !decoded.tenantId) {
      logger.warn('Invalid token payload', { decoded });
      return null;
    }

    return {
      userId: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      tenantId: decoded.tenantId,
      sessionId: decoded.sessionId,
    } as any;
  } catch (error) {
    logger.error('Token verification failed', { error });
    return null;
  }
}

export function extractTokenFromSocket(socket: Socket): string | null {
  // Try different sources for the token
  const authHeader = socket.handshake.headers.authorization;
  const authToken = socket.handshake.auth?.token;
  const queryToken = socket.handshake.query?.token as string;

  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  return authToken || queryToken || null;
}
