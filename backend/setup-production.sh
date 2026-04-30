#!/bin/bash
# Production Deployment Setup Script
# Run this once on your production server

set -e

echo "🚀 MoneyMatrix Production Deployment Setup"
echo "=========================================="

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "This script must be run as root"
   exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt-get update && apt-get upgrade -y

# Install Node.js
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs

# Install PM2 globally
echo "📦 Installing PM2..."
npm install -g pm2

# Install Nginx
echo "📦 Installing Nginx..."
apt-get install -y nginx

# Install Certbot for SSL
echo "📦 Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# Create application directory
echo "📁 Creating application directory..."
mkdir -p /var/www/moneymatrix
cd /var/www/moneymatrix

# Clone or pull repository
if [ -d ".git" ]; then
    echo "📥 Pulling latest code..."
    git pull origin main
else
    echo "📥 Cloning repository..."
    git clone <your-repo-url> .
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
cd backend
npm ci --only=production

# Setup logs directory
mkdir -p logs

# Copy production environment file
echo "📝 Setting up environment configuration..."
if [ ! -f ".env.production" ]; then
    cp .env.production.example .env.production
    echo "⚠️  Please edit .env.production with your configuration"
fi

# Validate environment
echo "🔍 Validating environment..."
npm run validate:env

# Setup PM2
echo "🚀 Starting PM2..."
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup

# Setup Nginx
echo "🔐 Setting up Nginx..."
cp /var/www/moneymatrix/nginx.conf.production /etc/nginx/sites-available/moneymatrix
ln -sf /etc/nginx/sites-available/moneymatrix /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Setup SSL with Let's Encrypt
echo "🔒 Setting up SSL certificates..."
certbot certonly --nginx \
    --non-interactive \
    --agree-tos \
    --email admin@moneymatrixapp.com \
    -d api.moneymatrixapp.com

# Reload Nginx
systemctl reload nginx

# Setup log rotation
echo "📊 Setting up log rotation..."
cat > /etc/logrotate.d/moneymatrix << EOF
/var/www/moneymatrix/backend/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 www-data www-data
    sharedscripts
    postrotate
        systemctl reload nginx > /dev/null 2>&1 || true
    endscript
}
EOF

# Setup automatic SSL renewal
echo "🔄 Setting up automatic SSL renewal..."
systemctl enable certbot.timer
systemctl start certbot.timer

# Create monitoring script
echo "📈 Setting up monitoring..."
cat > /usr/local/bin/moneymatrix-health.sh << 'EOF'
#!/bin/bash
curl -f http://localhost:8000/health > /dev/null 2>&1
exit $?
EOF
chmod +x /usr/local/bin/moneymatrix-health.sh

# Add to crontab for monitoring
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/moneymatrix-health.sh || systemctl restart moneymatrix") | crontab -

echo ""
echo "✅ Production setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Edit /var/www/moneymatrix/backend/.env.production with your configuration"
echo "2. Run: npm run validate:env"
echo "3. Monitor: pm2 logs"
echo "4. Check SSL: https://ssl.ssllabs.com/ssltest/analyze.html?d=api.moneymatrixapp.com"
echo "5. Monitor health: curl https://api.moneymatrixapp.com/health"
echo ""
