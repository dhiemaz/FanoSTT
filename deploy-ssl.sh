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
DEFAULT_DOMAIN="${SERVER_IP}.nip.io"
EMAIL="admin@example.com"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[SSL DEPLOY]${NC} $1"
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

    # Check if docker and docker-compose are available
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        exit 1
    fi

    if ! command -v docker-compose &> /dev/null; then
        print_error "docker-compose is not available"
        print_info "Install with: sudo apt-get install docker-compose"
        print_info "Or download: sudo curl -L \"https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)\" -o /usr/local/bin/docker-compose && sudo chmod +x /usr/local/bin/docker-compose"
        exit 1
    fi

    CONTAINER_CMD="docker"
    COMPOSE_CMD="docker-compose"
    print_info "Using Docker with docker-compose"

    print_success "Prerequisites check passed"
}

# Function to setup directories
setup_directories() {
    print_status "Setting up directories..."

    # Create necessary directories
    mkdir -p "${PROJECT_DIR}/ssl"
    mkdir -p "${PROJECT_DIR}/certbot-data"
    mkdir -p "${PROJECT_DIR}/nginx-logs"
    mkdir -p "${PROJECT_DIR}/logs"

    # Set permissions
    chmod 755 "${PROJECT_DIR}/ssl"
    chmod 755 "${PROJECT_DIR}/certbot-data"
    chmod 755 "${PROJECT_DIR}/nginx-logs"
    chmod 755 "${PROJECT_DIR}/logs"

    print_success "Directories created successfully"
}

# Function to get domain from user
get_domain() {
    echo ""
    print_info "SSL Certificate Domain Setup"
    print_info "============================"
    print_info "Let's Encrypt doesn't support bare IP addresses."
    print_info "You have the following options:"
    echo ""
    print_info "1. Use nip.io service (${DEFAULT_DOMAIN})"
    print_info "   - Works immediately"
    print_info "   - No DNS setup required"
    print_info "   - Perfect for testing/development"
    echo ""
    print_info "2. Use your own domain"
    print_info "   - Must be pointed to ${SERVER_IP}"
    print_info "   - Requires DNS configuration"
    print_info "   - Better for production"
    echo ""

    while true; do
        read -p "Choose option (1 for nip.io, 2 for custom domain): " choice
        case $choice in
            1)
                DOMAIN="${DEFAULT_DOMAIN}"
                print_success "Using domain: ${DOMAIN}"
                break
                ;;
            2)
                read -p "Enter your domain name: " custom_domain
                if [[ -n "$custom_domain" ]]; then
                    DOMAIN="$custom_domain"
                    print_success "Using domain: ${DOMAIN}"
                    print_warning "Make sure ${DOMAIN} points to ${SERVER_IP}"
                    read -p "Press Enter to continue after DNS is configured..."
                    break
                else
                    print_error "Domain cannot be empty"
                fi
                ;;
            *)
                print_error "Please choose 1 or 2"
                ;;
        esac
    done

    # Get email
    read -p "Enter email for Let's Encrypt (default: ${EMAIL}): " input_email
    if [[ -n "$input_email" ]]; then
        EMAIL="$input_email"
    fi
}

# Function to update nginx configuration with domain
update_nginx_config() {
    print_status "Updating nginx configuration for domain: ${DOMAIN}"

    # Create backup
    cp "${PROJECT_DIR}/nginx.conf" "${PROJECT_DIR}/nginx.conf.backup"

    # Update server_name in nginx.conf
    sed -i "s/server_name 143\.198\.192\.233;/server_name ${DOMAIN};/g" "${PROJECT_DIR}/nginx.conf"
    sed -i "s|ssl_certificate /etc/letsencrypt/live/143\.198\.192\.233/|ssl_certificate /etc/letsencrypt/live/${DOMAIN}/|g" "${PROJECT_DIR}/nginx.conf"
    sed -i "s|ssl_certificate_key /etc/letsencrypt/live/143\.198\.192\.233/|ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/|g" "${PROJECT_DIR}/nginx.conf"

    print_success "Nginx configuration updated"
}

# Function to update docker-compose SSL configuration
update_compose_config() {
    print_status "Updating docker-compose SSL configuration..."

    # Create backup
    cp "${PROJECT_DIR}/docker-compose.ssl.yml" "${PROJECT_DIR}/docker-compose.ssl.yml.backup"

    # Update domain in certbot command
    sed -i "s/143\.198\.192\.233\.nip\.io/${DOMAIN}/g" "${PROJECT_DIR}/docker-compose.ssl.yml"
    sed -i "s/admin@example\.com/${EMAIL}/g" "${PROJECT_DIR}/docker-compose.ssl.yml"

    print_success "Docker-compose SSL configuration updated"
}

# Function to start initial services (HTTP only for certificate generation)
start_initial_services() {
    print_status "Starting initial services for certificate generation..."

    # Stop any existing services
    $COMPOSE_CMD -f docker-compose.ssl.yml down --remove-orphans || true

    # Start services without SSL first
    $COMPOSE_CMD -f docker-compose.ssl.yml up -d nginx

    # Wait for nginx to be ready
    print_status "Waiting for nginx to be ready..."
    sleep 10

    # Check if nginx is responding
    if curl -f "http://${SERVER_IP}/health" &> /dev/null; then
        print_success "Nginx is ready for certificate generation"
    else
        print_error "Nginx is not responding"
        $COMPOSE_CMD -f docker-compose.ssl.yml logs nginx
        exit 1
    fi
}

# Function to generate SSL certificate
generate_certificate() {
    print_status "Generating SSL certificate for ${DOMAIN}..."

    # Generate certificate using certbot
    $COMPOSE_CMD -f docker-compose.ssl.yml run --rm certbot

    # Check if certificate was generated
    if [[ -f "${PROJECT_DIR}/ssl/live/${DOMAIN}/fullchain.pem" ]]; then
        print_success "SSL certificate generated successfully"
    else
        print_error "Failed to generate SSL certificate"
        print_info "Please check the logs above for more details"
        print_info "Common issues:"
        print_info "- Domain ${DOMAIN} doesn't point to ${SERVER_IP}"
        print_info "- Port 80 is blocked by firewall"
        print_info "- Rate limiting from Let's Encrypt"
        exit 1
    fi
}

# Function to restart services with SSL
restart_with_ssl() {
    print_status "Restarting services with SSL enabled..."

    # Stop services
    $COMPOSE_CMD -f docker-compose.ssl.yml down

    # Start all services including SSL
    $COMPOSE_CMD -f docker-compose.ssl.yml up -d

    # Wait for services to be ready
    print_status "Waiting for services to be ready..."
    sleep 15

    # Check HTTPS endpoint
    if curl -k -f "https://${DOMAIN}/health" &> /dev/null; then
        print_success "HTTPS is working correctly"
    else
        print_warning "HTTPS endpoint not responding, checking logs..."
        $COMPOSE_CMD -f docker-compose.ssl.yml logs nginx
    fi
}

# Function to setup certificate renewal
setup_renewal() {
    print_status "Setting up automatic certificate renewal..."

    # Create renewal script
    cat > "${PROJECT_DIR}/renew-certificates.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"

# Renew certificates
docker-compose -f docker-compose.ssl.yml run --rm certbot renew --webroot --webroot-path=/var/www/certbot --quiet

# Restart nginx if renewal was successful
if [ $? -eq 0 ]; then
    docker-compose -f docker-compose.ssl.yml restart nginx
    echo "$(date): SSL certificates renewed successfully" >> logs/ssl-renewal.log
else
    echo "$(date): SSL certificate renewal failed" >> logs/ssl-renewal.log
fi
EOF

    chmod +x "${PROJECT_DIR}/renew-certificates.sh"

    # Add to crontab (run twice daily as recommended by Let's Encrypt)
    CRON_JOB="0 12,24 * * * ${PROJECT_DIR}/renew-certificates.sh"

    # Check if cron job already exists
    if ! crontab -l 2>/dev/null | grep -q "renew-certificates.sh"; then
        (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
        print_success "Automatic renewal set up (runs twice daily)"
    else
        print_info "Automatic renewal already configured"
    fi
}

# Function to test SSL configuration
test_ssl() {
    print_status "Testing SSL configuration..."

    # Test HTTP redirect
    print_info "Testing HTTP to HTTPS redirect..."
    HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "http://${DOMAIN}/health")
    if [[ "$HTTP_RESPONSE" == "301" ]]; then
        print_success "HTTP to HTTPS redirect working"
    else
        print_warning "HTTP redirect may not be working (got $HTTP_RESPONSE)"
    fi

    # Test HTTPS
    print_info "Testing HTTPS endpoint..."
    if curl -s -f "https://${DOMAIN}/health" > /dev/null; then
        print_success "HTTPS endpoint working"
    else
        print_error "HTTPS endpoint not working"
    fi

    # Test WebSocket (if possible)
    print_info "WebSocket endpoint: wss://${DOMAIN}/ws/"

    # Test SSL certificate
    print_info "Testing SSL certificate..."
    CERT_INFO=$(echo | openssl s_client -servername "${DOMAIN}" -connect "${DOMAIN}:443" 2>/dev/null | openssl x509 -noout -dates)
    if [[ $? -eq 0 ]]; then
        print_success "SSL certificate is valid"
        print_info "$CERT_INFO"
    else
        print_warning "Could not verify SSL certificate"
    fi
}

# Function to display final information
display_final_info() {
    echo ""
    print_success "🎉 HTTPS/SSL deployment completed successfully!"
    echo ""
    print_info "📊 Service Information:"
    print_info "======================"
    print_info "🌐 Web Application: https://${DOMAIN}"
    print_info "🔌 WebSocket Proxy: wss://${DOMAIN}/ws/"
    print_info "🔒 SSL Certificate: Let's Encrypt"
    print_info "📧 Certificate Email: ${EMAIL}"
    echo ""

    print_info "🛠️ Management Commands:"
    print_info "======================"
    print_info "View logs: $COMPOSE_CMD -f docker-compose.ssl.yml logs -f"
    print_info "Stop services: $COMPOSE_CMD -f docker-compose.ssl.yml down"
    print_info "Restart services: $COMPOSE_CMD -f docker-compose.ssl.yml restart"
    print_info "Renew certificates: ./renew-certificates.sh"
    echo ""

    print_info "🔍 Troubleshooting:"
    print_info "=================="
    print_info "Service status: $COMPOSE_CMD -f docker-compose.ssl.yml ps"
    print_info "Nginx logs: $COMPOSE_CMD -f docker-compose.ssl.yml logs nginx"
    print_info "App logs: $COMPOSE_CMD -f docker-compose.ssl.yml logs fano-stt-app"
    print_info "Certificate info: openssl x509 -in ssl/live/${DOMAIN}/fullchain.pem -text -noout"
    echo ""

    print_warning "⚠️ Important Notes:"
    print_warning "=================="
    print_warning "• Certificates auto-renew twice daily"
    print_warning "• Keep ports 80 and 443 open in firewall"
    print_warning "• Backup ssl/ directory for certificate safety"
    print_warning "• Monitor logs/ssl-renewal.log for renewal status"
    echo ""

    print_success "🚀 Your FANO STT application is now ready with HTTPS!"
    print_success "🎙️ Microphone access will now work in production!"
}

# Function to cleanup on error
cleanup_on_error() {
    print_error "Deployment failed, cleaning up..."
    $COMPOSE_CMD -f docker-compose.ssl.yml down --remove-orphans || true

    # Restore backups if they exist
    if [[ -f "${PROJECT_DIR}/nginx.conf.backup" ]]; then
        mv "${PROJECT_DIR}/nginx.conf.backup" "${PROJECT_DIR}/nginx.conf"
        print_info "Restored nginx configuration backup"
    fi

    if [[ -f "${PROJECT_DIR}/docker-compose.ssl.yml.backup" ]]; then
        mv "${PROJECT_DIR}/docker-compose.ssl.yml.backup" "${PROJECT_DIR}/docker-compose.ssl.yml"
        print_info "Restored docker-compose configuration backup"
    fi
}

# Set trap for cleanup on script exit
trap cleanup_on_error ERR

# Main execution
main() {
    echo ""
    print_success "🔒 FANO STT HTTPS/SSL Deployment Script"
    print_success "======================================="
    echo ""

    check_prerequisites
    setup_directories
    get_domain
    update_nginx_config
    update_compose_config
    start_initial_services
    generate_certificate
    restart_with_ssl
    setup_renewal
    test_ssl
    display_final_info

    # Remove trap since we completed successfully
    trap - ERR
}

# Run main function
main "$@"
