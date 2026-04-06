# MoneyMatrix

MoneyMatrix is a full-stack betting platform with:

- a `frontend` React + Vite app
- a `backend` Node.js + Express API
- MongoDB for persistence
- Socket.IO for live game updates
- Tron wallet support through Tatum
- Transak on-ramp and off-ramp integration

## Project Structure

```text
moneyMatrix2/
  backend/
    src/
      app.js
      index.js
      controller/
      db/
      middleware/
      model/
      routes/
      service/
      socket/
  frontend/
    src/
      App.jsx
      App.css
  README.md
```

## Tech Stack

- Frontend: React, Vite
- Backend: Node.js, Express
- Database: MongoDB, Mongoose
- Realtime: Socket.IO
- Auth: JWT, cookies
- External services: Tatum, Transak, Twilio, Nodemailer

## Local Development

### Backend

```bash
cd backend
npm install
npm run dev
```

Backend runs on:

```text
http://localhost:5000
```

Health check:

```http
GET /health
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend usually runs on:

```text
http://localhost:5173
```

## Environment Variables

Create `backend/.env` and configure:

```env
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/moneymatrix

ACCESS_TOKEN_SECRET=your_access_secret
ACCESS_TOKEN_EXPIRE=15m
REFRESH_TOKEN_SECRET=your_refresh_secret
REFRESH_TOKEN_EXPIRE=7d

CORS_ORIGINS=http://localhost:5173,http://localhost:3000

MENEMONIC_ENCRYPTION_KEY=your_strong_encryption_key

TATUM_API_KEY_KUNAL=your_tatum_api_key
TATUM_WEBHOOK_SECRET=your_tatum_webhook_secret

TRANSAK_API_KEY=your_transak_api_key
TRANSAK_API_SECRET=your_transak_api_secret
TRANSAK_ACCESS_TOKEN=
TRANSAK_WEBHOOK_SECRET=your_transak_webhook_secret
TRANSAK_HOST_URL=https://your-public-app-domain.com
TRANSAK_REFERRER_DOMAIN=your-public-app-domain.com

TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+10000000000

EMAIL_USER=your_email@example.com
EMAIL_PASS=your_email_password_or_app_password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_ALLOW_INVALID_TLS=false
```

## Main API Base

Base URL:

```text
http://localhost:5000/api/v1
```

Main route groups:

- `/users`
- `/wallet`
- `/ramp`
- `/admin`
- `/webhook`

## Important Routes

### User

- `POST /api/v1/users/register`
- `POST /api/v1/users/verify-otp`
- `POST /api/v1/users/login`
- `POST /api/v1/users/forgot-password`
- `POST /api/v1/users/reset-password`
- `POST /api/v1/users/refresh-token`
- `GET /api/v1/users/logout`

### Wallet

- `POST /api/v1/wallet`
- `GET /api/v1/wallet/info`
- `GET /api/v1/wallet/bet-info`

### Ramp

- `GET /api/v1/ramp/on-ramp`
- `POST /api/v1/ramp/off-ramp`
- `POST /api/v1/ramp/withdraw`

## Authentication

Protected routes accept token from either:

- `Cookie: accessToken=...`
- `Authorization: Bearer <token>`

Socket authentication supports token-based connection as well.

## Socket.IO

Socket server runs on the same backend host:

```text
http://localhost:5000
```

Common events used by the app:

- `current-round`
- `new-round`
- `timer`
- `place-bet`
- `bet-placed`
- `bet-result`
- `round-ended`
- `admin-bet-update`

Example connection:

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: {
    token: accessToken,
  },
  withCredentials: true,
});
```

## Notes

- Wallet APIs require authenticated users.
- Wallet creation uses the backend user identity from JWT.
- The backend now uses the `user` field in wallet documents, not `userId`.
- If MongoDB had an old `userId_1` wallet index, backend startup now removes that stale index and syncs the correct wallet indexes.

## Useful Entry Points

- [backend/src/index.js](c:/Users/DELL/Desktop/moneyMatrix2/backend/src/index.js)
- [backend/src/app.js](c:/Users/DELL/Desktop/moneyMatrix2/backend/src/app.js)
- [backend/src/routes/user.route.js](c:/Users/DELL/Desktop/moneyMatrix2/backend/src/routes/user.route.js)
- [backend/src/routes/wallet.route.js](c:/Users/DELL/Desktop/moneyMatrix2/backend/src/routes/wallet.route.js)
- [backend/src/socket/index.js](c:/Users/DELL/Desktop/moneyMatrix2/backend/src/socket/index.js)
- [frontend/src/App.jsx](c:/Users/DELL/Desktop/moneyMatrix2/frontend/src/App.jsx)
