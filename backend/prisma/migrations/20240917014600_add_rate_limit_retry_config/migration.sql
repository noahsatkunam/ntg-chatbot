-- Add rate limit and retry configuration columns for API connections
ALTER TABLE "api_connections"
  ADD COLUMN "rateLimit" JSONB,
  ADD COLUMN "retryConfig" JSONB;

-- Backfill newly added columns using existing data
UPDATE "api_connections"
SET "rateLimit" = COALESCE(
  "rateLimits",
  jsonb_build_object(
    'requestsPerSecond', 5,
    'requestsPerMinute', 300,
    'requestsPerHour', 1000,
    'burstLimit', 10
  )
)
WHERE "rateLimit" IS NULL;

UPDATE "api_connections"
SET "retryConfig" = COALESCE(
  "metadata" -> 'retryConfig',
  jsonb_build_object(
    'maxRetries', 3,
    'backoffMultiplier', 2,
    'maxBackoffMs', 10000,
    'retryableStatusCodes', jsonb_build_array(429, 500, 502, 503, 504)
  )
)
WHERE "retryConfig" IS NULL;

-- Remove migrated retry configuration from metadata to avoid duplication
UPDATE "api_connections"
SET "metadata" = "metadata" - 'retryConfig'
WHERE "metadata" IS NOT NULL AND "metadata" ? 'retryConfig';

-- Drop legacy column once data has been migrated
ALTER TABLE "api_connections" DROP COLUMN IF EXISTS "rateLimits";
