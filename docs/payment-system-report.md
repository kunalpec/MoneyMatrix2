# Payment System Report

## Project overview

This project implements a custodial crypto payment system centered on the Tron network.

It currently uses:

- `Tatum` for Tron wallet generation and blockchain transaction submission
- `Transak` for fiat-to-crypto on-ramp and crypto-to-fiat off-ramp flows
- `MongoDB + Mongoose` for wallet and transaction storage
- `JWT authentication` to protect user payment endpoints

The system already supports:

- user wallet creation
- on-ramp order creation
- Transak widget session URL generation
- Transak webhook processing
- Tatum deposit webhook processing
- automatic sweep from user wallet to admin wallet
- direct TRX withdrawal to an external address
- off-ramp order creation

This is a solid development-stage payment foundation, but it should not yet be described as fully production-ready for real-money use.

## Main payment-related files

- `backend/src/controller/tatum/address.controller.js`
- `backend/src/controller/tatum/ramp.controller.js`
- `backend/src/controller/tatum/webhook.controller.js`
- `backend/src/controller/tatum/transak.controller.js`
- `backend/src/controller/tatum/client.controller.js`
- `backend/src/model/wallet.model.js`
- `backend/src/model/transaction.model.js`
- `backend/src/routes/ramp.route.js`
- `backend/src/routes/webhook.route.js`
- `backend/src/util/EncryptDecrypt.util.js`

## Payment routes

### Authenticated payment routes

Defined in `backend/src/routes/ramp.route.js` and protected by `verifyJWT`:

- `POST /on-ramp` -> `createOnRampUrl`
- `POST /off-ramp` -> `createOffRampUrl`
- `POST /withdraw` -> `withdrawTrx`

### Webhook routes

Defined in `backend/src/routes/webhook.route.js` and intentionally not protected by JWT because they are called by external providers:

- `POST /tatum/deposit` -> `tronWebhook`
- `POST /tatum/withdraw` -> `tronWithdrawWebhook`
- `POST /transak` -> `transakWebhook`

## Current payment architecture

### 1. Wallet creation flow

The wallet creation flow is handled by `UserWallet`.

How it works:

1. The backend loads the authenticated user.
2. It checks whether the user already has a wallet.
3. If not, it requests a Tron wallet from Tatum.
4. It derives the first Tron address from the returned `xpub`.
5. It encrypts the mnemonic before saving it.
6. It stores the wallet in MongoDB.
7. It updates the user record with the public Tron address.

Why it exists:

- to create one blockchain wallet per user
- to avoid duplicate wallet creation
- to store the public deposit address for future payment flows
- to retain signing material for later blockchain actions

Main function:

- `UserWallet`

### 2. On-ramp deposit flow

The on-ramp flow is handled by `createOnRampUrl`.

How it works:

1. The backend verifies that the user already has a wallet.
2. It validates the fiat amount.
3. It creates a local `Transaction` with type `DEPOSIT` and status `PENDING`.
4. It generates a unique `externalId` using `crypto.randomUUID()`.
5. It builds a Transak widget session URL.
6. The frontend redirects the user to the Transak checkout.
7. Later, Transak and Tatum webhooks update the transaction lifecycle.

Why it exists:

- to create a local payment record before the third-party checkout starts
- to bind the external Transak order to an internal transaction
- to support traceability and idempotent webhook handling

Main function:

- `createOnRampUrl`

### 3. Transak order-status webhook flow

The Transak webhook flow is handled by `transakWebhook`.

How it works:

1. The backend verifies the `x-transak-signature` HMAC.
2. It normalizes the incoming payload using `getPayload`.
3. It stores the normalized provider payload in the matching `Transaction` metadata.
4. It finds the related transaction by `externalId`.
5. If the event is a successful deposit event, it moves the transaction to `PROCESSING`.
6. If the event is a successful withdrawal event, it marks the transaction `SUCCESS`.
7. If the event is a failure for an off-ramp withdrawal, it refunds the user wallet balance and marks the transaction `FAILED`.

Why it exists:

- to capture provider-level order status changes
- to distinguish provider completion from actual blockchain confirmation
- to preserve provider and blockchain state on the matching transaction record

Main function:

- `transakWebhook`

### 4. Tatum deposit webhook flow

The Tron deposit webhook flow is handled by `tronWebhook`.

How it works:

1. The backend verifies `x-tatum-webhook-secret`.
2. It extracts `txId`, destination address, amount, and confirmations.
3. It reads and reconciles the webhook payload against the matching `Transaction`.
4. It waits until the configured minimum confirmation count is reached.
5. It checks whether the blockchain transaction was already processed.
6. It finds or creates the matching `DEPOSIT` transaction.
7. It credits the wallet balance in MongoDB.
8. It marks the deposit transaction `SUCCESS`.
9. It creates a pending sweep placeholder if the deposit belongs to a user wallet instead of the admin wallet.
10. It triggers sweep execution asynchronously.

Why it exists:

- to credit user balance only after blockchain confirmation
- to make deposit processing idempotent
- to support sweep scheduling after deposit settlement

Main function:

- `tronWebhook`

### 5. Automatic sweep to admin wallet

The sweep flow uses `createSweepPlaceholder`, `sweepToAdminWallet`, and `executePendingSweep`.

How it works:

1. After a user deposit is confirmed, a `SWEEP` transaction placeholder is created.
2. The system loads the user wallet and admin wallet.
3. It decrypts the user mnemonic.
4. It derives the Tron private key from the mnemonic.
5. It sends the TRX from the user wallet to the admin wallet through Tatum.
6. It updates the `SWEEP` transaction with blockchain status information.
7. It increases the admin wallet balance in MongoDB.

Why it exists:

- to centralize treasury funds in the admin wallet
- to reduce operational balances spread across user wallets
- to make later payouts easier from one main treasury wallet

Main functions:

- `createSweepPlaceholder`
- `sweepToAdminWallet`
- `executePendingSweep`

### 6. Direct TRX withdrawal flow

The direct crypto payout flow is handled by `withdrawTrx`.

How it works:

1. A user submits an amount and destination Tron address.
2. The backend validates the amount.
3. It checks that the admin wallet has enough balance.
4. If the caller is not an admin, it deducts the user balance first.
5. It creates a `WITHDRAW` transaction with status `PENDING`.
6. It decrypts the admin mnemonic and derives the private key.
7. It sends the TRX through Tatum.
8. It reduces the admin wallet balance in MongoDB.
9. It marks the transaction `SUCCESS`.
10. If submission fails, it refunds the user balance and marks the transaction `FAILED`.

Why it exists:

- to support direct crypto payouts
- to send funds from a central treasury wallet
- to provide a withdrawal path that does not depend on the Transak off-ramp

Main function:

- `withdrawTrx`

### 7. Off-ramp flow

The Transak sell flow is handled by `createOffRampUrl`.

How it works:

1. The backend validates the requested amount.
2. It immediately deducts the user balance in MongoDB.
3. It creates a `WITHDRAW` transaction with a unique `externalId`.
4. It builds a Transak sell widget session URL.
5. The frontend redirects the user to the sell flow.
6. Transak webhooks later mark the transaction successful or failed.
7. If widget creation fails, the deducted balance is refunded and the transaction is marked `FAILED`.

Why it exists:

- to connect internal wallet balance to fiat withdrawal
- to create a pending transaction before the third-party flow begins
- to preserve internal accounting around off-ramp attempts

Main function:

- `createOffRampUrl`

### 8. Tatum withdraw-confirmation webhook flow

The withdrawal confirmation webhook is handled by `tronWithdrawWebhook`.

How it works:

1. The backend verifies the Tatum webhook secret.
2. It reconciles the webhook payload against the matching `Transaction`.
3. It finds the related `WITHDRAW` transaction by `txId`.
4. It safely locks the transaction for processing.
5. It marks the withdrawal as `SUCCESS` and stores processing timestamps.

Why it exists:

- to record final blockchain confirmation for outgoing TRX transfers
- to make withdraw confirmation idempotent
- to keep an auditable post-submission lifecycle for withdrawals

Main function:

- `tronWithdrawWebhook`

## Important functions and what they do

### Controller functions

#### `UserWallet`

Creates a Tron wallet for the authenticated user if one does not already exist, encrypts the mnemonic, stores the address and `xpub`, and saves the public address onto the user profile.

#### `createOnRampUrl`

Creates a pending deposit transaction and returns a Transak widget URL for fiat-to-TRX purchase.

#### `createOffRampUrl`

Deducts user balance, creates a pending withdrawal transaction, and returns a Transak sell widget URL.

#### `withdrawTrx`

Submits a direct TRX withdrawal from the admin wallet to an external address and records the result in the `Transaction` collection.

#### `sweepToAdminWallet`

Creates or resumes a `SWEEP` transaction for a confirmed user deposit and forwards execution to the sweep worker.

#### `executePendingSweep`

Locks a pending sweep, decrypts the user wallet secret, submits the Tron transfer, credits the admin wallet balance, and updates the sweep transaction result.

#### `transakWebhook`

Processes Transak order-state webhooks, updates transaction status, handles refunds for failed off-ramp withdrawals, and stores webhook-delivery history.

#### `tronWebhook`

Processes Tatum deposit webhooks, waits for confirmation depth, credits wallet balance, marks the deposit successful, and schedules a sweep when needed.

#### `tronWithdrawWebhook`

Processes Tatum withdrawal-confirmation webhooks and finalizes matching withdrawal transactions.

### Provider and client helper functions

#### `tatumClient`

A shared Axios client configured for Tatum API calls so the code does not repeat base URL, headers, and timeout configuration.

#### `generateTransakAccessToken`

Requests a Transak partner access token using the configured API key and secret.

#### `getTransakAccessToken`

Returns the generated Transak token through an HTTP response when needed by the application.

#### `createTransakWidgetUrl`

Creates a Transak session and returns the widget URL used by the frontend checkout flow.

#### `getTransakEnvironmentConfig`

Builds Transak environment-specific configuration such as host URL, referrer domain, and session API URL based on `NODE_ENV`.

#### `getTransakRefreshTokenUrl`

Chooses the Transak token endpoint for development or production mode.

### Webhook helper functions

#### `verifyTatum`

Checks the incoming `x-tatum-webhook-secret` header before allowing webhook processing.

#### `verifyTransakSignature`

Verifies the Transak HMAC signature using the raw request payload and shared webhook secret.

#### `getPayload`

Normalizes different webhook body shapes into a consistent `{ eventType, data }` format.

#### `getAmount`

Extracts the amount from several possible provider payload fields.

#### `parseCurrency`

Extracts the currency or token code from different provider field names.

#### `parseProviderTxId`

Extracts the blockchain transaction hash from Transak payload variants.

#### `incrementTransactionRetry`

Increments transaction retry metadata when webhook processing fails and can eventually mark the transaction as failed.

#### `createSweepPlaceholder`

Creates a pending `SWEEP` transaction inside the deposit-processing database transaction so sweep work can continue safely later.

### Wallet and encryption helper functions

#### `encrypt`

Encrypts the wallet mnemonic before it is stored in MongoDB.

#### `decrypt`

Decrypts the stored mnemonic when the system needs to sign a blockchain transaction.

#### `derivePrivateKeyFromMnemonic`

Derives a Tron private key from the mnemonic using the Tron HD derivation path.

## Data models and why they matter

### Wallet model

The `Wallet` model stores:

- `user`
- `balance`
- `lockedBalance`
- `address`
- `xpub`
- `mnemonic`
- `index`
- `signatureId`
- `signerProvider`
- `signerRef`
- `isAdmin`

Why this model matters:

- it represents the user's payment account inside the app
- it stores the Tron deposit address
- it tracks available and locked balances
- it marks the special admin treasury wallet

Wallet methods:

- `credit(amount)` -> increases balance
- `debit(amount)` -> decreases balance if funds are sufficient
- `lockAmount(amount)` -> moves funds from available balance to locked balance
- `settleWin(betAmount, winAmount, io, userSocket)` -> unlocks a bet, credits winnings, and can emit a socket update
- `settleLoss(amount)` -> removes locked balance for a losing bet

### Transaction model

The `Transaction` model stores:

- `userId`
- `type`
- `amount`
- `status`
- `provider`
- `currency`
- `txId`
- `externalId`
- `fromAddress`
- `toAddress`
- `metadata`
- `processed`
- `retryCount`
- `lastError`
- `lockedAt`
- `processedAt`
- `confirmedAt`
- `completedAt`

Supported transaction types:

- `DEPOSIT`
- `WITHDRAW`
- `SWEEP`

Supported statuses:

- `PENDING`
- `LOCKED`
- `PROCESSING`
- `SUCCESS`
- `FAILED`

Why this model matters:

- it provides the main payment audit trail
- it stores provider references and blockchain references
- it supports locking, retries, idempotency, and processing state

Important indexes:

- unique partial index on `externalId`
- unique partial index on `txId`

## Security and reliability features already present

The current implementation already includes some useful safeguards:

- JWT protection on user payment routes
- Tatum webhook secret verification
- Transak HMAC signature verification
- encrypted mnemonic storage instead of plaintext
- local transaction creation before external processing
- provider payload persistence inside transaction metadata
- unique transaction indexes on `externalId` and `txId`
- duplicate deposit protection in blockchain webhook handling
- retry tracking for transaction and webhook failures
- configurable minimum Tron confirmation count
- transaction locking states such as `LOCKED`, `PROCESSING`, `SUCCESS`, and `FAILED`
- refund rollback in some failed off-ramp or withdraw cases

## Gaps before real-money production use

### 1. Server-side mnemonic custody

Current state:

- user and admin mnemonics are stored in the application database
- the application decrypts them to derive private keys

Risk:

- if the app server or database is compromised, attacker-controlled signing becomes possible

What is needed:

- move signing to KMS, HSM, or Tatum KMS
- minimize access to signing credentials
- avoid raw mnemonic decryption in application code

### 2. Floating-point money handling

Current state:

- balances and transaction amounts use JavaScript `Number`

Risk:

- rounding and precision problems can occur in financial logic

What is needed:

- store values in smallest units
- use integer accounting or a decimal library
- define clear rounding rules

### 3. Weak withdrawal address validation

Current state:

- `withdrawTrx` validates the amount but does not strongly validate destination addresses

Risk:

- malformed or unsupported Tron addresses may be submitted

What is needed:

- validate Tron address format strictly
- reject blocked destinations and self-transfers
- enforce correct network assumptions

### 4. Incomplete transactional consistency

Current state:

- some balance updates and transaction updates happen in separate operations

Risk:

- partial state changes can happen if one write succeeds and another fails

What is needed:

- use MongoDB transactions for all critical balance and transaction state changes
- especially for withdrawals, refunds, and treasury accounting

### 5. Partial webhook idempotency

Current state:

- duplicate detection exists, but some deposit matching still falls back to address-based lookup

Risk:

- out-of-order or repeated events could attach to the wrong pending transaction

What is needed:

- prefer strict order binding through provider references
- persist provider event identifiers where available
- expand webhook reconciliation logic

### 6. Admin treasury balance drift risk

Current state:

- admin balance is maintained in MongoDB after sweep and withdrawal operations

Risk:

- database balance can drift from actual on-chain balance

What is needed:

- add regular reconciliation jobs
- compare treasury records with blockchain balances
- alert on mismatches

### 7. Limited confirmation-depth policy

Current state:

- the code supports a configurable minimum confirmation count, but the business policy is still minimal

Risk:

- too-low confirmation depth increases premature credit risk

What is needed:

- define a stronger confirmation policy
- consider separate states such as seen, confirmed, and finalized

### 8. Missing fraud and compliance controls

Current state:

- the code focuses on payment processing, not regulated operational controls

What is needed:

- KYC and AML enforcement
- sanctions screening
- suspicious activity monitoring
- risk checks on device and IP
- admin review rules for high-value withdrawals
- immutable audit logging

### 9. Environment and configuration hardening

Current state:

- environment-sensitive behavior exists, especially around development and production URLs

Risk:

- unsafe configuration could weaken webhook or provider protection in a public deployment

What is needed:

- enforce production environment checks
- validate required secrets at startup
- add deployment safeguards for webhook configuration

### 10. Missing rate limits and abuse controls

Current state:

- the reviewed payment routes do not show visible rate limiting

What is needed:

- rate limit wallet creation, on-ramp, off-ramp, and withdraw endpoints
- add IP and user-based throttling
- alert on repeated failures and suspicious payment behavior

## What is safe to say about the current system

It is accurate to say:

- the project has a working crypto payment flow built with Tatum and Transak
- it tracks deposits, withdrawals, sweeps, and webhook state in transactions
- it uses encrypted mnemonic storage, webhook verification, and transaction indexing
- it is suitable as a development or staging payment foundation

It is not yet accurate to say:

- it is fully production-ready for real-money payments
- it is fully secure against signing-key compromise
- it has full treasury reconciliation and compliance coverage

## Recommended production-readiness checklist

1. Replace server-side mnemonic handling with KMS or HSM signing.
2. Move monetary values to integer smallest-unit accounting.
3. Add MongoDB transactions around all critical balance and transaction updates.
4. Add strict Tron address validation and withdrawal policy checks.
5. Store webhook event identifiers and strengthen idempotency rules.
6. Add treasury reconciliation against on-chain balances.
7. Add withdrawal review rules, limits, and anti-fraud controls.
8. Add route rate limiting and anomaly alerts.
9. Add stronger audit logging and operational monitoring.
10. Add startup and deployment checks for secrets and payment configuration.

## Short technical summary

This payment system follows a custodial Tron wallet architecture. User wallets are created through Tatum, on-ramp and off-ramp flows are handled through Transak, and internal balances are maintained in MongoDB using `Wallet` and `Transaction` models. Deposits are first tracked locally, then finalized through provider and blockchain webhooks, and confirmed user deposits can be swept into a central admin treasury wallet. The strongest parts of the implementation are local transaction tracking, webhook verification, stateful processing, and transaction-level audit data. The main weaknesses are server-side key custody, floating-point money handling, incomplete reconciliation, and missing production-grade compliance and abuse protections.

## Suggested statement for client or team discussion

This project currently uses Tatum for Tron wallet generation and blockchain transfers, and Transak for fiat on-ramp and off-ramp flows. Internal balances and payment transactions are stored in MongoDB through dedicated `Wallet` and `Transaction` models, with provider and blockchain payloads embedded in transaction metadata. Deposits are created locally before external processing, then finalized through provider and blockchain webhooks, and confirmed user deposits can be swept into an admin treasury wallet. The implementation is a strong development-stage payment base, but before real-money production it still needs stronger key management, integer-based accounting, stricter withdrawal validation, broader transactional consistency, treasury reconciliation, rate limiting, and compliance controls.
