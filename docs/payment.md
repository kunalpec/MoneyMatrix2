# Payment Webhook Test Formats

Use these payload formats when testing Transak and Tatum webhooks locally or through ngrok.

Only these webhook data flows are supported in this project:

```txt
Transak deposit
Transak withdraw
Tatum deposit
Tatum withdraw
```

Any other webhook type or unrelated webhook data should not be sent to these endpoints.

Replace `BASE_URL` with your server URL, for example:

```txt
http://localhost:8000
https://your-ngrok-url.ngrok-free.app
```

## Transak Webhook

Frontend note:

```txt
For frontend Transak withdraw, use only:
POST BASE_URL/api/v1/ramp/off-ramp
```

Send this body from frontend:

```json
{
  "amount": 50,
  "toAddress": "TRON_DESTINATION_ADDRESS",
  "fiatCurrency": "INR",
  "countryCode": "IN",
  "cryptoCurrencyCode": "TRX"
}
```

Off-ramp example JSON:

```json
{
  "amount": 50,
  "toAddress": "TExampleDestinationAddress123456789",
  "fiatCurrency": "INR",
  "countryCode": "IN",
  "cryptoCurrencyCode": "TRX"
}
```

The following Transak withdraw webhook route is backend-only and should not be called directly by the frontend:

```txt
POST BASE_URL/api/v1/webhook/transak/withdraw
```

For direct TRX withdraw without Transak, use:

```txt
POST BASE_URL/api/v1/ramp/withdraw
```

Send this body:

```json
{
  "amount": 25,
  "toAddress": "TRON_DESTINATION_ADDRESS"
}
```

Withdraw TRX example JSON:

```json
{
  "amount": 25,
  "toAddress": "TExampleDestinationAddress123456789"
}
```

Endpoint:

```txt
POST BASE_URL/api/v1/webhook/transak
POST BASE_URL/api/v1/webhook/transak/deposit
POST BASE_URL/api/v1/webhook/transak/withdraw
```

Required header:

```txt
Content-Type: application/json
```

Optional header:

```txt
x-transak-signature: <valid_hmac_signature>
```

The backend accepts the real Transak format:

```json
{
  "meta": {
    "orderID": "322dc79c-fad2-4df1-bf50-b292191fc953",
    "eventID": "ORDER_COMPLETED"
  },
  "data": [
    {
      "id": "670e7c469f2a5dd93fbe4406",
      "eventID": "ORDER_COMPLETED",
      "webhookData": {
        "id": "322dc79c-fad2-4df1-bf50-b292191fc953",
        "status": "COMPLETED",
        "walletAddress": "TWhzMExtXfcXJpbTRMvXxJqnUrRdV4hf8p",
        "fiatCurrency": "INR",
        "fiatAmount": 4500,
        "amountPaid": 4500,
        "cryptoCurrency": "TRX",
        "cryptoAmount": 955.93,
        "isBuyOrSell": "BUY",
        "network": "tron",
        "countryCode": "IN",
        "paymentOptionId": "upi",
        "transactionHash": "DUMMY_OR_REAL_CHAIN_TX_ID",
        "transactionLink": "https://tronscan.org/#/transaction/DUMMY_OR_REAL_CHAIN_TX_ID",
        "completedAt": "2026-04-20T10:00:00.000Z"
      }
    }
  ]
}
```

Important Transak fields:

```txt
meta.orderID or webhookData.id       Transak order id
meta.eventID or data[0].eventID      Event type, for example ORDER_COMPLETED
webhookData.status                   COMPLETED, FAILED, CANCELLED
webhookData.walletAddress            User wallet address
webhookData.cryptoCurrency           TRX
webhookData.cryptoAmount             Crypto amount
webhookData.transactionHash          Provider or chain tx id
```

Supported success events:

```txt
ORDER_COMPLETED
COMPLETED
SUCCESS
```

Supported failure events:

```txt
FAILED
ORDER_FAILED
CANCELLED
CANCELED
```

### Generate Transak Test JWT

To test manually, first generate a JWT from your backend:

```bash
curl -X POST BASE_URL/api/v1/transak/jwt-token \
  -H "Content-Type: application/json" \
  -d '{"eventId":"ORDER_COMPLETED","orderId":"322dc79c-fad2-4df1-bf50-b292191fc953","status":"COMPLETED","cryptoAmount":"955.93","cryptoCurrency":"TRX","walletAddress":"TWhzMExtXfcXJpbTRMvXxJqnUrRdV4hf8p","fiatAmount":4500,"fiatCurrency":"INR","countryCode":"IN"}'
```

Then send the returned `webhookPayload` to the webhook:

```bash
curl -X POST BASE_URL/api/v1/webhook/transak \
  -H "Content-Type: application/json" \
  -d '{"data":"<jwt_from_previous_response>","eventID":"ORDER_COMPLETED","webhookData":{"id":"322dc79c-fad2-4df1-bf50-b292191fc953","orderId":"322dc79c-fad2-4df1-bf50-b292191fc953","status":"COMPLETED","walletAddress":"TWhzMExtXfcXJpbTRMvXxJqnUrRdV4hf8p","cryptoCurrency":"TRX","cryptoAmount":"955.93","fiatAmount":4500,"fiatCurrency":"INR","countryCode":"IN"}}'
```

## Tatum Deposit Webhook

Endpoint:

```txt
POST BASE_URL/api/v1/webhook/tatum/deposit
POST BASE_URL/api/v1/webhook/tatum/address
```

Required header:

```txt
x-tatum-webhook-secret: <TATUM_WEBHOOK_SECRET from backend/.env>
Content-Type: application/json
```

Payload format:

```json
{
  "subscriptionType": "ADDRESS_EVENT",
  "txId": "6f1c9f4c3c5b0c1e8b2f7c9d1e5a1234567890abcdef",
  "address": "TWhzMExtXfcXJpbTRMvXxJqnUrRdV4hf8p",
  "amount": "955.93",
  "blockNumber": 53948213,
  "counterAddress": "TXYZSenderAddress123456789",
  "asset": "TRX",
  "network": "TRON",
  "confirmations": 19,
  "timestamp": 1713600000000
}
```

Important Tatum fields:

```txt
txId             Blockchain transaction id
address          Your user wallet address
amount           Deposit amount in TRX
asset            TRX
network          TRON
confirmations    Must be >= MIN_TRON_CONFIRMATIONS
```

Test curl:

```bash
curl -X POST BASE_URL/api/v1/webhook/tatum/deposit \
  -H "Content-Type: application/json" \
  -H "x-tatum-webhook-secret: <your_tatum_webhook_secret>" \
  -d '{"subscriptionType":"ADDRESS_EVENT","txId":"6f1c9f4c3c5b0c1e8b2f7c9d1e5a1234567890abcdef","address":"TWhzMExtXfcXJpbTRMvXxJqnUrRdV4hf8p","amount":"955.93","blockNumber":53948213,"counterAddress":"TXYZSenderAddress123456789","asset":"TRX","network":"TRON","confirmations":19,"timestamp":1713600000000}'
```

## Tatum Withdraw Webhook

Endpoint:

```txt
POST BASE_URL/api/v1/webhook/tatum/withdraw
```

Required header:

```txt
x-tatum-webhook-secret: <TATUM_WEBHOOK_SECRET from backend/.env>
Content-Type: application/json
```

Payload format:

```json
{
  "txId": "6f1c9f4c3c5b0c1e8b2f7c9d1e5a1234567890abcdef",
  "network": "TRON",
  "asset": "TRX",
  "confirmations": 19
}
```

Test curl:

```bash
curl -X POST BASE_URL/api/v1/webhook/tatum/withdraw \
  -H "Content-Type: application/json" \
  -H "x-tatum-webhook-secret: <your_tatum_webhook_secret>" \
  -d '{"txId":"6f1c9f4c3c5b0c1e8b2f7c9d1e5a1234567890abcdef","network":"TRON","asset":"TRX","confirmations":19}'
```

## Expected Flow

For on-ramp:

```txt
1. POST /api/v1/ramp/on-ramp creates a pending TRANSAK deposit.
2. Transak webhook updates the order info and amount.
3. Tatum deposit webhook confirms the real TRX transfer.
4. Transaction becomes SUCCESS and wallet balance is credited.
```

For off-ramp:

```txt
1. POST /api/v1/ramp/off-ramp creates a pending TRANSAK withdraw.
2. The frontend should use only POST /api/v1/ramp/off-ramp to start the Transak withdraw flow.
3. Transak webhook marks it SUCCESS or FAILED later.
4. If it fails, the user balance is refunded.
```
