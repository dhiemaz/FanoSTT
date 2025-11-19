#!/bin/bash

# Fano STT Installation Script
# This script automates the setup process for the Fano STT application

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Unicode symbols
CHECK_MARK="✓"
CROSS_MARK="✗"
ARROW="→"
STAR="★"

print_header() {
    echo -e "${PURPLE}"
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║              FANO STT INSTALLER                   ║"
    echo "║      Advanced Speech-to-Text Web Application     ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${CYAN}${ARROW} $1${NC}"
}

print_success() {
    echo -e "${GREEN}${CHECK_MARK} $1${NC}"
}

print_error() {
    echo -e "${RED}${CROSS_MARK} $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ  $1${NC}"
}

check_command() {
    if command -v "$1" >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

check_node_version() {
    if check_command node; then
        local node_version=$(node -v | cut -d'v' -f2)
        local major_version=$(echo $node_version | cut -d'.' -f1)
        if [ "$major_version" -ge "18" ]; then
            return 0
        else
            return 1
        fi
    else
        return 1
    fi
}

install_dependencies() {
    print_step "Installing project dependencies..."

    if check_command yarn; then
        print_info "Using Yarn package manager"
        yarn install
    elif check_command npm; then
        print_info "Using NPM package manager"
        npm install
    else
        print_error "Neither npm nor yarn is installed"
        exit 1
    fi

    print_success "Dependencies installed successfully"
}

setup_environment() {
    print_step "Setting up environment configuration..."

    if [ ! -f ".env.local" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example .env.local
            print_success "Environment file created from template"
            print_warning "Please edit .env.local with your actual configuration values"
        else
            print_error ".env.example file not found"
            return 1
        fi
    else
        print_info "Environment file already exists"
    fi
}

create_directories() {
    print_step "Creating necessary directories..."

    # Create public directories if they don't exist
    mkdir -p public/icons
    mkdir -p public/images
    mkdir -p .next

    print_success "Directories created"
}

check_prerequisites() {
    print_step "Checking system prerequisites..."

    local all_good=true

    # Check Node.js
    if check_node_version; then
        local node_version=$(node -v)
        print_success "Node.js ${node_version} (✓ >= 18.0.0)"
    else
        print_error "Node.js 18.0.0 or higher is required"
        print_info "Please install Node.js from https://nodejs.org/"
        all_good=false
    fi

    # Check package manager
    if check_command yarn; then
        local yarn_version=$(yarn -v)
        print_success "Yarn ${yarn_version}"
    elif check_command npm; then
        local npm_version=$(npm -v)
        print_success "NPM ${npm_version}"
    else
        print_error "No package manager found (npm or yarn required)"
        all_good=false
    fi

    # Check Git
    if check_command git; then
        local git_version=$(git --version | cut -d' ' -f3)
        print_success "Git ${git_version}"
    else
        print_warning "Git not found (optional but recommended)"
    fi

    if [ "$all_good" = false ]; then
        print_error "Prerequisites not met. Please install the required software and try again."
        exit 1
    fi

    print_success "All prerequisites satisfied"
}

setup_git_hooks() {
    if [ -d ".git" ]; then
        print_step "Setting up Git hooks..."

        # Create pre-commit hook
        cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
echo "Running pre-commit checks..."

# Run ESLint
npm run lint || exit 1

# Run type checking
npx tsc --noEmit || exit 1

echo "Pre-commit checks passed!"
EOF

        chmod +x .git/hooks/pre-commit
        print_success "Git hooks configured"
    fi
}

run_initial_build() {
    print_step "Running initial build to verify setup..."

    if check_command yarn; then
        yarn build
    else
        npm run build
    fi

    print_success "Initial build completed successfully"
}

print_next_steps() {
    echo ""
    echo -e "${GREEN}${STAR} Installation completed successfully! ${STAR}${NC}"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo -e "  ${ARROW} Edit .env.local with your Fano STT credentials"
    echo -e "  ${ARROW} Run 'npm run dev' or 'yarn dev' to start development server"
    echo -e "  ${ARROW} Visit http://localhost:3000 to view the application"
    echo ""
    echo -e "${BLUE}Important Configuration:${NC}"
    echo -e "  • NEXT_PUBLIC_FANO_WEBSOCKET_URL: Your WebSocket endpoint"
    echo -e "  • NEXT_PUBLIC_FANO_AUTH_TOKEN: Your JWT authentication token"
    echo -e "  • NEXT_PUBLIC_DEFAULT_LANGUAGE_CODE: Language setting (default: en-SG-x-multi)"
    echo ""
    echo -e "${PURPLE}Documentation:${NC}"
    echo -e "  • README.md: Full documentation and usage guide"
    echo -e "  • .env.example: All available environment variables"
    echo ""
    echo -e "${CYAN}Development Commands:${NC}"
    echo -e "  • npm run dev     - Start development server"
    echo -e "  • npm run build   - Build for production"
    echo -e "  • npm run start   - Start production server"
    echo -e "  • npm run lint    - Run code linting"
    echo ""
}

main() {
    clear
    print_header

    echo -e "${BLUE}Welcome to the Fano STT installation wizard!${NC}"
    echo -e "${BLUE}This script will set up your development environment.${NC}"
    echo ""

    # Ask for confirmation
    read -p "Do you want to proceed with the installation? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi

    echo ""

    # Run installation steps
    check_prerequisites
    echo ""

    install_dependencies
    echo ""

    setup_environment
    echo ""

    create_directories
    echo ""

    setup_git_hooks
    echo ""

    # Ask if user wants to run initial build
    read -p "Do you want to run an initial build to verify the setup? (Y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        print_info "Skipping initial build"
    else
        echo ""
        run_initial_build
    fi

    echo ""
    print_next_steps

    # Ask if user wants to start dev server
    read -p "Do you want to start the development server now? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo ""
        print_step "Starting development server..."
        if check_command yarn; then
            yarn dev
        else
            npm run dev
        fi
    fi
}

# Handle script interruption
trap 'echo -e "\n${RED}Installation interrupted${NC}"; exit 1' INT

# Check if script is run from project root
if [ ! -f "package.json" ]; then
    print_error "This script must be run from the project root directory"
    print_info "Please navigate to the FanoSTT directory and run ./install.sh"
    exit 1
fi

# Run main function
main
