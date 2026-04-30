# 🔒 Production Security Best Practices Guide

## 1. SECRET MANAGEMENT

### Generating Secure Secrets
```bash
# Generate 64-character random secrets
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Where to Store Secrets
✅ DO:
- Use `.env.production` on production server (not in git)
- Use environment variables via system/orchestration platform
- Use secrets management tools (Vault, AWS Secrets Manager)
- Encrypt secrets at rest and in transit
- Rotate secrets regularly (quarterly minimum)

❌ DON'T:
- Commit secrets to git repository
- Store in application code
- Share in Slack/email
- Use same secret across environments
- Commit `.env` files

## 2. AUTHENTICATION & AUTHORIZATION

### JWT Configuration
```javascript
// Production recommended settings
{
  algorithm: 'HS256',
  expiresIn: '15m',           // Short-lived access token
  refreshTokenExpiry: '7d',   // Longer refresh token
  issuer: 'api.moneymatrixapp.com',
  audience: 'moneymatrixapp.com'
}
```

### Password Security
- Minimum 8 characters
- Require uppercase letter
- Require number
- Optional: Special character (@, #, !, etc.)
- Use bcrypt with salt rounds: 10+
- Never log passwords

### Rate Limiting Per Endpoint
```
/auth/login: 5 requests / 15 minutes
/auth/signup: 5 requests / 15 minutes
/auth/forgot-password: 3 requests / 1 hour
/api/*: 100 requests / 15 minutes
/webhook/*: 1000 requests / 1 minute
```

## 3. DATA PROTECTION

### MongoDB Connection
```javascript
// Production secure connection
mongodb+srv://username:password@cluster.mongodb.net/dbname?
  authSource=admin&
  ssl=true&
  retryWrites=true&
  w=majority
```

### Encryption at Rest
- Enable MongoDB encryption at rest
- Use volume-level encryption (EBS, etc.)
- Encrypt database backups

### Encryption in Transit
- TLS 1.2+ for all connections
- Verify certificate validity
- Use HTTPS everywhere

### PII Handling
- Encrypt sensitive fields (SSN, passport #, etc.)
- Hash emails for lookups
- Mask in logs (show first 4 chars only)
- Comply with GDPR/local regulations

## 4. API SECURITY

### CORS Configuration
```javascript
// Production CORS
{
  origin: ['https://moneymatrixapp.com', 'https://www.moneymatrixapp.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 3600
}
```

### Input Validation
```javascript
// Every endpoint should validate:
- Type validation (string, number, boolean)
- Length validation (max 255 chars, etc.)
- Format validation (email, phone, URL)
- Enum validation (only specific values)
- Range validation (0-100, etc.)
- Pattern validation (regex for complex formats)
```

### Output Sanitization
- Never expose database IDs in some cases
- Remove sensitive fields before sending to client
- Implement field-level access control
- Use DTOs (Data Transfer Objects)

## 5. WEBHOOK SECURITY

### HMAC Verification
```javascript
// REQUIRED for all webhooks
const signature = req.get('x-tatum-signature');
const hmac = crypto
  .createHmac('sha256', webhookSecret)
  .update(req.rawBody)
  .digest('hex');

if (signature !== hmac) {
  throw new Error('Invalid webhook signature');
}
```

### Webhook Best Practices
- Verify signature on every webhook
- Implement idempotency (track processed events)
- Log all webhook events with full payload
- Retry failed webhook processing
- Monitor webhook processing delays
- Alert on webhook processing failures

## 6. LOGGING & MONITORING

### What to Log
✅ Log:
- All authentication attempts (success/failure)
- API endpoint access (method, path, status)
- Error details (stack trace, context)
- Security events (rate limit, invalid signature)
- Database operations (for sensitive tables)

❌ Don't Log:
- Passwords or secrets
- Full credit card numbers
- Personal identification numbers
- API keys or tokens
- Request body with sensitive data

### Production Logging
```json
{
  "timestamp": "2026-04-29T10:30:00Z",
  "level": "error",
  "service": "moneymatrix-api",
  "path": "/api/v1/users/auth/login",
  "method": "POST",
  "statusCode": 401,
  "duration": "45ms",
  "userId": "user_123",
  "error": "Invalid credentials",
  "ip": "192.168.1.1"
}
```

### Monitoring Alerts
Set up alerts for:
- Error rate > 5%
- Response time P99 > 1000ms
- CPU > 80%
- Memory > 80%
- Database pool exhausted
- Rate limit breaches
- Failed webhooks > 10%

## 7. DEPLOYMENT SECURITY

### SSL/TLS Certificates
- Use Let's Encrypt (free, automatic)
- Auto-renew 30 days before expiry
- Monitor certificate expiry
- Use A+ rated SSL configuration

### Nginx Security Headers
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

### Firewall & Network
- Restrict database access to application servers only
- Restrict Redis access to application servers only
- Use VPN for admin access
- Disable SSH password auth (use keys only)
- Configure UFW/iptables rules

## 8. BACKUP & DISASTER RECOVERY

### Backup Strategy
- Automated daily backups
- Backup retention: 30 days minimum
- Store backups separately (different server/region)
- Test restore procedure monthly
- Encrypt backups in storage
- Monitor backup success/failure

### Disaster Recovery Plan
- RPO (Recovery Point Objective): < 24 hours
- RTO (Recovery Time Objective): < 4 hours
- Document restore procedures
- Test failover quarterly
- Maintain runbook for common issues

## 9. REGULAR MAINTENANCE

### Weekly
- Review error logs
- Check disk space
- Monitor database size
- Verify backups completed

### Monthly
- Review security logs
- Update dependencies (npm audit)
- Test backup restore
- Review rate limiting metrics

### Quarterly
- Rotate secrets/credentials
- Security audit of code
- Penetration testing (if budget allows)
- Update SSL certificates check
- Review access logs for anomalies

### Annually
- Full security audit
- Update security policies
- Team security training
- Incident response drill

## 10. INCIDENT RESPONSE

### If Credentials Leaked
1. Immediately rotate the leaked credential
2. Audit logs for unauthorized access
3. Reset affected user sessions
4. Update monitoring for suspicious activity
5. Notify relevant parties
6. Document incident

### If Data Breach Suspected
1. Isolate affected systems
2. Preserve logs for investigation
3. Notify affected users
4. Contact legal/compliance
5. Conduct forensic investigation
6. Implement remediation

### If Service Down
1. Check monitoring dashboard
2. Review recent logs
3. Check database connectivity
4. Check external services (Tatum, Transak)
5. Check PM2 process status
6. Initiate rollback if recent deployment
7. Communicate with team/users

## 11. COMPLIANCE & AUDIT

### Regulatory Compliance
- PCI-DSS (if handling payments)
- GDPR (if EU users)
- KYC/AML (if financial service)
- Local regulations (jurisdiction-specific)

### Security Audit Trail
Log and maintain:
- Admin actions
- User authentication events
- Failed authentication attempts
- Webhook events
- Data modifications
- Access to sensitive data

### Documentation
- Keep deployment logs
- Document all configuration changes
- Maintain runbooks
- Create incident reports
- Update security policies

## Quick Security Checklist

Before going to production:
- [ ] All secrets rotated and secure
- [ ] Rate limiting configured
- [ ] HTTPS enforced
- [ ] Database credentials non-root
- [ ] Backups tested and automated
- [ ] Monitoring and alerts enabled
- [ ] Error tracking service active
- [ ] Webhook HMAC verification enabled
- [ ] Security headers configured
- [ ] Input validation on all endpoints
- [ ] Logging centralized and monitored
- [ ] Graceful error handling
- [ ] Rate limiting on auth endpoints
- [ ] Firewall rules in place
- [ ] Team trained on security

---

**Last Updated**: 2026-04-29
**Version**: 1.0
**Maintained By**: DevOps Team
