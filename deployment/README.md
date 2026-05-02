# MoneyMatrix Deployment Guide

MoneyMatrix is a full-stack crypto gaming platform with:

- `frontend`: React + Vite, deployed on Vercel
- `backend`: Express + Socket.IO, runs on port `8000`
- `database`: MongoDB Atlas
- `queue/cache`: Redis
- `payments`: Tatum + Transak

This repository should be deployed with:

- Frontend domain: `https://moneymatrixapp.com`
- Frontend www domain: `https://www.moneymatrixapp.com`
- Backend API domain: `https://api.moneymatrixapp.com`

## Deployment Architecture

```text
Users
  -> https://moneymatrixapp.com
  -> https://www.moneymatrixapp.com
        |
        v
     Vercel
        |
        v
  https://api.moneymatrixapp.com
        |
        +-> Express API on port 8000
        +-> Socket.IO
        +-> Redis
        +-> MongoDB Atlas
        +-> Tatum
        +-> Transak
```

## Production Frontend Settings

Set these in Vercel:

```env
VITE_API_URL=https://api.moneymatrixapp.com/api/v1
VITE_API_BASE_URL=https://api.moneymatrixapp.com/api/v1
VITE_SOCKET_URL=https://api.moneymatrixapp.com
```

The frontend code already supports these variables in [frontend/src/services/api.js](/abs/path/c:/Users/DELL/Desktop/moneyMatrix2/frontend/src/services/api.js:1) and [frontend/src/services/socket.js](/abs/path/c:/Users/DELL/Desktop/moneyMatrix2/frontend/src/services/socket.js:1).

## Production Backend Settings

Backend runs on:

```text
http://localhost:8000
```

Public production URL:

```text
https://api.moneymatrixapp.com
```

Main API base:

```text
https://api.moneymatrixapp.com/api/v1
```

Use these production values:

```env
PORT=8000
NODE_ENV=development
MONGO_URI=mongodb+srv://kunal:kunal1234@cluster0.kv5gcsy.mongodb.net/crypto-game
ACCESS_TOKEN_SECRET=79d9a09821833bb08043b2dbe7288368424153a9035826382c85307a7d80773b
ACCESS_TOKEN_EXPIRE=15m
REFRESH_TOKEN_SECRET=8ea517cc1a6634c2c0a3127eaaafc7752be32a3b15af9da42c62f3f7429d8ab1
REFRESH_TOKEN_EXPIRE=7d
CORS_ORIGINS=https://moneymatrixapp.com,https://www.moneymatrixapp.com
TATUM_API_KEY=t-69c26a31564f048dcf4dd20b-fe8d76bd0bec41c7af7f4bb7
TATUM_WEBHOOK_HMAC_SECRET=8e1a6ca3738090b6bfb684fde04d0bf35a5e17d80fcc686ebf587ce9b22424bf
TATUM_TRON_ADMIN_ADDRESS=TJv25FCA2bwLeJHs8op1duVkWkucGyswPF
TATUM_TRON_ADMIN_SIGNATURE_ID=aa43fa62-3873-429b-84c5-c271538a00c0
TATUM_TRON_ADMIN_SIGNER_REF=admin-tron-wallet
CHAIN=tron-testnet
TATUM_TRON_TRANSFER_MODE=TRX
TATUM_TRON_TRC20_TOKEN_ADDRESS=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
MENEMONIC_ENCRYPTION_KEY=8ea517cc1a6634c2c0a3127eaaafc7752be32a3b15af9da42c62f3f7429d8ab1
PUBLIC_WEBHOOK_BASE_URL=https://api.moneymatrixapp.com
BACKEND_PUBLIC_URL=https://api.moneymatrixapp.com
TRANSAK_API_KEY=465b1f9d-5018-450d-bffd-37781b95d617
TRANSAK_API_SECRET=GUnJaeml+37JY1lKSASEyg==
TRANSAK_ACCESS_TOKEN=
TRANSAK_HOST_URL=https://moneymatrixapp.com
TRANSAK_REFERRER_DOMAIN=moneymatrixapp.com
REDIS_URL=redis://127.0.0.1:6379
TRON_FEE=1
MIN_TRON_CONFIRMATIONS=0
WEBHOOK_MAX_RETRIES=5
DEPOSIT_POLL_INTERVAL_MS=120000
DEPOSIT_POLL_BATCH_SIZE=25
WITHDRAWAL_JOB_ATTEMPTS=5
WITHDRAWAL_JOB_BACKOFF_MS=5000
WITHDRAWAL_WORKER_CONCURRENCY=1
ADMIN_WALLET_USER_ID=69eb4c8f8654ae16eedb1396
ADMIN_WALLET_USER_EMAIL=kunalcode23106052@gmail.com
ADMIN_WALLET_USER_PHONE=+919592951721
ADMIN_SIGNUP_KEY=4058a9dc89d21558e7bddf19f467a2192224dfe22726bb34173fa0c924172bfd
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
EMAIL_USER=kunalcode23106052@gmail.com
EMAIL_PASS=aruf kqft xaws eugm
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_ALLOW_INVALID_TLS=true
```

For real production, change `NODE_ENV` to `production` and rotate secrets before publishing.

## Generate 256-Bit Secrets

Use 256-bit values for JWT secrets, encryption keys, HMAC secrets, and admin keys:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Good candidates for 256-bit rotation:

- `ACCESS_TOKEN_SECRET`
- `REFRESH_TOKEN_SECRET`
- `MENEMONIC_ENCRYPTION_KEY`
- `TATUM_WEBHOOK_HMAC_SECRET`
- `ADMIN_SIGNUP_KEY`

## Docker Services

Run Redis in Docker:

```bash
docker run -d --name redis-server -p 6379:6379 redis:7-alpine
```

Run backend locally:

```bash
cd backend
npm install
npm run dev
```

Build frontend locally:

```bash
cd frontend
npm install
npm run build
```

## Full Step-By-Step Docs

- Deployment walkthrough: [docs/deploymentSteps.md](/abs/path/c:/Users/DELL/Desktop/moneyMatrix2/docs/deploymentSteps.md)
- API testing guide: [docs/postman.md](/abs/path/c:/Users/DELL/Desktop/moneyMatrix2/docs/postman.md)
- Backend API reference: [docs/API_README.md](/abs/path/c:/Users/DELL/Desktop/moneyMatrix2/docs/API_README.md)
