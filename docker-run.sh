#!/bin/bash

# Fano STT - Simple Docker Run Script
# This script builds and runs the Fano STT application in Docker

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
IMAGE_NAME="fano-stt"
CONTAINER_NAME="fano-stt-app"
PORT=${PORT:-3000}

# Detect container runtime (Docker or Podman)
if command -v podman > /dev/null 2>&1; then
    CONTAINER_CMD="podman"
elif command -v docker > /dev/null 2>&1; then
    CONTAINER_CMD="docker"
else
    CONTAINER_CMD=""
fi

print_info() {
    echo -e "${BLUE}ℹ  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠  $1${NC}"
}

# Function to check if container runtime is available
check_docker() {
    if [ -z "$CONTAINER_CMD" ]; then
        print_error "Neither Docker nor Podman is installed. Please install one and try again."
        exit 1
    fi

    if ! $CONTAINER_CMD info > /dev/null 2>&1; then
        print_error "$CONTAINER_CMD is not running or accessible. Please start $CONTAINER_CMD and try again."
        exit 1
    fi
}

# Function to build the image
build_image() {
    print_info "Building container image with $CONTAINER_CMD..."
    $CONTAINER_CMD build -t $IMAGE_NAME .
    print_success "Image built successfully"
}

# Function to stop existing container
stop_container() {
    if $CONTAINER_CMD ps -q -f name=$CONTAINER_NAME > /dev/null 2>&1; then
        print_info "Stopping existing container..."
        $CONTAINER_CMD stop $CONTAINER_NAME > /dev/null 2>&1
        $CONTAINER_CMD rm $CONTAINER_NAME > /dev/null 2>&1
        print_success "Container stopped and removed"
    fi
}

# Function to run the container
run_container() {
    print_info "Starting Fano STT container..."

    # Check if .env.local exists and load it
    ENV_FILE=""
    if [ -f ".env.local" ]; then
        ENV_FILE="--env-file .env.local"
        print_info "Loading environment from .env.local"
    elif [ -f ".env" ]; then
        ENV_FILE="--env-file .env"
        print_info "Loading environment from .env"
    else
        print_warning "No environment file found. Using default values."
    fi

    $CONTAINER_CMD run -d \
        --name $CONTAINER_NAME \
        -p $PORT:3000 \
        $ENV_FILE \
        $IMAGE_NAME

    print_success "Container started successfully"
    print_info "Application is running at http://localhost:$PORT"
}

# Function to show logs
show_logs() {
    print_info "Showing container logs (Press Ctrl+C to exit)..."
    $CONTAINER_CMD logs -f $CONTAINER_NAME
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  build     Build the Docker image"
    echo "  run       Run the container (builds if needed)"
    echo "  stop      Stop the container"
    echo "  restart   Restart the container"
    echo "  logs      Show container logs"
    echo "  status    Show container status"
    echo "  clean     Stop and remove container and image"
    echo ""
    echo "Environment Variables:"
    echo "  PORT      Port to run on (default: 3000)"
    echo ""
    echo "Examples:"
    echo "  $0 run"
    echo "  PORT=8080 $0 run"
    echo "  $0 logs"
}

# Main script
main() {
    check_docker

    case "${1:-run}" in
        "build")
            build_image
            ;;
        "run")
            # Check if image exists, build if not
            if ! $CONTAINER_CMD image inspect $IMAGE_NAME > /dev/null 2>&1; then
                print_info "Image not found. Building..."
                build_image
            fi
            stop_container
            run_container
            ;;
        "stop")
            stop_container
            ;;
        "restart")
            stop_container
            if ! $CONTAINER_CMD image inspect $IMAGE_NAME > /dev/null 2>&1; then
                print_info "Image not found. Building..."
                build_image
            fi
            run_container
            ;;
        "logs")
            if $CONTAINER_CMD ps -q -f name=$CONTAINER_NAME > /dev/null 2>&1; then
                show_logs
            else
                print_error "Container is not running"
                exit 1
            fi
            ;;
        "status")
            if $CONTAINER_CMD ps -q -f name=$CONTAINER_NAME > /dev/null 2>&1; then
                print_success "Container is running"
                $CONTAINER_CMD ps -f name=$CONTAINER_NAME --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
            else
                print_warning "Container is not running"
            fi
            ;;
        "clean")
            print_info "Cleaning up..."
            stop_container
            if $CONTAINER_CMD image inspect $IMAGE_NAME > /dev/null 2>&1; then
                $CONTAINER_CMD rmi $IMAGE_NAME
                print_success "Image removed"
            fi
            print_success "Cleanup complete"
            ;;
        "help"|"-h"|"--help")
            show_usage
            ;;
        *)
            print_error "Unknown command: $1"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
