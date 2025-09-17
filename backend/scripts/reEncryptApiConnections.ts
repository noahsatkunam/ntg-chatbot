import { PrismaClient } from '@prisma/client';
import type { AuthConfig } from '../src/integrations/apiConnector';
import {
  encryptPayload,
  ensureEncryptionKey,
  isEncryptedPayload
} from '../src/utils/encryption';

const prisma = new PrismaClient();

function decodeLegacyAuthConfig(storedAuth: any): AuthConfig | null {
  if (!storedAuth) {
    return null;
  }

  try {
    if (typeof storedAuth.credentials === 'string') {
      const decoded = Buffer.from(storedAuth.credentials, 'base64').toString();
      const credentials = JSON.parse(decoded);
      return {
        ...storedAuth,
        credentials
      } as AuthConfig;
    }

    return storedAuth as AuthConfig;
  } catch (error) {
    console.warn('Skipping API connection with unreadable credentials', error);
    return null;
  }
}

async function main(): Promise<void> {
  const rawKey = process.env.API_CONNECTOR_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  const encryptionKey = ensureEncryptionKey(rawKey, 'API connection re-encryption');

  const connections = await prisma.apiConnection.findMany();
  let migrated = 0;

  for (const connection of connections) {
    let storedAuth = connection.authentication as any;

    if (!storedAuth) {
      continue;
    }

    if (typeof storedAuth === 'string') {
      try {
        storedAuth = JSON.parse(storedAuth);
      } catch (error) {
        console.warn(`Skipping API connection ${connection.id}: authentication payload is not valid JSON`, error);
        continue;
      }
    }

    if (isEncryptedPayload(storedAuth)) {
      continue;
    }

    const authConfig = decodeLegacyAuthConfig(storedAuth);
    if (!authConfig) {
      continue;
    }

    const encrypted = encryptPayload(authConfig, encryptionKey);
    await prisma.apiConnection.update({
      where: { id: connection.id },
      data: { authentication: encrypted }
    });

    migrated += 1;
    console.log(`Re-encrypted API connection ${connection.id}`);
  }

  console.log(`Re-encrypted ${migrated} API connection(s).`);
}

main()
  .catch((error) => {
    console.error('Failed to re-encrypt API connections', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

