# MoneyMatrix Backend API Guide

MoneyMatrix is a Node.js + Express + MongoDB backend for a color betting game with:

- user auth with OTP verification
- Tron wallet creation and balance handling
- Transak on-ramp and off-ramp flows
- Tatum blockchain integration
- live game updates over Socket.IO
- admin monitoring and game controls

This README is written so a frontend developer can use the project directly without digging through backend code.

## Project Structure

```text
moneyMatrix2/
  backend/
    src/
      app.js
      index.js
      routes/
      controller/
      middleware/
      model/
      service/
      socket/
```

There is currently no frontend app in this repository. This README documents the backend APIs and socket events you can connect from your frontend.

## Tech Stack

- Node.js
- Express
- MongoDB with Mongoose
- Socket.IO
- JWT auth
- Tatum API
- Transak
- Twilio
- Nodemailer

## Base URL

Local backend base URL:

```text
http://localhost:5000
```

API base prefix:

```text
http://localhost:5000/api/v1
```

Health check:

```http
GET /health
```

Example response:

```json
{
  "status": 200,
  "message": "Surver is running"
}
```

## Installation

From the project root:

```bash
cd backend
npm install
```

Run development server:

```bash
npm run dev
```

## Environment Variables

Create `backend/.env` and add the values below.

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
TRANSAK_WEBHOOK_SECRET=your_transak_webhook_secret

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

## CORS

The backend:

- allows `localhost`
- allows `ngrok`
- allows origins listed in `CORS_ORIGINS`
- uses `credentials: true`

If your frontend uses cookies, send requests with credentials enabled.

Examples:

```js
fetch(url, {
  credentials: "include"
});
```

```js
axios.create({
  baseURL: "http://localhost:5000/api/v1",
  withCredentials: true
});
```

## Auth Model

The backend supports both:

- cookie-based auth
- bearer token auth

Protected routes accept the access token from:

- `Cookie: accessToken=...`
- `Authorization: Bearer <token>`

Socket authentication accepts:

- `socket.handshake.auth.token`
- `Authorization: Bearer <token>` header during socket connection

## Standard API Response Format

Successful controller responses usually follow this shape:

```json
{
  "status": 200,
  "success": true,
  "message": "Success",
  "data": {}
}
```

Error responses usually follow this shape:

```json
{
  "success": false,
  "message": "Error message",
  "statusCode": 400
}
```

## Main Frontend Flow

Recommended frontend order:

1. Register user
2. Verify OTP
3. Store access token from response if you want bearer-token usage
4. Create or fetch wallet
5. Connect socket with access token
6. Listen for round updates
7. Place bets during `running` phase
8. Use ramp endpoints for deposit and withdrawal flows

## REST API

### 1. Auth APIs

Base path:

```text
/api/v1/users
```

#### Register

```http
POST /api/v1/users/register
Content-Type: application/json
```

Request body:

```json
{
  "name": "Kunal",
  "email": "kunal@example.com",
  "phone": "+919999999999",
  "password": "12345678"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "OTP sent successfully",
  "data": {}
}
```

Notes:

- creates user if not already verified
- sends OTP through email
- sends OTP through Twilio SMS if configured

#### Verify OTP

```http
POST /api/v1/users/verify-otp
Content-Type: application/json
```

Request body:

```json
{
  "phone": "+919999999999",
  "otp": "123456"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Account verified",
  "data": {
    "user": {
      "_id": "USER_ID",
      "name": "Kunal",
      "email": "kunal@example.com",
      "phone": "+919999999999",
      "role": "user",
      "isVerified": true
    },
    "accessToken": "JWT_ACCESS_TOKEN"
  }
}
```

Notes:

- also sets `accessToken` and `refreshToken` cookies
- user becomes verified here

#### Login

```http
POST /api/v1/users/login
Content-Type: application/json
```

Request body with email:

```json
{
  "email": "kunal@example.com",
  "password": "12345678"
}
```

Request body with phone:

```json
{
  "phone": "+919999999999",
  "password": "12345678"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "USER_ID",
      "name": "Kunal",
      "email": "kunal@example.com",
      "phone": "+919999999999",
      "role": "user"
    },
    "accessToken": "JWT_ACCESS_TOKEN"
  }
}
```

#### Refresh Token

```http
POST /api/v1/users/refresh-token
Content-Type: application/json
```

Request body if not using cookies:

```json
{
  "refreshToken": "JWT_REFRESH_TOKEN"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Token refreshed",
  "data": {
    "accessToken": "NEW_ACCESS_TOKEN"
  }
}
```

#### Logout

```http
GET /api/v1/users/logout
Authorization: Bearer <access_token>
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Logged out",
  "data": {}
}
```

#### Forgot Password

```http
POST /api/v1/users/forgot-password
Content-Type: application/json
```

Request body:

```json
{
  "phone": "+919999999999"
}
```

#### Reset Password

```http
POST /api/v1/users/reset-password
Content-Type: application/json
```

Request body:

```json
{
  "phone": "+919999999999",
  "otp": "123456",
  "newPassword": "newStrongPassword"
}
```

### 2. Wallet API

Base path:

```text
/api/v1/wallet
```

Protected route:

- requires access token

#### Create or Fetch User Wallet

```http
POST /api/v1/wallet
Authorization: Bearer <access_token>
```

Success when wallet already exists:

```json
{
  "status": 200,
  "success": true,
  "message": "Wallet already exists",
  "data": {
    "wallet": {
      "address": "TRON_ADDRESS"
    }
  }
}
```

Success when wallet is newly created:

```json
{
  "status": 201,
  "success": true,
  "message": "Tron Wallet created successfully",
  "data": {
    "wallet": {
      "address": "TRON_ADDRESS"
    }
  }
}
```

Frontend note:

- only the public wallet address is returned
- mnemonic and xpub are never returned

### 3. Ramp APIs

Base path:

```text
/api/v1/ramp
```

All routes require authentication.

#### Generate On-Ramp URL

```http
GET /api/v1/ramp/on-ramp
Authorization: Bearer <access_token>
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "On-ramp URL generated successfully",
  "data": {
    "url": "https://global-stg.transak.com?...or...https://global.transak.com?..."
  }
}
```

Frontend use:

- redirect user to `data.url`
- backend pre-fills TRX and user wallet address

#### Generate Off-Ramp URL

```http
POST /api/v1/ramp/off-ramp
Authorization: Bearer <access_token>
Content-Type: application/json
```

Request body:

```json
{
  "amount": 100
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Off-ramp URL generated",
  "data": {
    "url": "https://global-stg.transak.com?...or...https://global.transak.com?...",
    "transactionId": "TRANSACTION_ID"
  }
}
```

Important frontend note:

- user wallet balance is reduced immediately when this URL is generated
- if Transak later fails or cancels, the webhook refunds the balance

#### Withdraw TRX

```http
POST /api/v1/ramp/withdraw
Authorization: Bearer <access_token>
Content-Type: application/json
```

Request body:

```json
{
  "amount": 50,
  "toAddress": "TRON_EXTERNAL_ADDRESS"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Withdraw initiated",
  "data": {
    "txId": "BLOCKCHAIN_TX_ID"
  }
}
```

Notes:

- non-admin users withdraw from internal balance
- admin wallet sends the actual blockchain transaction
- final success is confirmed later by webhook

### 4. Admin APIs

Base path:

```text
/api/v1/admin
```

All routes require:

- valid access token
- user role must be `admin`

#### Get Platform Users

```http
GET /api/v1/admin/users
Authorization: Bearer <admin_access_token>
```

Success response shape:

```json
{
  "status": 200,
  "success": true,
  "message": "Platform users fetched successfully",
  "data": {
    "totalUsers": 10,
    "livePlayers": 4,
    "users": [
      {
        "_id": "USER_ID",
        "name": "Kunal",
        "email": "kunal@example.com",
        "phone": "+919999999999",
        "tronAddress": "TRON_ADDRESS",
        "createdAt": "2026-03-31T00:00:00.000Z",
        "balance": 500,
        "lockedBalance": 100,
        "isLoggedIn": true,
        "isCurrentlyPlaying": true
      }
    ]
  }
}
```

#### Get Leaderboard

```http
GET /api/v1/admin/leaderboard?limit=10
Authorization: Bearer <admin_access_token>
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Leaderboard fetched successfully",
  "data": [
    {
      "_id": "USER_ID",
      "totalWinAmount": 1200,
      "totalBetsWon": 6,
      "name": "Kunal",
      "email": "kunal@example.com",
      "tronAddress": "TRON_ADDRESS"
    }
  ]
}
```

### 5. Webhook APIs

Base path:

```text
/api/v1/webhook
```

These routes are for Tatum and Transak servers, not for frontend use.

Endpoints:

- `POST /api/v1/webhook/tatum/deposit`
- `POST /api/v1/webhook/tatum/withdraw`
- `POST /api/v1/webhook/transak`

Headers checked by backend:

- `x-webhook-secret`
- `x-tatum-webhook-secret`
- `x-transak-signature`
- `authorization`

## Socket.IO Integration

Socket server runs on the same host and port as the backend.

Connection URL:

```text
http://localhost:5000
```

Install client:

```bash
npm install socket.io-client
```

### Frontend Connection Example

```js
import { io } from "socket.io-client";

const socket = io("http://localhost:5000", {
  auth: {
    token: accessToken
  },
  withCredentials: true
});

socket.on("connect", () => {
  console.log("socket connected", socket.id);
});

socket.on("connect_error", (err) => {
  console.error("socket auth failed", err.message);
});
```

### Client Events You Emit

#### `place-bet`

User only.

Payload:

```json
{
  "color": "red",
  "amount": 100
}
```

Example:

```js
socket.emit("place-bet", {
  color: "red",
  amount: 100
});
```

#### `change-result`

Admin only.

Payload:

```json
{
  "color": "blue"
}
```

Example:

```js
socket.emit("change-result", {
  color: "blue"
});
```

#### `change-duration`

Admin only.

Payload:

```json
{
  "seconds": 20,
  "isIncrease": true
}
```

Example:

```js
socket.emit("change-duration", {
  seconds: 20,
  isIncrease: true
});
```

### Server Events You Listen For

#### `current-round`

Sent to a newly joined authenticated user if a round already exists.

Example payload:

```json
{
  "_id": "ROUND_DB_ID",
  "roundId": "ROUND-1743412345678",
  "status": "running",
  "startTime": "2026-03-31T10:00:00.000Z",
  "endTime": "2026-03-31T10:01:00.000Z",
  "totalBetAmount": 0,
  "totalRed": 0,
  "totalBlue": 0,
  "totalViolet": 0
}
```

#### `new-round`

Broadcast when a new game round starts.

Example payload:

```json
{
  "_id": "ROUND_DB_ID",
  "roundId": "ROUND-1743412345678",
  "status": "running",
  "startTime": "2026-03-31T10:00:00.000Z",
  "endTime": "2026-03-31T10:01:00.000Z",
  "result": null,
  "totalBetAmount": 0,
  "totalRed": 0,
  "totalBlue": 0,
  "totalViolet": 0
}
```

#### `timer`

Broadcast every second.

Payload:

```json
{
  "remaining": 42135,
  "status": "running"
}
```

Frontend note:

- `remaining` is in milliseconds
- convert to seconds in UI if needed

#### `bet-placed`

Private event sent to the user who placed a bet.

Payload:

```json
{
  "bet": {
    "_id": "BET_ID",
    "user": "USER_ID",
    "round": "ROUND_ID",
    "color": "red",
    "amount": 100,
    "status": "pending",
    "winAmount": 0,
    "isSettled": false
  },
  "balance": 400,
  "lockedBalance": 100
}
```

#### `bet-result`

Private event sent to each user after round settlement.

Payload:

```json
{
  "_id": "BET_ID",
  "user": "USER_ID",
  "round": "ROUND_ID",
  "color": "red",
  "amount": 100,
  "status": "won",
  "winAmount": 200,
  "isSettled": true
}
```

#### `round-ended`

Broadcast when betting closes and result is shown.

Waiting phase payload:

```json
{
  "result": "blue",
  "status": "waiting",
  "nextRoundAt": "2026-03-31T10:02:00.000Z",
  "currentRound": {
    "_id": "ROUND_ID",
    "roundId": "ROUND-1743412345678",
    "status": "waiting",
    "result": "blue"
  }
}
```

Ended payload can also be:

```json
{
  "result": "blue",
  "status": "ended"
}
```

#### `admin-bet-update`

Sent only to admin room when any user places a bet.

Payload:

```json
{
  "userId": "USER_ID",
  "amount": 100,
  "color": "red",
  "roundId": "ROUND_ID",
  "currentTotals": {
    "total": 1000,
    "red": 600,
    "blue": 200,
    "violet": 200
  }
}
```

#### `player-count`

Sent to admins when user count changes.

Payload:

```json
4
```

#### `admin-set-result`

Sent to admins after manual result selection.

Payload:

```json
{
  "result": "violet",
  "roundId": "ROUND_ID"
}
```

#### `admin-change-duration`

Broadcast when admin changes current round duration.

Payload:

```json
{
  "newEndTime": "2026-03-31T10:01:20.000Z",
  "roundId": "ROUND_ID"
}
```

#### `game-stopped`

Broadcast if the engine is stopped manually.

Payload:

```json
{}
```

#### `error`

Emitted back to the socket client when a socket action fails.

Payload:

```json
{
  "message": "Betting is currently closed"
}
```

## Frontend Example Service Layer

### Axios Client

```js
import axios from "axios";

export const api = axios.create({
  baseURL: "http://localhost:5000/api/v1",
  withCredentials: true
});

export const authHeader = (token) => ({
  headers: {
    Authorization: `Bearer ${token}`
  }
});
```

### Example API Calls

```js
export const registerUser = (payload) =>
  api.post("/users/register", payload);

export const verifyOtp = (payload) =>
  api.post("/users/verify-otp", payload);

export const loginUser = (payload) =>
  api.post("/users/login", payload);

export const createWallet = (token) =>
  api.post("/wallet", {}, authHeader(token));

export const getOnRampUrl = (token) =>
  api.get("/ramp/on-ramp", authHeader(token));

export const getOffRampUrl = (token, amount) =>
  api.post("/ramp/off-ramp", { amount }, authHeader(token));

export const withdraw = (token, amount, toAddress) =>
  api.post("/ramp/withdraw", { amount, toAddress }, authHeader(token));
```

### Example Socket Wrapper

```js
import { io } from "socket.io-client";

export const createGameSocket = (token) =>
  io("http://localhost:5000", {
    auth: { token },
    withCredentials: true
  });
```

## Game Logic Summary

- game starts automatically when server starts
- one round runs for 60 seconds
- after betting closes, result is shown during waiting phase
- server picks winner based on minimum total bet color unless admin sets a result
- winning bet multiplier is `2x`
- wallet balance moves to `lockedBalance` when a bet is placed
- after settlement:
  - win: locked amount is released and payout is added
  - loss: locked amount is removed

## Important Frontend Notes

- `timer.remaining` is milliseconds, not seconds
- users must be authenticated before socket connection
- admins can connect to same socket server and receive admin-only events
- `off-ramp` deducts balance first and refunds only if webhook says failed/cancelled
- `withdraw` returns initiation result first; final confirmation is webhook-based
- `wallet` endpoint is `POST`, not `GET`
- cookies are supported, but bearer token is easier for many frontend apps

## Known Backend Behaviors to Be Aware Of

- `GET /health` returns `"Surver is running"` with that exact spelling
- admin routes are protected by JWT middleware and then checked again in controller logic
- webhook routes are intentionally public and rely on secret headers
- the repository currently contains only the backend folder

## Suggested Frontend Pages

- Register
- Verify OTP
- Login
- Forgot Password
- Reset Password
- Wallet / Balance
- Deposit
- Withdraw
- Live Game
- Admin Dashboard
- Leaderboard

## Quick Manual Test Order

1. Start MongoDB
2. Start backend with `npm run dev`
3. Call `POST /api/v1/users/register`
4. Call `POST /api/v1/users/verify-otp`
5. Call `POST /api/v1/wallet`
6. Connect socket with returned access token
7. Listen for `new-round` and `timer`
8. Emit `place-bet`
9. Listen for `bet-placed`, `bet-result`, and `round-ended`

## File References

Useful backend entry points:

- [backend/src/app.js](c:\Users\DELL\Desktop\moneyMatrix2\backend\src\app.js)
- [backend/src/index.js](c:\Users\DELL\Desktop\moneyMatrix2\backend\src\index.js)
- [backend/src/socket/index.js](c:\Users\DELL\Desktop\moneyMatrix2\backend\src\socket\index.js)
- [backend/src/service/gameEngine.service.js](c:\Users\DELL\Desktop\moneyMatrix2\backend\src\service\gameEngine.service.js)

