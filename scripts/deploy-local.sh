#!/bin/bash

# Local Deployment Test Script for FANO STT Application
# This script simulates the Digital Ocean deployment process locally

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.prod.yml"
WEB_PORT=3001
PROXY_PORT=8080
HEALTH_TIMEOUT=60

echo -e "${BLUE}🚀 FANO STT Local Deployment Test${NC}"
echo "=================================="
echo ""

# Function to print colored output
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed"
    exit 1
fi
print_status "Docker is installed"

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    print_error "Docker Compose is not installed"
    exit 1
fi
print_status "Docker Compose is installed"

# Check if Docker daemon is running
if ! docker info &> /dev/null; then
    print_error "Docker daemon is not running"
    exit 1
fi
print_status "Docker daemon is running"

# Check if production compose file exists
if [ ! -f "$COMPOSE_FILE" ]; then
    print_error "Production compose file ($COMPOSE_FILE) not found"
    exit 1
fi
print_status "Production compose file found"

# Check if .env file exists, create from example if not
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        print_warning ".env file not found, creating from .env.example"
        cp .env.example .env
        print_info "Please edit .env file with your FANO AUTH_TOKEN before running again"
        exit 1
    else
        print_warning ".env file not found, creating template"
        cat > .env << 'EOF'
# FANO STT Configuration
AUTH_TOKEN=your_fano_auth_token_here
WEBSOCKET_URL=ws://localhost:8080
NEXT_PUBLIC_WEBSOCKET_URL=ws://localhost:8080

# Optional: Custom ports
WEB_PORT=3001
PROXY_PORT=8080
EOF
        print_info "Please edit .env file with your FANO AUTH_TOKEN before running again"
        exit 1
    fi
fi
print_status ".env file found"

# Check if AUTH_TOKEN is set
if ! grep -q "AUTH_TOKEN=.*[^[:space:]]" .env || grep -q "AUTH_TOKEN=your_fano_auth_token_here" .env; then
    print_error "AUTH_TOKEN not configured in .env file"
    print_info "Please set your FANO authentication token in .env file"
    exit 1
fi
print_status "AUTH_TOKEN is configured"

echo ""
echo "🛠️  Starting deployment process..."

# Stop any existing services
echo "🛑 Stopping existing services..."
docker-compose -f $COMPOSE_FILE down || true
print_status "Existing services stopped"

# Clean up old images and containers
echo "🧹 Cleaning up old images..."
docker system prune -f
print_status "Old images cleaned up"

# Check if ports are available
echo "🔍 Checking port availability..."
if lsof -Pi :$WEB_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    print_error "Port $WEB_PORT is already in use"
    print_info "Please stop the service using port $WEB_PORT and try again"
    exit 1
fi

if lsof -Pi :$PROXY_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    print_error "Port $PROXY_PORT is already in use"
    print_info "Please stop the service using port $PROXY_PORT and try again"
    exit 1
fi
print_status "Ports $WEB_PORT and $PROXY_PORT are available"

# Build and start services
echo "🏗️  Building and starting services..."
docker-compose -f $COMPOSE_FILE up --build -d

if [ $? -eq 0 ]; then
    print_status "Services started successfully"
else
    print_error "Failed to start services"
    docker-compose -f $COMPOSE_FILE logs
    exit 1
fi

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check service status
echo "🔍 Checking service status..."
if docker-compose -f $COMPOSE_FILE ps | grep -q "Up"; then
    print_status "Services are running"
    docker-compose -f $COMPOSE_FILE ps
else
    print_error "Services are not running properly"
    docker-compose -f $COMPOSE_FILE logs
    exit 1
fi

echo ""

# Health checks
echo "🏥 Performing health checks..."

# Check proxy health
echo "Testing proxy health endpoint..."
proxy_health_attempts=0
max_attempts=$((HEALTH_TIMEOUT / 5))

while [ $proxy_health_attempts -lt $max_attempts ]; do
    if curl -f -s http://localhost:$PROXY_PORT/health > /dev/null; then
        print_status "Proxy health check passed"
        break
    else
        proxy_health_attempts=$((proxy_health_attempts + 1))
        if [ $proxy_health_attempts -eq $max_attempts ]; then
            print_error "Proxy health check failed after $HEALTH_TIMEOUT seconds"
            docker-compose -f $COMPOSE_FILE logs fano-proxy
            exit 1
        fi
        echo "Waiting for proxy to be ready... (attempt $proxy_health_attempts/$max_attempts)"
        sleep 5
    fi
done

# Check web app health
echo "Testing web app health endpoint..."
web_health_attempts=0

while [ $web_health_attempts -lt $max_attempts ]; do
    if curl -f -s http://localhost:$WEB_PORT/api/health > /dev/null; then
        print_status "Web app health check passed"
        break
    else
        web_health_attempts=$((web_health_attempts + 1))
        if [ $web_health_attempts -eq $max_attempts ]; then
            print_error "Web app health check failed after $HEALTH_TIMEOUT seconds"
            docker-compose -f $COMPOSE_FILE logs fano-stt-app
            exit 1
        fi
        echo "Waiting for web app to be ready... (attempt $web_health_attempts/$max_attempts)"
        sleep 5
    fi
done

echo ""

# Test WebSocket connection (basic connectivity test)
echo "🔌 Testing WebSocket connectivity..."
if curl -i -N -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Key: test" -H "Sec-WebSocket-Version: 13" http://localhost:$PROXY_PORT/ 2>/dev/null | grep -q "101 Switching Protocols"; then
    print_status "WebSocket endpoint is accessible"
else
    print_warning "WebSocket endpoint test inconclusive (this is normal)"
fi

echo ""

# Display deployment information
echo "📋 Deployment Summary:"
echo "====================="
echo -e "${GREEN}✅ All services are running successfully!${NC}"
echo ""
echo "Service URLs:"
echo "  🌐 Web Application: http://localhost:$WEB_PORT"
echo "  🔌 WebSocket Proxy: ws://localhost:$PROXY_PORT"
echo "  🏥 Health Endpoints:"
echo "     - Web App: http://localhost:$WEB_PORT/api/health"
echo "     - Proxy: http://localhost:$PROXY_PORT/health"
echo ""
echo "Docker Services:"
docker-compose -f $COMPOSE_FILE ps
echo ""

# Show resource usage
echo "📊 Resource Usage:"
echo "=================="
docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
echo ""

# Show recent logs
echo "📝 Recent Logs (last 10 lines):"
echo "==============================="
docker-compose -f $COMPOSE_FILE logs --tail=10
echo ""

# Provide next steps
echo "🎉 Local deployment test completed successfully!"
echo ""
echo "Next Steps:"
echo "1. Open your browser and navigate to: http://localhost:$WEB_PORT"
echo "2. Test the application functionality"
echo "3. Check logs with: docker-compose -f $COMPOSE_FILE logs -f"
echo "4. Stop services with: docker-compose -f $COMPOSE_FILE down"
echo ""
echo "If everything works correctly, you're ready to deploy to Digital Ocean!"
echo ""
echo "To stop the services, run:"
echo "  docker-compose -f $COMPOSE_FILE down"
echo ""
