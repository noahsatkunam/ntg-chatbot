import { PrismaClient } from '@prisma/client';
import {
  encryptPayload,
  ensureEncryptionKey,
  EncryptedPayload,
  isEncryptedPayload
} from '../src/utils/encryption';

const prisma = new PrismaClient();

function serialize(payload: EncryptedPayload): string {
  return JSON.stringify(payload);
}

function parseEncrypted(value: unknown): EncryptedPayload | null {
  if (!value) {
    return null;
  }

  if (isEncryptedPayload(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (isEncryptedPayload(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function decodeLegacyClientSecret(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    if (
      decoded &&
      Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '') === trimmed.replace(/=+$/, '')
    ) {
      return decoded;
    }
  } catch {
    // Not base64 encoded – fall through to returning trimmed value
  }

  return trimmed;
}

function decodeLegacyToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function reEncryptProviders(encryptionKey: string): Promise<number> {
  const providers = await prisma.oAuth2Provider.findMany();
  let migrated = 0;

  for (const provider of providers) {
    const currentSecret = provider.clientSecret as unknown;
    if (parseEncrypted(currentSecret)) {
      continue;
    }

    const legacySecret = decodeLegacyClientSecret(currentSecret);
    if (!legacySecret) {
      console.warn(`Skipping OAuth2 provider ${provider.id}: missing or unreadable client secret`);
      continue;
    }

    const encryptedSecret = serialize(encryptPayload(legacySecret, encryptionKey));
    await prisma.oAuth2Provider.update({
      where: { id: provider.id },
      data: { clientSecret: encryptedSecret }
    });

    migrated += 1;
    console.log(`Re-encrypted OAuth2 provider ${provider.id}`);
  }

  return migrated;
}

async function reEncryptConnections(encryptionKey: string): Promise<number> {
  const connections = await prisma.oAuth2Connection.findMany();
  let migrated = 0;

  for (const connection of connections) {
    const updates: { accessToken?: string; refreshToken?: string | null } = {};

    if (!parseEncrypted(connection.accessToken as unknown)) {
      const legacyAccessToken = decodeLegacyToken(connection.accessToken as unknown);
      if (legacyAccessToken) {
        updates.accessToken = serialize(encryptPayload(legacyAccessToken, encryptionKey));
      }
    }

    if (connection.refreshToken && !parseEncrypted(connection.refreshToken as unknown)) {
      const legacyRefreshToken = decodeLegacyToken(connection.refreshToken as unknown);
      if (legacyRefreshToken) {
        updates.refreshToken = serialize(encryptPayload(legacyRefreshToken, encryptionKey));
      }
    }

    if (Object.keys(updates).length === 0) {
      continue;
    }

    await prisma.oAuth2Connection.update({
      where: { id: connection.id },
      data: updates
    });

    migrated += 1;
    console.log(`Re-encrypted OAuth2 connection ${connection.id}`);
  }

  return migrated;
}

async function main(): Promise<void> {
  const rawKey =
    process.env.OAUTH2_ENCRYPTION_KEY ||
    process.env.API_CONNECTOR_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY;
  const encryptionKey = ensureEncryptionKey(rawKey, 'OAuth2 re-encryption');

  const providerCount = await reEncryptProviders(encryptionKey);
  const connectionCount = await reEncryptConnections(encryptionKey);

  console.log(
    `Re-encrypted ${providerCount} OAuth2 provider(s) and ${connectionCount} OAuth2 connection(s).`
  );
}

main()
  .catch(error => {
    console.error('Failed to re-encrypt OAuth2 secrets', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
