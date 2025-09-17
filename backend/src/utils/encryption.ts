import crypto from 'crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH_BYTES = 16;

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

function deriveKey(rawKey: string): Buffer {
  const trimmed = rawKey.trim();
  let keyMaterial: Buffer;

  if (isBase64(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed, 'base64');
      if (decoded.length > 0) {
        keyMaterial = decoded;
      } else {
        keyMaterial = Buffer.from(trimmed, 'utf8');
      }
    } catch {
      keyMaterial = Buffer.from(trimmed, 'utf8');
    }
  } else if (isHex(trimmed)) {
    try {
      keyMaterial = Buffer.from(trimmed, 'hex');
    } catch {
      keyMaterial = Buffer.from(trimmed, 'utf8');
    }
  } else {
    keyMaterial = Buffer.from(trimmed, 'utf8');
  }

  return crypto.createHash('sha256').update(keyMaterial).digest();
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.iv === 'string' && typeof candidate.ciphertext === 'string';
}

export function encryptPayload(payload: unknown, rawKey: string): EncryptedPayload {
  if (!rawKey || rawKey.trim().length === 0) {
    throw new Error('Encryption key must be provided');
  }

  const key = deriveKey(rawKey);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  const plaintextBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const combined = Buffer.concat([authTag, encrypted]);

  return {
    iv: iv.toString('base64'),
    ciphertext: combined.toString('base64')
  };
}

export function decryptPayload<T>(payload: EncryptedPayload, rawKey: string): T {
  if (!rawKey || rawKey.trim().length === 0) {
    throw new Error('Encryption key must be provided');
  }

  const key = deriveKey(rawKey);
  const iv = Buffer.from(payload.iv, 'base64');
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error('Invalid initialization vector');
  }

  const combined = Buffer.from(payload.ciphertext, 'base64');
  if (combined.length < AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Invalid ciphertext payload');
  }

  const authTag = combined.subarray(0, AUTH_TAG_LENGTH_BYTES);
  const encrypted = combined.subarray(AUTH_TAG_LENGTH_BYTES);

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');

  return JSON.parse(decrypted) as T;
}

export function ensureEncryptionKey(key: string | null | undefined, context: string): string {
  const trimmed = key?.trim();
  if (!trimmed) {
    throw new Error(`${context}: encryption key is not configured`);
  }

  return trimmed;
}

