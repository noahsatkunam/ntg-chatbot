# Manual Testing Guide - Phase 1

This guide provides step-by-step instructions for manually testing the multi-tenant chatbot platform.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 18+ installed
- cURL or Postman for API testing
- Test environment set up (`./scripts/setup-test-env.sh`)

## Test Credentials

### Super Admin
- Email: `superadmin@test.com`
- Password: `SuperSecure123!`
- Tenant: None (global access)

### Tenant 1 (Professional Plan)
- Subdomain: `testtenant1`
- Admin: `admin@tenant1.com` / `AdminSecure123!`
- User: `user@tenant1.com` / `UserSecure123!`

### Tenant 2 (Starter Plan - Trial)
- Subdomain: `testtenant2`
- Admin: `admin@tenant2.com` / `AdminSecure123!`
- User: `user@tenant2.com` / `UserSecure123!`

### Shared User
- Email: `shared@example.com`
- Password: `UserSecure123!`
- Exists in both tenants with different profiles

## 1. Authentication Testing

### 1.1 Registration Flow

```bash
# Register new user in Tenant 1
curl -X POST http://testtenant1.localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newuser@example.com",
    "password": "NewUser123!",
    "confirmPassword": "NewUser123!",
    "fullName": "New Test User",
    "acceptTerms": true
  }'

# Expected: 201 Created with user data (role should be TENANT_USER)
```

### 1.2 Login Flow

```bash
# Login to Tenant 1
curl -X POST http://testtenant1.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "user@tenant1.com",
    "password": "UserSecure123!"
  }'

# Expected: 200 OK with user data and tokens in cookies
```

### 1.3 Access Protected Route

```bash
# Get user profile (using cookies from login)
curl -X GET http://testtenant1.localhost:3000/api/auth/profile \
  -b cookies.txt

# Expected: 200 OK with user profile data
```

### 1.4 Logout

```bash
# Logout
curl -X POST http://testtenant1.localhost:3000/api/auth/logout \
  -b cookies.txt

# Expected: 200 OK, cookies cleared
```

## 2. Security Testing

### 2.1 SUPER_ADMIN Creation Prevention

```bash
# Try to create SUPER_ADMIN (should fail)
curl -X POST http://testtenant1.localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hacker@example.com",
    "password": "Hacker123!",
    "confirmPassword": "Hacker123!",
    "fullName": "Hacker",
    "role": "SUPER_ADMIN",
    "acceptTerms": true
  }'

# Expected: 403 Forbidden - "Insufficient permissions to create admin users"
```

### 2.2 Cross-Tenant Authentication

```bash
# Try to login to Tenant 2 with Tenant 1 credentials
curl -X POST http://testtenant2.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@tenant1.com",
    "password": "UserSecure123!"
  }'

# Expected: 401 Unauthorized - "Invalid credentials"
```

### 2.3 Missing Tenant Context

```bash
# Try to register without subdomain
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "notenant@example.com",
    "password": "NoTenant123!",
    "confirmPassword": "NoTenant123!",
    "fullName": "No Tenant",
    "acceptTerms": true
  }'

# Expected: 404 Not Found - "Tenant not found"
```

## 3. Multi-Tenant Testing

### 3.1 Same Email in Different Tenants

```bash
# Login as shared@example.com in Tenant 1
curl -X POST http://testtenant1.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -c tenant1-cookies.txt \
  -d '{
    "email": "shared@example.com",
    "password": "UserSecure123!"
  }'

# Login as shared@example.com in Tenant 2
curl -X POST http://testtenant2.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -c tenant2-cookies.txt \
  -d '{
    "email": "shared@example.com",
    "password": "UserSecure123!"
  }'

# Get profiles to verify different users
curl -X GET http://testtenant1.localhost:3000/api/auth/profile -b tenant1-cookies.txt
curl -X GET http://testtenant2.localhost:3000/api/auth/profile -b tenant2-cookies.txt

# Expected: Different user IDs and fullNames for same email
```

### 3.2 Tenant Context in Protected Routes

```bash
# Access chatbots endpoint with tenant context
curl -X GET http://testtenant1.localhost:3000/api/chatbots \
  -b tenant1-cookies.txt

# Expected: 200 OK (placeholder response)
```

### 3.3 Subdomain Validation

```bash
# Invalid subdomain
curl -X GET http://invalidtenant.localhost:3000/api/tenants/current

# Expected: 404 Not Found - "Tenant not found"

# Reserved subdomain
curl -X GET http://www.localhost:3000/api/tenants/current

# Expected: 404 Not Found
```

## 4. Password Reset Testing

### 4.1 Request Password Reset

```bash
# Request reset for existing user
curl -X POST http://testtenant1.localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@tenant1.com"
  }'

# Expected: 200 OK - "If an account exists..."
```

### 4.2 Reset Password

```bash
# Get reset token from database (in real scenario, from email)
# Use the token to reset password
curl -X POST http://testtenant1.localhost:3000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "RESET_TOKEN_FROM_EMAIL",
    "password": "NewPassword123!",
    "confirmPassword": "NewPassword123!"
  }'

# Expected: 200 OK - Password updated
```

## 5. Rate Limiting Testing

### 5.1 Test Rate Limits

```bash
# Make rapid requests to trigger rate limit
for i in {1..20}; do
  curl -X POST http://testtenant1.localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com", "password": "wrong"}' \
    -w "Status: %{http_code}\n"
done

# Expected: After ~10 requests, should see 429 Too Many Requests
```

### 5.2 Per-Tenant Rate Limits

```bash
# After hitting rate limit on tenant1, try tenant2
curl -X POST http://testtenant2.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "wrong"}'

# Expected: 401 (not rate limited) - limits are per tenant
```

## 6. Tenant Management Testing

### 6.1 Get Current Tenant

```bash
# Login as tenant admin
curl -X POST http://testtenant1.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -c admin-cookies.txt \
  -d '{
    "email": "admin@tenant1.com",
    "password": "AdminSecure123!"
  }'

# Get tenant details
curl -X GET http://testtenant1.localhost:3000/api/tenants/current \
  -b admin-cookies.txt

# Expected: 200 OK with tenant details including plan, features, limits
```

### 6.2 Update Tenant Settings

```bash
# Update tenant branding
curl -X PUT http://testtenant1.localhost:3000/api/tenants/current \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{
    "primaryColor": "#FF0000",
    "secondaryColor": "#00FF00",
    "contactEmail": "support@tenant1.com"
  }'

# Expected: 200 OK - Tenant updated
```

### 6.3 Check Tenant Usage

```bash
# Get usage statistics
curl -X GET http://testtenant1.localhost:3000/api/tenants/current/usage \
  -b admin-cookies.txt

# Expected: 200 OK with usage metrics
```

## 7. Two-Factor Authentication Testing

### 7.1 Enable 2FA

```bash
# Setup 2FA (as authenticated user)
curl -X POST http://testtenant1.localhost:3000/api/auth/setup-2fa \
  -b cookies.txt

# Expected: 200 OK with QR code URL and secret
```

### 7.2 Login with 2FA

```bash
# Initial login
curl -X POST http://testtenant1.localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user-with-2fa@tenant1.com",
    "password": "Password123!"
  }'

# Expected: 200 OK with requiresTwoFactor: true

# Complete 2FA
curl -X POST http://testtenant1.localhost:3000/api/auth/verify-2fa \
  -H "Content-Type: application/json" \
  -d '{
    "tempToken": "TEMP_TOKEN_FROM_LOGIN",
    "token": "123456"
  }'

# Expected: 200 OK with full login tokens
```

## 8. Performance Testing

### 8.1 Concurrent User Logins

```bash
# Test multiple concurrent logins
for i in {1..10}; do
  (curl -X POST http://testtenant1.localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email": "user@tenant1.com", "password": "UserSecure123!"}' \
    -o /dev/null -s -w "Request $i: %{time_total}s\n") &
done
wait

# Expected: All requests complete < 1s
```

### 8.2 Database Query Performance

```bash
# Measure tenant data query time
time curl -X GET http://testtenant1.localhost:3000/api/tenants/current/usage \
  -b admin-cookies.txt

# Expected: Response time < 100ms
```

## Troubleshooting

### Common Issues

1. **Cannot connect to localhost:3000**
   - Check if backend is running: `docker ps`
   - Check logs: `docker logs chatbot-platform-backend-1`

2. **"Tenant not found" errors**
   - Ensure using correct subdomain
   - Check hosts file includes tenant subdomains
   - Verify test data was seeded

3. **Authentication failures**
   - Check JWT secret is set in environment
   - Verify cookies are being sent with requests
   - Check user email is verified in database

4. **Rate limiting not working**
   - Ensure Redis is running: `docker ps | grep redis`
   - Check Redis connection in backend logs

### Debug Commands

```bash
# Check backend logs
docker logs -f chatbot-platform-backend-1

# Check database
docker exec -it chatbot-test-db psql -U chatbot_user -d chatbot_test

# Check Redis
docker exec -it chatbot-test-redis redis-cli

# View JWT token contents
echo "YOUR_JWT_TOKEN" | cut -d. -f2 | base64 -d | jq
```

## Validation Checklist

- [ ] Registration creates only TENANT_USER role
- [ ] Cannot create SUPER_ADMIN via public endpoint
- [ ] Login requires tenant context
- [ ] Same email can exist in different tenants
- [ ] Cross-tenant authentication blocked
- [ ] JWT tokens include tenant context
- [ ] Rate limiting works per tenant
- [ ] Password reset is tenant-scoped
- [ ] All API endpoints require authentication
- [ ] Tenant isolation in all queries

## Performance Baseline

Expected performance metrics:
- Login response: < 200ms
- Protected route access: < 50ms
- Tenant query: < 100ms
- Registration: < 300ms
- Password hashing: < 100ms
- Concurrent users: 100+
