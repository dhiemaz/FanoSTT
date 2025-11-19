#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[FANO STT]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if podman compose is available
if ! podman compose version &> /dev/null; then
    print_error "podman compose is not available. Please install podman with compose support:"
    echo "  dnf install podman podman-compose"
    echo "  or"
    echo "  apt install podman podman-compose"
    exit 1
fi

# Function to cleanup
cleanup() {
    print_status "Shutting down services..."
    podman compose down --remove-orphans
    print_success "Services stopped"
}

# Set trap for cleanup on script exit
trap cleanup EXIT INT TERM

print_status "Starting FANO STT Application with Podman Compose..."
echo
print_status "Services:"
print_status "  📡 Proxy Server: ws://localhost:8080"
print_status "  🌐 Web App: http://localhost:3001"
echo

# Build and start services
print_status "Building and starting services..."
podman compose up --build -d

# Wait for services to be ready
print_status "Waiting for services to be ready..."
sleep 5

# Check if services are running
if podman compose ps | grep -q "Up"; then
    print_success "Services are running!"
    echo
    print_success "🚀 FANO STT Application is ready!"
    print_success "   Web Application: http://localhost:3001"
    print_success "   Proxy Server: ws://localhost:8080"
    echo
    print_status "View logs with: podman compose logs -f"
    print_status "Stop services with: podman compose down"
    echo

    # Follow logs
    print_status "Following logs (Press Ctrl+C to stop)..."
    podman compose logs -f
else
    print_error "Failed to start services"
    podman compose ps
    podman compose logs
    exit 1
fi
