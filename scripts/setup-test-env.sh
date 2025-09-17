#!/bin/bash
# setup-test-env.sh - Initialize test environment for Phase 1 validation

set -e

echo "🚀 Setting up test environment for Phase 1 validation..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Node.js/npm is not installed. Please install Node.js first.${NC}"
    exit 1
fi

# Create test environment file
echo -e "${YELLOW}Creating test environment configuration...${NC}"
cat > backend/.env.test << EOF
# Test Environment Configuration
NODE_ENV=test

# Database
DATABASE_URL=postgresql://chatbot_user:secure_password@localhost:5432/chatbot_test

# Redis
REDIS_URL=redis://localhost:6379

# JWT Configuration
JWT_SECRET=test-jwt-secret-at-least-32-characters-long-for-testing
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
JWT_ISSUER=chatbot-platform-test
JWT_AUDIENCE=chatbot-platform-api-test

# Bcrypt
BCRYPT_ROUNDS=10

# Email (Mock for testing)
EMAIL_ENABLED=false
EMAIL_FROM=noreply@test.platform.com
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=debug

# Test-specific settings
TEST_TENANT_1_SUBDOMAIN=testtenant1
TEST_TENANT_2_SUBDOMAIN=testtenant2
TEST_SUPER_ADMIN_EMAIL=superadmin@test.com
TEST_SUPER_ADMIN_PASSWORD=SuperSecure123!
EOF

echo -e "${GREEN}Test environment file created${NC}"

# Start test database
echo -e "${YELLOW}Starting test database...${NC}"
docker run -d \
  --name chatbot-test-db \
  -e POSTGRES_USER=chatbot_user \
  -e POSTGRES_PASSWORD=secure_password \
  -e POSTGRES_DB=chatbot_test \
  -p 5432:5432 \
  postgres:15-alpine || echo "Test database already running"

# Start test Redis
echo -e "${YELLOW}Starting test Redis...${NC}"
docker run -d \
  --name chatbot-test-redis \
  -p 6379:6379 \
  redis:7-alpine || echo "Test Redis already running"

# Wait for services
echo -e "${YELLOW}Waiting for services to be ready...${NC}"
sleep 5

# Install dependencies
echo -e "${YELLOW}Installing backend dependencies...${NC}"
cd backend
npm install

# Generate Prisma client
echo -e "${YELLOW}Generating Prisma client...${NC}"
npx prisma generate

# Run migrations
echo -e "${YELLOW}Running database migrations...${NC}"
npx prisma migrate deploy

# Seed test data
echo -e "${YELLOW}Creating test seed data...${NC}"
cat > seed-test-data.ts << 'EOF'
import { PrismaClient } from '@prisma/client';
import { hashPassword } from './src/auth/utils/password';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding test database...');

  // Create test tenants
  const tenant1 = await prisma.tenant.create({
    data: {
      name: 'Test Tenant 1',
      slug: 'test-tenant-1',
      subdomain: 'testtenant1',
      status: 'ACTIVE',
      plan: 'PROFESSIONAL',
      primaryColor: '#3B82F6',
      secondaryColor: '#10B981',
      settings: {
        maxUsers: 100,
        enableApiAccess: true,
        enableWebhooks: true,
      },
      features: {
        chatbots: true,
        analytics: true,
        customBranding: true,
        apiAccess: true,
        webhooks: true,
      },
      limits: {
        maxUsers: 100,
        maxChatbots: 20,
        maxConversationsPerDay: 2000,
        maxMessagesPerMonth: 100000,
        maxStorageGB: 100,
        maxApiCallsPerHour: 2000,
        maxApiCallsPerMonth: 100000,
      },
    },
  });

  const tenant2 = await prisma.tenant.create({
    data: {
      name: 'Test Tenant 2',
      slug: 'test-tenant-2',
      subdomain: 'testtenant2',
      status: 'TRIAL',
      plan: 'STARTER',
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
      primaryColor: '#8B5CF6',
      secondaryColor: '#EC4899',
      settings: {
        maxUsers: 20,
        enableApiAccess: true,
      },
      features: {
        chatbots: true,
        analytics: true,
        customBranding: true,
        apiAccess: true,
      },
      limits: {
        maxUsers: 20,
        maxChatbots: 5,
        maxConversationsPerDay: 500,
        maxMessagesPerMonth: 10000,
        maxStorageGB: 10,
        maxApiCallsPerHour: 500,
        maxApiCallsPerMonth: 10000,
      },
    },
  });

  // Create super admin (no tenant)
  const superAdminHash = await hashPassword('SuperSecure123!');
  await prisma.user.create({
    data: {
      email: 'superadmin@test.com',
      passwordHash: superAdminHash,
      fullName: 'Super Admin',
      role: 'SUPER_ADMIN',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  // Create tenant admins
  const adminHash = await hashPassword('AdminSecure123!');
  await prisma.user.create({
    data: {
      email: 'admin@tenant1.com',
      passwordHash: adminHash,
      fullName: 'Tenant 1 Admin',
      role: 'TENANT_ADMIN',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      tenantId: tenant1.id,
    },
  });

  await prisma.user.create({
    data: {
      email: 'admin@tenant2.com',
      passwordHash: adminHash,
      fullName: 'Tenant 2 Admin',
      role: 'TENANT_ADMIN',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      tenantId: tenant2.id,
    },
  });

  // Create regular users
  const userHash = await hashPassword('UserSecure123!');
  await prisma.user.create({
    data: {
      email: 'user@tenant1.com',
      passwordHash: userHash,
      fullName: 'Regular User 1',
      role: 'TENANT_USER',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      tenantId: tenant1.id,
    },
  });

  await prisma.user.create({
    data: {
      email: 'user@tenant2.com',
      passwordHash: userHash,
      fullName: 'Regular User 2',
      role: 'TENANT_USER',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      tenantId: tenant2.id,
    },
  });

  // Create users with same email in different tenants
  await prisma.user.create({
    data: {
      email: 'shared@example.com',
      passwordHash: userHash,
      fullName: 'Shared User - Tenant 1',
      role: 'TENANT_USER',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      tenantId: tenant1.id,
    },
  });

  await prisma.user.create({
    data: {
      email: 'shared@example.com',
      passwordHash: userHash,
      fullName: 'Shared User - Tenant 2',
      role: 'TENANT_USER',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      tenantId: tenant2.id,
    },
  });

  console.log('Test data seeded successfully');
  console.log(`Tenant 1 ID: ${tenant1.id}`);
  console.log(`Tenant 2 ID: ${tenant2.id}`);
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
EOF

# Run seed script
echo -e "${YELLOW}Seeding test database...${NC}"
npx ts-node seed-test-data.ts

# Create test summary
echo -e "${GREEN}✅ Test environment setup complete!${NC}"
echo ""
echo "Test Credentials:"
echo "=================="
echo "Super Admin: superadmin@test.com / SuperSecure123!"
echo "Tenant 1 Admin: admin@tenant1.com / AdminSecure123!"
echo "Tenant 1 User: user@tenant1.com / UserSecure123!"
echo "Tenant 2 Admin: admin@tenant2.com / AdminSecure123!"
echo "Tenant 2 User: user@tenant2.com / UserSecure123!"
echo "Shared User: shared@example.com / UserSecure123! (exists in both tenants)"
echo ""
echo "Test Subdomains:"
echo "================"
echo "Tenant 1: testtenant1.platform.com"
echo "Tenant 2: testtenant2.platform.com"
echo ""
echo "Services:"
echo "========="
echo "Database: postgresql://localhost:5432/chatbot_test"
echo "Redis: redis://localhost:6379"
echo ""
echo -e "${YELLOW}Run './scripts/run-security-tests.sh' to execute security tests${NC}"
