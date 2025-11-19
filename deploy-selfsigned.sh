#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SERVER_IP="143.198.192.233"
DOMAIN="${SERVER_IP}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${PROJECT_DIR}/ssl-selfsigned"
NGINX_CONF="${PROJECT_DIR}/nginx-selfsigned.conf"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[SELF-SIGNED SSL]${NC} $1"
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

print_info() {
    echo -e "${CYAN}[INFO]${NC} $1"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."

    # Check if running as root or with sudo
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root or with sudo"
        exit 1
    fi

    # Check if docker/podman is available
    if command -v podman &> /dev/null; then
        CONTAINER_CMD="podman"
        COMPOSE_CMD="podman compose"
        print_info "Using Podman for container management"
    elif command -v docker &> /dev/null; then
        CONTAINER_CMD="docker"
        COMPOSE_CMD="docker compose"
        print_info "Using Docker for container management"
    else
        print_error "Neither Docker nor Podman is installed"
        exit 1
    fi

    # Check if openssl is available
    if ! command -v openssl &> /dev/null; then
        print_error "OpenSSL is not installed"
        print_info "Install with: apt install openssl"
        exit 1
    fi

    # Check if compose is available
    if ! $COMPOSE_CMD version &> /dev/null; then
        print_error "$COMPOSE_CMD is not available"
        exit 1
    fi

    print_success "Prerequisites check passed"
}

# Function to setup directories
setup_directories() {
    print_status "Setting up directories..."

    # Create necessary directories
    mkdir -p "${CERT_DIR}"
    mkdir -p "${PROJECT_DIR}/nginx-logs"
    mkdir -p "${PROJECT_DIR}/logs"

    # Set permissions
    chmod 755 "${CERT_DIR}"
    chmod 755 "${PROJECT_DIR}/nginx-logs"
    chmod 755 "${PROJECT_DIR}/logs"

    print_success "Directories created successfully"
}

# Function to get domain/IP from user
get_domain() {
    echo ""
    print_info "Self-Signed SSL Certificate Setup"
    print_info "================================="
    print_warning "Self-signed certificates will show security warnings in browsers!"
    print_info "This is intended for:"
    print_info "• Development and testing"
    print_info "• Internal networks"
    print_info "• When Let's Encrypt is not available"
    echo ""

    read -p "Enter domain or IP address (default: ${SERVER_IP}): " input_domain
    if [[ -n "$input_domain" ]]; then
        DOMAIN="$input_domain"
    fi

    print_success "Using domain/IP: ${DOMAIN}"
}

# Function to generate self-signed certificate
generate_selfsigned_certificate() {
    print_status "Generating self-signed SSL certificate for ${DOMAIN}..."

    # Create certificate directory structure
    mkdir -p "${CERT_DIR}/live/${DOMAIN}"

    # Generate private key
    openssl genrsa -out "${CERT_DIR}/live/${DOMAIN}/privkey.pem" 2048

    # Create certificate signing request configuration
    cat > "${CERT_DIR}/cert.conf" << EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = v3_req

[dn]
C=US
ST=Development
L=Development
O=FANO STT
OU=Development
CN=${DOMAIN}

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${DOMAIN}
DNS.2 = localhost
DNS.3 = *.${DOMAIN}
IP.1 = ${SERVER_IP}
IP.2 = 127.0.0.1
EOF

    # Generate certificate signing request
    openssl req -new -key "${CERT_DIR}/live/${DOMAIN}/privkey.pem" \
                -out "${CERT_DIR}/live/${DOMAIN}/cert.csr" \
                -config "${CERT_DIR}/cert.conf"

    # Generate self-signed certificate (valid for 365 days)
    openssl x509 -req -in "${CERT_DIR}/live/${DOMAIN}/cert.csr" \
                 -signkey "${CERT_DIR}/live/${DOMAIN}/privkey.pem" \
                 -out "${CERT_DIR}/live/${DOMAIN}/fullchain.pem" \
                 -days 365 \
                 -extensions v3_req \
                 -extfile "${CERT_DIR}/cert.conf"

    # Create chain file (same as fullchain for self-signed)
    cp "${CERT_DIR}/live/${DOMAIN}/fullchain.pem" "${CERT_DIR}/live/${DOMAIN}/cert.pem"

    # Set proper permissions
    chmod 600 "${CERT_DIR}/live/${DOMAIN}/privkey.pem"
    chmod 644 "${CERT_DIR}/live/${DOMAIN}/fullchain.pem"
    chmod 644 "${CERT_DIR}/live/${DOMAIN}/cert.pem"

    # Verify certificate
    if openssl x509 -in "${CERT_DIR}/live/${DOMAIN}/fullchain.pem" -text -noout > /dev/null 2>&1; then
        print_success "Self-signed SSL certificate generated successfully"

        # Display certificate information
        print_info "Certificate Details:"
        openssl x509 -in "${CERT_DIR}/live/${DOMAIN}/fullchain.pem" -noout -subject -issuer -dates
    else
        print_error "Failed to generate self-signed SSL certificate"
        exit 1
    fi
}

# Function to create nginx configuration for self-signed SSL
create_nginx_config() {
    print_status "Creating nginx configuration for self-signed SSL..."

    cat > "${NGINX_CONF}" << EOF
# HTTP to HTTPS redirect
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$server_name\$request_uri;
}

# HTTPS server for Next.js app (Self-Signed SSL)
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};

    # Self-Signed SSL Configuration
    ssl_certificate /etc/nginx/ssl/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/live/${DOMAIN}/privkey.pem;
    ssl_session_cache shared:SSL:1m;
    ssl_session_timeout 10m;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-AES256-GCM-SHA384;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: ws: wss: data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self';" always;
    add_header Permissions-Policy "interest-cohort=()";

    # Enable gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;

    # Main Next.js application
    location / {
        proxy_pass http://fano-stt-app:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # WebSocket proxy for FANO STT (port 8080)
    location /ws/ {
        proxy_pass http://fano-proxy:8080/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    # Static files caching
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)\$ {
        proxy_pass http://fano-stt-app:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\\n";
        add_header Content-Type text/plain;
    }

    # API endpoints (if any)
    location /api/ {
        proxy_pass http://fano-stt-app:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
EOF

    print_success "Nginx configuration created: ${NGINX_CONF}"
}

# Function to create docker-compose file for self-signed SSL
create_compose_config() {
    print_status "Creating docker-compose configuration for self-signed SSL..."

    cat > "${PROJECT_DIR}/docker-compose.selfsigned.yml" << 'EOF'
version: "3.8"

services:
  # Main FANO STT Application
  fano-stt-app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: fano-stt-app-ssl
    environment:
      - NODE_ENV=production
      - PORT=3001
    expose:
      - "3001"
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    networks:
      - fano-network
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://localhost:3001/health",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # FANO STT Proxy Service
  fano-proxy:
    build:
      context: .
      dockerfile: Dockerfile.proxy
    container_name: fano-proxy-ssl
    environment:
      - NODE_ENV=production
      - PORT=8080
      - AUTH_TOKEN=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJmYW5vX2RldiI6dHJ1ZSwiZXhwIjoxNzY3MzAwNzk5fQ.d7zBL2bH-qJ6uK5yGHKZPhhRQX0dWRxCYCw2aVq-8wgZY-dvYZ8dTL3vHqQvlDEfgJWr5kK6uT5hP4kQJvF0ePEv7jKvPKJAhOG4h8LH6bNGvnD3wE1YkV7x0iEgFKq6uQ6KYPXsAkGhHgJP-KjVa_a8YvQNWfj4YGvAQoA5v5h
    expose:
      - "8080"
    volumes:
      - ./logs:/app/logs
    restart: unless-stopped
    networks:
      - fano-network
    healthcheck:
      test:
        [
          "CMD",
          "node",
          "-e",
          "const http = require('http'); http.get('http://localhost:8080', (res) => { process.exit(res.statusCode === 404 ? 0 : 1); }).on('error', () => process.exit(1));",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Nginx SSL Reverse Proxy (Self-Signed)
  nginx:
    image: nginx:1.25-alpine
    container_name: fano-nginx-ssl
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx-selfsigned.conf:/etc/nginx/conf.d/default.conf:ro
      - ./ssl-selfsigned:/etc/nginx/ssl:ro
      - ./nginx-logs:/var/log/nginx
    depends_on:
      - fano-stt-app
      - fano-proxy
    restart: unless-stopped
    networks:
      - fano-network
    healthcheck:
      test:
        [
          "CMD",
          "wget",
          "--no-verbose",
          "--tries=1",
          "--spider",
          "http://localhost:80/health",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

networks:
  fano-network:
    driver: bridge

volumes:
  nginx-logs:
    driver: local
EOF

    print_success "Docker-compose configuration created: docker-compose.selfsigned.yml"
}

# Function to start services
start_services() {
    print_status "Starting services with self-signed SSL..."

    # Stop any existing services
    $COMPOSE_CMD -f docker-compose.selfsigned.yml down --remove-orphans || true
    $COMPOSE_CMD -f docker-compose.ssl.yml down --remove-orphans || true
    $COMPOSE_CMD -f docker-compose.yml down --remove-orphans || true

    # Start services
    $COMPOSE_CMD -f docker-compose.selfsigned.yml up --build -d

    # Wait for services to be ready
    print_status "Waiting for services to be ready..."
    sleep 15

    # Check if services are running
    if $COMPOSE_CMD -f docker-compose.selfsigned.yml ps | grep -q "Up"; then
        print_success "Services are running with self-signed SSL!"
    else
        print_error "Failed to start services"
        $COMPOSE_CMD -f docker-compose.selfsigned.yml ps
        $COMPOSE_CMD -f docker-compose.selfsigned.yml logs
        exit 1
    fi
}

# Function to test SSL configuration
test_ssl() {
    print_status "Testing self-signed SSL configuration..."

    # Test HTTP redirect
    print_info "Testing HTTP to HTTPS redirect..."
    HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://${DOMAIN}/health" || echo "000")
    if [[ "$HTTP_RESPONSE" == "301" ]]; then
        print_success "HTTP to HTTPS redirect working"
    else
        print_warning "HTTP redirect may not be working (got $HTTP_RESPONSE)"
    fi

    # Test HTTPS (ignore certificate errors for self-signed)
    print_info "Testing HTTPS endpoint..."
    if curl -k -s -f "https://${DOMAIN}/health" > /dev/null; then
        print_success "HTTPS endpoint working (with self-signed certificate)"
    else
        print_error "HTTPS endpoint not working"
    fi

    print_info "WebSocket endpoint: wss://${DOMAIN}/ws/ (ignore certificate warnings)"
}

# Function to display browser instructions
display_browser_instructions() {
    echo ""
    print_warning "🔒 BROWSER SECURITY WARNINGS"
    print_warning "============================"
    print_warning "Self-signed certificates will show security warnings in browsers."
    print_warning "You MUST accept/bypass these warnings to use the application."
    echo ""

    print_info "📱 Browser-Specific Instructions:"
    echo ""

    print_info "🔹 Chrome/Chromium:"
    print_info "  1. Visit: https://${DOMAIN}"
    print_info "  2. Click 'Advanced' on the warning page"
    print_info "  3. Click 'Proceed to ${DOMAIN} (unsafe)'"
    print_info "  4. Or type 'thisisunsafe' on the warning page"
    echo ""

    print_info "🔹 Firefox:"
    print_info "  1. Visit: https://${DOMAIN}"
    print_info "  2. Click 'Advanced'"
    print_info "  3. Click 'Accept the Risk and Continue'"
    echo ""

    print_info "🔹 Safari:"
    print_info "  1. Visit: https://${DOMAIN}"
    print_info "  2. Click 'Show Details'"
    print_info "  3. Click 'visit this website'"
    print_info "  4. Click 'Visit Website' in the popup"
    echo ""

    print_info "🔹 Edge:"
    print_info "  1. Visit: https://${DOMAIN}"
    print_info "  2. Click 'Advanced'"
    print_info "  3. Click 'Continue to ${DOMAIN} (unsafe)'"
    echo ""
}

# Function to display final information
display_final_info() {
    echo ""
    print_success "🔐 Self-Signed SSL deployment completed successfully!"
    echo ""
    print_info "📊 Service Information:"
    print_info "======================"
    print_info "🌐 Web Application: https://${DOMAIN}"
    print_info "🔌 WebSocket Proxy: wss://${DOMAIN}/ws/"
    print_info "🔒 SSL Certificate: Self-Signed (365 days validity)"
    print_info "📁 Certificate Location: ${CERT_DIR}/live/${DOMAIN}/"
    echo ""

    print_info "🛠️ Management Commands:"
    print_info "======================"
    print_info "View logs: $COMPOSE_CMD -f docker-compose.selfsigned.yml logs -f"
    print_info "Stop services: $COMPOSE_CMD -f docker-compose.selfsigned.yml down"
    print_info "Restart services: $COMPOSE_CMD -f docker-compose.selfsigned.yml restart"
    print_info "View certificate: openssl x509 -in ${CERT_DIR}/live/${DOMAIN}/fullchain.pem -text -noout"
    echo ""

    print_info "🔍 Troubleshooting:"
    print_info "=================="
    print_info "Service status: $COMPOSE_CMD -f docker-compose.selfsigned.yml ps"
    print_info "Nginx logs: $COMPOSE_CMD -f docker-compose.selfsigned.yml logs nginx"
    print_info "App logs: $COMPOSE_CMD -f docker-compose.selfsigned.yml logs fano-stt-app"
    print_info "Test HTTPS: curl -k -I https://${DOMAIN}/health"
    echo ""

    display_browser_instructions

    print_warning "⚠️ Important Notes:"
    print_warning "=================="
    print_warning "• Self-signed certificates show browser warnings"
    print_warning "• Users must manually accept certificate in browser"
    print_warning "• Not recommended for production use"
    print_warning "• Certificate expires in 365 days"
    print_warning "• Consider using Let's Encrypt for production"
    echo ""

    print_info "🔄 To switch to Let's Encrypt SSL later:"
    print_info "sudo ./deploy-ssl.sh"
    echo ""

    print_success "🚀 Your FANO STT application is ready with Self-Signed HTTPS!"
    print_success "🎙️ Microphone access will work after accepting certificate warnings!"
}

# Function to create certificate renewal script
create_renewal_script() {
    print_status "Creating certificate renewal script..."

    cat > "${PROJECT_DIR}/renew-selfsigned.sh" << EOF
#!/bin/bash

# Self-Signed Certificate Renewal Script
# Run this when the certificate expires (365 days)

cd "${PROJECT_DIR}"

echo "Renewing self-signed certificate..."

# Backup old certificate
cp "${CERT_DIR}/live/${DOMAIN}/fullchain.pem" "${CERT_DIR}/live/${DOMAIN}/fullchain.pem.backup.\$(date +%Y%m%d)"

# Generate new certificate
openssl x509 -req -in "${CERT_DIR}/live/${DOMAIN}/cert.csr" \\
             -signkey "${CERT_DIR}/live/${DOMAIN}/privkey.pem" \\
             -out "${CERT_DIR}/live/${DOMAIN}/fullchain.pem" \\
             -days 365 \\
             -extensions v3_req \\
             -extfile "${CERT_DIR}/cert.conf"

# Restart nginx
$COMPOSE_CMD -f docker-compose.selfsigned.yml restart nginx

echo "Self-signed certificate renewed successfully!"
echo "New expiration date:"
openssl x509 -in "${CERT_DIR}/live/${DOMAIN}/fullchain.pem" -noout -dates | grep notAfter
EOF

    chmod +x "${PROJECT_DIR}/renew-selfsigned.sh"
    print_success "Renewal script created: ${PROJECT_DIR}/renew-selfsigned.sh"
}

# Function to cleanup on error
cleanup_on_error() {
    print_error "Deployment failed, cleaning up..."
    $COMPOSE_CMD -f docker-compose.selfsigned.yml down --remove-orphans || true

    print_info "Temporary files may remain in:"
    print_info "- ${CERT_DIR}"
    print_info "- ${NGINX_CONF}"
    print_info "- docker-compose.selfsigned.yml"
    print_info "Remove manually if needed."
}

# Set trap for cleanup on script exit
trap cleanup_on_error ERR

# Main execution
main() {
    echo ""
    print_success "🔐 FANO STT Self-Signed SSL Deployment Script"
    print_success "=============================================="
    print_warning "⚠️  This creates self-signed certificates that show browser warnings!"
    print_warning "⚠️  Use only for development/testing or when Let's Encrypt fails!"
    echo ""

    read -p "Continue with self-signed SSL setup? (y/N): " continue_setup
    if [[ ! "$continue_setup" =~ ^[Yy]$ ]]; then
        print_info "Setup cancelled. Use ./deploy-ssl.sh for proper SSL certificates."
        exit 0
    fi

    check_prerequisites
    setup_directories
    get_domain
    generate_selfsigned_certificate
    create_nginx_config
    create_compose_config
    start_services
    test_ssl
    create_renewal_script
    display_final_info

    # Remove trap since we completed successfully
    trap - ERR
}

# Run main function
main "$@"
