# NTG Chatbot Platform

A production-ready enterprise AI chatbot platform with knowledge base integration, workflow automation, and multi-tenant support.

## 🚀 Features

- **AI-Powered Chat**: Advanced conversational AI with context awareness and streaming responses
- **Knowledge Base**: Document upload, processing, and intelligent retrieval with RAG
- **Workflow Automation**: Integration with n8n for business process automation
- **Multi-Tenant**: Complete tenant isolation with custom branding and settings
- **Real-time Communication**: WebSocket-powered live chat and notifications
- **Analytics**: Comprehensive usage analytics and performance metrics
- **Security**: Enterprise-grade security with JWT authentication and 2FA
- **Testing**: Comprehensive test suite with unit, integration, and E2E tests

## 🏗️ Architecture

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development and optimized builds
- **Tailwind CSS** with shadcn/ui components
- **Radix UI** for accessible components
- **React Query** for state management
- **Socket.io** for real-time communication
- **PWA Support** with service workers

### Backend
- **Node.js** with Express and TypeScript
- **Prisma** ORM with PostgreSQL
- **Redis** for caching and sessions
- **Socket.io** for WebSocket communication
- **OpenAI API** for AI capabilities
- **JWT** authentication with refresh tokens

### Infrastructure
- **Docker** containerization with multi-stage builds
- **PostgreSQL** database with optimized queries
- **Redis** cache with persistence
- **n8n** workflow automation engine
- **Nginx** reverse proxy with SSL termination
- **Prometheus & Grafana** monitoring stack

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker and Docker Compose
- Git

### Development Setup

1. **Clone and setup**
   ```bash
   git clone https://github.com/your-org/ntg-chatbot.git
   cd ntg-chatbot
   
   # Install all dependencies
   npm install
   ```

2. **Environment configuration**
   ```bash
   # Copy environment templates
   cp .env.example .env
   cp frontend/.env.example frontend/.env
   cp backend/.env.example backend/.env
   
   # Edit with your configuration
   ```

3. **Start development environment**
   ```bash
   # Start all services
   docker-compose up -d
   
   # Initialize database
   cd backend && npx prisma migrate dev && npx prisma db seed
   ```

4. **Access applications**
   - **Frontend**: http://localhost:5173
   - **Backend API**: http://localhost:3001
   - **n8n Workflows**: http://localhost:5678
   - **Grafana**: http://localhost:3000

## 🏭 Production Deployment

### Docker Compose (Recommended)

1. **Production setup**
   ```bash
   # Configure production environment
   cp .env.example .env.production
   nano .env.production  # Edit with production values
   ```

2. **Deploy stack**
   ```bash
   # Build and start production services
   docker-compose -f docker-compose.prod.yml up -d
   
   # Initialize database
   docker-compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
   ```

3. **SSL Configuration**
   ```bash
   # Using Let's Encrypt
   sudo certbot --nginx -d your-domain.com
   
   # Or place certificates in ./ssl/
   ```

### Manual Deployment

1. **Build applications**
   ```bash
   # Frontend build
   cd frontend && npm run build
   
   # Backend build
   cd backend && npm run build
   ```

2. **Configure services**
   - Set up PostgreSQL database
   - Configure Redis cache
   - Set up Nginx reverse proxy
   - Configure SSL certificates

## 🧪 Testing

### Comprehensive Test Suite

```bash
# Unit tests
npm run test                    # All tests
npm run test:frontend          # Frontend tests
npm run test:backend           # Backend tests

# Integration tests
npm run test:integration       # API integration tests

# End-to-End tests
npm run test:e2e              # Playwright E2E tests
npm run test:e2e:ui           # E2E tests with UI

# Test coverage
npm run test:coverage         # Coverage report
```

### Test Structure
- **Unit Tests**: Component and function testing with Vitest/Jest
- **Integration Tests**: API endpoint testing with MSW mocks
- **E2E Tests**: Full user journey testing with Playwright
- **Performance Tests**: Load testing and performance monitoring

## 📊 Monitoring & Analytics

### Health Monitoring
- **Application Health**: `/health` endpoints for all services
- **Database Health**: PostgreSQL connection and query monitoring
- **Cache Health**: Redis connection and performance metrics
- **Real-time Metrics**: WebSocket connection monitoring

### Performance Monitoring
- **Core Web Vitals**: LCP, FID, CLS tracking
- **API Performance**: Response times and error rates
- **Bundle Analysis**: JavaScript bundle size optimization
- **Memory Usage**: Heap size and garbage collection monitoring

### Analytics Dashboard
- **User Analytics**: Active users, retention, engagement
- **Chat Analytics**: Message volume, response times, satisfaction
- **Knowledge Base**: Document usage, search performance
- **Workflow Analytics**: Execution rates, success metrics

## 🔒 Security

### Authentication & Authorization
- **JWT Tokens**: Secure access and refresh token system
- **2FA Support**: TOTP-based two-factor authentication
- **Role-Based Access**: Granular permissions system
- **Session Security**: Secure cookie handling and session management

### Data Protection
- **Input Validation**: Comprehensive Zod schema validation
- **SQL Injection Protection**: Parameterized queries with Prisma
- **XSS Protection**: Content Security Policy and input sanitization
- **Rate Limiting**: API rate limiting and DDoS protection

### Infrastructure Security
- **HTTPS Enforcement**: Force HTTPS in production
- **Security Headers**: HSTS, CSP, X-Frame-Options, X-Content-Type-Options
- **Container Security**: Non-root containers, minimal attack surface
- **Secrets Management**: Environment-based secret handling

## 🎛️ Configuration

### Environment Variables

#### Frontend Configuration
```env
# API Configuration
VITE_API_URL=https://api.your-domain.com/api
VITE_WS_URL=wss://api.your-domain.com

# Feature Flags
VITE_ENABLE_STREAMING=true
VITE_ENABLE_FILE_UPLOAD=true
VITE_ENABLE_ANALYTICS=true
VITE_ENABLE_WORKFLOWS=true
VITE_ENABLE_2FA=true

# File Upload Limits
VITE_MAX_FILE_SIZE=52428800
VITE_ALLOWED_FILE_TYPES=.pdf,.doc,.docx,.txt,.md,.jpg,.jpeg,.png,.gif
```

#### Backend Configuration
```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ntg_chatbot

# Cache
REDIS_URL=redis://localhost:6379

# Security
JWT_SECRET=your-super-secure-jwt-secret
ENCRYPTION_KEY=your-32-character-encryption-key

# AI Integration
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4

# External Services
SUPABASE_URL=https://your-project.supabase.co
N8N_WEBHOOK_URL=https://your-domain.com/webhook
```

### Feature Flags
Control platform capabilities:
- **Streaming**: Real-time AI response streaming
- **File Upload**: Document upload in chat
- **Analytics**: Usage analytics and reporting
- **Workflows**: Workflow automation features
- **2FA**: Two-factor authentication

## 📚 API Documentation

### Authentication
```http
POST /api/auth/login          # User login
POST /api/auth/register       # User registration
POST /api/auth/logout         # User logout
GET  /api/auth/me            # Current user info
POST /api/auth/refresh       # Refresh tokens
POST /api/auth/2fa/setup     # Setup 2FA
POST /api/auth/2fa/verify    # Verify 2FA
```

### Chat Management
```http
GET  /api/conversations                    # List conversations
POST /api/conversations                    # Create conversation
GET  /api/conversations/:id/messages       # Get messages
POST /api/conversations/:id/messages       # Send message
POST /api/conversations/:id/messages/stream # Stream message
DELETE /api/conversations/:id              # Delete conversation
```

### Knowledge Base
```http
GET  /api/knowledge/documents              # List documents
POST /api/knowledge/documents              # Upload document
DELETE /api/knowledge/documents/:id        # Delete document
POST /api/knowledge/search                 # Search documents
GET  /api/knowledge/documents/:id/status   # Processing status
```

### Workflows
```http
GET  /api/workflows                        # List workflows
POST /api/workflows                        # Create workflow
PUT  /api/workflows/:id                    # Update workflow
DELETE /api/workflows/:id                  # Delete workflow
POST /api/workflows/:id/execute            # Execute workflow
GET  /api/workflows/:id/executions         # Execution history
```

### Tenant Management
```http
GET  /api/tenant                          # Get tenant info
PUT  /api/tenant/settings                 # Update settings
GET  /api/tenant/users                    # List tenant users
POST /api/tenant/integrations             # Create integration
```

## 🔧 Troubleshooting

### Common Issues

#### Database Connection
```bash
# Check database status
docker-compose ps postgres

# View logs
docker-compose logs postgres

# Reset database
docker-compose down -v postgres
docker-compose up -d postgres
```

#### Redis Issues
```bash
# Test Redis connection
docker-compose exec redis redis-cli ping

# Clear Redis cache
docker-compose exec redis redis-cli FLUSHALL
```

#### Build Issues
```bash
# Clear caches
rm -rf frontend/node_modules frontend/.vite
rm -rf backend/node_modules backend/dist

# Reinstall dependencies
npm run clean && npm install
```

#### Performance Issues
```bash
# Analyze bundle size
cd frontend && npm run build:analyze

# Check memory usage
docker stats

# Monitor API performance
curl -w "@curl-format.txt" -s -o /dev/null http://localhost:3001/api/health
```

### Debug Mode
```bash
# Enable debug logging
DEBUG=ntg:* npm run dev

# Frontend debug mode
VITE_DEBUG=true npm run dev:frontend

# Backend debug mode
NODE_ENV=development DEBUG=* npm run dev:backend
```

## 🚀 Performance Optimization

### Frontend Optimization
- **Code Splitting**: Route-based lazy loading
- **Bundle Optimization**: Tree shaking and minification
- **Image Optimization**: Lazy loading and WebP format
- **Caching**: Service worker and browser caching
- **PWA Features**: Offline support and app-like experience

### Backend Optimization
- **Database Indexing**: Optimized query performance
- **Connection Pooling**: Efficient database connections
- **Redis Caching**: Frequently accessed data caching
- **Compression**: Gzip/Brotli response compression
- **Load Balancing**: Horizontal scaling support

### Infrastructure Optimization
- **CDN Integration**: Static asset delivery
- **Database Optimization**: Query optimization and indexing
- **Container Optimization**: Multi-stage builds and minimal images
- **Monitoring**: Real-time performance tracking

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Make changes with tests
4. Run test suite: `npm test`
5. Commit: `git commit -m 'feat: add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. Create Pull Request

### Code Standards
- **TypeScript**: Strict type checking
- **ESLint**: Code linting and formatting
- **Prettier**: Code formatting
- **Conventional Commits**: Standardized commit messages
- **Test Coverage**: Minimum 80% coverage requirement

### Review Process
- Automated CI/CD checks
- Code review by maintainers
- Security scan validation
- Performance impact assessment

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Comprehensive guides and API docs
- **Issues**: GitHub Issues for bugs and feature requests
- **Discussions**: GitHub Discussions for questions
- **Security**: security@your-domain.com for security issues

## 📋 Changelog

### v1.0.0 (Production Ready)
- ✅ Complete frontend-backend API integration
- ✅ Multi-tenant architecture with custom branding
- ✅ Real-time chat with WebSocket and streaming
- ✅ Knowledge base with RAG and document processing
- ✅ Workflow automation with n8n integration
- ✅ Comprehensive testing suite (unit, integration, E2E)
- ✅ Production deployment configuration
- ✅ Security hardening and input validation
- ✅ Performance optimization and monitoring
- ✅ Analytics dashboard and reporting
- ✅ PWA support with offline capabilities
- ✅ Docker containerization with health checks
- ✅ SSL/TLS configuration and security headers
