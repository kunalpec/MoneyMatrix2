# 🚀 MoneyMatrix Production Deployment Guide

## Table of Contents
1. [Pre-Deployment](#pre-deployment)
2. [Environment Setup](#environment-setup)
3. [Local Testing](#local-testing)
4. [Production Deployment](#production-deployment)
5. [Post-Deployment Verification](#post-deployment-verification)
6. [Monitoring & Maintenance](#monitoring--maintenance)
7. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment

### 1. Verify All Requirements Met
```bash
# Clone the repository
git clone <repo-url>
cd moneymatrix

# Verify Node.js version
node --version  # Should be v20.x or higher

# Check if Docker is installed (for containerized deployment)
docker --version
docker-compose --version

# Install dependencies
cd backend
npm install
```

### 2. Generate Production Secrets
```bash
# Generate 4 random 64-character secrets
node -e "console.log('ACCESS_TOKEN_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('REFRESH_TOKEN_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('TATUM_WEBHOOK_HMAC_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Run Deployment Checklist
```bash
# Review the complete checklist
cat ../DEPLOYMENT_CHECKLIST.md

# Ensure all items are checked ✅
```

---

## Environment Setup

### Option 1: Traditional Linux Server Deployment

#### 1.1 Server Preparation
```bash
# SSH into production server
ssh root@your-server-ip

# Run initial setup script
cd /var/www/moneymatrix
chmod +x backend/setup-production.sh
./backend/setup-production.sh
```

#### 1.2 Configure Environment
```bash
# Create production environment file
nano backend/.env.production

# Add all required environment variables from .env.production template
# See: backend/.env.production
```

#### 1.3 Validate Environment
```bash
cd backend
npm run validate:env
```

#### 1.4 Start Application with PM2
```bash
# Install PM2 globally (if not already done)
npm install -g pm2

# Start application
pm2 start ecosystem.config.js --env production

# Verify processes are running
pm2 status

# Make PM2 start on server reboot
pm2 startup
pm2 save

# View logs
pm2 logs moneymatrix-api
```

### Option 2: Docker Containerized Deployment

#### 2.1 Prepare Docker Environment
```bash
# Create .env file for docker-compose
cp backend/.env.production .env

# Verify docker-compose configuration
docker-compose config

# Validate all services
docker-compose validate
```

#### 2.2 Build and Start Services
```bash
# Build backend image
docker-compose build

# Start all services (MongoDB, Redis, Backend, Nginx)
docker-compose up -d

# Verify all services are running
docker-compose ps

# Check logs
docker-compose logs -f backend

# View specific service logs
docker-compose logs -f nginx
docker-compose logs -f mongodb
```

#### 2.3 Health Check
```bash
# Check backend health
curl http://localhost:8000/health

# Check through Nginx (if SSL is ready)
curl https://api.moneymatrixapp.com/health
```

---

## Local Testing

### 1. Test in Development Environment
```bash
# Start in development
npm run dev

# Run validation tests
npm run validate:env

# Test health endpoint
curl http://localhost:8000/health

# Test authentication flow
curl -X POST http://localhost:8000/api/v1/users/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPassword123"}'
```

### 2. Load Testing
```bash
# Install Artillery (if not done)
npm install -g artillery

# Run load test
artillery run backend/load-test.yml

# Expected results:
# - 100 RPS sustained
# - < 100ms average response time
# - < 500ms P99 latency
# - < 0.1% error rate
```

### 3. Staging Environment Testing
```bash
# Deploy to staging first
# Test entire user flow:
# 1. User registration
# 2. Email verification
# 3. Login
# 4. Deposit via Tatum
# 5. Place bet
# 6. Withdraw

# Test webhook delivery from Tatum testnet
# Verify webhook signatures are valid
```

---

## Production Deployment

### 1. Pre-Deployment Final Checks
```bash
# Stop accepting traffic to old version (if applicable)
# Take database backup
mongodump --uri="$MONGO_URI" --out=/backups/pre-deploy-backup

# Notify team
echo "Deploying to production at $(date)"

# Clear any pending background jobs (if needed)
pm2 stop all  # Optional: only if doing controlled restart
```

### 2. Deploy New Code
```bash
# Pull latest code
git pull origin main

# Install updated dependencies
npm ci --only=production

# Validate environment again
npm run validate:env

# Run any required migrations
npm run migrate:wallet-accounting
npm run migrate:wallet-subscriptions
npm run webhooks:tatum-hmac
```

### 3. Zero-Downtime Restart with PM2
```bash
# PM2 handles graceful reload automatically
pm2 reload ecosystem.config.js

# Watch the restart (should take 5-10 seconds)
pm2 logs moneymatrix-api

# Verify all processes are running
pm2 status
```

### 4. Verify Deployment Success
```bash
# Check health endpoint
curl https://api.moneymatrixapp.com/health

# Verify response:
# {
#   "status": "up",
#   "timestamp": "...",
#   "checks": {
#     "mongodb": "healthy",
#     "memory": {...},
#     "responsiveness": "healthy"
#   }
# }

# Check for errors in logs
pm2 logs moneymatrix-api --err

# Monitor metrics
pm2 dashboard
```

---

## Post-Deployment Verification

### 1. Immediate Checks (First 5 minutes)
```bash
# Health check every 30 seconds
watch -n 1 'curl -s https://api.moneymatrixapp.com/health | jq'

# Monitor real-time logs
pm2 logs moneymatrix-api --lines 50

# Check process status
pm2 status

# Verify database connectivity
pm2 exec "npm run validate:env"
```

### 2. User Testing (First 30 minutes)
- [ ] Test user login on production website
- [ ] Test user registration flow
- [ ] Test payment deposit (small amount)
- [ ] Test placing a bet
- [ ] Test withdrawal request

### 3. API Testing (First hour)
```bash
# Test critical endpoints
curl -X GET https://api.moneymatrixapp.com/health

# Test with valid JWT token
JWT_TOKEN=$(curl -s -X POST https://api.moneymatrixapp.com/api/v1/users/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"AdminPassword123"}' | jq -r '.token')

# Test protected endpoint
curl -H "Authorization: Bearer $JWT_TOKEN" \
  https://api.moneymatrixapp.com/api/v1/auth/me
```

### 4. Monitoring Check (First 24 hours)
- [ ] No spike in error rates
- [ ] Response times normal (< 100ms average)
- [ ] Database connections stable
- [ ] Memory usage stable
- [ ] CPU usage normal
- [ ] All background jobs running
- [ ] Webhooks being received and processed
- [ ] Backups completed successfully

---

## Monitoring & Maintenance

### Daily Monitoring

```bash
# Check PM2 status
pm2 status

# View logs for errors
pm2 logs moneymatrix-api --err

# Check system resources
top -b -n 1 | head -20

# Monitor MongoDB connection pool
# (Check logs for "connection pool" messages)
```

### Weekly Maintenance

```bash
# Review error logs
tail -1000 /var/log/moneymatrix/combined.log | grep "ERROR"

# Check database size
du -sh /data/db

# Verify backups completed
ls -lah /backups/mongodb/

# Monitor SSL certificate expiry
curl -vI https://api.moneymatrixapp.com 2>&1 | grep "expire date"
```

### Monthly Tasks

```bash
# Update dependencies
npm update

# Run security audit
npm audit

# Rotate secrets (if needed)
# Update .env.production
# Restart: pm2 reload ecosystem.config.js

# Test backup restore
mongorestore --archive=/backups/mongodb/backup_*.archive --gzip
```

### Quarterly Tasks

```bash
# Rotate all credentials
# - Database password
# - JWT secrets
# - API keys
# - Webhook secrets

# Review and update security policies
# Run full security audit
# Test disaster recovery procedure
# Update documentation
```

---

## Troubleshooting

### Issue: Application won't start
```bash
# Check error logs
pm2 logs moneymatrix-api

# Verify environment variables
npm run validate:env

# Check MongoDB connection
mongosh $MONGO_URI

# Check Redis connection (if configured)
redis-cli ping

# Restart with more detail
PM2_DEBUG=true pm2 start ecosystem.config.js
```

### Issue: High response time
```bash
# Check database query performance
# Look for slow queries in logs

# Monitor database connections
# Check for connection pool exhaustion

# Check CPU and memory
top

# Review Nginx logs
tail -100 /var/log/nginx/moneymatrix_error.log

# Consider:
# 1. Add database indexes
# 2. Increase connection pool size
# 3. Implement caching (Redis)
# 4. Optimize queries
```

### Issue: Memory leak
```bash
# Monitor memory usage over time
pm2 monit

# Check for unhandled promises
grep "unhandledRejection\|uncaughtException" /var/log/moneymatrix/*

# Restart specific process
pm2 restart moneymatrix-api

# Investigate in code for:
# - Event listeners not removed
# - Timers not cleared
# - Circular references
# - Large data structures in memory
```

### Issue: Database connection errors
```bash
# Test connection directly
mongosh "$MONGO_URI"

# Check connection pool size in logs
grep "connection pool" /var/log/moneymatrix/*

# Verify MongoDB is running
mongo --eval "db.adminCommand('ping')"

# Check network connectivity
nc -zv $MONGODB_HOST $MONGODB_PORT

# Consider increasing pool size:
# mongoose.set('maxPoolSize', 100);
```

### Issue: Webhook events not received
```bash
# Verify webhook URL is correct
echo $PUBLIC_WEBHOOK_BASE_URL

# Check webhook signature verification
grep "webhook.*signature" /var/log/moneymatrix/combined.log

# Verify HMAC secret matches Tatum/Transak
# Regenerate webhook subscriptions:
npm run webhooks:tatum-hmac

# Monitor webhook processing queue
# Check for failed webhook deliveries in logs
```

### Issue: SSL certificate errors
```bash
# Check certificate validity
openssl s_client -connect api.moneymatrixapp.com:443

# Check certificate expiry
curl -vI https://api.moneymatrixapp.com 2>&1 | grep "expire"

# Renew certificate
sudo certbot renew --force-renewal

# Verify auto-renewal is configured
sudo systemctl status certbot.timer
```

---

## Rollback Procedure

If critical issue found after deployment:

```bash
# 1. Stop accepting new traffic
pm2 stop moneymatrix-api

# 2. Restore from backup
mongorestore --archive=/backups/pre-deploy-backup.archive --gzip

# 3. Revert to previous code version
git checkout HEAD~1

# 4. Reinstall dependencies
npm ci --only=production

# 5. Restart application
pm2 start ecosystem.config.js

# 6. Verify
curl https://api.moneymatrixapp.com/health

# 7. Notify team
echo "Rollback completed at $(date)"
```

---

## Emergency Contacts

- **DevOps Lead**: [Contact info]
- **On-Call Engineer**: [Contact info]
- **Database Admin**: [Contact info]
- **Security Team**: [Contact info]

---

## Deployment History

| Date | Version | Status | Deployed By | Notes |
|------|---------|--------|-------------|-------|
| 2026-04-29 | 1.0.0 | ✅ SUCCESS | Your Name | Initial production deployment |

---

**Last Updated**: 2026-04-29
**Maintained By**: DevOps Team
**Location**: `/var/www/moneymatrix/DEPLOYMENT_GUIDE.md`
