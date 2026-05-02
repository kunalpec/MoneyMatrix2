# Backend API README

This file is meant for frontend developers who need to integrate with the MoneyMatrix backend.

## Base URLs

- Local backend: `http://localhost:8000`
- API base: `http://localhost:8000/api/v1`

## Health Check

### `GET /health`

Use this to confirm the backend is running.

Example response:

```json
{
  "status": 200,
  "message": "Surver is running"
}
```

## Authentication

Protected routes accept either of these:

- `Cookie: accessToken=...`
- `Authorization: Bearer <accessToken>`

Backend behavior:

- Login and OTP verification set `accessToken` and `refreshToken` as `HttpOnly` cookies.
- The API also returns `accessToken` in JSON for clients that want to store/use it manually.
- `refresh-token` accepts refresh token from cookie or from request body.

Recommended frontend setup:

- If your frontend and backend are on different origins and you want cookie auth, send requests with `withCredentials: true`.
- If you prefer token auth, read `accessToken` from the login/verify response and send it in the `Authorization` header.

Example bearer header:

```http
Authorization: Bearer <accessToken>
```

## Common Response Format

Successful responses usually look like this:

```json
{
  "status": 200,
  "success": true,
  "message": "Success",
  "data": {}
}
```

Error responses look like this:

```json
{
  "success": false,
  "message": "Unauthorized",
  "statusCode": 401
}
```

## User APIs

### `POST /api/v1/users/register`

Creates a user and sends OTP to email/SMS.

Request body:

```json
{
  "name": "Kunal",
  "email": "kunal@example.com",
  "phone": "+919999999999",
  "password": "secret123",
  "role": "user"
}
```

Optional admin signup fields:

```json
{
  "role": "admin",
  "adminKey": "your_admin_signup_key"
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

### `POST /api/v1/users/verify-otp`

Verifies signup OTP and logs the user in.

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
      "isVerified": true,
      "tronAddress": "TRON_ADDRESS"
    },
    "accessToken": "JWT_ACCESS_TOKEN"
  }
}
```

### `POST /api/v1/users/login`

Login with either `email` or `phone`, plus `password`.

Request body with email:

```json
{
  "email": "kunal@example.com",
  "password": "secret123"
}
```

Request body with phone:

```json
{
  "phone": "+919999999999",
  "password": "secret123"
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
      "role": "user",
      "isVerified": true
    },
    "accessToken": "JWT_ACCESS_TOKEN"
  }
}
```

### `POST /api/v1/users/refresh-token`

Refreshes access token using refresh token from cookie or request body.

Request body if not using cookie:

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
    "accessToken": "NEW_JWT_ACCESS_TOKEN"
  }
}
```

### `GET /api/v1/users/logout`

Protected route. Clears cookies and invalidates stored refresh token.

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Logged out",
  "data": {}
}
```

### `POST /api/v1/users/forgot-password`

Sends OTP for password reset and temporarily stores `newpassword`.

Request body:

```json
{
  "phone": "+919999999999",
  "newpassword": "newSecret123"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Reset OTP sent",
  "data": {}
}
```

### `POST /api/v1/users/reset-password`

Completes password reset using OTP.

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
  "message": "Password reset successful",
  "data": {}
}
```

## Wallet APIs

All wallet routes are protected.

### `POST /api/v1/wallet`

Creates the current user's Tron wallet if it does not exist yet.

Request body:

```json
{}
```

Success response when wallet is created:

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

Success response when wallet already exists:

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

### `GET /api/v1/wallet/info`

Returns wallet balance details for current user.

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Wallet information retrieved successfully",
  "data": {
    "wallet": {
      "address": "TRON_ADDRESS",
      "balance": 12.5
    }
  }
}
```

### `GET /api/v1/wallet/bet-info`

Returns current user's bet summary.

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Bet information retrieved successfully",
  "data": {
    "betInfo": {
      "_id": "USER_ID",
      "totalBets": 10,
      "totalAmountBet": 500,
      "totalWins": 6,
      "totalLosses": 4,
      "totalAmountWon": 900,
      "totalAmountLost": 200
    }
  }
}
```

## Ramp APIs

All ramp routes are protected.

### `POST /api/v1/ramp/on-ramp`

Creates a Transak buy widget URL for depositing TRX.

Requirements:

- User must be authenticated.
- User must already have a wallet address.

Request body:

```json
{
  "fiatAmount": 1000,
  "countryCode": "IN",
  "fiatCurrency": "INR",
  "cryptoCurrencyCode": "TRX"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Success",
  "data": {
    "url": "https://global.transak.com?...",
    "orderId": "PARTNER_ORDER_ID"
  }
}
```

Frontend note:

- Redirect the user to `data.url`.
- Save `orderId` if you need to track the flow on the frontend.
- Actual wallet credit happens later through webhook processing.

### `POST /api/v1/ramp/off-ramp`

Creates a Transak sell widget URL for withdrawing from internal balance.

Request body:

```json
{
  "amount": 50,
  "toAddress": "TRON_DESTINATION_ADDRESS",
  "fiatCurrency": "INR",
  "countryCode": "IN",
  "cryptoCurrencyCode": "TRX"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Success",
  "data": {
    "url": "https://global.transak.com?...",
    "orderId": "PARTNER_ORDER_ID"
  }
}
```

Frontend note:

- User balance is reserved before the widget URL is returned.
- Frontend should call only `POST /api/v1/ramp/off-ramp` with `amount` and `toAddress`.
- Backend validates `toAddress` and passes it into the Transak sell flow.
- If widget creation fails, the backend rolls the reserved amount back automatically.

### `POST /api/v1/ramp/withdraw`

Direct TRX withdrawal to an external wallet.

Request body:

```json
{
  "amount": 25,
  "toAddress": "TRON_DESTINATION_ADDRESS"
}
```

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Withdrawal submitted",
  "data": {
    "txId": "BLOCKCHAIN_TX_ID"
  }
}
```

Possible alternate success message:

```json
{
  "status": 200,
  "success": true,
  "message": "Withdrawal submitted and awaiting webhook confirmation",
  "data": {
    "txId": "BLOCKCHAIN_TX_ID"
  }
}
```

Important behavior:

- For normal users, the backend deducts balance before sending the chain transaction.
- Final transaction success is confirmed later through Tatum webhook.

## Admin APIs

All admin routes are protected and require `req.user.role === "admin"`.

### `GET /api/v1/admin/users`

Returns platform users, balance data, login status, and live playing status.

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Platform users fetched successfully",
  "data": {
    "totalUsers": 2,
    "livePlayers": 1,
    "users": [
      {
        "_id": "USER_ID",
        "name": "Kunal",
        "email": "kunal@example.com",
        "phone": "+919999999999",
        "tronAddress": "TRON_ADDRESS",
        "createdAt": "2026-04-16T10:00:00.000Z",
        "balance": 100,
        "lockedBalance": 20,
        "isLoggedIn": true,
        "isCurrentlyPlaying": false
      }
    ]
  }
}
```

### `GET /api/v1/admin/leaderboard?limit=10`

Returns users with the highest total winnings.

Success response:

```json
{
  "status": 200,
  "success": true,
  "message": "Leaderboard fetched successfully",
  "data": [
    {
      "_id": "USER_ID",
      "totalWinAmount": 1500,
      "totalBetsWon": 8,
      "name": "Kunal",
      "email": "kunal@example.com",
      "tronAddress": "TRON_ADDRESS"
    }
  ]
}
```

## Transak Utility APIs

These are mostly support/internal endpoints. Frontend may use them only if needed.

### `GET /api/v1/transak/token`

Returns a Transak access token fetched by backend.

Example response:

```json
{
  "accessToken": "TRANSAK_ACCESS_TOKEN",
  "expiresIn": 3600
}
```

### `POST /api/v1/transak/jwt-token`

Generates a Transak-style webhook JWT for testing and returns a ready-to-send webhook body.

Request body:

```json
{
  "eventId": "ORDER_COMPLETED",
  "orderId": "322dc79c-fad2-4df1-bf50-b292191fc953",
  "status": "COMPLETED",
  "cryptoAmount": "955.93",
  "cryptoCurrency": "TRX",
  "walletAddress": "TWhzMExtXfcXJpbTRMvXxJqnUrRdV4hf8p",
  "fiatAmount": 4500,
  "fiatCurrency": "INR",
  "countryCode": "IN"
}
```

### `POST /api/v1/webhook/tatum/hmac`

Generates a Tatum `x-payload-hash` for the exact payload string you want to send.

Request body when you want to preserve spaces and line breaks exactly:

```json
{
  "rawPayload": "{\n  \"subscriptionType\": \"INCOMING_NATIVE_TX\",\n  \"chain\": \"TRON\",\n  \"address\": \"TJv25FCA2bwLeJHs8op1duVkWkucGyswPF\",\n  \"counterAddress\": \"TSENDER_WALLET_ADDRESS\",\n  \"amount\": \"0.000241500000147\",\n  \"txId\": \"27c8f9a1b2c3d4e5f6789012345678901234567890abcdef\",\n  \"blockNumber\": 651631,\n  \"timestamp\": \"2026-04-27T08:00:00.000Z\",\n  \"fee\": \"0.000001\",\n  \"confirmations\": 1\n}"
}
```

If you send `payload` instead of `rawPayload`, the backend hashes `JSON.stringify(payload)` as a minified JSON string.

### `GET /api/v1/transak/success`

Simple success page used as redirect target after Transak buy flow.

## Webhook APIs

These are provider-facing routes. Frontend should not call them directly in normal app flow.

### `POST /api/v1/webhook/tatum/deposit`

Headers:

```http
x-tatum-webhook-secret: YOUR_TATUM_WEBHOOK_SECRET
```

Purpose:

- Confirms TRX deposit on-chain
- Credits user wallet
- Schedules treasury sweep if needed

### `POST /api/v1/webhook/tatum/withdraw`

Headers:

```http
x-tatum-webhook-secret: YOUR_TATUM_WEBHOOK_SECRET
```

Purpose:

- Confirms submitted withdrawal on-chain

### `POST /api/v1/webhook/transak`

Headers:

```http
x-transak-signature: HMAC_SHA256_SIGNATURE
```

Purpose:

- Updates local Transak deposit/withdraw transactions
- Finalizes success or refunds failed off-ramp reservations

## Frontend Integration Order

Recommended user flow:

1. Register user with `/users/register`
2. Verify OTP with `/users/verify-otp`
3. Create wallet with `POST /wallet`
4. Read wallet with `GET /wallet/info`
5. Start buy flow with `POST /ramp/on-ramp`
6. Start sell flow with `POST /ramp/off-ramp`
7. Use direct payout with `POST /ramp/withdraw` when needed

## Important Frontend Notes

- `logout` is a `GET` request, not `POST`.
- `on-ramp` is a `POST` request, not `GET`.
- `forgot-password` expects `newpassword` in the first call.
- `reset-password` expects only `phone` and `otp`; the new password is already stored temporarily by the previous endpoint.
- Wallet credit after on-ramp is asynchronous and depends on webhook delivery.
- Withdrawal completion is also asynchronous and may remain in processing until webhook confirmation.
- Admin APIs return `401` when a logged-in non-admin user tries to access them.

## Suggested Axios Setup

Cookie-based:

```js
import axios from "axios";

export const api = axios.create({
  baseURL: "http://localhost:8000/api/v1",
  withCredentials: true,
});
```

Bearer token-based:

```js
import axios from "axios";

export const api = axios.create({
  baseURL: "http://localhost:8000/api/v1",
});

export const setAccessToken = (token) => {
  api.defaults.headers.common.Authorization = `Bearer ${token}`;
};
```
