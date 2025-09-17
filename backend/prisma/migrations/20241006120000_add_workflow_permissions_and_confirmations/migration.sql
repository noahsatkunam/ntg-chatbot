-- Create table for workflow-level permissions
CREATE TABLE "workflow_permissions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "userId" TEXT,
  "role" "Role",
  "canView" BOOLEAN NOT NULL DEFAULT false,
  "canExecute" BOOLEAN NOT NULL DEFAULT false,
  "canCancel" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_permissions_pkey" PRIMARY KEY ("id")
);

-- Create table for pending workflow confirmations
CREATE TABLE "workflow_confirmations" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestData" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_confirmations_pkey" PRIMARY KEY ("id")
);

-- Indexes to support permission lookups
CREATE INDEX "workflow_permissions_tenantId_idx" ON "workflow_permissions" ("tenantId");
CREATE INDEX "workflow_permissions_workflowId_idx" ON "workflow_permissions" ("workflowId");
CREATE INDEX "workflow_permissions_userId_idx" ON "workflow_permissions" ("userId");
CREATE INDEX "workflow_permissions_role_idx" ON "workflow_permissions" ("role");

-- Indexes to support confirmation lookups and cleanup
CREATE INDEX "workflow_confirmations_tenantId_idx" ON "workflow_confirmations" ("tenantId");
CREATE INDEX "workflow_confirmations_workflowId_idx" ON "workflow_confirmations" ("workflowId");
CREATE INDEX "workflow_confirmations_userId_idx" ON "workflow_confirmations" ("userId");
CREATE INDEX "workflow_confirmations_expiresAt_idx" ON "workflow_confirmations" ("expiresAt");

-- Foreign keys to enforce tenant and workflow scoping
ALTER TABLE "workflow_permissions"
  ADD CONSTRAINT "workflow_permissions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_permissions_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_permissions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "workflow_confirmations"
  ADD CONSTRAINT "workflow_confirmations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_confirmations_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_confirmations_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
