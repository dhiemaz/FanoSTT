#!/bin/bash

# Digital Ocean Server Setup Script for FANO STT Application
# Run this script on a fresh Ubuntu 22.04 droplet

set -e

echo "🚀 Setting up Digital Ocean server for FANO STT deployment..."

# Update system packages
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install essential packages
echo "🔧 Installing essential packages..."
apt install -y \
    curl \
    wget \
    git \
    unzip \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    ufw \
    htop \
    vim \
    tree

# Install Docker
echo "🐳 Installing Docker..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Install Docker Compose standalone (for compatibility)
echo "📋 Installing Docker Compose..."
DOCKER_COMPOSE_VERSION="2.24.0"
curl -L "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create deployment user
echo "👤 Creating deployment user..."
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash deploy
    usermod -aG docker deploy
    usermod -aG sudo deploy
fi

# Create application directory
echo "📁 Setting up application directory..."
mkdir -p /opt/fano-stt
chown deploy:deploy /opt/fano-stt

# Setup SSH for deployment user
echo "🔐 Setting up SSH for deployment..."
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chown deploy:deploy /home/deploy/.ssh

# Configure firewall
echo "🔥 Configuring firewall..."
ufw --force enable
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3001/tcp  # FANO STT Web App
ufw allow 8080/tcp  # WebSocket Proxy

# Configure Docker daemon for better performance
echo "⚡ Optimizing Docker configuration..."
cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
EOF

systemctl restart docker

# Create systemd service for auto-start (optional)
echo "🔄 Creating systemd service..."
cat > /etc/systemd/system/fano-stt.service << 'EOF'
[Unit]
Description=FANO STT Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=true
WorkingDirectory=/opt/fano-stt
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
User=deploy
Group=deploy

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

# Clone repository (if not exists)
echo "📂 Setting up repository..."
if [ ! -d "/opt/fano-stt/.git" ]; then
    echo "Please clone your repository manually:"
    echo "sudo -u deploy git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git /opt/fano-stt"
fi

# Create environment file template
echo "📄 Creating environment template..."
cat > /opt/fano-stt/.env.example << 'EOF'
# FANO STT Configuration
AUTH_TOKEN=your_fano_auth_token_here
WEBSOCKET_URL=ws://localhost:8080
NEXT_PUBLIC_WEBSOCKET_URL=ws://your-domain.com:8080

# Optional: Custom ports
WEB_PORT=3001
PROXY_PORT=8080
EOF

chown deploy:deploy /opt/fano-stt/.env.example

# Set up log rotation
echo "📋 Setting up log rotation..."
cat > /etc/logrotate.d/fano-stt << 'EOF'
/opt/fano-stt/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    copytruncate
}
EOF

# Create logs directory
mkdir -p /opt/fano-stt/logs
chown deploy:deploy /opt/fano-stt/logs

# Install Node.js (for potential local development/testing)
echo "📦 Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Clean up
echo "🧹 Cleaning up..."
apt autoremove -y
apt autoclean
docker system prune -f

# Display system information
echo "📊 System Information:"
echo "===================="
echo "OS: $(lsb_release -d | cut -f2)"
echo "Docker: $(docker --version)"
echo "Docker Compose: $(docker-compose --version)"
echo "Node.js: $(node --version)"
echo "NPM: $(npm --version)"
echo "Available Memory: $(free -h | grep Mem | awk '{print $2}')"
echo "Available Disk: $(df -h / | tail -1 | awk '{print $4}')"

echo ""
echo "✅ Server setup completed successfully!"
echo ""
echo "📋 Next Steps:"
echo "1. Clone your repository to /opt/fano-stt"
echo "2. Copy .env.example to .env and configure your AUTH_TOKEN"
echo "3. Set up GitHub secrets for CI/CD:"
echo "   - DO_HOST: Your droplet IP address"
echo "   - DO_USER: deploy"
echo "   - DO_SSH_PRIVATE_KEY: Your private SSH key"
echo "   - AUTH_TOKEN: Your FANO authentication token"
echo ""
echo "🔐 SSH Key Setup:"
echo "Add your public SSH key to /home/deploy/.ssh/authorized_keys"
echo ""
echo "🚀 Manual Deployment Test:"
echo "cd /opt/fano-stt && docker-compose up -d"
echo ""
echo "🌐 Access your application at: http://$(curl -s ifconfig.me):3001"
