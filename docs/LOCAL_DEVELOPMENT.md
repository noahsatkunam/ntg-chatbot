# Local Development Setup Guide

This guide will help you set up the NTG Chatbot Platform for local development without Docker dependencies.

## Prerequisites

- Node.js 18+ and npm 8+
- Git

## Quick Start

1. **Clone and setup the project:**
   ```bash
   git clone <repository-url>
   cd ntg-chatbot
   npm run dev:setup
   ```

2. **Start the development environment:**
   ```bash
   npm run dev:start
   ```

3. **Access the application:**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001
   - Health Check: http://localhost:3001/api/health

## Detailed Setup

### 1. Environment Configuration

The setup script automatically creates `.env.local` from `.env.example`. This file contains:

- **SQLite Database**: Uses `file:./dev.db` for local development
- **Mock Services**: Redis, AI APIs, email, and file storage are mocked
- **Development Flags**: Debug logging and relaxed rate limits enabled

### 2. Database Setup

The project uses SQLite for local development with a separate Prisma schema:

```bash
# Manual database setup (if needed)
cd backend
npm run prisma:generate:dev
npm run prisma:push:dev
npm run prisma:seed  # Optional: seed with test data
```

### 3. Mock Services

Local development uses mock implementations for external services:

- **Redis**: In-memory cache
- **AI Services**: Mock OpenAI/Anthropic responses
- **Email**: Console logging instead of SMTP
- **File Storage**: Local filesystem
- **Vector Database**: In-memory mock collections

## Available Scripts

### Root Level Scripts

- `npm run dev:setup` - Complete environment setup
- `npm run dev:start` - Start both frontend and backend concurrently
- `npm run env:validate` - Validate environment configuration
- `npm run health:check` - Check backend health status

### Backend Scripts

- `npm run dev` - Start backend development server
- `npm run db:setup` - Setup SQLite database
- `npm run prisma:studio` - Open Prisma Studio for database management

### Frontend Scripts

- `npm run dev` - Start frontend development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Development Workflow

### Starting Development

```bash
# First time setup
npm run dev:setup

# Daily development
npm run dev:start
```

### Database Management

```bash
# View/edit data in browser
cd backend && npm run prisma:studio

# Reset database
cd backend && npm run prisma:reset

# Generate new migration (when schema changes)
cd backend && npm run prisma:migrate:dev
```

### Testing API Endpoints

The backend provides several health check endpoints:

- `GET /api/health` - Service health status
- `GET /api/ready` - Readiness check (stricter)
- `GET /api/live` - Liveness check (basic)

Example health check response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 123.456,
  "services": {
    "database": "healthy",
    "redis": "healthy (mock)",
    "openai": "healthy (mock)"
  },
  "mode": "local_development"
}
```

## File Structure

```
ntg-chatbot/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   ├── environment.ts      # Environment validation
│   │   │   └── localDevelopment.ts # Local dev configuration
│   │   ├── services/
│   │   │   └── mockServices.ts     # Mock service implementations
│   │   └── routes/
│   │       └── health.ts           # Health check endpoints
│   ├── prisma/
│   │   ├── schema.prisma           # Production schema
│   │   └── schema.dev.prisma       # Local development schema
│   └── dev.db                      # SQLite database (created automatically)
├── frontend/
│   └── .env.local                  # Frontend environment variables
├── scripts/
│   ├── dev-setup.js                # Setup script
│   └── dev-start.js                # Development startup script
├── .env.local                      # Local development environment
└── .env.example                    # Environment template
```

## Environment Variables

### Key Local Development Variables

```bash
# Database
DATABASE_URL="file:./dev.db"

# Development Mode
NODE_ENV="development"
DEVELOPMENT_MODE="local"

# Mock Services
USE_MOCK_AI="true"
USE_MOCK_EMAIL="true"
USE_MEMORY_CACHE="true"
USE_MEMORY_VECTOR_DB="true"
USE_LOCAL_STORAGE="true"

# Debug Settings
LOG_LEVEL="debug"
ENABLE_REQUEST_LOGGING="true"
```

## Troubleshooting

### Common Issues

1. **Port conflicts**: Change ports in `.env.local` if 3001 or 5173 are in use
2. **Database locked**: Stop all processes and delete `backend/dev.db` to reset
3. **Module not found**: Run `npm install` in root, backend, and frontend directories
4. **Permission errors**: Ensure you have write permissions in the project directory

### Logs and Debugging

- Backend logs appear in the terminal with colored output
- Frontend logs appear in browser console and terminal
- Database queries can be viewed with `LOG_LEVEL="debug"`
- Health endpoints provide service status information

### Resetting Environment

```bash
# Clean everything and start fresh
npm run clean
npm run dev:setup
```

## Production vs Development

| Feature | Development | Production |
|---------|-------------|------------|
| Database | SQLite | PostgreSQL |
| Redis | Mock (in-memory) | Real Redis |
| AI Services | Mock responses | Real API calls |
| Email | Console logging | SMTP server |
| File Storage | Local filesystem | MinIO/S3 |
| Authentication | Relaxed | Full security |

## Next Steps

After setting up local development:

1. **Explore the API**: Use the health endpoints to verify services
2. **Test chat functionality**: Create conversations and send messages
3. **Upload files**: Test file upload and processing
4. **Review logs**: Check console output for any issues
5. **Customize**: Modify `.env.local` for your specific needs

## Getting Help

- Check the health endpoints for service status
- Review console logs for error messages
- Ensure all dependencies are installed with `npm run install:all`
- Validate environment with `npm run env:validate`

For production deployment, see the main README.md file.
