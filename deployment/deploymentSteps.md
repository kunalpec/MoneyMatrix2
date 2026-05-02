# MoneyMatrix Deployment Steps

This guide is the clean start-to-finish deployment flow for MoneyMatrix.

## 1. Final Production URLs

Use these URLs in production:

- Frontend: `https://moneymatrixapp.com`
- Frontend alternate: `https://www.moneymatrixapp.com`
- Backend API: `https://api.moneymatrixapp.com`
- API base: `https://api.moneymatrixapp.com/api/v1`
- Socket.IO base: `https://api.moneymatrixapp.com`

## 2. Prerequisites

Install and prepare:

- Node.js `20+`
- Docker Desktop
- GitHub repository access
- Vercel account
- MongoDB Atlas database
- Domain DNS access for `moneymatrixapp.com` and `api.moneymatrixapp.com`

## 3. Frontend Deployment on Vercel

### Local check

```bash
cd frontend
npm install
npm run dev
npm run build
```

### Push code

```bash
git add .
git commit -m "Prepare production deployment docs and env"
git push origin main
```

### Import into Vercel

1. Open Vercel.
2. Click `Add New Project`.
3. Import the GitHub repository.
4. Set the root directory to `frontend`.
5. Let Vercel detect `Vite`.

### Add frontend environment variables in Vercel

```env
VITE_API_URL=https://api.moneymatrixapp.com/api/v1
VITE_API_BASE_URL=https://api.moneymatrixapp.com/api/v1
VITE_SOCKET_URL=https://api.moneymatrixapp.com
```

### Add production domains in Vercel

Add both:

- `moneymatrixapp.com`
- `www.moneymatrixapp.com`

### Verify frontend

After deploy, confirm:

- Signup page loads
- Login page loads
- API requests go to `https://api.moneymatrixapp.com/api/v1`
- Socket connection points to `https://api.moneymatrixapp.com`

## 4. Backend Deployment

The backend is an Express app that listens on port `8000`.

Recommended production stack:

- App server or VPS
- Docker for Redis
- MongoDB Atlas for database
- Reverse proxy or direct domain mapping for `api.moneymatrixapp.com`

### Backend install

```bash
cd backend
npm install
```

### Backend `.env`

Create `backend/.env` with:

```env
########################################
# SERVER
########################################
PORT=8000
NODE_ENV=development

########################################
# DATABASE
########################################
MONGO_URI=mongodb+srv://kunal:kunal1234@cluster0.kv5gcsy.mongodb.net/crypto-game

########################################
# AUTH
########################################
ACCESS_TOKEN_SECRET=79d9a09821833bb08043b2dbe7288368424153a9035826382c85307a7d80773b
ACCESS_TOKEN_EXPIRE=15m
REFRESH_TOKEN_SECRET=8ea517cc1a6634c2c0a3127eaaafc7752be32a3b15af9da42c62f3f7429d8ab1
REFRESH_TOKEN_EXPIRE=7d

########################################
# CORS
########################################
CORS_ORIGINS=https://moneymatrixapp.com,https://www.moneymatrixapp.com

########################################
# TATUM Dev
########################################
TATUM_API_KEY=t-69c26a31564f048dcf4dd20b-fe8d76bd0bec41c7af7f4bb7
TATUM_WEBHOOK_HMAC_SECRET=8e1a6ca3738090b6bfb684fde04d0bf35a5e17d80fcc686ebf587ce9b22424bf
TATUM_TRON_ADMIN_ADDRESS=TJv25FCA2bwLeJHs8op1duVkWkucGyswPF
TATUM_TRON_ADMIN_SIGNATURE_ID=aa43fa62-3873-429b-84c5-c271538a00c0
TATUM_TRON_ADMIN_SIGNER_REF=admin-tron-wallet
CHAIN=tron-testnet

########################################
# TRON TRANSFER MODE
########################################
TATUM_TRON_TRANSFER_MODE=TRX
TATUM_TRON_TRC20_TOKEN_ADDRESS=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t

########################################
# ENCRYPTION
########################################
MENEMONIC_ENCRYPTION_KEY=8ea517cc1a6634c2c0a3127eaaafc7752be32a3b15af9da42c62f3f7429d8ab1

########################################
# PUBLIC URLS
########################################
PUBLIC_WEBHOOK_BASE_URL=https://api.moneymatrixapp.com
BACKEND_PUBLIC_URL=https://api.moneymatrixapp.com

########################################
# TRANSAK Dev
########################################
TRANSAK_API_KEY=465b1f9d-5018-450d-bffd-37781b95d617
TRANSAK_API_SECRET=GUnJaeml+37JY1lKSASEyg==
TRANSAK_ACCESS_TOKEN=
TRANSAK_HOST_URL=https://moneymatrixapp.com
TRANSAK_REFERRER_DOMAIN=moneymatrixapp.com

########################################
# REDIS
########################################
REDIS_URL=redis://127.0.0.1:6379

########################################
# BLOCKCHAIN SETTINGS
########################################
TRON_FEE=1
MIN_TRON_CONFIRMATIONS=0

########################################
# JOB / QUEUE CONFIG
########################################
WEBHOOK_MAX_RETRIES=5
DEPOSIT_POLL_INTERVAL_MS=120000
DEPOSIT_POLL_BATCH_SIZE=25
WITHDRAWAL_JOB_ATTEMPTS=5
WITHDRAWAL_JOB_BACKOFF_MS=5000
WITHDRAWAL_WORKER_CONCURRENCY=1

########################################
# OPTIONAL ADMIN WALLET MAPPING
########################################
ADMIN_WALLET_USER_ID=69eb4c8f8654ae16eedb1396
ADMIN_WALLET_USER_EMAIL=kunalcode23106052@gmail.com
ADMIN_WALLET_USER_PHONE=+919592951721

########################################
# ADMIN SIGNUP
########################################
ADMIN_SIGNUP_KEY=4058a9dc89d21558e7bddf19f467a2192224dfe22726bb34173fa0c924172bfd

########################################
# TWILIO (OPTIONAL)
########################################
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

########################################
# EMAIL
########################################
EMAIL_USER=kunalcode23106052@gmail.com
EMAIL_PASS=aruf kqft xaws eugm
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_ALLOW_INVALID_TLS=true
```

### Start Redis with Docker

```bash
docker run -d --name redis-server -p 6379:6379 redis:7-alpine
```

If you need to restart it:

```bash
docker start redis-server
```

### Start backend

```bash
cd backend
npm run dev
```

Health check:

```text
http://localhost:8000/health
```

## 5. Tatum KMS Signature ID

Use this when the Tatum admin `signatureId` is missing.

### Important

The file `backend/.tatumrc` must exist before running these commands. On this machine, that file is currently missing, so a fresh signature ID cannot be generated from the repo state alone.

If `backend/.tatumrc` does not exist, Docker can create it as a directory instead of a file. That happened during verification here, so create the file first before relying on the generated wallet.

Create the file first:

```powershell
New-Item -ItemType File -Path C:\Users\DELL\Desktop\moneyMatrix2\backend\.tatumrc -Force
```

### Generate managed wallet

```powershell
docker run --rm `
  -e TATUM_API_KEY=t-69c26a31564f048dcf4dd20b-fe8d76bd0bec41c7af7f4bb7 `
  -e TATUM_KMS_PASSWORD=kunal@123 `
  -v C:\Users\DELL\Desktop\moneyMatrix2\backend\.tatumrc:/root/.tatumrc `
  tatumio/tatum-kms generatemanagedwallet TRON
```

Alternative if `tatum-kms` container is already running:

```powershell
docker exec -it tatum-kms tatum-kms generatemanagedwallet TRON
```

Expected result:

```json
{
  "signatureId": "aa43fa62-3873-429b-84c5-c271538a00c0",
  "xpub": "xpub6DycnprcwHt2dhrnk6VFMQWSDgvKerE7E5ccnU2iR3utJfpDAXNeotiCzx4g2KV4qercGycJRijXXAybmAhT1Gmd4R2d1pwnm7DWwMcrMGo"
}
```

Use that value in:

```env
TATUM_TRON_ADMIN_SIGNATURE_ID=aa43fa62-3873-429b-84c5-c271538a00c0
```

## 6. Tatum Webhook Registration

Register the webhook against the backend public URL:

```powershell
curl -X POST "https://api.tatum.io/v4/subscription" `
  -H "Content-Type: application/json" `
  -H "x-api-key: t-69c26a31564f048dcf4dd20b-6cdd1e9bf928477d834021b7" `
  -d '{
    "type": "ADDRESS_TRANSACTION",
    "attr": {
      "address": "TDNRjEdj9uueCVnFxaVuhvzQYREJ1Yv5GU",
      "chain": "TRX",
      "url": "https://api.moneymatrixapp.com/api/v1/webhook/tatum/address"
    },
    "secret": "d0ce2d892bf8824d931d1dad0c4c654afdc0d0b1803a9d6a4e8e0cb7e4092e6a"
  }'
```

## 7. Connect Frontend to Backend

Frontend API calls should go to:

```text
https://api.moneymatrixapp.com/api/v1
```

Frontend socket calls should go to:

```text
https://api.moneymatrixapp.com
```

This is already supported by the frontend env file:

- [frontend/.env.production](/abs/path/c:/Users/DELL/Desktop/moneyMatrix2/frontend/.env.production:1)

## 8. Test the App After Deployment

Run these checks in order:

1. Open `https://moneymatrixapp.com`
2. Register a user
3. Verify OTP
4. Login
5. Create wallet
6. Open wallet info
7. Run on-ramp
8. Test webhook endpoints
9. Test off-ramp
10. Test direct withdrawal

Use this testing reference:

- [docs/postman.md](/abs/path/c:/Users/DELL/Desktop/moneyMatrix2/docs/postman.md:1)

## 9. Production Recommendations

- Change `NODE_ENV=production` before final release
- Rotate every shared secret before public deployment
- Do not commit real `.env` secrets
- Keep MongoDB Atlas IP and user access locked down
- Put `api.moneymatrixapp.com` behind HTTPS only
- Monitor `/health`
- Keep Redis running before backend boot
