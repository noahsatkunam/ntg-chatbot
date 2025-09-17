# Docker Development Environment

This document describes the comprehensive Docker Compose setup for local development of the chatbot platform.

## 📋 Services Overview

The development environment includes the following services:

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | Next.js development server with hot reload |
| Backend | 5000 | Express API with TypeScript and hot reload |
| PostgreSQL | 5432 | Primary database (Supabase local) |
| Redis | 6379 | Session management and caching |
| MinIO | 9000/9001 | S3-compatible object storage |
| Qdrant | 6333/6334 | Vector database for embeddings |
| n8n | 5678 | Workflow automation platform |
| Prometheus | 9090 | Metrics collection |
| Grafana | 3001 | Metrics visualization |
| Adminer | 8080 | Database management UI (dev only) |
| MailHog | 8025 | Email testing (dev only) |

## 🚀 Quick Start

### Prerequisites
- Docker Desktop installed and running
- At least 8GB RAM allocated to Docker
- 20GB free disk space

### Initial Setup

1. **Clone the repository**
```bash
git clone <repository-url>
cd chatbot-platform
```

2. **Copy environment file**
```bash
cp .env.example .env
```

3. **Start all services**
```bash
docker-compose up -d
```

4. **Check service health**
```bash
docker-compose ps
```

## 🔧 Service Details

### Frontend (Next.js)
- **URL**: http://localhost:3000
- **Hot Reload**: Enabled via WATCHPACK_POLLING
- **Volume Mounts**: Source code mounted for live updates
- **Memory Limit**: 2GB (configurable)

### Backend (Express)
- **URL**: http://localhost:5000
- **Hot Reload**: Using tsx watch mode
- **Health Check**: http://localhost:5000/health
- **Memory Limit**: 1GB (configurable)

### PostgreSQL
- **Connection**: `postgresql://postgres:postgres@localhost:5432/chatbot_platform`
- **Admin UI**: http://localhost:8080 (Adminer)
- **Databases Created**:
  - `chatbot_platform` - Main application database
  - `n8n` - Workflow automation database
  - `qdrant_meta` - Vector database metadata

### Redis
- **Connection**: `redis://localhost:6379`
- **Max Memory**: 256MB with LRU eviction
- **Persistence**: AOF enabled

### MinIO (S3-Compatible Storage)
- **API**: http://localhost:9000
- **Console**: http://localhost:9001
- **Default Credentials**:
  - Access Key: `minioadmin`
  - Secret Key: `minioadmin`

### Qdrant (Vector Database)
- **API**: http://localhost:6333
- **Dashboard**: http://localhost:6333/dashboard
- **gRPC**: Port 6334

### n8n (Workflow Automation)
- **URL**: http://localhost:5678
- **Default Credentials**:
  - Username: `admin`
  - Password: `admin`

### Monitoring Stack
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001
  - Default login: `admin/admin`

## 📁 Volume Management

### Persistent Volumes
All data is persisted in Docker volumes:
- `postgres_data` - Database files
- `redis_data` - Redis persistence
- `minio_data` - Object storage
- `qdrant_data` - Vector database
- `n8n_data` - Workflows and credentials
- `prometheus_data` - Metrics history
- `grafana_data` - Dashboards and settings

### Development Volumes
Source code is mounted for hot reload:
```yaml
volumes:
  - ./frontend:/app
  - /app/node_modules  # Excluded for performance
  - /app/.next         # Excluded for performance
```

## 🛠️ Common Commands

### Start/Stop Services
```bash
# Start all services
docker-compose up -d

# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v

# Restart a specific service
docker-compose restart backend

# View logs
docker-compose logs -f backend
```

### Service Management
```bash
# Check service health
docker-compose ps

# Execute commands in containers
docker-compose exec backend npm run test
docker-compose exec postgres psql -U postgres

# Rebuild services
docker-compose build --no-cache
```

### Database Operations
```bash
# Run migrations
docker-compose exec postgres psql -U postgres -d chatbot_platform -f /migrations/00001_initial_schema.sql

# Access database CLI
docker-compose exec postgres psql -U postgres -d chatbot_platform

# Backup database
docker-compose exec postgres pg_dump -U postgres chatbot_platform > backup.sql
```

## 🔒 Security Considerations

### Development vs Production
- All default passwords should be changed for production
- Network isolation is configured via custom bridge network
- Services run as non-root users where possible
- Resource limits prevent runaway containers

### Environment Variables
- Sensitive values are in `.env` (gitignored)
- Default values provided for development
- Production values should use secrets management

## 🚨 Troubleshooting

### Common Issues

1. **Port conflicts**
   ```bash
   # Check what's using a port
   netstat -ano | findstr :3000
   ```

2. **Container won't start**
   ```bash
   # Check logs
   docker-compose logs <service-name>
   
   # Check health
   docker-compose ps
   ```

3. **Hot reload not working**
   - Ensure WATCHPACK_POLLING is enabled
   - Check volume mounts are correct
   - Restart the service

4. **Out of memory**
   - Increase Docker Desktop memory allocation
   - Adjust service resource limits in docker-compose.yml

### Reset Development Environment
```bash
# Complete reset (⚠️ deletes all data)
docker-compose down -v
docker system prune -a
docker-compose up -d
```

## 📊 Resource Usage

Typical resource usage with all services running:
- **CPU**: 2-4 cores
- **Memory**: 6-8GB
- **Disk**: ~5GB for volumes

## 🔄 Development Workflow

1. **Start services**: `docker-compose up -d`
2. **Check health**: All services should be "healthy"
3. **Develop**: Code changes auto-reload
4. **Test**: Access services via localhost
5. **Stop**: `docker-compose down`

## 🎯 Best Practices

1. **Use docker-compose.override.yml** for personal settings
2. **Don't commit .env files** with real credentials
3. **Monitor resource usage** to prevent system slowdown
4. **Regularly prune** unused Docker resources
5. **Use health checks** to ensure service availability

## 📚 Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Service Configuration Details](./service-configuration.md)
- [Production Deployment Guide](./production-deployment.md)
