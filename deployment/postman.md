# MoneyMatrix API Testing Guide

Use this file as the Postman checklist for local and production testing.

## Base URLs

- Local API: `http://localhost:8000/api/v1`
- Production API: `https://api.moneymatrixapp.com/api/v1`

## Recommended Test Order

1. Register user
2. Verify OTP
3. Login
4. Create wallet
5. Check wallet info
6. Test on-ramp
7. Generate Transak test JWT
8. Test Transak webhook
9. Test Tatum webhook hash
10. Test Tatum webhook
11. Test withdraw
12. Test off-ramp
13. Register Tatum webhook

## 1. Register

`POST /users/register`

```http
http://localhost:8000/api/v1/users/register
```

```json
{
  "name": "jasleenkaur",
  "email": "jasleenkaurjandoria@gmail.com",
  "password": "12345678",
  "phone": "+919878497680"
}
```

## 2. Verify OTP

`POST /users/verify-otp`

```http
http://localhost:8000/api/v1/users/verify-otp
```

```json
{
  "phone": "+919781991761",
  "otp": "197473"
}
```

## 3. Login

`POST /users/login`

```http
http://localhost:8000/api/v1/users/login
```

```json
{
  "phone": "+919878497680",
  "password": "12345678"
}
```

Save the returned access token and cookies.

## 4. Create Wallet

`POST /wallet`

```http
http://localhost:8000/api/v1/wallet
```

Headers:

```text
Authorization: Bearer <accessToken>
```

## 5. Wallet Info

`GET /wallet/info`

```http
http://localhost:8000/api/v1/wallet/info
```

## 6. On-Ramp

`POST /ramp/on-ramp`

```http
http://localhost:8000/api/v1/ramp/on-ramp
```

Headers:

```text
Content-Type: application/json
token: <JWT token>
```

```json
{
  "fiatAmount": 100,
  "countryCode": "US",
  "fiatCurrency": "USD",
  "cryptoCurrencyCode": "TRX"
}
```

## 7. Generate Transak Test JWT

`POST /transak/jwt-token`

```http
http://localhost:8000/api/v1/transak/jwt-token
```

```json
{
  "eventId": "ORDER_COMPLETED",
  "orderId": "4bd5c097-8fea-41d6-8442-08b519242ee2",
  "status": "COMPLETED",
  "cryptoAmount": "100.0",
  "cryptoCurrency": "TRX",
  "walletAddress": "TJv25FCA2bwLeJHs8op1duVkWkucGyswPF",
  "fiatAmount": 100,
  "fiatCurrency": "USD",
  "countryCode": "US"
}
```

## 8. Test Transak Webhook

`POST /webhook/transak`

```http
http://localhost:8000/api/v1/webhook/transak
```

Header:

```text
x-transak-signature: 7d5f9fae93029fb3be577a70a344d54f20d275f0acaa06de45a56ddaac75d74e
```

```json
{
  "data": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJldmVudElkIjoiT1JERVJfQ09NUExFVEVEIiwib3JkZXJJZCI6IjRiZDVjMDk3LThmZWEtNDFkNi04NDQyLTA4YjUxOTI0MmVlMiIsInN0YXR1cyI6IkNPTVBMRVRFRCIsImNyeXB0b0Ftb3VudCI6IjEwMC4wIiwiY3J5cHRvQ3VycmVuY3kiOiJUUlgiLCJ3YWxsZXRBZGRyZXNzIjoiVEp2MjVGQ0EyYndMZUpIczhvcDFkdVZrV2t1Y0d5c3dQRiIsImZpYXRBbW91bnQiOjEwMCwiZmlhdEN1cnJlbmN5IjoiVVNEIiwiY291bnRyeUNvZGUiOiJVUyIsImV2ZW50SUQiOiJPUkRFUl9DT01QTEVURUQiLCJ3ZWJob29rRGF0YSI6eyJldmVudElkIjoiT1JERVJfQ09NUExFVEVEIiwib3JkZXJJZCI6IjRiZDVjMDk3LThmZWEtNDFkNi04NDQyLTA4YjUxOTI0MmVlMiIsInN0YXR1cyI6IkNPTVBMRVRFRCIsImNyeXB0b0Ftb3VudCI6IjEwMC4wIiwiY3J5cHRvQ3VycmVuY3kiOiJUUlgiLCJ3YWxsZXRBZGRyZXNzIjoiVEp2MjVGQ0EyYndMZUpIczhvcDFkdVZrV2t1Y0d5c3dQRiIsImZpYXRBbW91bnQiOjEwMCwiZmlhdEN1cnJlbmN5IjoiVVNEIiwiY291bnRyeUNvZGUiOiJVUyIsImlkIjoiNGJkNWMwOTctOGZlYS00MWQ2LTg0NDItMDhiNTE5MjQyZWUyIn0sImlhdCI6MTc3NzI3NTY1NiwiZXhwIjoxNzc3Mjc5MjU2fQ.WTaCIUokvG09uss9sNPOkvOlhbDF1LbKmAh9oNTxQg0",
  "eventID": "ORDER_COMPLETED",
  "webhookData": {
    "eventId": "ORDER_COMPLETED",
    "orderId": "4bd5c097-8fea-41d6-8442-08b519242ee2",
    "status": "COMPLETED",
    "cryptoAmount": "100.0",
    "cryptoCurrency": "TRX",
    "walletAddress": "TJv25FCA2bwLeJHs8op1duVkWkucGyswPF",
    "fiatAmount": 100,
    "fiatCurrency": "USD",
    "countryCode": "US",
    "id": "4bd5c097-8fea-41d6-8442-08b519242ee2"
  }
}
```

## 9. Test Tatum Webhook

`POST /webhook/tatum/address`

```http
http://localhost:8000/api/v1/webhook/tatum/address
```

Header:

```text
x-payload-hash: cGnr1QXuwvFLVIR6z5ujYqqLd3dg8sZAm+z/ueicIp5f+HYd2SjlwYyO5ROazvS5xw83SOaUXyD3dhakq6Ppzw==
```

```json
{
  "currency": "TRON",
  "address": "TJv25FCA2bwLeJHs8op1duVkWkucGyswPF",
  "blockNumber": 651631,
  "counterAddress": "TJv25FCA2bwLeJHs8op1duVkWkucGyswPF",
  "txId": "27c8f9a1b2c3d4e5f6789012345678901234567890abcdef",
  "chain": "tron-mainnet",
  "subscriptionType": "INCOMING_NATIVE_TX",
  "amount": "0.000241500000147"
}
```

## 10. Generate Tatum HMAC

`POST /webhook/tatum/hmac`

```http
http://localhost:8000/api/v1/webhook/tatum/hmac
```

```json
{
  "currency": "TRON",
  "address": "TJv25FCA2bwLeJHs8op1duVkWkucGyswPF",
  "blockNumber": 651631,
  "counterAddress": "TJv25FCA2bwLeJHs8op1duVkWkucGyswPF",
  "txId": "27c8f9a1b2c3d4e5f6789012345678901234567890abcdef",
  "chain": "tron-mainnet",
  "subscriptionType": "INCOMING_NATIVE_TX",
  "amount": "0.000241500000147"
}
```

## 11. Withdraw TRX

`POST /ramp/withdraw`

```http
http://localhost:8000/api/v1/ramp/withdraw
```

```json
{
  "amount": 25
}
```

## 12. Off-Ramp

`POST /ramp/off-ramp`

```http
http://localhost:8000/api/v1/ramp/off-ramp
```

```json
{
  "amount": 100,
  "fiatCurrency": "USD",
  "countryCode": "US",
  "cryptoCurrencyCode": "TRX"
}
```

## 13. Register Tatum Webhook from Backend

`POST /webhook/tatum/register-webhook`

```http
http://localhost:8000/api/v1/webhook/tatum/register-webhook
```

## 14. Delete Existing Tatum Subscription

```http
DELETE https://api.tatum.io/v4/subscription/69ec9241241ed512bceaff07
```

Header:

```text
x-api-key: t-69c26a31564f048dcf4dd20b-fe8d76bd0bec41c7af7f4bb7
```

## Notes

- Replace `http://localhost:8000` with `https://api.moneymatrixapp.com` for live testing.
- For protected routes, keep cookies enabled or send bearer tokens.
- Test webhooks only after backend public URL is reachable from the internet.
