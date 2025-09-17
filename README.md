# NTG Chatbot Platform

A modern, full-stack multi-tenant chatbot platform built with React, TypeScript, Node.js, and comprehensive backend services.

## 🏗️ Architecture

```
ntg-chatbot/
├── frontend/           # Vite + React + TypeScript frontend
├── backend/           # Express + TypeScript + Prisma backend
├── docs/             # Documentation
├── monitoring/       # Grafana & Prometheus configs
├── scripts/          # Database and utility scripts
├── supabase/         # Supabase migrations and functions
└── archived-nextjs-frontend/  # Legacy Next.js frontend (archived)
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Docker & Docker Compose
- PostgreSQL (or use Docker setup)

### Development Setup

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd ntg-chatbot
npm run install:all
```

2. **Environment setup:**
```bash
# Copy environment files
cp .env.example .env
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env

# Update the .env files with your configuration
```

3. **Start development servers:**
```bash
# Start both frontend and backend concurrently
npm run dev

# Or start individually
npm run dev:frontend  # Frontend on http://localhost:3000
npm run dev:backend   # Backend on http://localhost:5000
```

### Docker Development

```bash
# Start all services with Docker Compose
npm run docker:dev

# Or manually
docker-compose up --build
```

## 📦 Available Scripts

### Root Level Commands
- `npm run dev` - Start both frontend and backend in development mode
- `npm run build` - Build both frontend and backend for production
- `npm run start` - Start both services in production mode
- `npm run lint` - Run linting on both frontend and backend
- `npm run install:all` - Install dependencies for all packages
- `npm run clean` - Clean all node_modules and build artifacts
- `npm run docker:dev` - Start development environment with Docker
- `npm run docker:prod` - Start production environment with Docker

### Frontend Commands (in `/frontend`)
- `npm run dev` - Start Vite development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run type-check` - Run TypeScript type checking

### Backend Commands (in `/backend`)
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run test` - Run tests

## 🛠️ Tech Stack

### Frontend
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **UI Library:** Radix UI + shadcn/ui components
- **Styling:** Tailwind CSS
- **State Management:** Zustand + React Query
- **Routing:** React Router
- **Forms:** React Hook Form + Zod validation

### Backend
- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Database:** PostgreSQL with Prisma ORM
- **Authentication:** JWT + bcrypt
- **Real-time:** Socket.io
- **File Storage:** MinIO (S3-compatible)
- **Vector Database:** Qdrant
- **Caching:** Redis
- **AI Integration:** OpenAI, Anthropic Claude
- **Security:** Helmet, CORS, rate limiting

### Infrastructure
- **Containerization:** Docker & Docker Compose
- **Monitoring:** Prometheus + Grafana
- **Workflow Automation:** n8n
- **Database:** PostgreSQL
- **Message Queue:** Redis
- **Reverse Proxy:** Nginx (production)

## 🔧 Configuration

### Environment Variables

Key environment variables to configure:

**Frontend (.env in /frontend):**
- `VITE_API_URL` - Backend API URL
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

**Backend (.env in /backend):**
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret (min 32 chars)
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `REDIS_URL` - Redis connection string

**Docker (.env in root):**
- All service ports and credentials for containerized deployment

## 🚢 Deployment

### Production Build
```bash
npm run build
npm run start
```

### Docker Production
```bash
npm run docker:prod
```

## 📚 Documentation

- [Manual Testing Guide](docs/MANUAL_TESTING_GUIDE.md)
- [Docker Development Setup](docs/docker-development.md)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 📄 License

This project is proprietary. All rights reserved.
