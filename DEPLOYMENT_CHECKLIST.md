# MoneyMatrix Production Deployment Checklist

## Pre-Deployment Security Audit

### Environment Variables
- [ ] All required env vars are set in `.env.production`
- [ ] Secrets are at least 64 characters (16 random bytes hex-encoded)
- [ ] MongoDB credentials are different from development
- [ ] JWT secrets are rotated and unique
- [ ] TATUM_WEBHOOK_HMAC_SECRET is unique and secure
- [ ] Never commit `.env.production` to version control
- [ ] Use `.env.production.example` with placeholder values in repo

### Application Security
- [ ] Rate limiting enabled (express-rate-limit configured)
- [ ] Helmet security headers installed and enabled
- [ ] CORS configured to specific domains only
- [ ] Input validation on all endpoints (express-validator)
- [ ] SQL injection prevention enabled (MongoDB sanitization)
- [ ] XSS protection enabled
- [ ] CSRF tokens implemented for state-changing operations
- [ ] Authentication JWT has reasonable expiry (15m recommended)
- [ ] Password requirements enforced (min 8 chars, uppercase, number)

### Logging & Monitoring
- [ ] Winston logger configured for production JSON format
- [ ] Structured logging enabled (timestamp, level, metadata)
- [ ] Log rotation configured (daily, max 30 days retention)
- [ ] Error tracking setup (Sentry or similar)
- [ ] Health check endpoint implemented (`/health`)
- [ ] HTTP request logging enabled (Morgan + Winston)
- [ ] Webhook event logging for audit trail
- [ ] PM2 monitoring dashboard accessible

### Database
- [ ] MongoDB connection pooling configured (min 10, max 100)
- [ ] Database indexes optimized
  - [ ] Users: email (unique), phone (unique)
  - [ ] Transactions: userId, timestamp, type
  - [ ] Wallets: userId, balance
  - [ ] Bets: userId, roundId, createdAt
- [ ] MongoDB replica set for ACID transactions
- [ ] Backup strategy implemented (daily automated backups)
- [ ] Backup retention policy (30 days minimum)
- [ ] Database user with least privilege (not root)
- [ ] Connection string encrypted in `.env`

### Performance Optimization
- [ ] Redis cache configured for sessions (if needed)
- [ ] Response compression enabled (gzip)
- [ ] Query optimization: no N+1 queries
- [ ] Database connection pooling optimized
- [ ] Static file caching headers set
- [ ] Load balancing configured (Nginx upstream)
- [ ] Cache headers optimized for production

### Deployment Infrastructure
- [ ] PM2 configured with clustering (multi-process)
- [ ] Zero-downtime restart strategy enabled
- [ ] Graceful shutdown handler implemented (30s timeout)
- [ ] PM2 ecosystem.config.js reviewed and tested
- [ ] Auto-restart on crash enabled
- [ ] Memory limits set (500M recommended)
- [ ] PM2 startup script registered (`pm2 startup`)

### SSL/TLS & HTTPS
- [ ] SSL certificate installed (Let's Encrypt)
- [ ] Certificate auto-renewal configured (certbot)
- [ ] HTTP redirects to HTTPS enforced
- [ ] HSTS header enabled (`max-age=31536000`)
- [ ] SSL/TLS version: TLS 1.2 minimum
- [ ] Certificate valid for correct domains
- [ ] SSL Labs score: A+ recommended

### Nginx Reverse Proxy
- [ ] Nginx installed and configured
- [ ] Rate limiting configured at Nginx level
- [ ] Compression (gzip) enabled
- [ ] Real IP headers forwarded to backend
- [ ] WebSocket support enabled (Upgrade headers)
- [ ] Security headers set in Nginx config
- [ ] Connection timeouts optimized (60s)
- [ ] Buffer sizes configured for large requests

### Webhook Security
- [ ] HMAC signature verification on all webhooks
- [ ] Webhook endpoints protected from CSRF
- [ ] Webhook event logging for audit trail
- [ ] Tatum webhook signatures validated
- [ ] Transak webhook signatures validated
- [ ] Webhook retries implemented for failures
- [ ] Webhook timeout handling implemented

### Monitoring & Alerting
- [ ] Health check endpoint accessible
- [ ] PM2 dashboard monitored
- [ ] CPU/Memory usage monitored
- [ ] Database connection pool monitored
- [ ] Log files monitored for errors
- [ ] Uptime monitoring service configured (Uptime Robot, etc.)
- [ ] Alert notifications setup (email/Slack)
- [ ] Error rate alerts configured

### Backup & Disaster Recovery
- [ ] Daily MongoDB backups automated
- [ ] Backups stored separately (different server/cloud)
- [ ] Backup retention policy: minimum 30 days
- [ ] Restore procedure tested and documented
- [ ] Backup encryption enabled
- [ ] Backup S3 upload configured (if using cloud)
- [ ] Point-in-time recovery capability verified

### Testing
- [ ] Unit tests passing locally
- [ ] Integration tests passing
- [ ] Load testing completed
  - [ ] Target: 100 RPS sustained
  - [ ] Response time: < 100ms average
  - [ ] Error rate: < 0.1%
  - [ ] P99 latency: < 500ms
- [ ] Webhook testing with actual Tatum/Transak
- [ ] Payment flow end-to-end tested
- [ ] Rollback procedure tested

### Documentation
- [ ] Deployment guide documented
- [ ] Environment variables documented
- [ ] API documentation updated
- [ ] Runbook for common issues created
- [ ] Incident response procedure documented
- [ ] Monitoring dashboard access credentials shared

### Final Checks
- [ ] All team members notified of deployment
- [ ] Deployment window scheduled (low-traffic time)
- [ ] Rollback plan documented
- [ ] Database backup taken before deployment
- [ ] Team on standby during deployment
- [ ] Staging environment mirrors production
- [ ] DNS/Load balancer updated (if applicable)
- [ ] Smoke tests pass on production

## Post-Deployment Verification

### Immediate (First 5 minutes)
- [ ] API responding on production domain
- [ ] Health check endpoint returns 200
- [ ] PM2 processes running (`pm2 status`)
- [ ] No critical errors in logs
- [ ] SSL certificate valid

### Short-term (First hour)
- [ ] User login working
- [ ] API endpoints responding normally
- [ ] Database connections stable
- [ ] No spike in error rates
- [ ] Response times acceptable
- [ ] Webhook events processing

### Extended (First 24 hours)
- [ ] All user flows working (login, bet, deposit, etc.)
- [ ] No data loss or corruption
- [ ] Backups completing successfully
- [ ] Monitoring alerts not firing excessively
- [ ] Performance metrics stable
- [ ] Logs show normal operation

## Monitoring During Peak Hours

### Metrics to Watch
- Request rate (target: < 500 RPS)
- Response time (target: < 100ms avg, < 500ms P99)
- Error rate (target: < 0.1%)
- CPU usage (target: < 70%)
- Memory usage (target: < 500M per process)
- Database connections (target: < 80% of pool)
- Queue depth (if applicable)

### Actions if Issues Detected
- Review logs for root cause
- Check monitoring dashboard
- Verify database connectivity
- Check external API availability (Tatum, etc.)
- Monitor error tracking service (Sentry)
- Consider rollback if critical issue

## After Production Deployment

- [ ] Update deployment status in team channels
- [ ] Archive deployment logs
- [ ] Update runbook with any new issues discovered
- [ ] Schedule post-deployment review meeting
- [ ] Plan for non-critical fixes discovered
- [ ] Thank the team!

---

**Deployment Date**: _______________
**Deployed By**: _______________
**Environment**: PRODUCTION
**Status**: ✅ DEPLOYED / ❌ ROLLED BACK
