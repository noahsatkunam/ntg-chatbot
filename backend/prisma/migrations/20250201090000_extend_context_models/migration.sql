-- Rebuild conversation context storage using key/value rows
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'conversation_contexts'
      AND table_schema = 'public'
  ) THEN
    ALTER TABLE "conversation_contexts" RENAME TO "conversation_contexts_old";
  END IF;
END $$;

CREATE TABLE "conversation_contexts" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_contexts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_contexts_conversationId_key_key"
  ON "conversation_contexts" ("conversationId", "key");
CREATE INDEX "conversation_contexts_conversationId_idx"
  ON "conversation_contexts" ("conversationId");
CREATE INDEX "conversation_contexts_tenantId_idx"
  ON "conversation_contexts" ("tenantId");

ALTER TABLE "conversation_contexts"
  ADD CONSTRAINT "conversation_contexts_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "conversation_contexts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'conversation_contexts_old'
      AND table_schema = 'public'
  ) THEN
    INSERT INTO "conversation_contexts" ("id", "conversationId", "tenantId", "key", "value", "createdAt", "updatedAt")
    SELECT
      concat(old."id", '_', kv.key),
      old."conversationId",
      old."tenantId",
      kv.key,
      kv.value,
      old."createdAt",
      old."updatedAt"
    FROM "conversation_contexts_old" AS old
    CROSS JOIN LATERAL jsonb_each(coalesce(old."variables", '{}'::jsonb)) AS kv(key, value);
  END IF;
END $$;

DROP TABLE IF EXISTS "conversation_contexts_old";

-- Store per-user context variables
CREATE TABLE "user_contexts" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_contexts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_contexts_userId_tenantId_key_key"
  ON "user_contexts" ("userId", "tenantId", "key");
CREATE INDEX "user_contexts_tenantId_idx" ON "user_contexts" ("tenantId");

ALTER TABLE "user_contexts"
  ADD CONSTRAINT "user_contexts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "user_contexts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- Rebuild workflow input request storage with explicit columns
DROP TABLE IF EXISTS "workflow_input_requests";

CREATE TABLE "workflow_input_requests" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "conversationId" TEXT,
  "stepId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "options" TEXT[],
  "validation" JSONB,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "timeout" INTEGER,
  "response" JSONB,
  "respondedBy" TEXT,
  "respondedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_input_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_input_requests_workflowId_idx"
  ON "workflow_input_requests" ("workflowId");
CREATE INDEX "workflow_input_requests_executionId_idx"
  ON "workflow_input_requests" ("executionId");
CREATE INDEX "workflow_input_requests_tenantId_idx"
  ON "workflow_input_requests" ("tenantId");
CREATE INDEX "workflow_input_requests_conversationId_idx"
  ON "workflow_input_requests" ("conversationId");
CREATE INDEX "workflow_input_requests_respondedBy_idx"
  ON "workflow_input_requests" ("respondedBy");
CREATE INDEX "workflow_input_requests_expiresAt_idx"
  ON "workflow_input_requests" ("expiresAt");

ALTER TABLE "workflow_input_requests"
  ADD CONSTRAINT "workflow_input_requests_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_input_requests_executionId_fkey"
    FOREIGN KEY ("executionId") REFERENCES "workflow_executions"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_input_requests_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_input_requests_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "workflow_input_requests_respondedBy_fkey"
    FOREIGN KEY ("respondedBy") REFERENCES "users"("id") ON DELETE SET NULL;

-- Workflow approval tracking
CREATE TABLE "workflow_approval_requests" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "approvers" TEXT[] NOT NULL,
  "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "workflow_approval_requests_workflowId_idx"
  ON "workflow_approval_requests" ("workflowId");
CREATE INDEX "workflow_approval_requests_executionId_idx"
  ON "workflow_approval_requests" ("executionId");
CREATE INDEX "workflow_approval_requests_tenantId_idx"
  ON "workflow_approval_requests" ("tenantId");
CREATE INDEX "workflow_approval_requests_expiresAt_idx"
  ON "workflow_approval_requests" ("expiresAt");

ALTER TABLE "workflow_approval_requests"
  ADD CONSTRAINT "workflow_approval_requests_workflowId_fkey"
    FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_approval_requests_executionId_fkey"
    FOREIGN KEY ("executionId") REFERENCES "workflow_executions"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_approval_requests_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE;

CREATE TABLE "workflow_approval_responses" (
  "id" TEXT NOT NULL,
  "approvalRequestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL,
  "comment" TEXT,
  "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_approval_responses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_approval_responses_request_user_unique"
  ON "workflow_approval_responses" ("approvalRequestId", "userId");
CREATE INDEX "workflow_approval_responses_userId_idx"
  ON "workflow_approval_responses" ("userId");

ALTER TABLE "workflow_approval_responses"
  ADD CONSTRAINT "workflow_approval_responses_requestId_fkey"
    FOREIGN KEY ("approvalRequestId") REFERENCES "workflow_approval_requests"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "workflow_approval_responses_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
