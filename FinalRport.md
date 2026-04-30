# MoneyMatrix Payment Flow Final Report

## Overview

This document defines the production-ready end-to-end payment flow for MoneyMatrix across user onboarding, wallet creation, deposit processing, withdrawal processing, webhook reconciliation, redirect handling, and final wallet settlement.

Core rule:

`The transaction must be created first, then enriched later by webhooks, and the final credit or debit must happen only after webhook confirmation.`

The system uses:

- `Transak` for fiat on-ramp and off-ramp user flows
- `Tatum` for wallet infrastructure and blockchain event confirmation
- `MongoDB` for transaction, wallet, user, and audit persistence
- `metadata.transak`, `metadata.tatum`, and `metadata.success` for future-safe webhook enrichment

The design goal is to keep top-level transaction fields clean for querying and reconciliation, while storing provider payloads in metadata without losing historical detail.

## Admin And User Starting Point

### Admin setup

Before live payment activity starts, the admin side must already be prepared.

1. The system creates or configures the admin treasury wallet.
2. The admin wallet is marked as the operational funding wallet for treasury movement.
3. The admin wallet is used to fund the withdrawal path when required.
4. Webhook secrets for `Transak` and `Tatum` are configured and verified.
5. The backend knows the frontend success redirect domain, including `moneymatrixapp.com`.
6. The system enables logging, auditing, retry handling, and reconciliation jobs.

### User starting point

1. A user opens the application.
2. The user creates an account with the required identity fields.
3. The backend stores the user in an unverified or pending-verification state.
4. The system sends an OTP to the user.
5. The user submits the OTP.
6. The backend verifies the OTP and marks the account as verified.
7. The backend creates or assigns the user wallet after verification.
8. The wallet becomes the user's internal payment wallet for future deposit and withdrawal operations.

## User Onboarding

### Step 1: Account creation

When a new user signs up:

1. The backend creates the user record.
2. The user status is set to a pre-verification state such as `PENDING_OTP`.
3. The system generates an OTP and sends it through the configured delivery channel.
4. A short-lived OTP audit record should be stored for security and abuse monitoring.

### Step 2: OTP verification

When the user submits the OTP:

1. The backend validates the OTP and expiry window.
2. If valid, the user is marked `VERIFIED`.
3. If invalid, the system rejects the request and increments the attempt counter.
4. Repeated failures should trigger throttling or temporary blocking.

### Step 3: Wallet creation or assignment

After successful verification:

1. The backend checks whether a wallet already exists for the user.
2. If no wallet exists, the backend creates or assigns a wallet through the wallet provider flow.
3. The wallet address is saved to the wallet record and linked to the user.
4. The wallet is now available for deposit reception and withdrawal bookkeeping.

## Wallet Creation

The wallet layer has two operational roles:

- `User wallet`: receives user-linked final balance updates after confirmed processing
- `Admin wallet`: acts as treasury and funds the withdrawal path when required

### User wallet purpose

The user wallet is the internal value account used by the application to:

- receive final credited value after confirmed deposit settlement
- hold available balance for future withdrawal requests
- support reporting, reconciliation, and user history

### Admin wallet purpose

The admin wallet is the treasury wallet used to:

- centralize platform operational funds
- fund outbound withdrawal execution when needed
- support settlement and treasury reconciliation

## Deposit Flow

The deposit flow begins when the user wants to buy crypto or fund their application balance through the fiat on-ramp path.

### Step 1: User initiates deposit

1. The user selects deposit.
2. The frontend sends the deposit request with amount, currency, and user context.
3. The backend validates the user, wallet availability, amount, and supported payment parameters.

### Step 2: Transaction record is created immediately

Before redirecting the user anywhere, the backend must create the transaction first.

1. A new `DEPOSIT` transaction is created immediately.
2. The transaction is stored with a generated internal reference and provider correlation fields.
3. The initial transaction status is usually `PENDING`.
4. The record contains the expected user, direction, asset, and amount details.
5. `metadata.transak`, `metadata.tatum`, and `metadata.success` are initialized as empty or null containers.

This step is critical because all future webhook events must enrich this existing transaction instead of creating disconnected payment records later.

### Step 3: Transak on-ramp session is created

1. The backend creates the Transak on-ramp session or URL.
2. The transaction's `externalId` and `providerOrderId` strategy should be bound to the provider session where possible.
3. The backend returns the Transak redirect URL to the frontend.

### Step 4: User is redirected to Transak

1. The frontend redirects the user to the Transak on-ramp page.
2. The user completes payment details.
3. The user completes KYC if Transak requires it.

### Step 5: KYC waiting state

If KYC is triggered:

1. The user completes KYC inside the Transak flow.
2. The application does not credit the wallet during KYC.
3. The transaction remains in a pre-settlement state such as `PENDING` or `PROCESSING`, depending on the webhook state received.
4. The system waits for provider webhooks instead of relying on browser completion alone.

### Step 6: Transak webhook arrives

1. Transak sends webhook events to the backend.
2. The backend verifies the Transak signature.
3. The backend matches the event to the existing transaction using `externalId`, `providerOrderId`, or other trusted correlation identifiers.
4. The full useful Transak payload is stored in `metadata.transak`.
5. Top-level queryable fields such as provider state, order reference, fiat amount, and currency may also be updated.
6. The transaction may move from `PENDING` to `PROCESSING` if the provider marks the order as progressing successfully.

Important rule:

- The Transak webhook does not by itself authorize final wallet credit unless the business rule says provider completion alone is enough.
- For this system, final credit must wait for blockchain webhook confirmation.

### Step 7: Tatum webhook arrives

1. Tatum sends the blockchain deposit webhook after detecting the blockchain transfer.
2. The backend verifies the Tatum webhook secret.
3. The backend matches the blockchain event to the same transaction using wallet address, tx hash, external correlation, and amount checks.
4. The full useful Tatum payload is stored in `metadata.tatum`.
5. The transaction status is advanced only when the required blockchain confirmation conditions are met.

### Step 8: Final deposit confirmation

When the Tatum webhook confirms the blockchain transfer:

1. The backend marks the deposit transaction as confirmed.
2. The system writes the merged final settlement snapshot to `metadata.success`.
3. The transaction status changes to the final successful state such as `SUCCESS` or `COMPLETED`.
4. `confirmedAt`, `processedAt`, and `completedAt` are filled where appropriate.

### Step 9: Wallet is credited only after blockchain confirmation

This is the key accounting rule.

1. The user wallet is credited only after the Tatum blockchain webhook confirms the deposit.
2. No wallet credit should happen only because the redirect finished.
3. No wallet credit should happen only because the Transak checkout screen reported success.
4. The final wallet balance update must happen in the same trusted settlement path as the confirmed transaction state update.

### Step 10: Success redirect

1. After webhook-confirmed success is known, the frontend or backend can redirect the user to the success page.
2. The success page should be on `moneymatrixapp.com`.
3. Redirect is a user experience event, not a settlement event.
4. If the redirect happens before webhook completion, the page should show a waiting or processing message instead of a credited-success message.

## Withdraw Flow

The withdrawal flow begins when the user wants to move value out of the application through off-ramp or payout handling.

### Step 1: User clicks withdraw

1. The user selects withdrawal.
2. The frontend sends the requested amount and required destination or off-ramp context.
3. The backend validates the request.

### Step 2: Wallet balance is checked

1. The backend loads the user wallet balance.
2. The system verifies that the user has sufficient available balance.
3. If the user does not have enough balance, the request is rejected immediately.

### Step 3: Admin wallet funds the withdrawal path when required

1. The user wallet represents the user's internal settled balance.
2. The admin wallet acts as the treasury or operational source wallet when actual payout execution needs platform funding.
3. The system must clearly separate internal user entitlement from treasury-side funding execution.

### Step 4: Transaction record is created immediately

Before redirect or payout execution:

1. A new `WITHDRAW` transaction is created immediately.
2. The transaction status is initialized as `PENDING`.
3. The record stores the expected amount, asset, user, and provider fields.
4. `metadata.transak`, `metadata.tatum`, and `metadata.success` are prepared for later enrichment.

### Step 5: User balance reservation or locking

For a professional production flow:

1. The system should lock or reserve the user's balance at withdrawal start.
2. A locked state is safer than immediate permanent debit.
3. If the flow fails, the lock can be released.
4. If the flow succeeds, the final debit becomes permanent after webhook-confirmed settlement.

If the current implementation debits earlier, the report recommendation is to move toward `lock first, settle later`.

### Step 6: Redirect to Transak off-ramp flow

1. The backend creates the Transak withdrawal or off-ramp flow URL.
2. The backend returns the URL to the frontend.
3. The frontend redirects the user to the Transak flow.
4. The user completes KYC if required.

### Step 7: Transak webhook handling for withdrawal

1. Transak sends webhook updates for the off-ramp order.
2. The backend verifies the webhook signature.
3. The backend matches the event to the existing `WITHDRAW` transaction.
4. The webhook payload is stored in `metadata.transak`.
5. The transaction status is updated to a processing or provider-success stage when appropriate.

### Step 8: Tatum webhook handling for withdrawal

1. If the off-ramp or payout path includes a blockchain transfer, Tatum later sends the blockchain webhook.
2. The backend verifies the Tatum webhook secret.
3. The payload is stored in `metadata.tatum`.
4. The backend confirms that the blockchain event matches the transaction.
5. The transaction should not be finalized until the expected settlement signal is confirmed.

### Step 9: Final withdrawal completion

After successful webhook-confirmed processing:

1. The transaction is marked `SUCCESS` or `COMPLETED`.
2. The final merged settlement snapshot is stored in `metadata.success`.
3. The user's locked balance is converted into a final debit.
4. If admin treasury funds were used for execution, the treasury-side movement is recorded and reconciled.

### Step 10: Success redirect

1. After the webhook-confirmed final state is reached, the user is redirected to the success page.
2. The success page should reflect final settled completion, not only provider screen completion.

### Failure handling

If the withdrawal fails:

1. The transaction is marked `FAILED`.
2. The reason is stored in top-level error fields and relevant metadata.
3. Any locked user balance is released back to available balance.
4. No permanent debit should remain unless settlement truly happened.

## KYC Handling

KYC occurs inside the provider flow, typically at `Transak`.

### Deposit KYC

1. The user enters the Transak on-ramp flow.
2. Transak decides whether KYC is required.
3. The application waits during KYC review or completion.
4. No wallet credit occurs during KYC waiting.

### Withdrawal KYC

1. The user enters the Transak off-ramp flow.
2. KYC may be required before the provider progresses the withdrawal.
3. The application keeps the transaction open while waiting for webhook updates.
4. No final debit or completion occurs from KYC completion alone.

## Transak Webhook Handling

The Transak webhook is the provider-order lifecycle source.

### Purpose

It tells the system:

- whether the user completed the Transak flow
- whether KYC passed, is pending, or failed
- whether the provider order was created, processing, completed, or failed

### Processing rules

1. Verify the webhook signature before using the payload.
2. Normalize the payload into a consistent internal format.
3. Match the payload to the existing transaction.
4. Store the raw or normalized useful payload in `metadata.transak`.
5. Update safe top-level fields for reporting.
6. Never remove previously stored useful payload history.
7. Keep retry and idempotency logic so duplicate webhook deliveries do not double-process the transaction.

### What belongs in `metadata.transak`

Recommended contents:

- event type
- provider order id
- partner or external order id
- status
- sub-status
- wallet address
- fiat amount
- fiat currency
- crypto amount
- crypto currency
- user country
- KYC state
- redirect or checkout context
- raw provider payload snapshot
- webhook received timestamps or history

## Tatum Webhook Handling

The Tatum webhook is the blockchain settlement source.

### Purpose

It tells the system:

- the blockchain transaction hash
- the destination or source address
- the asset and amount observed on-chain
- the confirmation status
- whether final blockchain settlement conditions were met

### Processing rules

1. Verify the Tatum webhook secret before processing.
2. Match the event to the existing transaction by trusted identifiers.
3. Store the payload in `metadata.tatum`.
4. Check idempotency before any balance update.
5. Only after the required confirmation condition is satisfied should settlement proceed.
6. Persist blockchain references into top-level fields such as `txId`, `fromAddress`, `toAddress`, and `confirmedAt`.

### What belongs in `metadata.tatum`

Recommended contents:

- tx hash
- chain or network
- asset
- from address
- to address
- amount
- block number
- confirmation count
- observed timestamp
- subscription type
- webhook received timestamps or history
- raw provider payload snapshot

## Success Redirect

The redirect is the user-facing completion step, but not the accounting trigger.

### Rules

1. Redirect only after the system can determine the transaction is truly successful, or show a processing page if still awaiting webhook confirmation.
2. Use `moneymatrixapp.com` as the final success location.
3. The redirect page should be able to query transaction status by internal reference.
4. If the provider returns the user to the app before final webhook settlement, show `processing`, not `success`.

## Final Transaction Schema

The transaction schema should be query-friendly at the top level and enrichment-friendly in metadata.

```js
const transactionSchema = {
  _id: ObjectId,
  userId: ObjectId,
  walletId: ObjectId,
  type: "DEPOSIT" | "WITHDRAW" | "SWEEP",
  flow: "ON_RAMP" | "OFF_RAMP" | "TREASURY" | "INTERNAL",
  direction: "IN" | "OUT",
  provider: "TRANSAK" | "TATUM" | "SYSTEM" | null,
  status:
    | "PENDING"
    | "LOCKED"
    | "KYC_REQUIRED"
    | "KYC_PENDING"
    | "PROCESSING"
    | "CHAIN_PENDING"
    | "SUCCESS"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED",
  amount: Number,
  amountMinor: Number,
  amountSun: Number,
  fee: Number | null,
  feeMinor: Number | null,
  fiatAmount: Number | null,
  fiatCurrency: String | null,
  cryptoAmount: Number | null,
  cryptoCurrency: String | null,
  currency: String | null,
  network: String | null,
  externalId: String | null,
  providerOrderId: String | null,
  txId: String | null,
  fromAddress: String | null,
  toAddress: String | null,
  reference: String,
  redirectUrl: String | null,
  kycStatus: "NOT_REQUIRED" | "REQUIRED" | "PENDING" | "APPROVED" | "REJECTED" | null,
  processed: Boolean,
  retryCount: Number,
  lastError: String | null,
  failureCode: String | null,
  failureReason: String | null,
  initiatedAt: Date,
  lockedAt: Date | null,
  processedAt: Date | null,
  confirmedAt: Date | null,
  completedAt: Date | null,
  failedAt: Date | null,
  metadata: {
    transak: Object | null,
    tatum: Object | null,
    success: Object | null,
    history: Array,
    audit: Object | null
  },
  createdAt: Date,
  updatedAt: Date
};
```

### Production guidance for the schema

1. Keep top-level fields for filtering, search, dashboards, reconciliation, and audit reporting.
2. Store provider payloads inside metadata so the schema can absorb future webhook fields without destructive migrations.
3. Do not overwrite valuable older webhook details when newer events arrive.
4. Preserve historical event progression where possible through `metadata.history` or a separate audit log.

## Metadata Structure

Recommended metadata design:

```json
{
  "transak": {
    "orderId": "string",
    "partnerOrderId": "string",
    "status": "string",
    "subStatus": "string",
    "kycStatus": "string",
    "fiatAmount": 100,
    "fiatCurrency": "USD",
    "cryptoAmount": 95,
    "cryptoCurrency": "USDT",
    "walletAddress": "string",
    "countryCode": "string",
    "flow": "ON_RAMP",
    "raw": {}
  },
  "tatum": {
    "txId": "string",
    "chain": "TRON",
    "asset": "USDT",
    "fromAddress": "string",
    "toAddress": "string",
    "amount": 95,
    "blockNumber": 123456,
    "confirmations": 20,
    "subscriptionType": "ADDRESS_EVENT",
    "raw": {}
  },
  "success": {
    "provider": "TRANSAK",
    "settlementProvider": "TATUM",
    "type": "DEPOSIT",
    "status": "COMPLETED",
    "currency": "USDT",
    "amount": 95,
    "externalId": "string",
    "providerOrderId": "string",
    "txId": "string",
    "fromAddress": "string",
    "toAddress": "string",
    "completedAt": "2026-04-30T00:00:00.000Z"
  },
  "history": [
    {
      "source": "TRANSAK",
      "event": "ORDER_PROCESSING",
      "receivedAt": "2026-04-30T00:00:00.000Z"
    },
    {
      "source": "TATUM",
      "event": "BLOCKCHAIN_CONFIRMED",
      "receivedAt": "2026-04-30T00:05:00.000Z"
    }
  ],
  "audit": {
    "createdBy": "system",
    "lastReconciledAt": "2026-04-30T00:06:00.000Z"
  }
}
```

### Metadata rules

1. `metadata.transak` stores Transak webhook payloads and derived provider state.
2. `metadata.tatum` stores Tatum webhook payloads and blockchain state.
3. `metadata.success` stores the final merged success record used for settlement proof and reporting.
4. `metadata.history` can keep event snapshots without losing older data.
5. Metadata should enrich the transaction, not replace core top-level fields.

## Webhook Update Strategy

The webhook strategy must be safe against retries, duplicate deliveries, and out-of-order events.

### Strategy

1. Create the transaction before any external provider action starts.
2. Match each webhook to an existing transaction using trusted identifiers.
3. Verify signatures or secrets before applying updates.
4. Merge provider data into metadata instead of replacing the entire metadata object.
5. Update top-level reporting fields only when the new data is trusted and improves reconciliation quality.
6. Record retry count and last error when processing fails.
7. Use idempotent processing so the same webhook cannot credit or debit twice.
8. Accept that Transak and Tatum webhooks may arrive in different order.
9. Final settlement logic should check the full combined transaction state before balance mutation.

### Recommended update order

1. Load transaction.
2. Validate webhook authenticity.
3. Check duplicate or already-processed state.
4. Merge payload into the correct metadata bucket.
5. Update top-level correlation fields.
6. Evaluate status transition rules.
7. If settlement conditions are satisfied, perform wallet mutation and final success write.
8. Mark processing timestamps.
9. Save audit trail.

## Status Transitions

Recommended lifecycle states:

### Deposit

1. `PENDING` when the local transaction is created.
2. `KYC_PENDING` if the provider requires identity verification.
3. `PROCESSING` when the provider flow is progressing.
4. `CHAIN_PENDING` when provider success exists but blockchain confirmation is still pending.
5. `SUCCESS` when blockchain confirmation is achieved and wallet credit is applied.
6. `COMPLETED` when post-settlement bookkeeping and redirect-ready state are finalized.
7. `FAILED` if the flow is cancelled, rejected, or cannot settle.

### Withdrawal

1. `PENDING` when the local transaction is created.
2. `LOCKED` when the user balance is reserved.
3. `KYC_PENDING` if provider identity review is required.
4. `PROCESSING` when provider execution is underway.
5. `CHAIN_PENDING` when treasury-side blockchain movement is awaiting confirmation.
6. `SUCCESS` when webhook-confirmed settlement is achieved and final debit is applied.
7. `COMPLETED` when reconciliation and redirect-ready state are finalized.
8. `FAILED` if the payout fails and the lock must be released.

## Final Success State Strategy

The final success state should exist only when the system has enough trusted evidence to declare the transaction settled.

### Deposit completion rule

Complete the deposit only when:

1. The transaction exists.
2. The provider order is matched.
3. The blockchain transfer is confirmed through Tatum.
4. The wallet credit has been applied successfully.
5. `metadata.success` has been written.

### Withdrawal completion rule

Complete the withdrawal only when:

1. The transaction exists.
2. The user balance was locked or reserved safely.
3. The provider and blockchain states match the expected settlement path.
4. The final debit is applied or confirmed according to the business flow.
5. `metadata.success` has been written.

### What goes into `metadata.success`

`metadata.success` should contain the final merged, stable settlement summary:

- transaction type
- final status
- provider and settlement provider
- amount and currency
- fiat details if applicable
- external provider order id
- blockchain tx id
- from and to addresses
- chain or network
- completed timestamp

## Admin And User Wallet Relationship

The wallet relationship should remain simple and auditable.

### User wallet

The user wallet represents the user's internal settled funds.

### Admin wallet

The admin wallet represents treasury or operational funds used to execute platform-side payout movement when required.

### Interaction rule

1. Deposits result in the user wallet receiving final credited balance after confirmed webhook processing.
2. Withdrawals reduce the user's entitled balance only after the withdrawal flow reaches confirmed settlement.
3. The admin wallet funds the withdrawal path when required.
4. Treasury-side movement and user-side accounting must both be recorded so reconciliation can explain every balance change.

## How The System Decides A Transaction Is Complete

A transaction is complete when all required settlement signals for that transaction type have been satisfied.

### Deposit is complete when

1. The transaction was created before redirect.
2. Transak data is attached if the provider flow was used.
3. Tatum confirms the blockchain transfer.
4. The user wallet credit is successfully applied.
5. The final merged success state is stored.

### Withdrawal is complete when

1. The transaction was created before redirect.
2. The user balance has been safely locked or reserved.
3. Transak and Tatum webhook states match the expected payout path.
4. The final debit or payout settlement is confirmed.
5. The final merged success state is stored.

Browser redirect alone never means the transaction is complete.

## Implementation Notes

### Recommended backend behavior

1. Always create the transaction before calling Transak.
2. Always treat webhook handling as the source of truth for settlement.
3. Always merge webhook payloads into metadata without losing prior useful state.
4. Always keep queryable reconciliation fields at the top level.
5. Always make wallet balance mutation idempotent.
6. Prefer balance locking for withdrawals instead of early irreversible debit.
7. Record timestamps for initiation, lock, confirmation, completion, and failure.

### Recommended audit behavior

1. Keep an append-only event trail in metadata history or a dedicated transaction event collection.
2. Record which provider sent which event and when.
3. Keep enough detail for support, disputes, reconciliation, and compliance reviews.

## Final Notes

This design keeps the transaction as the single source of truth from start to finish.

The professional rule is simple:

1. Create the transaction first.
2. Enrich it through Transak and Tatum webhooks.
3. Credit or debit balances only after confirmed settlement.
4. Redirect the user only when the system can correctly represent the current outcome.

That approach gives MoneyMatrix a clean, auditable, production-ready payment lifecycle for both deposit and withdrawal flows.
