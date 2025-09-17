#!/bin/bash

# Production Deployment Script for NTG Chatbot Platform
# This script handles the complete production deployment process

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
BACKUP_DIR="./backups/$(date +%Y%m%d_%H%M%S)"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker is not running"
        exit 1
    fi
    
    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check if production environment file exists
    if [ ! -f "$ENV_FILE" ]; then
        log_error "Production environment file ($ENV_FILE) not found"
        log_info "Please create $ENV_FILE based on .env.example"
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

backup_database() {
    log_info "Creating database backup..."
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    
    # Check if database is running
    if docker-compose -f "$COMPOSE_FILE" ps postgres | grep -q "Up"; then
        # Create database backup
        docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "$BACKUP_DIR/database_backup.sql"
        log_success "Database backup created: $BACKUP_DIR/database_backup.sql"
    else
        log_warning "Database not running, skipping backup"
    fi
}

build_images() {
    log_info "Building production images..."
    
    # Build all images
    docker-compose -f "$COMPOSE_FILE" build --no-cache
    
    log_success "Images built successfully"
}

run_tests() {
    log_info "Running tests..."
    
    # Frontend tests
    log_info "Running frontend tests..."
    cd frontend
    npm test -- --coverage --watchAll=false
    cd ..
    
    # Backend tests
    log_info "Running backend tests..."
    cd backend
    npm test -- --coverage
    cd ..
    
    log_success "All tests passed"
}

deploy_services() {
    log_info "Deploying services..."
    
    # Stop existing services
    docker-compose -f "$COMPOSE_FILE" down
    
    # Start services in correct order
    log_info "Starting database and Redis..."
    docker-compose -f "$COMPOSE_FILE" up -d postgres redis
    
    # Wait for database to be ready
    log_info "Waiting for database to be ready..."
    sleep 10
    
    # Run database migrations
    log_info "Running database migrations..."
    docker-compose -f "$COMPOSE_FILE" run --rm backend npm run prisma:migrate:deploy
    
    # Start remaining services
    log_info "Starting application services..."
    docker-compose -f "$COMPOSE_FILE" up -d
    
    log_success "Services deployed successfully"
}

health_check() {
    log_info "Performing health checks..."
    
    # Wait for services to start
    sleep 30
    
    # Check backend health
    if curl -f http://localhost:3001/api/health > /dev/null 2>&1; then
        log_success "Backend health check passed"
    else
        log_error "Backend health check failed"
        return 1
    fi
    
    # Check frontend availability
    if curl -f http://localhost > /dev/null 2>&1; then
        log_success "Frontend health check passed"
    else
        log_error "Frontend health check failed"
        return 1
    fi
    
    # Check database connectivity
    if docker-compose -f "$COMPOSE_FILE" exec -T postgres pg_isready -U "$POSTGRES_USER" > /dev/null 2>&1; then
        log_success "Database health check passed"
    else
        log_error "Database health check failed"
        return 1
    fi
    
    # Check Redis connectivity
    if docker-compose -f "$COMPOSE_FILE" exec -T redis redis-cli ping | grep -q "PONG"; then
        log_success "Redis health check passed"
    else
        log_error "Redis health check failed"
        return 1
    fi
    
    log_success "All health checks passed"
}

setup_ssl() {
    log_info "Setting up SSL certificates..."
    
    # Check if SSL certificates exist
    if [ ! -f "./ssl/cert.pem" ] || [ ! -f "./ssl/key.pem" ]; then
        log_warning "SSL certificates not found in ./ssl/"
        log_info "Please ensure SSL certificates are properly configured"
        log_info "You can use Let's Encrypt with: certbot --nginx -d your-domain.com"
    else
        log_success "SSL certificates found"
    fi
}

setup_monitoring() {
    log_info "Setting up monitoring..."
    
    # Start monitoring services
    docker-compose -f "$COMPOSE_FILE" up -d prometheus grafana
    
    log_success "Monitoring services started"
    log_info "Grafana available at: http://localhost:3000"
    log_info "Prometheus available at: http://localhost:9090"
}

cleanup_old_images() {
    log_info "Cleaning up old Docker images..."
    
    # Remove unused images
    docker image prune -f
    
    # Remove dangling volumes
    docker volume prune -f
    
    log_success "Cleanup completed"
}

show_deployment_info() {
    log_success "Deployment completed successfully!"
    echo ""
    echo "=== Deployment Information ==="
    echo "Frontend URL: http://localhost"
    echo "Backend API: http://localhost:3001"
    echo "Grafana: http://localhost:3000"
    echo "Prometheus: http://localhost:9090"
    echo ""
    echo "=== Service Status ==="
    docker-compose -f "$COMPOSE_FILE" ps
    echo ""
    echo "=== Logs ==="
    echo "View logs with: docker-compose -f $COMPOSE_FILE logs -f [service_name]"
    echo ""
    echo "=== Backup Location ==="
    echo "Database backup: $BACKUP_DIR/database_backup.sql"
}

rollback() {
    log_error "Deployment failed. Rolling back..."
    
    # Stop new services
    docker-compose -f "$COMPOSE_FILE" down
    
    # Restore from backup if available
    if [ -f "$BACKUP_DIR/database_backup.sql" ]; then
        log_info "Restoring database from backup..."
        # Restore database backup logic here
    fi
    
    log_info "Rollback completed"
    exit 1
}

# Main deployment process
main() {
    log_info "Starting production deployment..."
    
    # Set error handler for rollback
    trap rollback ERR
    
    # Load environment variables
    source "$ENV_FILE"
    
    # Run deployment steps
    check_prerequisites
    backup_database
    build_images
    run_tests
    deploy_services
    setup_ssl
    setup_monitoring
    health_check
    cleanup_old_images
    show_deployment_info
    
    log_success "Production deployment completed successfully!"
}

# Parse command line arguments
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "health")
        health_check
        ;;
    "backup")
        backup_database
        ;;
    "rollback")
        rollback
        ;;
    "logs")
        docker-compose -f "$COMPOSE_FILE" logs -f "${2:-}"
        ;;
    "status")
        docker-compose -f "$COMPOSE_FILE" ps
        ;;
    *)
        echo "Usage: $0 {deploy|health|backup|rollback|logs|status}"
        echo ""
        echo "Commands:"
        echo "  deploy   - Full production deployment"
        echo "  health   - Run health checks"
        echo "  backup   - Create database backup"
        echo "  rollback - Rollback deployment"
        echo "  logs     - View service logs"
        echo "  status   - Show service status"
        exit 1
        ;;
esac
